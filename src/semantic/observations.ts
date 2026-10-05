// Pure, deterministic builders from gs-term semantic facts to observation records. No framework,
// no I/O. World-agnostic: resource identity is (worldId, resource), never normalized across worlds.
// An observation is a fact noticed about reality — it is never intent and never a run.
import type { Effect, ObservationAttribution, ObservationRecord, ObservationSource } from "./contracts.ts";

/**
 * Convert a derived effect (already world-scoped with evidence) into an observation record. Used when
 * the factual evidence of an execution's effect is to enter the log as a first-class observation that
 * retains correlation to the execution while remaining semantically distinct from the intent/run.
 */
export function effectToObservation(
  effect: Effect,
  attribution: ObservationAttribution,
  source: ObservationSource,
  observedAt: string,
  idempotencyKey: string,
): ObservationRecord {
  return {
    kind: effect.kind,
    subject: { worldId: effect.worldId, resource: effect.target, kind: "resource" },
    facts: { before: effect.before ?? null, after: effect.after ?? null },
    source,
    evidence: effect.evidence,
    attribution,
    observedAt,
    idempotencyKey,
  };
}

/** A fact noticed directly by an observer (not derived from an execution). */
export function factToObservation(
  kind: string,
  subject: { worldId?: string; resource: string; kind?: string },
  facts: unknown,
  source: ObservationSource,
  attribution: ObservationAttribution,
  observedAt: string,
  idempotencyKey: string,
  evidence?: unknown,
): ObservationRecord {
  return { kind, subject, facts, source, evidence, attribution, observedAt, idempotencyKey };
}
