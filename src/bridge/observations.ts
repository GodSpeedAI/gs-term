// Effect → observation fan-out (Phase 3, the Phase-2.5 deliberate increment). High-value derived
// effects that become Focus/evidence enter the log as first-class observations via the Cognate
// observation door — correlated to their execution (causation cited) while remaining semantically
// distinct (runId:null). Bounded (only useful kinds) and idempotent (stable keys) — no duplicate
// facts, no pointer noise. Low-value effects are NOT fanned out merely for completeness.
import type { Caller, ObservationInput, ObservationView, RuntimeService } from "@cognate/runtime-api";
import type { Effect } from "../semantic/contracts.ts";
import { effectToObservation } from "../semantic/observations.ts";

/** Effect kinds worth preserving as Focus/evidence observations. `none` and noise are excluded. */
const FOCUS_RELEVANT = new Set<Effect["kind"]>(["file.created", "file.modified", "file.deleted", "port.opened", "port.closed", "git.dirty", "git.clean", "process.started", "process.stopped"]);

export interface FanOutOptions {
  readonly correlationId: string;
  /** The execution event id that caused these effects (cited only when established). */
  readonly causationEventId?: string;
  readonly observedAt: string;
  /** Stable per-execution id so a replay never double-records. */
  readonly executionId: string;
}

/** Record the focus-relevant effects as observations. Returns only what was recorded. */
export async function recordEffectObservations(
  service: RuntimeService,
  caller: Caller,
  effects: readonly Effect[],
  options: FanOutOptions,
): Promise<ObservationView[]> {
  const recorded: ObservationView[] = [];
  let index = 0;
  for (const effect of effects) {
    if (!FOCUS_RELEVANT.has(effect.kind)) continue;
    const record = effectToObservation(
      effect,
      // Correlated to the execution; causation cited only when a cause event id is provided.
      options.causationEventId
        ? { kind: "caused", correlationId: options.correlationId, causationEventId: options.causationEventId, confidence: "observed" }
        : { kind: "correlated", correlationId: options.correlationId, confidence: "observed" },
      { observer: "effect-observer", provider: effect.worldId, method: "snapshot-diff" },
      options.observedAt,
      `effect:${options.executionId}:${effect.kind}:${effect.worldId}:${effect.target}:${index++}`,
    );
    try {
      recorded.push(await service.observe(caller, { ...record } as unknown as ObservationInput));
    } catch {
      // Idempotent replay or transient contention: skip — never fabricate a second fact.
    }
  }
  return recorded;
}
