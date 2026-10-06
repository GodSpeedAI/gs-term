# Why two doors, one semantic world

## The question

A person typing `git status` and a tool calling `execute_command(["git","status"])` are doing the
same thing to the same machine. Should the system record them the same way?

gs-term's answer is yes, and this page explains why that is a load-bearing decision rather than a
simplification.

## The separation being rejected

The conventional split is a "terminal" and an "automation API":

- the terminal has a byte stream, a scrollback, a cursor;
- the API has argv, exit codes, structured output.

Each surface then builds its own history, its own record of what changed, and its own idea of
"current state". A person and a tool looking at the same workspace get different answers, and
neither answer is complete.

## What gs-term does instead

Both doors converge on the **same semantic kind**: an execution.

```
INTENT ─► Cognate action/run ─► execution ──(correlation)──┐
                                                          ▼
REALITY ──► OBSERVATION ──► evidence/provenance ──► effects / world state
```

Concretely, `src/agents/observe.ts` (human) and `src/agents/execute.ts` (machine) emit the same four
event types with the same payload shapes. What differs is metadata:

| Field | Human (`pty`) | Structured (`ui` / `webmcp`) |
| --- | --- | --- |
| `source` | `pty` | `ui` / `webmcp` |
| `surface` | `terminal` | `cockpit` / `webmcp` |
| `output` | `"unknown"` | captured stdout/stderr |
| `settled` | `observed` (shell integration told us) | `derived` (we diffed snapshots) |

Those differences are real and worth recording — but they are *attributes of an execution*, not
different kinds of execution.

## The domain model says the same thing

`.sea/interaction/interaction-model.sea` defines one `Execution` resource. How it entered —
"observed through a session" (J1) versus "issued by automation" (J2) — is a *variant dimension* of
one journey kind. The WebMCP surface (J2-W) is a further specialisation of J2 by actor and surface.
Nothing in the model forks.

`src/semantic/concepts.ts` carries the same statement as `concept:execution.two-doors`:
*"the originating surface is recorded as plain metadata and never forks the model into separate
ontologies."*

## Why this is worth the trouble

**A single history answers questions neither surface could.** When a command fails, you can ask
*what changed* and get an answer regardless of who ran it. When you wonder what happened, the
projection is the history.

**Trust is separable from privilege.** Because the human door is a compatibility surface rather than
an authority grant, the machine door can be locked down hard. See
[authority-and-policy.md](../subsystems/authority-and-policy.md).

**Evidence is uniform.** Effects and evidence come from snapshot diffs either way, so an SSH
execution and a local terminal command are comparable.

**New surfaces are free.** Adding WebMCP meant writing descriptors, not a second backend.

## Honest cost

Convergence is not free, and the cost shows up in specific places:

- **PTY runs cannot capture output.** The byte stream is never parsed into stdout, so `output` is
  `"unknown"`. Structured runs capture it. This asymmetry is visible in the UI and is deliberate
  (debt D-015).
- **PTY command boundaries depend on shell integration.** No `A`/`D` markers means no execution
  (debt D-018). Structured runs have no such dependency.
- **Timing metadata differs in kind.** `startedAt`/`endedAt` come from shell markers for PTY runs
  and from recorded steps for structured runs. Both are honest; they are not equally precise.
- **`cd` is a special case.** A shell builtin changes the world without producing a file or process
  diff, so cwd is taken from the marker rather than derived. See
  [the J1 trace](../workflows/human-command-observation.md).

## What would break the invariant

- A second ontology of "tool executions" alongside "shell executions".
- A capability named after a surface (`terminal.exec`, `webmcp.execute`) rather than after an
  operation.
- A projection that treats `source` as a partition key.
- Treating the human's unrestricted shell as evidence of machine authority.

`test/architecture.test.ts` and `test/journeys/` encode several of these as executable checks.

## Source trail

- `src/agents/observe.ts`, `src/agents/execute.ts` — the converging implementations
- `src/semantic/contracts.ts:166-205` — one payload vocabulary, `ExecutionSource` as metadata
- `src/ui/invoker.ts` — one invoker for both surfaces
- `src/webmcp/descriptors.ts` — the surface as a projection
- `.sea/interaction/interaction-model.sea` — one `Execution` resource
- `.sea/interaction/handoff.md` — the "Surfaces → same path" table
- `src/semantic/concepts.ts:139-146` — `concept:execution.two-doors`
- `test/journeys/journey-j1-…`, `journey-j2-…`, `journey-j2-worlds.test.ts`