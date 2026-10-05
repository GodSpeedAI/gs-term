// Deterministic attention resolution (Phase 3). HumanAttention is a transient best estimate;
// AttentionSnapshot freezes it when `/` opens so a referent ("this", "that") never silently
// mutates because the pointer moved afterward. Resolution is a fixed, testable precedence —
// never arbitrary numeric confidence. Binds to semantic entity identity, never DOM paths.
import type { AgentAttention, AttentionSnapshot, EntityRef, HumanAttention, SharedFocus } from "../semantic/focus.ts";

/** The fixed evidence precedence for what the human is attending to (highest first). */
export const ATTENTION_PRECEDENCE = [
  "explicit-selection",
  "selected-text",
  "focused-object",
  "keyboard-focus",
  "pointer-dwell",
  "pointer-at-open",
  "active-execution",
  "shared-focus",
  "recent-interaction",
  "workspace-fallback",
] as const;
export type AttentionLevel = (typeof ATTENTION_PRECEDENCE)[number];

export interface ResolvedAttention {
  readonly referent?: EntityRef;
  readonly level: AttentionLevel;
  /** Higher-precedence candidates the referent beat (for "I think you mean" ambiguity surfacing). */
  readonly alternatives: readonly EntityRef[];
}

/** Resolve the human's current referent by deterministic precedence. */
export function resolveHumanAttention(attention: HumanAttention, sharedFocus?: SharedFocus): ResolvedAttention {
  const candidates: { level: AttentionLevel; ref?: EntityRef }[] = [
    { level: "explicit-selection", ref: attention.selection },
    { level: "keyboard-focus", ref: attention.keyboardFocus },
    { level: "pointer-dwell", ref: attention.pointerTarget },
  ];
  for (const candidate of candidates) {
    if (candidate.ref) {
      const alternatives = candidates.filter((c) => c.ref && c.ref !== candidate.ref).map((c) => c.ref!);
      return { referent: candidate.ref, level: candidate.level, alternatives };
    }
  }
  if (attention.activeExecution) {
    return {
      referent: { worldId: attention.worldId, workspace: attention.workspace, kind: "Execution", id: attention.activeExecution.executionId, name: attention.activeExecution.command },
      level: "active-execution",
      alternatives: [],
    };
  }
  if (sharedFocus?.primary) return { referent: sharedFocus.primary, level: "shared-focus", alternatives: [...sharedFocus.pinned] };
  return { level: "workspace-fallback", alternatives: [] };
}

/** Freeze the attention context at a meaningful boundary (when `/` opens). Referent is fixed here. */
export function captureAttentionSnapshot(
  id: string,
  sessionId: string,
  attention: HumanAttention,
  sharedFocus: SharedFocus | undefined,
  capturedAt: string,
  pointerEntity?: EntityRef,
): AttentionSnapshot {
  const resolved = resolveHumanAttention(attention, sharedFocus);
  return {
    id,
    sessionId,
    worldId: attention.worldId,
    workspace: attention.workspace,
    sharedFocusVersion: sharedFocus?.version ?? 0,
    referent: resolved.referent,
    pointerEntity,
    activeExecution: attention.activeExecution,
    activePanel: attention.activePanel,
    capturedAt,
    provenance: { method: "attention-precedence", precedence: resolved.level },
  };
}

const REFERENCE_WORDS = new Set(["this", "that", "here", "it", "this failure", "this symbol", "this file", "this execution"]);

export interface ReferentResolution {
  readonly intent: string;
  readonly referent?: EntityRef;
  readonly ambiguous: boolean;
  readonly alternatives: readonly EntityRef[];
  readonly usedSnapshot: boolean;
}

/**
 * Resolve a contextual reference ("what is this?", "why did this fail?") against the FROZEN
 * snapshot — not live attention. Ambiguity (several near-precedence candidates) is surfaced,
 * never guessed through.
 */
export function resolveReferent(query: string, snapshot: AttentionSnapshot, sharedFocus?: SharedFocus): ReferentResolution {
  const lowered = query.toLowerCase().trim();
  const referenced = [...REFERENCE_WORDS].some((word) => lowered.includes(word));
  if (!referenced) return { intent: lowered, referent: snapshot.referent, ambiguous: false, alternatives: [], usedSnapshot: true };
  const resolved = resolveHumanAttention(
    { worldId: snapshot.worldId, workspace: snapshot.workspace, primary: snapshot.referent, pointerTarget: snapshot.pointerEntity, activeExecution: snapshot.activeExecution, activePanel: snapshot.activePanel, updatedAt: snapshot.capturedAt },
    sharedFocus,
  );
  return {
    intent: lowered,
    referent: snapshot.referent, // fixed at capture — does not follow a later pointer
    ambiguous: resolved.alternatives.length > 0 && !!snapshot.referent,
    alternatives: resolved.alternatives,
    usedSnapshot: true,
  };
}

/** Agent attention is independent and never mutates SharedFocus (typed for clarity at call sites). */
export function agentAttention(worldId: string, workspace: string, inspecting: EntityRef | undefined, updatedAt: string): AgentAttention {
  return { worldId, workspace, inspecting, updatedAt };
}
