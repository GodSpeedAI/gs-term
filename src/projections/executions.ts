// Public projection `executions`: a deterministic fold of execution.* events into a read model.
// Derived state — rebuildable from the event log; the projection is never authoritative.
// Identity bridge: `execution.started` also writes a `run:<runId>` marker key so runtime-level
// failure/cancellation events (which only know the run) can reach their execution entry.
// Consumers must ignore keys starting with `run:` (they are markers, not executions).
import type { Json, StoredEvent } from "@cognate/events";
import type { Projection, ProjectionState } from "@cognate/projections";
import type { Effect, EffectObservedPayload, ExecutionCompletedPayload, ExecutionStartedPayload } from "../semantic/contracts.ts";

export const EXECUTIONS_PROJECTION = "executions";
export const EXECUTIONS_PROJECTION_VERSION = "1.0.1"; // bumped for tenant-partitioned keys: stale checkpoints rebuild
export const RUN_MARKER_PREFIX = "run:";

export interface ExecutionEntry {
  readonly executionId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly status: "started" | "settled" | "failed" | "cancelled";
  readonly worldId?: string;
  readonly source?: string;
  readonly surface?: string;
  readonly command?: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly actor?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly effects: readonly Effect[];
  readonly effectsCount: number;
  readonly reason?: string;
}

/** `true` for projection-internal marker keys (see file header). */
export function isMarkerKey(key: string): boolean {
  return key.startsWith(RUN_MARKER_PREFIX);
}

function payload<T>(event: StoredEvent): T {
  return event.payload as unknown as T;
}

/** Public projections are tenant-partitioned by `<tenant>/` key prefix (spec §32; runtime filters reads). */
function scopedKey(event: StoredEvent, key: string): string {
  return `${event.tenant}/${key}`;
}

function merge(event: StoredEvent, state: ProjectionState, executionId: string, patch: Partial<ExecutionEntry>): readonly { readonly key: string; readonly value: Json }[] {
  const key = scopedKey(event, executionId);
  const existing = (state.get(key) as ExecutionEntry | undefined) ?? { executionId, runId: "", correlationId: "", status: "started" as const, effects: [], effectsCount: 0 };
  return [{ key, value: { ...existing, ...patch } as unknown as Json }];
}

function marker(event: StoredEvent, runId: string): readonly { readonly key: string; readonly value: Json }[] {
  return runId ? [{ key: scopedKey(event, `${RUN_MARKER_PREFIX}${runId}`), value: runId }] : [];
}

function executionIdForRun(event: StoredEvent, state: ProjectionState): string | undefined {
  return event.runId === undefined ? undefined : (state.get(scopedKey(event, `${RUN_MARKER_PREFIX}${event.runId}`)) as string | undefined);
}

export const executionsProjection: Projection = {
  name: EXECUTIONS_PROJECTION,
  version: EXECUTIONS_PROJECTION_VERSION,
  apply(event, state) {
    switch (event.eventType) {
      case "execution.started": {
        const p = payload<ExecutionStartedPayload>(event);
        const runId = event.runId ?? "";
        return [
          ...merge(event, state, p.executionId, {
            runId,
            correlationId: event.correlationId,
            status: "started",
            worldId: p.worldId,
            source: p.source,
            surface: p.surface,
            command: p.command,
            ...(p.argv ? { argv: [...p.argv] } : {}),
            cwd: p.cwd,
            actor: p.actor,
            startedAt: p.startedAt,
          }),
          ...marker(event, runId),
        ];
      }
      case "effect.observed": {
        const p = payload<EffectObservedPayload>(event);
        const effects = [...p.effects];
        return merge(event, state, p.executionId, { effects, effectsCount: effects.length });
      }
      case "execution.completed": {
        const p = payload<ExecutionCompletedPayload>(event);
        return merge(event, state, p.executionId, {
          status: "settled",
          exitCode: p.exitCode,
          ...(p.timedOut === undefined ? {} : { timedOut: p.timedOut }),
          endedAt: p.endedAt,
          durationMs: p.durationMs,
        });
      }
      case "execution.failed": {
        const p = payload<{ readonly executionId: string; readonly failedAt?: string; readonly reason?: string }>(event);
        return merge(event, state, p.executionId, { status: "failed", ...(p.reason === undefined ? {} : { reason: p.reason }) });
      }
      case "run.failed": {
        const executionId = executionIdForRun(event, state);
        if (!executionId) return [];
        const p = payload<{ readonly error?: string }>(event);
        return merge(event, state, executionId, { status: "failed", reason: p.error ?? "run failed" });
      }
      case "run.cancelled": {
        const executionId = executionIdForRun(event, state);
        return executionId ? merge(event, state, executionId, { status: "cancelled", reason: "run cancelled" }) : [];
      }
      default:
        return [];
    }
  },
};
