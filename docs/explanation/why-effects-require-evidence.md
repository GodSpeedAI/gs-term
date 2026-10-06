# Why effects require evidence

## The question

How does a system claim "this command changed the world" without being wrong?

The tempting shortcuts are all wrong in specific, expensive ways:

- **trust the exit code** — `rm -rf` on a typo'd path exits 0 and changes nothing;
  `curl` exits 0 and changes a great deal;
- **parse stdout** — output is untrusted, locale-dependent, and unavailable for PTY runs;
- **watch the filesystem continuously** — you still need a rule for what counts as a change and who
  caused it.

gs-term's answer: diff two coherent observations of the world and attach the evidence to the claim.

## The mechanism

```
pre snapshot  ──┐
                ├── deriveEffects ──► Effect[] {kind, worldId, target, before, after, evidence}
post snapshot ──┘
```

The pre-snapshot is captured *before* the execution begins (the bridge starts it when the shell
integration's start marker arrives; the agent invokes `world.snapshot` before `process.exec`). The
post-snapshot is taken immediately after. `deriveEffects` is a pure function over the pair.

Every effect carries:

```ts
Evidence { what, how, confidence, refs }
```

`refs` names the concrete observations supporting it — `<worldId>:<root>@<observedAt>` for snapshot
diffs, or the observation timestamps for git facts.

## Why confidence distinguishes `observed` from `derived`

- A **derived** effect came from comparing two snapshots. A file existing at both times with the
  same version token means "not observed as changed", which is weaker than a direct read.
- An **observed** effect rests on a direct read — a `git status` call that *said* the tree was dirty.

Collapsing the two would let a diff artefact masquerade as a fact. Keeping them apart lets a reader
weigh them.

## The `none` effect

When nothing changed, gs-term emits a `none` effect carrying evidence that says *"no observed change
in scoped world state of `<worldId>`"*, citing both snapshots and the walk method.

This matters because "nothing happened" is a claim. Making it first-class means it can be recorded,
searched, and compared — instead of being the absence of a record, which is indistinguishable from
"we did not look".

## The honesty rule that makes this trustworthy

```ts
if (!isScoped(pre) || !isScoped(post)) return [];
```

If the process observer could not establish processes in the post-snapshot, no `process.stopped` is
claimed. The system does not infer "no processes stopped" from "we could not see processes".

The same principle propagates everywhere:

| Situation | Claim |
| --- | --- |
| Repository is not a work tree | `no-repo` |
| `git status` failed | `unknown` + reason |
| No live session root process | processes `unknown` + reason |
| A listener cannot be attributed to the session tree | the port is not claimed |
| PTY run output | `"unknown"` |
| Remote world, no session pid | processes and ports `unknown` |

`unknown` is not a failure state. It is a specific, honest answer, and it is preserved across
reconciliation rather than being replaced with `false`.

## What this buys

**Remote executions are first class.** A command run over SSH produces `file.created` with remote
provenance because the pre/post snapshots came through that world's SFTP file port and remote process
port. Nothing infers it from exit 0.

**Restarts are honest.** The world view is re-derived from current facts on boot, so a stale claim
is replaced by reality.

**Failures are visible.** A failing run emits `execution.failed` — an explicit non-settlement — rather
than a completed run with no effects, which would be indistinguishable from "it did nothing".

## Known limits

- **Between settlements, changes are invisible.** Observers are settlement-time snapshots, not
  watchers (debt D-017). External edits surface at the next observation.
- **Walk cap.** 5 000 entries by default; `walk.truncated` records the gap (debt D-019).
- **Version tokens are provider-owned.** A provider whose staleness token misses a content change
  will produce a missed `file.modified`.
- **Git effects track cleanliness, not branch.** A branch change without a dirty flip produces no
  effect — a deliberate narrowing.

## Source trail

- `src/semantic/effects.ts` — `deriveEffects`, `fileEffects`, `gitEffects`, `scopedDiff`
- `src/semantic/contracts.ts:104-132` — `Evidence`, `Effect`, `EffectKind`
- `src/observers/*` — the `unknown` branches
- `src/agents/execute.ts:69-83` — snapshot / exec / snapshot ordering
- `src/agents/observe.ts:57-61` — pre snapshot supplied, post invoked
- `test/journeys/journey-j6-observations.test.ts` — evidence discipline
- `test/journeys/journey-j2-worlds.test.ts` — remote evidence, not exit code
- `src/semantic/concepts.ts:159-166` — `concept:effects.evidence`