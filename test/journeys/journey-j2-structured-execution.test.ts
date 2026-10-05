// J2 — structured-execution journey (canonical-journey-catalog.md).
// Runs the real runtime (memory store) with real observers against a real temp workspace and
// asserts SETTLEMENT via observable evidence: events, projection entry, effects + evidence,
// and the on-disk result — not merely that the run completed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller, RunView } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { EffectObservedPayload, ExecutionCompletedPayload, ExecutionStartedPayload } from "../../src/semantic/contracts.ts";
import { isMarkerKey, type ExecutionEntry } from "../../src/projections/executions.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };
const stranger: Caller = { tenant: "local", actor: { id: "stranger", kind: "user" } };

let workspace = "";
let app: GsTermRuntime;

interface CollectedEvent {
  readonly eventType: string;
  readonly payload: unknown;
}

function config(root: string): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root },
    session: { id: "j2-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
  };
}

async function settle(runId: string, timeoutMs = 15_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await app.runtime.idle(2_000);
    const run = await app.runtime.service.getRun(system, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not settle, last status ${run.status}`);
    await Bun.sleep(25);
  }
}

async function eventsFor(runId: string): Promise<CollectedEvent[]> {
  const collected: CollectedEvent[] = [];
  for await (const event of app.runtime.service.events(system, { runId })) {
    collected.push({ eventType: event.eventType, payload: event.payload });
  }
  return collected;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gsterm-j2-"));
  app = await createGsTermRuntime({ config: config(workspace), store: ":memory:", domainRoot: REPO_ROOT });
});

afterAll(async () => {
  await app?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("J2 structured-execution", () => {
  test("touch through the capability settles with effects, evidence, and projection", async () => {
    const view = await app.runtime.service.startRun(system, {
      agent: "agent.execute",
      input: { argv: ["touch", "semantic-proof-agent.txt"], cwd: ".", worldId: "local", source: "ui", surface: "test", requestedBy: "journey-test" },
      idempotencyKey: "j2-touch-1",
      correlationId: "session:j2",
    });
    const run = await settle(view.runId);
    expect(run.status).toBe("completed");

    // The file really exists (mechanism truth).
    const stats = await stat(join(workspace, "semantic-proof-agent.txt")).catch(() => undefined);
    expect(stats).toBeDefined();

    // Same semantic vocabulary as the human path, source as metadata.
    const events = await eventsFor(view.runId);
    const types = events.map((event) => event.eventType);
    expect(types).toContain("execution.started");
    expect(types).toContain("effect.observed");
    expect(types).toContain("execution.completed");
    expect(types).toContain("run.invocation");

    const started = events.find((event) => event.eventType === "execution.started")!.payload as ExecutionStartedPayload;
    expect(started.source).toBe("ui");
    expect(started.argv).toEqual(["touch", "semantic-proof-agent.txt"]);
    expect(started.cwd).toBe(workspace);
    expect(started.actor).toBe("system");

    const effects = (events.find((event) => event.eventType === "effect.observed")!.payload as EffectObservedPayload).effects;
    const created = effects.find((effect) => effect.kind === "file.created" && effect.target === "semantic-proof-agent.txt");
    expect(created).toBeDefined();
    // Evidence discipline: provenance-bearing claim, not a bare assertion.
    expect(created!.evidence.length).toBeGreaterThan(0);
    for (const evidence of created!.evidence) {
      expect(evidence.what.length).toBeGreaterThan(0);
      expect(evidence.how.length).toBeGreaterThan(0);
      expect(["observed", "derived", "unknown"]).toContain(evidence.confidence);
      expect(Array.isArray(evidence.refs)).toBe(true);
    }

    const completed = events.find((event) => event.eventType === "execution.completed")!.payload as ExecutionCompletedPayload;
    expect(completed.exitCode).toBe(0);
    expect(completed.output).not.toBe("unknown");
    expect(completed.settled).toBe("derived");

    // Projection read model contains the settled entry (markers excluded).
    const rows = await app.runtime.service.readProjection(system, { name: "executions" });
    const entry = rows.find((row) => row.key === started.executionId)?.value as unknown as ExecutionEntry;
    expect(entry).toBeDefined();
    expect(entry.status).toBe("settled");
    expect(entry.source).toBe("ui");
    expect(entry.effectsCount).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => !isMarkerKey(row.key)).length).toBeGreaterThanOrEqual(1);
  });

  test("denied actor gets no authority (machine authority is explicit)", async () => {
    await expect(
      app.runtime.service.startRun(stranger, {
        agent: "agent.execute",
        input: { argv: ["touch", "denied.txt"], cwd: ".", worldId: "local", source: "ui", surface: "test", requestedBy: "stranger" },
        idempotencyKey: "j2-denied-1",
      }),
    ).rejects.toThrow(/permission_denied|not recognized|no authority/i);

    // Capability invocation by an ungranted actor is denied at call time (kernel policy).
    await expect(app.runtime.service.invoke(stranger, { capability: "process.exec", input: { worldId: "local", argv: ["true"], cwd: workspace } })).rejects.toThrow(
      /permission|denied|no authority/i,
    );

    // Nothing was created by the denied attempt.
    const stats = await stat(join(workspace, "denied.txt")).catch(() => undefined);
    expect(stats).toBeUndefined();
  });

  test("cwd outside the workspace root fails closed (containment)", async () => {
    const view = await app.runtime.service.startRun(system, {
      agent: "agent.execute",
      input: { argv: ["pwd"], cwd: "..", worldId: "local", source: "ui", surface: "test", requestedBy: "journey-test" },
      idempotencyKey: "j2-escape-1",
      correlationId: "session:j2",
    });
    const run = await settle(view.runId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/escapes the workspace root|PathEscape/);
  });
});

