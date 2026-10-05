// Attention semantics (J7/J13): deterministic precedence, snapshot stability (a referent does not
// silently mutate when the pointer moves after `/`), and semantic identity (entities, not DOM paths).
import { describe, expect, test } from "bun:test";
import { captureAttentionSnapshot, resolveHumanAttention, resolveReferent } from "../../src/focus/attention.ts";
import type { EntityRef, HumanAttention, SharedFocus } from "../../src/semantic/focus.ts";

const W = "local";
const WS = "gs-term";
function ref(id: string, name?: string): EntityRef {
  return { worldId: W, workspace: WS, kind: "CodeSymbol", id, name, location: { path: "src/a.ts", line: 1 } };
}
function attention(partial: Partial<HumanAttention>): HumanAttention {
  return { worldId: W, workspace: WS, updatedAt: "t", ...partial };
}
const focus: SharedFocus = { sessionId: "s", worldId: W, workspace: WS, version: 2, pinned: [ref("pinned")], workingSet: [], unresolved: [], evidence: [], primary: ref("focus"), updatedAt: "t" };

describe("attention precedence", () => {
  test("explicit selection beats pointer and keyboard focus", () => {
    const resolved = resolveHumanAttention(attention({ selection: ref("sel"), keyboardFocus: ref("kbd"), pointerTarget: ref("ptr") }));
    expect(resolved.referent?.id).toBe("sel");
    expect(resolved.level).toBe("explicit-selection");
    expect(resolved.alternatives.map((r) => r.id).sort()).toEqual(["kbd", "ptr"]);
  });

  test("keyboard focus beats pointer when there is no selection", () => {
    const resolved = resolveHumanAttention(attention({ keyboardFocus: ref("kbd"), pointerTarget: ref("ptr") }));
    expect(resolved.referent?.id).toBe("kbd");
    expect(resolved.level).toBe("keyboard-focus");
  });

  test("falls back to active execution, then SharedFocus, then workspace", () => {
    const exec = resolveHumanAttention(attention({ activeExecution: { executionId: "e1", command: "bun test" } }));
    expect(exec.level).toBe("active-execution");
    expect(exec.referent?.kind).toBe("Execution");
    const sh = resolveHumanAttention(attention({}), focus);
    expect(sh.level).toBe("shared-focus");
    expect(sh.referent?.id).toBe("focus");
    const none = resolveHumanAttention(attention({}));
    expect(none.level).toBe("workspace-fallback");
    expect(none.referent).toBeUndefined();
  });

  test("binds to semantic entity identity, not a DOM selector", () => {
    const resolved = resolveHumanAttention(attention({ selection: ref("reconnectSession", "reconnectSession") }));
    expect(resolved.referent?.kind).toBe("CodeSymbol");
    expect(resolved.referent?.name).toBe("reconnectSession");
    expect(JSON.stringify(resolved.referent)).not.toContain("nth-child");
  });
});

describe("AttentionSnapshot stability (J13)", () => {
  test("the referent is frozen at capture; a later pointer move does not mutate it", () => {
    const atOpen = attention({ selection: ref("A", "A"), pointerTarget: ref("A", "A") });
    const snapshot = captureAttentionSnapshot("snap1", "s", atOpen, focus, "t0", ref("A"));
    expect(snapshot.referent?.id).toBe("A");
    // Pointer moves to B after `/` opened — resolution must still return A (the captured referent).
    const later = resolveReferent("what is this?", snapshot, focus);
    expect(later.referent?.id).toBe("A");
    expect(later.usedSnapshot).toBe(true);
  });

  test("the snapshot records world, workspace, focus version, and provenance", () => {
    const snapshot = captureAttentionSnapshot("snap2", "s", attention({ selection: ref("X") }), focus, "t0");
    expect(snapshot.worldId).toBe(W);
    expect(snapshot.workspace).toBe(WS);
    expect(snapshot.sharedFocusVersion).toBe(2);
    expect(snapshot.provenance.precedence).toBe("explicit-selection");
  });

  test("world identity is preserved: the snapshot carries the worldId", () => {
    const remote = captureAttentionSnapshot("snap3", "s", { worldId: "ssh-test", workspace: WS, selection: { worldId: "ssh-test", workspace: WS, kind: "CodeSymbol", id: "r" }, updatedAt: "t" }, undefined, "t0");
    expect(remote.worldId).toBe("ssh-test");
    expect(remote.referent?.worldId).toBe("ssh-test");
  });
});
