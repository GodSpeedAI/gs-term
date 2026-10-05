// J11/J12/J15 — agent.focus: the semantic orchestration for attention/focus/search. One agent,
// intent-dispatched (not a giant object). Deterministic given recorded step results. Semantic
// separation preserved: search is an action (invokes the focus.search capability); propose is an
// action (emits a FocusCandidate, SharedFocus unchanged); accept/pin/reject are intentional human
// transitions (SharedFocus changes ONLY via ctx.updateSharedState, which Cognate's ActionPolicy
// gates to human authority on the focus thread). Ranking/derivations are never observations.
import type { AgentDefinition } from "@cognate/runtime-api";
import type { Affordance, EntityRef, FocusCandidate, SharedFocus } from "../semantic/focus.ts";
import { acceptCandidate, emptySharedFocus, pinEntity, proposeCandidate, rejectCandidate } from "../focus/focus.ts";
import { affordancesFor } from "../focus/affordances.ts";
import { json } from "./shared.ts";

export const FOCUS_AGENT_ID = "agent.focus";

export interface FocusAgentOptions {
  readonly sessionWorldId: string;
  readonly workspace: string;
}

type Intent = "search" | "propose" | "accept" | "pin" | "reject" | "inspect";

function parse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) throw new Error("invalid input: expected an object");
  return raw as Record<string, unknown>;
}
function str(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`invalid input: ${field} must be a non-empty string`);
  return value;
}
function entityRef(value: unknown, field: string): EntityRef {
  const e = value as EntityRef | null;
  if (!e || typeof e.worldId !== "string" || typeof e.id !== "string" || typeof e.kind !== "string") throw new Error(`invalid input: ${field} must be an EntityRef`);
  return e;
}

export function focusAgent(options: FocusAgentOptions): AgentDefinition {
  return {
    id: FOCUS_AGENT_ID,
    version: "1.0.0",
    async run(raw, ctx) {
      const input = parse(raw);
      const intent = str(input.intent, "intent") as Intent;
      const sessionId = str(input.sessionId, "sessionId");
      const worldId = typeof input.worldId === "string" ? input.worldId : options.sessionWorldId;
      const workspace = typeof input.workspace === "string" ? input.workspace : options.workspace;
      const isHuman = ctx.actor.id === "human";
      const actorKind = isHuman ? "human" : "agent";

      if (intent === "search") {
        // ACTION: invoke the deterministic planner capability; return bounded results + receipt.
        const outcome = await ctx.invoke("focus.search", json({
          query: str(input.query, "query"),
          worldId,
          ...(input.intent ? {} : {}),
          ...(input.referent ? { referent: entityRef(input.referent, "referent") } : {}),
          ...(input.execution ? { execution: input.execution } : {}),
        }));
        const receipt = (outcome as { receipt?: { id?: string } }).receipt;
        await ctx.emit("focus.search.completed", json({ sessionId, worldId, query: input.query, receiptId: receipt?.id ?? null }));
        return json(outcome);
      }

      if (intent === "propose") {
        // ACTION: propose a candidate. SharedFocus is NOT changed (human must accept/pin).
        const proposedEntity = entityRef(input.proposedEntity, "proposedEntity");
        const candidate = proposeCandidate({
          id: str(input.candidateId, "candidateId"),
          worldId: proposedEntity.worldId,
          workspace,
          proposedEntity,
          reason: str(input.reason, "reason"),
          evidence: (input.evidence as FocusCandidate["evidence"]) ?? [],
          suggestedNextActions: (input.suggestedNextActions as Affordance[]) ?? affordancesFor(proposedEntity),
          sourceAgent: str(input.sourceAgent, "sourceAgent"),
          evidenceToken: str(input.evidenceToken, "evidenceToken"),
          createdAt: await ctx.step("clock.propose", () => new Date().toISOString()),
        });
        await ctx.emit("focus.candidate.proposed", json({ sessionId, candidate }));
        return json({ candidate, sharedFocusChanged: false });
      }

      if (intent === "inspect") {
        // READ: the current shared focus + affordances (no mutation).
        const rawInspect = (await ctx.sharedState("focus-read")) as unknown as Partial<SharedFocus> | null;
        const focus: SharedFocus = { ...emptySharedFocus(sessionId, worldId, workspace, new Date(0).toISOString()), ...(rawInspect ?? {}) };
        const affordances = focus.primary ? affordancesFor(focus.primary) : [];
        return json({ goal: focus.goal, worldId: focus.worldId, primary: focus.primary, pinned: focus.pinned, workingSet: focus.workingSet, unresolved: focus.unresolved, version: focus.version, affordances });
      }

      // accept / pin / reject — intentional HUMAN transitions. SharedFocus changes only here,
      // via ctx.updateSharedState (Cognate ActionPolicy gates it to human on the focus thread).
      const rawFocus = (await ctx.sharedState("focus-read")) as unknown as Partial<SharedFocus> | null;
      const current: SharedFocus = { ...emptySharedFocus(sessionId, worldId, workspace, new Date(0).toISOString()), ...(rawFocus ?? {}) };
      const at = await ctx.step("clock.resolve", () => new Date().toISOString());
      let next: SharedFocus = current;
      let resolvedEvent = "focus.candidate.resolved";
      if (intent === "accept") {
        const candidate = input.candidate as FocusCandidate;
        const outcome = acceptCandidate(current, candidate, actorKind, ctx.actor.id, at);
        next = outcome.focus;
        await ctx.emit("focus.candidate.resolved", json({ sessionId, candidateId: candidate.id, resolution: "accepted", resolvedBy: ctx.actor.id }));
      } else if (intent === "pin") {
        const entity = entityRef(input.entity, "entity");
        next = pinEntity(current, entity, actorKind, at);
        resolvedEvent = "focus.pinned";
        await ctx.emit("focus.pinned", json({ sessionId, entity, pinnedBy: ctx.actor.id }));
      } else if (intent === "reject") {
        const candidate = input.candidate as FocusCandidate;
        rejectCandidate(current, candidate, actorKind, ctx.actor.id, at);
        await ctx.emit("focus.candidate.resolved", json({ sessionId, candidateId: candidate.id, resolution: "rejected", resolvedBy: ctx.actor.id }));
        return json({ sharedFocusChanged: false, rejected: candidate.id });
      } else {
        throw new Error(`invalid input: unknown intent ${intent}`);
      }

      const result = await ctx.updateSharedState("focus-write", { snapshot: next as unknown as Record<string, never> });
      void resolvedEvent;
      return json({ sharedFocusChanged: true, version: result.version, focus: next });
    },
  };
}
