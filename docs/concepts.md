# Concepts and vocabulary

Repository-specific terms, defined once here. If a word appears in the source that is not listed,
it is either a Cognate term (see [Cognate's building skill](../../cognate/.agents/skills/building-with-cognate/SKILL.md))
or a standard programming term.

---

## Semantic world

The workspace being modelled: its files, repository state, the session's processes, and its
listening ports. It exists as a *model*, reconstructed from observations.

Not to be confused with: the execution world (where it lives), or the runtime (the process that
hosts the model).

The canonical shape is `WorldSnapshot` in `src/semantic/contracts.ts:89`.

## Execution world

An identifier (`worldId`) selecting *where* an operation physically runs. Configured worlds are
`local` plus any number of SSH worlds; `worldId` is an input property of a single capability, not a
family of verbs.

Not: a tenant, a user, or a separate model. Two worlds have the same semantic kinds; only provenance
differs.

`src/app/worlds.ts` is the only module with provider mechanics. World registration is the
*execution grant boundary*: an unregistered world fails closed.

## Resource identity

The pair `(worldId, resource)`. `semantic-world-proof.txt` in `local` and in `ssh-test` are two
different resources, and no code path may merge them.

Not: a path alone, and not a globally unique id.

Enforced by convention plus tests (`test/journeys/journey-j2-worlds.test.ts`,
`test/journeys/journey-j6-observations.test.ts`), recorded as app-level debt D-005.

## Execution

One command that ran in one world, with timing, exit status, effects and evidence. Emitted as
`execution.started` → `effect.observed` → `execution.completed`, or `execution.failed` when it could
not settle.

Not: a PTY session, a run in the Cognate sense, or a rendered command.

`ExecutionStartedPayload`, `ExecutionCompletedPayload`, `ExecutionFailedPayload` in
`src/semantic/contracts.ts:170-205`.

## Action / run

Intent that was requested and executed. In Cognate terms, a *run* of an agent. `agent.execute` and
`agent.observe` are runs; `agent.focus` runs exist too but are not executions.

Not: an observation.

## Observation

A fact noticed about reality. Recorded through `RuntimeService.observe` as a run-less observation
with its own provenance and attribution. Examples in this repository: a port that appeared during
reconciliation, a working tree that became dirty, and (through fan-out) a high-value derived effect.

Not: an action, and not a fact's *cause* — causation is cited only when established and otherwise
stays `null`.

`ObservationRecord`, `ObservationAttribution` in `src/semantic/contracts.ts:141-164`.

## World snapshot

One coherent read of one world at one instant: files, git state, session processes, session-
attributed ports, plus provenance. Produced by `world.snapshot`, which is the *only* evidence-
gathering capability.

Not: a diff, and not a projection.

Observers return `unknown` with a reason when they cannot establish a fact. `unknown` is never
collapsed into `false`.

## Effect

A claimed change to a resource, derived by diffing two world snapshots of the same world. Kinds:
`file.created`, `file.modified`, `file.deleted`, `git.dirty`, `git.clean`, `process.started`,
`process.stopped`, `port.opened`, `port.closed`, `none`.

Not: something inferred from stdout, and not "the command succeeded".

`deriveEffects` in `src/semantic/effects.ts:82`.

## Evidence

The provenance of a claim: `{what, how, confidence, refs}` where confidence is `observed`,
`derived`, or `unknown`.

The distinction matters: an *observed* effect came from a direct read (a git status call); a
*derived* effect came from a snapshot diff.

## Marker

An OSC escape sequence emitted by the shell integration so command boundaries are facts rather than
scraped text. Wire form: `ESC ] 7311 ; <code> ; <base64 JSON> BEL`, with codes `A` (command start),
`D` (command done), `R` (integration ready). Markers are parsed and **stripped** before any viewer
sees the byte stream.

`src/shell/markers.ts`, `src/shell/bash-init.sh`.

## Scrollback

A bounded, in-memory ring of recent PTY bytes replayed to a viewer on attach. Raw PTY bytes never
reach durable storage or the event log.

`src/terminal/scrollback.ts`; invariant enforced by `test/architecture.test.ts:69-75`.

## Capability

A named, versioned, policy-checked operation that an agent can invoke. The set is fixed:
`process.exec`, `world.snapshot`, `focus.search`, `code.definition`, `code.references`,
`code.implementations`, `code.diagnostics`.

Not: a function, and not a tool. A capability is a contract bound to a semantic object.

## Semantic object / semantic model

The entities, resources and journeys in `.sea/interaction/interaction-model.sea`, parsed by
DomainForge into objects such as `controlplane::Execution` and `controlplane::Evidence`. Binding
those ids to capability contracts is explicit and happens in exactly one place.

`src/app/bindings.ts`; enforced by `test/architecture.test.ts:63-67`.

## Component

A Cognate plugin that *provides* capabilities on a fiber. gs-term ships three: observers, focus,
code. Components are how mechanism work becomes invocable.

## Projection

A deterministic, rebuildable fold of the event log into a read model. gs-term ships one public
projection, `executions`. Consumers must ignore `run:`-prefixed keys, which are an identity bridge,
not executions.

## Shared thread state

Versioned, durable state addressed by a thread id. gs-term uses two: `session:<sessionId>` for the
world view, and a `focus:` thread for SharedFocus. Writes use `expectedVersion` and an idempotency
key.

## Journey

A catalogued end-to-end behaviour, `J1`–`J15`, defined in
`.sea/interaction/canonical-journey-catalog.md`. Journeys are the unit of behavioural naming: tests
in `test/journeys/` are named after them.

Not: a use case document. A journey that is not catalogued is not built.

## Attention

A transient best estimate of what the human is looking at (`HumanAttention`, `AgentAttention`).
Captured into a frozen `AttentionSnapshot` when a contextual search opens.

Resolution follows a fixed precedence — explicit selection, selected text, focused object, keyboard
focus, pointer dwell, pointer-at-open, active execution, shared focus, recent interaction, workspace
fallback — never a numeric confidence score.

## SharedFocus

The durable, human-governed working context: goal, primary focus, pinned entities, working set,
unresolved questions and evidence. An agent may *propose* a `FocusCandidate`; only a human may
accept, pin or reject. Enforced by the action policy server-side.

## FocusCandidate

A structured, evidence-backed proposal to shift SharedFocus. Submitting one changes nothing.
Rejected candidates cannot be reproposed without materially new evidence (`evidenceToken`).

## Affordance

An offered next action for a focused entity, naming a *precise semantic operation* (e.g.
`code.definition`) rather than a screen location. The same affordances render for a human clicking
in the cockpit and for a machine reading them through a tool.

## Syntelligent Search

The deterministic narrowing entry point behind `focus.search`. It routes by intent, spends the
fewest mechanisms that can answer the question, verifies survivors, and returns at most five results
plus a receipt.

Not: a language model, and not a vector search over everything.

## SearchReceipt

The inspectable record of one search: the detected intent, the mechanism availability snapshot, each
stage that actually ran with its true candidate count, and the reduction funnel
(`workspace → focusScope → structural → semantic → verified`). A stage that did not run is never
claimed. This is what makes "why these results?" answerable.

## Mechanism

An underlying implementation a capability calls through: `rg`, `solidlsp`, `zvec-grep`, `zvec`,
`structural-map`. Availability is reported per world and truthfully.

Not: a capability. Mechanisms have no authority; capabilities do.

## Semantic substrate

The managed, lazily started helper processes behind the semantic mechanisms: the Rust
`gsterm-semantic` binary (zvec-grep engine, zvec concept store, model2vec embedder) and the Python
`gsterm-solidlsp` bridge (SolidLSP over TypeScript). Mounted for the local world only.

## Structural map

A deliberately minimal deterministic graph — workspace, modules, tests, import edges, and which
tests exercise which modules — with typed edges carrying `how` provenance. Optionally enriched with
SolidLSP-verified `defines` / `references` edges. It exists to eliminate candidates cheaply and
intentionally contains no generated summaries.

## Concept

A curated, human-authored description of an application-domain concept, with explicit structural
links into the repository (`src/semantic/concepts.ts`). Vector similarity may *surface* a concept;
only its `links` say what it is about. Concepts are never source chunks — zvec-grep owns source.

## Truthfulness (unknown ≠ false)

The repository-wide rule that an unestablished fact is `unknown` with a reason, never `false`.
Concretely:

- an observer that could not read something says so;
- a run that captured no output says `output: "unknown"`;
- a repository outside a work tree (`no-repo`) differs from one that was never checked (`unknown`);
- an unavailable mechanism is reported unavailable, and local results are never substituted for a
  remote world's.

This is the single most load-bearing invariant in the codebase. Search for `status: "unknown"`
across `src/observers/` to see it applied.

## Surface / source

Metadata describing *who* and *how* an action arrived: `source` ∈ `pty | ui | webmcp`, plus a
`surface` string. Never a different ontology.

## Source trail

- `.sea/interaction/README.md` — the domain model's own orientation page
- `.sea/interaction/canonical-journey-catalog.md` — J1–J15
- `src/semantic/contracts.ts` — every contract shape named above
- `src/semantic/focus.ts` — attention, SharedFocus, affordances, receipts
- `src/semantic/concepts.ts` — the curated concept registry
- `src/app/policy.ts` — actor and grant vocabulary
- `src/focus/mechanisms.ts` — mechanism names and availability
- `src/shell/markers.ts` — marker codes