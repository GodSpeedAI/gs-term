// J3 — world-state-reconciliation (canonical-journey-catalog.md): git repository facts,
// dirty tracking with effects, session-associated port discovery (acceptance E + F),
// and the honesty rules: `unknown` and `no-repo` are distinct and never conflated.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import { ObservationBridge } from "../../src/bridge/observation.ts";
import { TerminalSession } from "../../src/terminal/session.ts";
import { observeGit } from "../../src/observers/git.ts";
import { takeWorldSnapshot } from "../../src/observers/snapshot.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { ExecutionEntry } from "../../src/projections/executions.ts";
import type { Marker } from "../../src/shell/markers.ts";
import { isScoped, type WorldStateView } from "../../src/semantic/contracts.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const INIT_FILE = resolve(REPO_ROOT, "src/shell/bash-init.sh");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };

let workspace = "";
let homeDir = "";
let app: GsTermRuntime | undefined;
let session: TerminalSession | undefined;
let bridge: ObservationBridge | undefined;
const markers: Marker[] = [];
const serverPort = 12_000 + Math.floor(Math.random() * 20_000);

function config(root: string): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root },
    session: { id: "j3-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {},
  };
}

async function git(args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", workspace, "-c", "user.email=t@gsterm.test", "-c", "user.name=gsterm", ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

function waitFor<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 15_000): Promise<T> {
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(40);
    }
  })();
}

async function world(): Promise<WorldStateView | null> {
  const shared = await app!.runtime.service.readSharedState(system, { threadId: "session:j3" });
  return (shared.state ?? null) as WorldStateView | null;
}

async function settledEntries(): Promise<ExecutionEntry[]> {
  const rows = await app!.runtime.service.readProjection(system, { name: "executions" });
  return rows.map((row) => row.value as unknown as ExecutionEntry).filter((entry) => entry.status === "settled");
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gsterm-j3-"));
  homeDir = await mkdtemp(join(tmpdir(), "gsterm-j3-home-"));
  await git(["init"]);
  await writeFile(join(workspace, "tracked.txt"), "line-1\n");
  await git(["add", "tracked.txt"]);
  await git(["commit", "-m", "initial"]);
  app = await createGsTermRuntime({ config: config(workspace), store: ":memory:", domainRoot: REPO_ROOT, sessionPid: () => session?.shellPid });
  session = new TerminalSession({
    id: "j3-session",
    shell: "bash",
    initFile: INIT_FILE,
    cwd: workspace,
    cols: 80,
    rows: 24,
    scrollbackBytes: 65_536,
    env: { HOME: homeDir },
  });
  bridge = new ObservationBridge({
    service: app.runtime.service,
    sessionId: "j3",
    sessionWorldId: "local",
    root: workspace,
    shell: "bash",
    sessionPid: () => session?.shellPid,
    terminalInfo: () => ({ alive: session?.alive ?? false, cols: session?.cols ?? 0, rows: session?.rows ?? 0, pid: session?.shellPid ?? null }),
  });
  session.attach({ marker: (marker) => (markers.push(marker), bridge!.handleMarker(marker)) });
  bridge.startFollower();
  await session.start();
  await waitFor(async () => (markers.some((marker) => marker.code === "R") ? true : undefined), "shell integration ready");
});

afterAll(async () => {
  await bridge?.close();
  await session?.close();
  await app?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
  if (homeDir) await rm(homeDir, { recursive: true, force: true });
});

describe("J3 world-state-reconciliation", () => {
  test("repository facts are observed: root, branch, clean → dirty with git effects (acceptance E)", async () => {
    session!.write("true\n"); // trigger a settlement → reconciliation
    const clean = await waitFor(async () => {
      const state = await world();
      return state && state.repository?.status === "observed" && state.repository.dirty === false ? state : undefined;
    }, "clean repository observation");
    expect(clean.repository.root).toBe(workspace);
    expect(clean.repository.branch === "master" || clean.repository.branch === "main").toBe(true);

    session!.write("echo change >> tracked.txt\n");
    const dirty = await waitFor(async () => {
      const state = await world();
      return state && state.repository?.dirty === true ? state : undefined;
    }, "dirty repository observation");
    expect(dirty.repository.changedFiles).toContain("tracked.txt");

    // The same change shows up as typed effects with provenance on a settled execution.
    const withGitEffect = await waitFor(async () => {
      const entries = await settledEntries();
      return entries.find((entry) => entry.effects.some((effect) => effect.kind === "git.dirty" || effect.target === "tracked.txt")) ?? undefined;
    }, "git.dirty/file effect evidence");
    const evidence = withGitEffect.effects.flatMap((effect) => effect.evidence);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.how.length > 0 && item.confidence !== undefined)).toBe(true);
  });

  test("a session-associated listening port is discovered and cleared (acceptance F)", async () => {
    session!.write(`bun -e 'Bun.serve({ port: ${serverPort}, fetch: () => new Response("x") })' &\n`);
    session!.write("sleep 0.5\n"); // settle AFTER the server is listening

    const listening = await waitFor(async () => {
      const state = await world();
      if (!state || !isScoped(state.ports)) return undefined;
      return state.ports.entries.find((entry) => entry.port === serverPort);
    }, `port ${serverPort} in world view`);
    expect(listening.port).toBe(serverPort);
    expect(listening.pid).toBeGreaterThan(0); // attributed to the session process tree (U3)
    expect(listening.process).toContain("bun");

    session!.write("kill %1\n");
    session!.write("sleep 0.3\n");
    const cleared = await waitFor(async () => {
      const state = await world();
      if (!state || !isScoped(state.ports)) return undefined;
      return !state.ports.entries.some((entry) => entry.port === serverPort) ? state : undefined;
    }, "port cleared from world view");
    expect(isScoped(cleared.ports) && cleared.ports.entries.some((entry) => entry.port === serverPort)).toBe(false);
  });

  test("honesty: no-repo and unknown are distinct states, never false", async () => {
    const local = app!.worlds.registry.get("local");
    const nonRepo = await observeGit(local.process, homeDir);
    expect(nonRepo.status).toBe("no-repo");

    const snapshot = await takeWorldSnapshot({
      world: { worldId: "local", kind: local.kind, metadata: local.metadata },
      fileSystem: local.fileSystem,
      process: local.process,
      root: workspace,
      sessionPid: undefined,
    });
    expect(snapshot.processes).toHaveProperty("status", "unknown");
    expect((snapshot.processes as { reason: string }).reason.length).toBeGreaterThan(0);
    expect(snapshot.git.status).toBe("observed"); // git observed even without processes
    expect(snapshot.files.length).toBeGreaterThan(0);
  });
});

