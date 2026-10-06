# Why shared focus is human-governed

## The question

An agent can search the codebase faster than a person can, and it will often notice that something
matters. Should it be able to change what the human is looking at?

No — and the interesting part is *where* the "no" is enforced.

## The easy way is wrong

The easy enforcement is UI: don't render an accept button for agents. Or social: agents are
instructed to be polite. Both fail. The first is bypassable by any non-UI caller — a WebMCP tool, a
future external agent — and the second is not a control at all.

## Where gs-term puts the gate

**Server-side, in the action policy.** `src/app/policy.ts`:

```ts
case "thread.state.update":
  if (resource.startsWith(WORLD_THREAD_PREFIX)) return allow("session world thread");
  if (resource.startsWith(FOCUS_THREAD_PREFIX))
    return caller.actor.id === ACTOR_HUMAN ? allow("human governs SharedFocus")
                                          : deny("SharedFocus is human-governed");
  return deny("state is session/focus-scoped");
```

Any caller that tries to write the focus thread without human authority is denied by the runtime.
This holds for every surface equally — cockpit, WebMCP, a future agent.

**Defence in depth in the reducer.** `src/focus/focus.ts` throws `FocusAuthorityError` from
`requireHuman` for accept/pin/reject. Redundant with the policy on purpose: it makes the invariant
directly unit-testable without standing up a runtime.

**Structural in the agent.** `agent.focus` routes accept/pin/reject through `ctx.updateSharedState`
and never mutates anything locally. `propose` deliberately returns `{sharedFocusChanged: false}`.

## What an agent actually gets

| Intent | Allowed for agents | Changes SharedFocus |
| --- | --- | --- |
| `inspect` | yes | no |
| `search` | yes | no |
| `propose` | yes | no |
| `code` | yes | no |
| `accept` / `pin` / `reject` | **no** | only human |

So an agent's only channel is a `FocusCandidate` — a structured, evidence-bearing proposal:

```ts
{ proposedEntity, reason, evidence[], expectedValue?, suggestedNextActions[], sourceAgent, evidenceToken }
```

`suggestedNextActions` are `Affordance`s naming semantic operations, so a machine proposal renders
the same actions a human would see.

## The wear-out problem

A proposal an agent keeps re-raising is an attention tax. So a candidate carries an
`evidenceToken`: a token for *materially new* evidence. Once a human rejects a candidate, the same
proposed entity with the same token cannot be resubmitted. To pitch again, the agent must bring
something new.

This is a real design choice, not a nicety: an agent that can re-pitch identically will eventually
train the human to dismiss it reflexively, and the shared focus stops being shared.

## Related decisions

**Attention is separate from focus.** Attention is a transient estimate, resolved by a fixed
precedence and frozen into an `AttentionSnapshot` when a search opens. It never mutates SharedFocus.
See [focus-engine.md](../subsystems/focus-engine.md).

**Rankings are derivations, not observations.** Search ranking and reduction are computed and
discarded; they are never recorded as facts about the world. This keeps the log free of pointer noise
and keeps "what the system believes" separate from "what happened".

**There is no WebMCP accept tool.** The omission is deliberate and asserted by a test: a machine must
not be able to resolve its own suggestion.

## What this is protecting

The invariant is attention sovereignty: an assistant may suggest what deserves attention, but only a
person decides what actually gets it. Everything else in this subsystem follows from that.

## Source trail

- `src/app/policy.ts:59-63` — the focus-thread rule
- `src/focus/focus.ts` — `requireHuman`, `FocusAuthorityError`, `acceptCandidate`, `pinEntity`,
  `rejectCandidate`, the rejected-evidence check
- `src/agents/focus.ts:108-136` — accept/pin/reject through `ctx.updateSharedState`
- `src/webmcp/descriptors.ts` — the deliberately absent accept tool
- `test/focus/focus-lifecycle.test.ts` — agent cannot self-accept
- `test/webmcp/webmcp-projection.test.ts` — "NO accept/pin/reject tool exists"
- `src/semantic/concepts.ts:46-61` — `concept:focus.human-governance`