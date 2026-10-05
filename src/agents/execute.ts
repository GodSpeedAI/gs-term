// J2 — structured execution. The machine door into the same semantic world the human door
// (agent.observe) enters: identical event vocabulary, source as metadata only.
// Everything nondeterministic (clock, ids, filesystem, process) goes through step/invoke.
import type { AgentDefinition } from "@cognate/runtime-api";
import { resolveLocal } from "@cognate/execution";
import type { ExecutionSource, ExecuteAgentInput, WorldSnapshot } from "../semantic/contracts.ts";
import { deriveEffects } from "../semantic/effects.ts";
import { isWorldSnapshot, json, renderCommand, requireArgv, requireString, truncateOutput } from "./shared.ts";

export const EXECUTE_AGENT_ID = "agent.execute";

export interface ExecuteAgentOptions {
  /** Containment boundary: cwd resolves inside this root or PathEscapeError fails the run. */
  readonly root: string;
  readonly defaultWorldId: string;
  readonly defaultTimeoutMs: number;
}

function parseInput(raw: unknown): ExecuteAgentInput {
  const input = raw as Partial<ExecuteAgentInput> | null;
  if (typeof input !== "object" || input === null) throw new Error("invalid input: expected an object");
  const source = (input.source ?? "ui") as ExecutionSource;
  if (source !== "ui" && source !== "webmcp" && source !== "pty") throw new Error(`invalid input: unknown source ${String(source)}`);
  return {
    argv: requireArgv(input.argv),
    cwd: typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : ".",
    worldId: typeof input.worldId === "string" && input.worldId.length > 0 ? input.worldId : "",
    source,
    surface: typeof input.surface === "string" && input.surface.length > 0 ? input.surface : source,
    requestedBy: typeof input.requestedBy === "string" ? input.requestedBy : "",
    ...(typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? { timeoutMs: input.timeoutMs } : {}),
  };
}

interface ExecResultLike {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export function executeAgent(options: ExecuteAgentOptions): AgentDefinition {
  return {
    id: EXECUTE_AGENT_ID,
    version: "1.0.0",
    async run(raw, ctx) {
      const input = parseInput(raw);
      const worldId = input.worldId === "" ? options.defaultWorldId : input.worldId;
      // Cognate's local-world containment rule, applied before invocation: escape fails closed.
      const cwd = resolveLocal(options.root, input.cwd);

      const executionId = await ctx.step("execution.id", () => crypto.randomUUID());
      const startedAt = await ctx.step("clock.started", () => new Date().toISOString());
      await ctx.emit("execution.started", json({
        executionId,
        source: input.source,
        surface: input.surface,
        worldId,
        command: renderCommand(input.argv),
        argv: [...input.argv],
        cwd,
        startedAt,
        actor: ctx.actor.id,
      }));

      try {
        const pre = await ctx.invoke("world.snapshot", json({}));
        if (!isWorldSnapshot(pre)) throw new Error("world.snapshot returned an unexpected shape");

        const result = (await ctx.invoke("process.exec", json({
          worldId,
          argv: [...input.argv],
          cwd,
          timeoutMs: input.timeoutMs ?? options.defaultTimeoutMs,
        }))) as unknown as ExecResultLike;

        const post = await ctx.invoke("world.snapshot", json({}));
        if (!isWorldSnapshot(post)) throw new Error("world.snapshot returned an unexpected shape");

        const effects = deriveEffects(pre as WorldSnapshot, post as WorldSnapshot);
        await ctx.emit("effect.observed", json({ executionId, observedAt: post.observedAt, effects }));

        const endedAt = await ctx.step("clock.ended", () => new Date().toISOString());
        const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
        const output = { stdout: truncateOutput(result.stdout), stderr: truncateOutput(result.stderr) };
        await ctx.emit("execution.completed", json({
          executionId,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          endedAt,
          durationMs,
          output,
          effectsCount: effects.length,
          settled: "derived",
        }));

        return json({
          executionId,
          source: input.source,
          surface: input.surface,
          worldId,
          command: renderCommand(input.argv),
          argv: [...input.argv],
          cwd,
          startedAt,
          endedAt,
          durationMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          output,
          effects,
        });
      } catch (error) {
        // Explicit non-settlement in the semantic world; the run still fails (never swallowed).
        // If the run was aborted, ctx.emit is blocked by design — the runtime records run.cancelled.
        try {
          const failedAt = await ctx.step("clock.failed", () => new Date().toISOString());
          await ctx.emit("execution.failed", json({ executionId, failedAt, reason: error instanceof Error ? error.message : String(error) }));
        } catch {
          // aborted mid-failure: runtime-level run status is the record
        }
        throw error;
      }
    },
  };
}
