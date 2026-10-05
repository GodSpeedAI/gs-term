// Phase-3 full loop (J10/J11/J12): search via the same capability, agent proposes, human accepts,
// SharedFocus changes only with human authority. Plus observation semantics: effect→observation
// fan-out is bounded/idempotent and search ranking is a derivation, never an observation.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { Effect } from "../../src/semantic/contracts.ts";
import type { SharedFocus as FocusState, FocusCandidate } from "../../src/semantic/focus.ts";
import { json } from "../../src/agents/shared.ts";
import { recordEffectObservations } from "../../src/bridge/observations.ts";
import { proposeCandidate } from "../../src/focus/focus.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const human: Caller = { tenant: "local", actor: { id: "human", kind: "user" } };
const webmcp: Caller = { tenant: "local", actor: { id: "webmcp", kind: "user" } };
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };
const FIXED_AT = "2026-01-01T00:00:00Z";
let root = "";
let app: GsTermRuntime | undefined;

function config(): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root },
    session: { id: "focus-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {},
  };
}

async function settle(runId: string): Promise<{ status: string; output: unknown }> {
  for (let i = 0; i < 200; i++) {
    await app!.runtime.idle(50).catch(() => undefined);
    const run = await app!.runtime.service.getRun(system, { runId });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") { return { status: run.status, output: (run as { output?: unknown }).output }; }
    await Bun.sleep(10);
  }
  throw new Error("run did not settle");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "gsterm-focus-"));
  await Bun.write(join(root, "session.ts"), "export function reconnectSession() { return 1; }\n");
  app = await createGsTermRuntime({ config: config(), store: ":memory:", domainRoot: REPO_ROOT });
});
afterAll(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("Phase 3 full loop", () => {
  test("Syntelligent Search runs through the shared capability and returns bounded results", async () => {
    const run = await app!.runtime.service.startRun(system, {
      agent: "agent.focus",
      input: json({ intent: "search", query: "who calls reconnectSession", worldId: "local", sessionId: "focus-test" }),
      idempotencyKey: "loop-search",
      correlationId: "focus:focus-test",
    });
    const { status, output } = await settle(run.runId);
    expect(status).toBe("completed");
    const results = (output as { results?: unknown[] }).results ?? [];
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("agent proposes a candidate; SharedFocus is unchanged until a human accepts", async () => {
    const candidate = proposeCandidate({ id: "restoreSession", worldId: "local", workspace: "gs-term", proposedEntity: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: "restoreSession", name: "restoreSession" }, reason: "writes state consumed before reconnectSession", evidence: [], suggestedNextActions: [], sourceAgent: "agent.focus", evidenceToken: "ev-1", createdAt: "t" });
    const run = await app!.runtime.service.startRun(webmcp, {
      agent: "agent.focus",
      input: json({ intent: "propose", sessionId: "focus-test", worldId: "local", candidateId: candidate.id, proposedEntity: candidate.proposedEntity, reason: candidate.reason, evidence: [], sourceAgent: "agent.focus", evidenceToken: "ev-1" }),
      idempotencyKey: "loop-propose",
      correlationId: "focus:focus-test",
    });
    const { status } = await settle(run.runId);
    expect(status).toBe("completed");
    const state = await app!.runtime.service.readSharedState(system, { threadId: "focus:focus-test" });
    const focus = (state.state ?? null) as FocusState | null;
    expect(focus?.primary).toBeUndefined(); // proposal does NOT change SharedFocus
  });

  test("human accepts; SharedFocus changes with human authority", async () => {
    const candidate: FocusCandidate = proposeCandidate({ id: "restoreSession", worldId: "local", workspace: "gs-term", proposedEntity: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: "restoreSession", name: "restoreSession" }, reason: "r", evidence: [], suggestedNextActions: [], sourceAgent: "agent.focus", evidenceToken: "ev-1", createdAt: "t" });
    const run = await app!.runtime.service.startRun(human, {
      agent: "agent.focus",
      input: json({ intent: "accept", sessionId: "focus-test", worldId: "local", candidate }),
      idempotencyKey: "loop-accept",
      correlationId: "focus:focus-test",
    });
    const { status } = await settle(run.runId);
    expect(status).toBe("completed");
    const state = await app!.runtime.service.readSharedState(system, { threadId: "focus:focus-test" });
    const focus = (state.state ?? null) as FocusState | null;
    expect(focus?.primary?.id).toBe("restoreSession");
  });

  test("an agent cannot self-accept (human authority is absolute)", async () => {
    const candidate: FocusCandidate = proposeCandidate({ id: "sneaky", worldId: "local", workspace: "gs-term", proposedEntity: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: "sneaky" }, reason: "r", evidence: [], suggestedNextActions: [], sourceAgent: "agent.focus", evidenceToken: "ev-2", createdAt: "t" });
    const run = await app!.runtime.service.startRun(webmcp, {
      agent: "agent.focus",
      input: json({ intent: "accept", sessionId: "focus-test", worldId: "local", candidate }),
      idempotencyKey: "loop-self-accept",
      correlationId: "focus:focus-test",
    });
    const { status } = await settle(run.runId);
    expect(status).toBe("failed"); // denied — SharedFocus is not hijacked
    const state = await app!.runtime.service.readSharedState(system, { threadId: "focus:focus-test" });
    const focus = (state.state ?? null) as FocusState | null;
    expect(focus?.primary?.id).toBe("restoreSession"); // unchanged (still the human's)
  });
});

describe("observation semantics", () => {
  test("effect→observation fan-out is bounded, correlated, and idempotent", async () => {
    const effects: Effect[] = [
      { kind: "file.created", worldId: "local", target: "a.txt", after: {}, evidence: [{ what: "created", how: "snapshot-diff", confidence: "derived", refs: ["r"] }] },
      { kind: "none", worldId: "local", target: ".", evidence: [{ what: "none", how: "snapshot-diff", confidence: "derived", refs: ["r"] }] },
    ];
    const first = await recordEffectObservations(app!.runtime.service, system, effects, { correlationId: "focus:focus-test", causationEventId: "evt-1", observedAt: FIXED_AT, executionId: "exec-1" });
    expect(first.length).toBe(1); // `none` is not fanned out (bounded)
    expect(first[0].attribution.kind).toBe("caused");
    expect(first[0].attribution.causationEventId).toBe("evt-1");
    // Idempotent: replaying the same execution/effect does not create a second fact.
    const second = await recordEffectObservations(app!.runtime.service, system, effects, { correlationId: "focus:focus-test", causationEventId: "evt-1", observedAt: FIXED_AT, executionId: "exec-1" });
    const events = [];
    for await (const e of app!.runtime.service.events(system, {})) events.push(e);
    const observations = events.filter((e) => e.eventType === "observation.recorded" && (e.payload as { subject?: { resource?: string } })?.subject?.resource === "a.txt");
    expect(observations.length).toBe(1); // no duplicate despite the second call
    expect(observations[0].runId).toBeNull(); // observation is not a run
    expect(second.length).toBe(1);
  });

  test("search ranking is a derivation, not an observation (no pointer/ranking noise)", async () => {
    const events = [];
    for await (const e of app!.runtime.service.events(system, {})) events.push(e);
    // No observation records a relevance score or a search rank.
    const ranked = events.filter((e) => e.eventType === "observation.recorded" && JSON.stringify(e.payload).includes("relevance"));
    expect(ranked.length).toBe(0);
  });
});
