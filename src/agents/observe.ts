// J1 — human command observation. The bridge hands the agent what shell integration observed;
// the agent produces the SAME event vocabulary as agent.execute. PTY output is not reconstructed
// (output: "unknown" — observed absence, never invented).
import type { AgentDefinition } from "@cognate/runtime-api";
import type { ObserveAgentInput, WorldSnapshot } from "../semantic/contracts.ts";
import { deriveEffects } from "../semantic/effects.ts";
import { isWorldSnapshot, json, requireString, truncateOutput } from "./shared.ts";

export const OBSERVE_AGENT_ID = "agent.observe";

function parseInput(raw: unknown): ObserveAgentInput {
  const input = raw as Partial<ObserveAgentInput> | null;
  if (typeof input !== "object" || input === null) throw new Error("invalid input: expected an object");
  if (input.source !== "pty") throw new Error(`invalid input: agent.observe accepts only source "pty", got ${String(input.source)}`);
  if (typeof input.exitCode !== "number" || !Number.isInteger(input.exitCode)) throw new Error("invalid input: exitCode must be an integer");
  if (typeof input.startedAt !== "string" || typeof input.endedAt !== "string") throw new Error("invalid input: startedAt/endedAt must be ISO strings");
  if (!isWorldSnapshot(input.preSnapshot)) throw new Error("invalid input: preSnapshot must be a world snapshot");
  return {
    observationId: requireString(input.observationId, "observationId"),
    sessionId: requireString(input.sessionId, "sessionId"),
    command: requireString(input.command, "command"),
    cwd: requireString(input.cwd, "cwd"),
    exitCode: input.exitCode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    preSnapshot: input.preSnapshot,
    source: "pty",
    surface: input.surface ?? "terminal",
  };
}

export function observeAgent(): AgentDefinition {
  return {
    id: OBSERVE_AGENT_ID,
    version: "1.0.0",
    async run(raw, ctx) {
      const input = parseInput(raw);
      const executionId = input.observationId;

      await ctx.emit("execution.started", json({
        executionId,
        source: "pty",
        surface: input.surface,
        worldId: "pty-session",
        command: input.command,
        cwd: input.cwd,
        startedAt: input.startedAt,
        actor: ctx.actor.id,
      }));

      try {
        const post = (await ctx.invoke("world.snapshot", json({}))) as unknown as WorldSnapshot;
        if (!isWorldSnapshot(post)) throw new Error("world.snapshot returned an unexpected shape");

        const effects = deriveEffects(input.preSnapshot, post);
        await ctx.emit("effect.observed", json({ executionId, observedAt: post.observedAt, effects }));

        const durationMs = Math.max(0, Date.parse(input.endedAt) - Date.parse(input.startedAt));
        await ctx.emit("execution.completed", json({
          executionId,
          exitCode: input.exitCode,
          endedAt: input.endedAt,
          durationMs,
          output: "unknown",
          effectsCount: effects.length,
          settled: "observed",
        }));

        return json({
          executionId,
          source: "pty",
          surface: input.surface,
          sessionId: input.sessionId,
          command: input.command,
          cwd: input.cwd,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationMs,
          exitCode: input.exitCode,
          output: "unknown",
          effects,
        });
      } catch (error) {
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
