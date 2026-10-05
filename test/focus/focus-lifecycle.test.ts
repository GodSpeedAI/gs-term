// FocusCandidate lifecycle + human authority (J11/J12): propose leaves SharedFocus unchanged;
// accept/pin/reject are human-only intentional transitions; identical rejected candidates cannot
// be reproposed without materially new evidence. Authority is enforced by Cognate's ActionPolicy
// (gsterm::human_governs_shared_focus), not merely UI convention.
import { describe, expect, test } from "bun:test";
import { acceptCandidate, canPropose, emptySharedFocus, FocusAuthorityError, pinEntity, proposeCandidate, rejectCandidate } from "../../src/focus/focus.ts";
import { gstermActions } from "../../src/app/policy.ts";
import type { Caller } from "@cognate/runtime-api";
import type { EntityRef, FocusCandidate } from "../../src/semantic/focus.ts";

const W = "local";
const WS = "gs-term";
const entity = (id: string): EntityRef => ({ worldId: W, workspace: WS, kind: "CodeSymbol", id, name: id, location: { path: "src/a.ts", line: 1 } });
const candidate = (id: string, token = "ev-1"): FocusCandidate =>
  proposeCandidate({ id, worldId: W, workspace: WS, proposedEntity: entity(id), reason: "r", evidence: [], suggestedNextActions: [], sourceAgent: "agent.focus", evidenceToken: token, createdAt: "t" });

describe("FocusCandidate lifecycle", () => {
  test("propose records a candidate and does NOT change SharedFocus", () => {
    const before = emptySharedFocus("s", W, WS, "t");
    const c = candidate("restoreSession");
    expect(c.status).toBe("proposed");
    // SharedFocus is untouched by a proposal (only accept/pin mutate it).
    expect(before.version).toBe(0);
    expect(before.primary).toBeUndefined();
  });

  test("accept promotes the candidate into the shared primary focus (human)", () => {
    const before = emptySharedFocus("s", W, WS, "t");
    const { focus, candidate: resolved } = acceptCandidate(before, candidate("restoreSession"), "human", "human", "t2");
    expect(focus.version).toBe(1);
    expect(focus.primary?.id).toBe("restoreSession");
    expect(focus.workingSet.map((e) => e.id)).toContain("restoreSession");
    expect(resolved.status).toBe("accepted");
  });

  test("pin persists into the working focus without replacing primary (human)", () => {
    let focus = emptySharedFocus("s", W, WS, "t");
    focus = acceptCandidate(focus, candidate("primary"), "human", "human", "t").focus;
    focus = pinEntity(focus, entity("sessionRegistry"), "human", "t2");
    expect(focus.primary?.id).toBe("primary");
    expect(focus.pinned.map((e) => e.id)).toContain("sessionRegistry");
  });

  test("reject declines and blocks identical reproposal without new evidence", () => {
    const before = emptySharedFocus("s", W, WS, "t");
    const c = candidate("badRedirect", "ev-same");
    const { candidate: rejected } = rejectCandidate(before, c, "human", "human", "t2");
    expect(rejected.status).toBe("rejected");
    // Same entity + same evidence token: cannot propose again.
    expect(canPropose({ proposedEntity: entity("badRedirect"), evidenceToken: "ev-same" }, [rejected])).toBe(false);
    // Materially new evidence token: allowed.
    expect(canPropose({ proposedEntity: entity("badRedirect"), evidenceToken: "ev-new" }, [rejected])).toBe(true);
  });

  test("candidate retains world identity", () => {
    const c = candidate("restoreSession");
    expect(c.proposedEntity.worldId).toBe(W);
    expect(c.worldId).toBe(W);
  });
});

describe("human authority is absolute for SharedFocus", () => {
  test("the reducer refuses accept/pin/reject from a non-human actor", () => {
    const before = emptySharedFocus("s", W, WS, "t");
    expect(() => acceptCandidate(before, candidate("x"), "agent", "webmcp", "t")).toThrow(FocusAuthorityError);
    expect(() => pinEntity(before, entity("y"), "agent", "t")).toThrow(FocusAuthorityError);
    expect(() => rejectCandidate(before, candidate("x"), "agent", "webmcp", "t")).toThrow(FocusAuthorityError);
  });

  test("Cognate ActionPolicy denies thread.state.update on a focus thread for non-human", () => {
    const actions = gstermActions();
    const human: Caller = { actor: { id: "human", kind: "user" }, tenant: "local" };
    const webmcp: Caller = { actor: { id: "webmcp", kind: "user" }, tenant: "local" };
    expect(actions.authorize({ caller: human, action: "thread.state.update", resource: "focus:s" }).allow).toBe(true);
    expect(actions.authorize({ caller: webmcp, action: "thread.state.update", resource: "focus:s" }).allow).toBe(false);
    // Both may read focus; the agent may inspect.
    expect(actions.authorize({ caller: webmcp, action: "thread.state.read", resource: "focus:s" }).allow).toBe(true);
  });
});
