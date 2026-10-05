// Phase 2.5 proofs — observation ingestion. Reality facts enter the semantic log as first-class
// observations (NOT actions/runs) with truthful attribution. D: a foreign fact (outside any Cognate
// action) enters WITHOUT manufacturing a run. E: an execution's effect retains correlation + cited
// causation while remaining semantically an observation (runId:null). F: observed reality can exist
// with UNKNOWN causation (causedBy:unknown, never invented). G: (worldId, resource) identity holds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { utils } from "ssh2";
import type { Caller, ObservationInput } from "@cognate/runtime-api";
import { loadSshFixture, type SshFixture } from "../support/ssh-fixture.ts";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { EffectObservedPayload, WorldSnapshot } from "../../src/semantic/contracts.ts";
import { effectToObservation, factToObservation } from "../../src/semantic/observations.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };
const SESSION = "session:j6";
const observedAt = "2026-01-01T00:00:00Z";

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
    session: { id: "j6-observations", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {
      "ssh-test": {
        kind: "ssh", display: "SSH test box", host: "127.0.0.1", port: fixture!.port, username: "tester",
        root: remoteRoot, auth: `key:${keyPath}`, hostKeyFingerprints: [fixture!.fingerprint],
        defaultTimeoutMs: 10_000, readyTimeoutMs: 10_000,
      },
    },
  };
}

async function settle(runId: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await app!.runtime.idle(2_000).catch(() => undefined);
    const run = await app!.runtime.service.getRun(system, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run.status;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle`);
    await Bun.sleep(25);
  }
}

async function allEvents(): Promise<{ eventId: string; eventType: string; runId: string | null; causationId: string | null; correlationId: string; metadata: unknown; payload: unknown }[]> {
  const collected: { eventId: string; eventType: string; runId: string | null; causationId: string | null; correlationId: string; metadata: unknown; payload: unknown }[] = [];
  for await (const e of app!.runtime.service.events(system, {})) {
    collected.push({ eventId: e.eventId, eventType: e.eventType, runId: e.runId, causationId: e.causationId, correlationId: e.correlationId, metadata: e.metadata, payload: e.payload });
  }
  return collected;
}

async function runStartedCount(): Promise<number> {
  return (await allEvents()).filter((e) => e.eventType === "run.started").length;
}

beforeAll(async () => {
  localRoot = await mkdtemp(join(tmpdir(), "gsterm-j6-local-"));
  remoteRoot = await mkdtemp(join(tmpdir(), "gsterm-j6-remote-"));
  keyDir = await mkdtemp(join(tmpdir(), "gsterm-j6-key-"));
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

describe("Phase 2.5: observation ingestion proofs", () => {
  test("D: a foreign fact enters as an observation, not a fabricated run", async () => {
    // Reality changes OUTSIDE any gs-term execution (a foreign actor writes a file).
    await writeFile(join(localRoot, "foreign-fact.txt"), "appeared by a foreign actor");
    // The mechanism observes it through the world's own port.
    const snapshot = await app!.runtime.service.invoke(system, { capability: "world.snapshot", input: { worldId: "local" } }) as unknown as WorldSnapshot;
    const seen = snapshot.files.find((f) => f.path === "foreign-fact.txt");
    expect(seen).toBeDefined();
    const runsBefore = await runStartedCount();
    // Record it through the honest door (service.observe) — an observation, not an action/run.
    const view = await app!.runtime.service.observe(system, factToObservation(
      "file.exists",
      { worldId: "local", resource: "foreign-fact.txt", kind: "file" },
      { present: true, size: seen!.size },
      { observer: "fs-walk", provider: "local", method: "world.snapshot" },
      { kind: "unattributed", confidence: "observed" },
      snapshot.observedAt,
      "proof-d-foreign-fact",
    ) as unknown as ObservationInput);
    const obs = (await allEvents()).find((e) => e.eventId === view.eventId)!;
    expect(obs.eventType).toBe("observation.recorded");
    expect(obs.runId).toBeNull();          // NOT part of a run
    expect(obs.causationId).toBeNull();    // no fabricated cause
    expect((obs.metadata as any).source).toBe("observation");
    expect((obs.payload as any).facts.present).toBe(true);
    // No run/action was manufactured for this fact.
    expect(await runStartedCount()).toBe(runsBefore);
  });

  test("E: an execution's effect stays an observation, correlated with cited causation", async () => {
    // INTENT -> EXECUTION: a real structured execution.
    const run = await app!.runtime.service.startRun(system, {
      agent: "agent.execute",
      input: { argv: ["sh", "-lc", "printf hello > e-proof.txt"], cwd: ".", worldId: "local", source: "ui", surface: "test", requestedBy: "j6" },
      idempotencyKey: "proof-e-exec",
      correlationId: SESSION,
    });
    expect(await settle(run.runId)).toBe("completed");
    const runEvents = [];
    for await (const e of app!.runtime.service.events(system, { runId: run.runId })) runEvents.push(e);
    const effectEvent = runEvents.find((e) => e.eventType === "effect.observed")!;
    const effect = (effectEvent.payload as unknown as EffectObservedPayload).effects.find((ef) => ef.kind === "file.created")!;
    expect(effect.worldId).toBe("local");
    // OBSERVATION: the effect's factual evidence as a first-class observation — correlated to the
    // execution and citing its cause — while remaining semantically distinct (runId: null).
    const view = await app!.runtime.service.observe(system, effectToObservation(
      effect,
      { kind: "caused", correlationId: SESSION, causationEventId: effectEvent.eventId, confidence: "observed" },
      { observer: "effect-deriver", provider: "local", method: "snapshot-diff" },
      observedAt,
      "proof-e-effect",
    ) as unknown as ObservationInput);
    const obs = (await allEvents()).find((e) => e.eventId === view.eventId)!;
    expect(obs.runId).toBeNull();                       // observation is distinct from the run
    expect(obs.correlationId).toBe(SESSION);            // correlation retained
    expect(obs.causationId).toBe(effectEvent.eventId);  // causation cited (established)
    expect((obs.payload as any).attribution.kind).toBe("caused");
    expect((obs.payload as any).subject.worldId).toBe("local");
  });

  test("F: observed reality can exist with unknown causation", async () => {
    const view = await app!.runtime.service.observe(system, factToObservation(
      "port.available",
      { worldId: "local", resource: "port/9999", kind: "port" },
      { port: 9999, protocol: "tcp" },
      { observer: "ports", provider: "local", method: "ss" },
      { kind: "correlated", correlationId: SESSION, confidence: "unknown" },
      observedAt,
      "proof-f-unknown-cause",
    ) as unknown as ObservationInput);
    const obs = (await allEvents()).find((e) => e.eventId === view.eventId)!;
    expect((obs.payload as any).facts.port).toBe(9999); // observed: true (the fact exists)
    expect(obs.causationId).toBeNull();                  // causedBy: unknown, not invented
    expect((obs.payload as any).attribution.kind).toBe("correlated"); // not "caused"
    expect(view.attribution.causationEventId).toBeNull();
    expect(view.attribution.confidence).toBe("unknown");
    expect(obs.correlationId).toBe(SESSION);             // correlated, but cause unknown
  });

  test("G: (worldId, resource) identity — same path in two worlds stays two observations", async () => {
    const local = await app!.runtime.service.observe(system, factToObservation(
      "file.exists", { worldId: "local", resource: "semantic-world-proof.txt", kind: "file" }, { present: true },
      { observer: "fs", provider: "local" }, { kind: "unattributed", confidence: "observed" }, observedAt, "proof-g-local",
    ) as unknown as ObservationInput);
    const remote = await app!.runtime.service.observe(system, factToObservation(
      "file.exists", { worldId: "ssh-test", resource: "semantic-world-proof.txt", kind: "file" }, { present: true },
      { observer: "sftp", provider: "ssh" }, { kind: "unattributed", confidence: "observed" }, observedAt, "proof-g-remote",
    ) as unknown as ObservationInput);
    expect(local.eventId).not.toBe(remote.eventId);
    expect(local.subject.worldId).toBe("local");
    expect(remote.subject.worldId).toBe("ssh-test");
    const events = await allEvents();
    expect((events.find((e) => e.eventId === local.eventId)!.metadata as any).worldId).toBe("local");
    expect((events.find((e) => e.eventId === remote.eventId)!.metadata as any).worldId).toBe("ssh-test");
  });
});
