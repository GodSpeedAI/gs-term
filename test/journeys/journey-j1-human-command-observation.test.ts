// J1 — human-command-observation (canonical-journey-catalog.md) + J3 world state.
// The human door end to end, in process: a REAL PTY running real bash with the real shell
// integration; a human-equivalent command is typed; the bridge settles it as a semantic
// execution with effects + evidence and reconciles durable world state.
// Asserts the CONVERGENCE claim: same event vocabulary and read model as the J2 path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import { ObservationBridge } from "../../src/bridge/observation.ts";
import { TerminalSession } from "../../src/terminal/session.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { EffectObservedPayload, ExecutionCompletedPayload, ExecutionStartedPayload, WorldStateView } from "../../src/semantic/contracts.ts";
import type { ExecutionEntry } from "../../src/projections/executions.ts";
import type { Marker } from "../../src/shell/markers.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const INIT_FILE = resolve(REPO_ROOT, "src/shell/bash-init.sh");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };

let workspace = "";
let homeDir = "";
let app: GsTermRuntime | undefined;
let session: TerminalSession | undefined;
let bridge: ObservationBridge | undefined;
const markers: Marker[] = [];
const transcript: string[] = [];

function config(root: string): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root },
    session: { id: "j1-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
  };
}

function waitFor<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 15_000): Promise<T> {
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; transcript=${transcript.join("").slice(-600)}`);
      await Bun.sleep(30);
    }
  })();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gsterm-j1-"));
  homeDir = await mkdtemp(join(tmpdir(), "gsterm-j1-home-"));
  app = await createGsTermRuntime({ config: config(workspace), store: ":memory:", domainRoot: REPO_ROOT, sessionPid: () => session?.shellPid });
  session = new TerminalSession({
    id: "j1-session",
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
    sessionId: "j1",
    root: workspace,
    shell: "bash",
    sessionPid: () => session?.shellPid,
    terminalInfo: () => ({ alive: session?.alive ?? false, cols: session?.cols ?? 0, rows: session?.rows ?? 0, pid: session?.shellPid ?? null }),
    onError: (context, error) => {
      throw new Error(`bridge ${context}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  session.attach({
    output: (data) => transcript.push(Buffer.from(data).toString("utf8")),
    marker: (marker) => {
      markers.push(marker);
      bridge!.handleMarker(marker);
    },
  });
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

describe("J1 human-command-observation", () => {
  test("touch typed into the terminal settles with effects, evidence, and the same event vocabulary", async () => {
    session!.write("touch semantic-proof-human.txt\n");

    const entry = await waitFor(async () => {
      const rows = await app!.runtime.service.readProjection(system, { name: "executions" });
      return rows.map((row) => row.value as unknown as ExecutionEntry).find((candidate) => candidate.status === "settled" && candidate.command?.includes("touch"));
    }, "observed execution to settle in the projection");

    // The file exists (mechanism truth) and the semantic record matches the J2 shape.
    expect(await stat(join(workspace, "semantic-proof-human.txt"))).toBeDefined();
    expect(entry.source).toBe("pty");
    expect(entry.surface).toBe("terminal");
    expect(entry.exitCode).toBe(0);
    expect(entry.effectsCount).toBeGreaterThanOrEqual(1);
    const created = entry.effects.find((effect) => effect.kind === "file.created" && effect.target === "semantic-proof-human.txt");
    expect(created).toBeDefined();
    for (const evidence of created!.evidence) {
      expect(evidence.what.length).toBeGreaterThan(0);
      expect(evidence.how.length).toBeGreaterThan(0);
      expect(["observed", "derived", "unknown"]).toContain(evidence.confidence);
    }

    // Durable events: started/completed with source metadata; output honestly unknown (A6).
    const events: { eventType: string; payload: unknown }[] = [];
    for await (const event of app!.runtime.service.events(system, { runId: entry.runId })) {
      events.push({ eventType: event.eventType, payload: event.payload });
    }
    const started = events.find((event) => event.eventType === "execution.started")!.payload as ExecutionStartedPayload;
    expect(started.source).toBe("pty");
    expect(started.command).toContain("touch semantic-proof-human.txt");
    const completed = events.find((event) => event.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    expect(completed.output).toBe("unknown");
    expect(completed.settled).toBe("observed");
    const effects = (events.find((event) => event.eventType === "effect.observed")!.payload as EffectObservedPayload).effects;
    expect(effects.some((effect) => effect.kind === "file.created")).toBe(true);
  });

  test("J3: world state reconciles with observed facts and honest unknowns", async () => {
    const state = await waitFor(async () => {
      const shared = await app!.runtime.service.readSharedState(system, { threadId: "session:j1" });
      const view = shared.state as WorldStateView | null;
      return view && view.lastExecution?.command?.includes("touch") ? view : undefined;
    }, "world state to carry the settled execution");

    expect(state.sessionId).toBe("j1");
    expect(state.cwd).toBe(workspace);
    expect(state.terminal.alive).toBe(true);
    expect(state.terminal.pid).toBe(session!.shellPid ?? null);
    expect(state.lastExecution!.exitCode).toBe(0);
    // Processes observed through the session tree (root pid known): a scope, not "unknown".
    expect(state.processes).toHaveProperty("entries");
    const version = await app!.runtime.service.readSharedState(system, { threadId: "session:j1" });
    expect(version.version).toBeGreaterThan(0);
  });

  test("J3: cd through the terminal updates the world's cwd (shell-builtin effects)", async () => {
    await mkdir(join(workspace, "subdir"));
    session!.write("cd subdir\n");
    const state = await waitFor(async () => {
      const shared = await app!.runtime.service.readSharedState(system, { threadId: "session:j1" });
      const view = shared.state as WorldStateView | null;
      return view && view.cwd.endsWith("subdir") ? view : undefined;
    }, "world state cwd to follow cd");
    expect(state.cwd).toBe(join(workspace, "subdir"));
    session!.write(`cd ${JSON.stringify(workspace)}\n`);
    await waitFor(async () => {
      const shared = await app!.runtime.service.readSharedState(system, { threadId: "session:j1" });
      const view = shared.state as WorldStateView | null;
      return view && view.cwd === workspace ? view : undefined;
    }, "world state cwd to return");
  });

  test("observability: the observed run is traceable end to end (J5 read path)", async () => {
    const runs = await app!.runtime.service.listRuns(system, { agent: "agent.observe", correlationId: "session:j1" });
    expect(runs.length).toBeGreaterThanOrEqual(2); // touch + cd at minimum
    for (const run of runs) expect(run.status).toBe("completed");
    const causal = await app!.runtime.inspect(runs[0]!.correlationId);
    expect(causal.runs.length).toBeGreaterThanOrEqual(1);
    expect(causal.events.some((event) => event.eventType.startsWith("execution."))).toBe(true);
    expect(causal.invocations.some((invocation) => invocation.capability === "world.snapshot")).toBe(true);
  });
});

