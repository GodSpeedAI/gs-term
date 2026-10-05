// Phase-2 core proof — the SAME semantic capability (`process.exec`) executes in two worlds.
// Local and SSH runs share capability identity, operation meaning, argv, actor, effect
// vocabulary, and evidence STRUCTURE — while world/provider/host provenance differs and is
// never normalized away. Resource identity = (worldId, path).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { utils } from "ssh2";
import type { Caller } from "@cognate/runtime-api";
import { loadSshFixture, type SshFixture } from "../support/ssh-fixture.ts";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { Effect, EffectObservedPayload, ExecutionCompletedPayload, ExecutionStartedPayload, WorldSnapshot } from "../../src/semantic/contracts.ts";
import type { ExecutionEntry } from "../../src/projections/executions.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };
const stranger: Caller = { tenant: "local", actor: { id: "stranger", kind: "user" } };
const PROOF_COMMAND = ["sh", "-lc", "printf hello > semantic-world-proof.txt"] as const;

let fixture: SshFixture | undefined;
let localRoot = "";
let remoteRoot = "";
let keyDir = "";
let keyPath = "";
let app: GsTermRuntime | undefined;

function config(): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root: localRoot },
    session: { id: "worlds-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {
      "ssh-test": {
        kind: "ssh",
        display: "SSH test box",
        host: "127.0.0.1",
        port: fixture!.port,
        username: "tester",
        root: remoteRoot,
        auth: `key:${keyPath}`,
        hostKeyFingerprints: [fixture!.fingerprint],
        defaultTimeoutMs: 10_000,
        readyTimeoutMs: 10_000,
      },
      // Registered but unreachable — the provider must fail closed, honestly.
      "ssh-down": {
        kind: "ssh",
        display: "unreachable host",
        host: "127.0.0.1",
        port: 1,
        username: "tester",
        root: remoteRoot,
        auth: `key:${keyPath}`,
        hostKeyFingerprints: [fixture!.fingerprint],
        defaultTimeoutMs: 2_000,
        readyTimeoutMs: 1_000,
      },
    },
  };
}

async function settle(runId: string, timeoutMs = 20_000): Promise<{ status: string; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await app!.runtime.idle(2_000).catch(() => undefined); // a long world op can keep the loop busy
    const run = await app!.runtime.service.getRun(system, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return { status: run.status, error: run.error };
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle`);
    await Bun.sleep(25);
  }
}

async function eventsFor(runId: string): Promise<{ eventType: string; payload: unknown }[]> {
  const collected: { eventType: string; payload: unknown; metadata: unknown }[] = [];
  for await (const event of app!.runtime.service.events(system, { runId })) {
    collected.push({ eventType: event.eventType, payload: event.payload, metadata: event.metadata });
  }
  return collected;
}

async function entries(): Promise<ExecutionEntry[]> {
  const rows = await app!.runtime.service.readProjection(system, { name: "executions" });
  return rows.map((row) => row.value as unknown as ExecutionEntry).filter((entry) => entry.executionId !== undefined);
}

async function runInWorld(worldId: string, argv: readonly string[], options: { readonly idempotencyKey: string; readonly cwd?: string }) {
  const view = await app!.runtime.service.startRun(system, {
    agent: "agent.execute",
    input: { argv: [...argv], cwd: options.cwd ?? ".", worldId, source: "ui", surface: "test", requestedBy: "worlds-test" },
    idempotencyKey: options.idempotencyKey,
    correlationId: "session:worlds-test",
  });
  return { runId: view.runId, settled: await settle(view.runId) };
}

beforeAll(async () => {
  localRoot = await mkdtemp(join(tmpdir(), "gsterm-worlds-local-"));
  remoteRoot = await mkdtemp(join(tmpdir(), "gsterm-worlds-remote-"));
  keyDir = await mkdtemp(join(tmpdir(), "gsterm-worlds-key-"));
  const keys = utils.generateKeyPairSync("ed25519");
  keyPath = join(keyDir, "id_ed25519");
  await writeFile(keyPath, keys.private);
  const fixtureModule = await loadSshFixture();
  fixture = await fixtureModule.startSshFixture({ users: { tester: { publicKeys: [keys.public] } } });
  app = await createGsTermRuntime({ config: config(), store: ":memory:", domainRoot: REPO_ROOT });
});

afterAll(async () => {
  await app?.close();
  await fixture?.close();
  for (const dir of [localRoot, remoteRoot, keyDir]) if (dir) await rm(dir, { recursive: true, force: true });
});

describe("Phase 2: same capability, two worlds", () => {
  test("provider selection: one registry, worldId routes to the provider", async () => {
    const worlds = app!.worlds.registry.list();
    expect(worlds.map((world) => world.worldId)).toEqual(["local", "ssh-down", "ssh-test"]);
    expect(worlds.map((world) => world.kind)).toEqual(["local", "ssh", "ssh"]);

    // The SAME capability id for both — no ssh.* anywhere.
    const local = await app!.runtime.service.invoke(system, {
      capability: "process.exec",
      input: { worldId: "local", argv: ["sh", "-lc", "echo LOCAL_MARK"], cwd: localRoot },
    }) as { stdout: string };
    const remote = await app!.runtime.service.invoke(system, {
      capability: "process.exec",
      input: { worldId: "ssh-test", argv: ["sh", "-lc", "echo SSH_MARK"], cwd: remoteRoot },
    }) as { stdout: string };
    expect(local.stdout.trim()).toBe("LOCAL_MARK");
    expect(remote.stdout.trim()).toBe("SSH_MARK");
  });

  test("same command, two worlds: one semantic operation, two physical truths", async () => {
    const localRun = await runInWorld("local", PROOF_COMMAND, { idempotencyKey: "worlds-proof-local" });
    const sshRun = await runInWorld("ssh-test", PROOF_COMMAND, { idempotencyKey: "worlds-proof-ssh" });
    expect(localRun.settled.status).toBe("completed");
    expect(sshRun.settled.status).toBe("completed");

    const localEvents = await eventsFor(localRun.runId);
    const sshEvents = await eventsFor(sshRun.runId);

    // SAME operation meaning: the capability invocation carries identical argv in both runs,
    // and both invocations name the SAME capability identity.
    for (const events of [localEvents, sshEvents]) {
      const invocation = events.find(
        (event) => event.eventType === "run.invocation" && (event as { metadata?: { capability?: string } }).metadata?.capability === "process.exec",
      )!;
      expect((invocation as { metadata?: { capability?: string } }).metadata?.capability).toBe("process.exec");
      const input = (invocation.payload as { input: { argv: string[] } }).input;
      expect(input.argv).toEqual([...PROOF_COMMAND]);
    }
    const localStart = localEvents.find((event) => event.eventType === "execution.started")!.payload as ExecutionStartedPayload;
    const sshStart = sshEvents.find((event) => event.eventType === "execution.started")!.payload as ExecutionStartedPayload;
    expect(localStart.command).toBe(sshStart.command);
    expect(localStart.argv).toEqual(sshStart.argv);
    expect(localStart.actor).toBe(sshStart.actor);
    expect(localStart.source).toBe(sshStart.source);

    // DIFFERENT world identity — provenance, never normalized away.
    expect(localStart.worldId).toBe("local");
    expect(sshStart.worldId).toBe("ssh-test");

    for (const events of [localEvents, sshEvents]) {
      const completed = events.find((event) => event.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
      expect(completed.exitCode).toBe(0);
    }

    // SAME effect vocabulary; DIFFERENT world provenance in the effect and its evidence.
    const localEffect = (localEvents.find((event) => event.eventType === "effect.observed")!.payload as EffectObservedPayload).effects
      .find((effect) => effect.kind === "file.created")!;
    const sshEffect = (sshEvents.find((event) => event.eventType === "effect.observed")!.payload as EffectObservedPayload).effects
      .find((effect) => effect.kind === "file.created")!;
    expect(localEffect.target).toBe("semantic-world-proof.txt");
    expect(sshEffect.target).toBe(localEffect.target);
    expect(localEffect.worldId).toBe("local");
    expect(sshEffect.worldId).toBe("ssh-test");
    expect(localEffect.evidence[0]!.how).toBe(sshEffect.evidence[0]!.how);
    expect(localEffect.evidence[0]!.refs.join(" ")).toContain(localRoot);
    expect(sshEffect.evidence[0]!.refs.join(" ")).toContain(remoteRoot);
    expect(sshEffect.evidence.map((item) => item.what).join(" ")).toContain("ssh-test");
  });

  test("resource identity: identical paths in different worlds stay distinct (acceptance D)", async () => {
    const all = await entries();
    const localEntry = all.find((entry) => entry.command?.includes("semantic-world-proof.txt") && entry.worldId === "local");
    const sshEntry = all.find((entry) => entry.command?.includes("semantic-world-proof.txt") && entry.worldId === "ssh-test");
    expect(localEntry).toBeDefined();
    expect(sshEntry).toBeDefined();
    expect(localEntry!.executionId).not.toBe(sshEntry!.executionId);

    const pairs = [...localEntry!.effects, ...sshEntry!.effects].map((effect: Effect) => `${effect.worldId}:${effect.target}`);
    expect(new Set(pairs).size).toBe(pairs.length); // (worldId, path) identity never collides
    expect(pairs).toContain("local:semantic-world-proof.txt");
    expect(pairs).toContain("ssh-test:semantic-world-proof.txt");
  });

  test("remote evidence is gathered, not inferred from exit 0 (acceptance C)", async () => {
    // file.created (absent → present) is what the snapshots derived; contents verified through
    // the REMOTE world's own ports — the local filesystem is a different world entirely.
    const remote = app!.worlds.registry.get("ssh-test");
    const remotePath = remote.fileSystem.resolve(remoteRoot, "semantic-world-proof.txt");
    expect(await remote.fileSystem.readText(remotePath)).toBe("hello");
    const viaRemoteProcess = await remote.process.exec({ argv: ["sh", "-lc", "cat semantic-world-proof.txt"], cwd: remoteRoot });
    expect(viaRemoteProcess.stdout).toBe("hello");

    const local = app!.worlds.registry.get("local");
    const localPath = local.fileSystem.resolve(localRoot, "semantic-world-proof.txt");
    expect(await local.fileSystem.readText(localPath)).toBe("hello");

    // Clean both worlds THROUGH their providers, then verify absence (absence ≠ false).
    await local.process.exec({ argv: ["rm", "-f", "semantic-world-proof.txt"], cwd: localRoot });
    await remote.process.exec({ argv: ["sh", "-lc", "rm -f semantic-world-proof.txt"], cwd: remoteRoot });
    expect(await stat(localPath).catch(() => undefined)).toBeUndefined();
    expect(await remote.fileSystem.exists(remotePath)).toBe(false);
  });

  test("world switching is an input change: same argv, where it ran is visible (acceptance E)", async () => {
    const localRun = await runInWorld("local", ["sh", "-lc", "pwd"], { idempotencyKey: "worlds-pwd-local" });
    const sshRun = await runInWorld("ssh-test", ["sh", "-lc", "pwd"], { idempotencyKey: "worlds-pwd-ssh" });
    const localOutput = (await eventsFor(localRun.runId)).find((e) => e.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    const sshOutput = (await eventsFor(sshRun.runId)).find((e) => e.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    const localStdout = (localOutput.output as { stdout: string }).stdout.trim();
    const sshStdout = (sshOutput.output as { stdout: string }).stdout.trim();
    // The identical semantic operation reports different physical truths per world.
    expect(localStdout).toBe(localRoot);
    expect(sshStdout).toBe(remoteRoot);
    expect(localStdout).not.toBe(sshStdout);
  });

  test("failures settle honestly (acceptance G)", async () => {
    // (a) unknown world id fails closed at INPUT VALIDATION — no semantic execution claimed.
    const unknown = await runInWorld("no-such-world", ["sh", "-lc", "true"], { idempotencyKey: "worlds-unknown" });
    expect(unknown.settled.status).toBe("failed");
    expect(unknown.settled.error).toMatch(/unknown execution world/);
    const unknownEvents = await eventsFor(unknown.runId);
    expect(unknownEvents.some((event) => event.eventType === "execution.started")).toBe(false);
    expect(unknownEvents.some((event) => event.eventType === "effect.observed")).toBe(false);

    // (b) registered-but-unreachable world: transport failure, not fake command semantics.
    const down = await runInWorld("ssh-down", ["sh", "-lc", "true"], { idempotencyKey: "worlds-down" });
    expect(down.settled.status).toBe("failed");
    const downEvents = await eventsFor(down.runId);
    expect(downEvents.some((event) => event.eventType === "execution.started")).toBe(true);
    expect(downEvents.some((event) => event.eventType === "effect.observed")).toBe(false); // no false effects
    const failure = downEvents.find((event) => event.eventType === "execution.failed")!.payload as { reason: string };
    expect(failure.reason.length).toBeGreaterThan(0);

    // (c) non-zero exit settles as an execution with its true exit code (not a run failure).
    const failing = await runInWorld("ssh-test", ["sh", "-lc", "printf oops >&2; exit 3"], { idempotencyKey: "worlds-exit3" });
    expect(failing.settled.status).toBe("completed");
    const failEvents = await eventsFor(failing.runId);
    const completed = failEvents.find((event) => event.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    expect(completed.exitCode).toBe(3);

    // (d) invalid remote working directory: honest non-zero process outcome, no hang.
    const badCwd = await runInWorld("ssh-test", ["sh", "-lc", "true"], { idempotencyKey: "worlds-badcwd", cwd: "no-such-dir" });
    expect(badCwd.settled.status).toBe("completed");
    const cwdEvents = await eventsFor(badCwd.runId);
    const cwdCompleted = cwdEvents.find((event) => event.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    expect(cwdCompleted.exitCode).not.toBe(0);
  });

  test("authority: capability grants are explicit; world registration is the grant boundary", async () => {
    // Ungranted actors cannot start journeys or invoke capabilities (Phase-1 policy).
    await expect(
      app!.runtime.service.startRun(stranger, {
        agent: "agent.execute",
        input: { argv: ["sh", "-lc", "true"], cwd: ".", worldId: "local", source: "ui", surface: "test", requestedBy: "stranger" },
        idempotencyKey: "worlds-stranger",
      }),
    ).rejects.toThrow(/permission_denied|not recognized|no authority/i);

    // An unregistered world is refused at the registry boundary (fail closed, never falls back
    // to local) — DEBT D-002 workaround: registration is what grants a world, not policy.
    await expect(
      app!.runtime.service.invoke(system, {
        capability: "process.exec",
        input: { worldId: "unregistered-world", argv: ["sh", "-lc", "true"], cwd: localRoot },
      }),
    ).rejects.toThrow(/unavailable/i);
  });
});

