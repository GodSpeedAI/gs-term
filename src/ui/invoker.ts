// The ONE invoker used by every machine surface (cockpit runner + WebMCP tools).
// Both start the same `agent.execute` run through the shared Cognate client — the
// WebMCP projection is a projection, never a second implementation (catalog J2/J2-W).
import type { Json } from "@cognate/events";
import type { ExecuteCommandArgs, ToolInvoker } from "../webmcp/descriptors.ts";

export interface CognateClientLike {
  startRun(
    agent: string,
    input: Json,
    options?: { readonly idempotencyKey?: string; readonly correlationId?: string; readonly state?: Json },
  ): Promise<{ readonly runId: string }>;
  run(runId: string): { get(): { status: string; output: Json; error: string | null } };
  threadSharedState(threadId: string): { get(): { state: Json; version: number } };
}

export interface UiInvokerOptions {
  readonly sessionId: string;
  readonly worldId: string;
  readonly threadId: string;
  /** Surface name recorded on the execution: `cockpit` for UI runs. */
  readonly surfaceFor: (source: "ui" | "webmcp") => string;
}

export function createUiInvoker(client: CognateClientLike, options: UiInvokerOptions): ToolInvoker {
  return {
    async executeCommand(args: ExecuteCommandArgs, source: "ui" | "webmcp"): Promise<Json> {
      const run = await client.startRun(
        "agent.execute",
        {
          argv: [...args.argv],
          cwd: args.cwd ?? ".",
          worldId: args.worldId ?? options.worldId,
          source,
          surface: options.surfaceFor(source),
          requestedBy: source,
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
        },
        { idempotencyKey: crypto.randomUUID(), correlationId: `session:${options.sessionId}` },
      );
      const deadline = Date.now() + 60_000;
      for (;;) {
        const state = client.run(run.runId).get();
        if (state.status === "completed") return state.output;
        if (state.status === "failed" || state.status === "cancelled") {
          return { error: state.error ?? state.status, runId: run.runId };
        }
        if (Date.now() > deadline) return { error: "timed out waiting for execution to settle", runId: run.runId };
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    },
    async worldState(): Promise<Json> {
      return client.threadSharedState(options.threadId).get().state;
    },
    async focusSearch(args, source): Promise<Json> {
      return runFocus(client, options, "search", { query: args.query, worldId: args.worldId ?? options.worldId, ...(args.referent ? { referent: args.referent } : {}) }, source);
    },
    async focusInspect(source): Promise<Json> {
      return runFocus(client, options, "inspect", {}, source);
    },
    async focusProposeCandidate(args, source): Promise<Json> {
      return runFocus(client, options, "propose", { proposedEntity: args.proposedEntity, reason: args.reason, evidence: args.evidence ?? [], sourceAgent: args.sourceAgent, candidateId: crypto.randomUUID(), evidenceToken: crypto.randomUUID() }, source);
    },
  };
}

/** Start and settle an `agent.focus` run (the semantic orchestration for attention/focus/search). */
async function runFocus(client: CognateClientLike, options: UiInvokerOptions, intent: string, input: Record<string, unknown>, source: "ui" | "webmcp"): Promise<Json> {
  const run = await client.startRun(
    "agent.focus",
    { intent, sessionId: options.sessionId, ...input } as Json,
    { idempotencyKey: crypto.randomUUID(), correlationId: `focus:${options.sessionId}` },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = client.run(run.runId).get();
    if (state.status === "completed") return state.output;
    if (state.status === "failed" || state.status === "cancelled") return { error: state.error ?? state.status, runId: run.runId };
    if (Date.now() > deadline) return { error: "timed out waiting for focus operation to settle", runId: run.runId };
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}
