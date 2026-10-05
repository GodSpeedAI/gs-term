// SharedFocus reducer + FocusCandidate lifecycle (Phase 3). SharedFocus is human-governed: the
// agent may only propose candidates; accept/pin/reject are human-only. This module is pure state
// transition; Cognate authority (kernel Policy) is the real gate, the actorKind check here is
// defense-in-depth and makes the invariant directly testable.
import type { Affordance, EntityRef, FocusCandidate, FocusEvidence, SharedFocus } from "../semantic/focus.ts";

export class FocusAuthorityError extends Error {
  override readonly name = "FocusAuthorityError";
}

export function emptySharedFocus(sessionId: string, worldId: string, workspace: string, updatedAt: string): SharedFocus {
  return { sessionId, worldId, workspace, version: 0, pinned: [], workingSet: [], unresolved: [], evidence: [], updatedAt };
}

export interface ProposeInput {
  readonly id: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly proposedEntity: EntityRef;
  readonly reason: string;
  readonly evidence: readonly FocusEvidence[];
  readonly suggestedNextActions: readonly Affordance[];
  readonly sourceAgent: string;
  /** Materially-new-evidence token; identical rejected candidates cannot be reproposed without a new one. */
  readonly evidenceToken: string;
  readonly proposedGoalDelta?: string;
  readonly expectedValue?: string;
  readonly createdAt: string;
}

export function proposeCandidate(input: ProposeInput): FocusCandidate {
  return { ...input, status: "proposed" };
}

/** A rejected candidate blocks identical reproposal unless the evidence token is materially new. */
export function canPropose(candidate: { proposedEntity: EntityRef; evidenceToken: string }, existing: readonly FocusCandidate[]): boolean {
  return !existing.some(
    (c) =>
      c.status === "rejected" &&
      c.proposedEntity.worldId === candidate.proposedEntity.worldId &&
      c.proposedEntity.id === candidate.proposedEntity.id &&
      c.evidenceToken === candidate.evidenceToken,
  );
}

function requireHuman(actorKind: string, op: string): void {
  if (actorKind !== "human") throw new FocusAuthorityError(`${op} requires human authority (gsterm::human_governs_shared_focus)`);
}

/** Accept: promote the candidate into the shared primary focus (human only). */
export function acceptCandidate(focus: SharedFocus, candidate: FocusCandidate, actorKind: string, resolvedBy: string, at: string): { focus: SharedFocus; candidate: FocusCandidate } {
  requireHuman(actorKind, "accept");
  const next: SharedFocus = {
    ...focus,
    version: focus.version + 1,
    primary: candidate.proposedEntity,
    workingSet: dedupe([...(focus.workingSet ?? []), candidate.proposedEntity]),
    updatedAt: at,
  };
  return { focus: next, candidate: { ...candidate, status: "accepted", resolvedAt: at, resolvedBy } };
}

/** Pin: add to persistent working focus without replacing the primary (human only). */
export function pinEntity(focus: SharedFocus, entity: EntityRef, actorKind: string, at: string): SharedFocus {
  requireHuman(actorKind, "pin");
  return { ...focus, version: focus.version + 1, pinned: dedupe([...(focus.pinned ?? []), entity]), updatedAt: at };
}

/** Reject: decline the proposal (human only). Contextual feedback; not a global suppression. */
export function rejectCandidate(focus: SharedFocus, candidate: FocusCandidate, actorKind: string, resolvedBy: string, at: string): { focus: SharedFocus; candidate: FocusCandidate } {
  requireHuman(actorKind, "reject");
  return { focus: { ...focus, updatedAt: at }, candidate: { ...candidate, status: "rejected", resolvedAt: at, resolvedBy } };
}

function dedupe(entities: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const entity of entities) {
    const key = `${entity.worldId}:${entity.workspace}:${entity.kind}:${entity.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entity);
    }
  }
  return out;
}
