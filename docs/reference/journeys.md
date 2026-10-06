# Journey reference

Journeys are catalogued end-to-end behaviours. **A journey that is not catalogued is not built.**
The canonical definitions live in `.sea/interaction/canonical-journey-catalog.md`; this page is the
implementation-side index.

## Core journeys (Phase 1)

| Id | Name | Trigger | Primary implementation | Tests |
| --- | --- | --- | --- | --- |
| **J1** | human-command-observation | a command boundary marker | `src/bridge/observation.ts`, `src/agents/observe.ts` | `test/journeys/journey-j1-human-command-observation.test.ts` |
| **J2** | structured-execution | an `argv` request | `src/agents/execute.ts` | `test/journeys/journey-j2-structured-execution.test.ts` |
| **J2-W** | structured-execution (WebMCP) | a WebMCP `execute_command` tool | `src/webmcp/descriptors.ts`, `src/ui/invoker.ts` | `test/webmcp/webmcp-projection.test.ts` |
| **J3** | world-state-reconciliation | run settlement, attach, boot | `src/bridge/observation.ts`, `src/observers/snapshot.ts` | `test/journeys/journey-j3-world-state-reconciliation.test.ts` |
| **J4** | terminal-session-attach | cockpit opened, WebSocket reopened | `src/terminal/session.ts`, `src/server/index.ts` | `test/conformance/pty.test.ts` |
| **J5** | cockpit-inspection | a reader wants history and evidence | `src/projections/executions.ts`, `src/ui/*` | `test/journeys/journey-j5-restart-durability.test.ts` |
| **J6** | observation-ingest (Phase 2.5 increment) | a discovered fact or a fanned-out effect | `src/bridge/observations.ts` | `test/journeys/journey-j6-observations.test.ts` |

## Focus journeys (Phase 3)

| Id | Name | Settlement criterion | Implementation |
| --- | --- | --- | --- |
| **J7** | `/ what is this?` | a bounded `SearchResult` set plus a `SearchReceipt` | `src/focus/search.ts` |
| **J8** | `/ why did this fail?` | the focused failed execution's effects are inspected **before** any broad source search | `src/focus/search.ts` |
| **J9** | `/ who calls this?` | SolidLSP references when the language mechanism is mounted; rg is the stated fallback and says semantic verification is unavailable | `src/focus/search.ts`, `src/components/code.ts` |
| **J10** | semantic search (unknown concept) | structural map narrows, then hybrid/exact retrieval; bounded results; unavailable mechanisms reported truthfully | `src/focus/search.ts`, `src/focus/mechanisms.ts` |
| **J11** | agent focus proposal | a `FocusCandidate` is proposed; **SharedFocus is unchanged**; identical rejected candidates are not reproposed without new evidence | `src/agents/focus.ts`, `src/focus/focus.ts` |
| **J12** | human accept / pin / reject | SharedFocus changes **only** here, gated to human authority by the action policy | `src/focus/focus.ts`, `src/app/policy.ts` |
| **J13** | world switch while a search is open | the `AttentionSnapshot` is frozen; the referent does not silently mutate | `src/focus/attention.ts` |
| **J14** | unavailable search mechanism (remote world) | degrade truthfully; never substitute a local index; provenance carries `worldId` | `src/focus/mechanisms.ts`, `src/mechanisms/substrate.ts` |
| **J15** | WebMCP agent focus collaboration | the agent inspects and searches through the same Focus Engine and **cannot self-resolve** | `src/webmcp/descriptors.ts` |

Journey-grounding tests: `test/journeys/journey-j9-semantic-reduction.test.ts` (routing tiers and
latency), `test/focus/*`.

## Named invariants

These appear in code as policy reasons and are the mechanical form of the model's policies.

| Invariant | Enforced in |
| --- | --- |
| `gsterm::machine_authority_is_explicit` | `gstermPolicy` denial reason |
| `gsterm::human_governs_shared_focus` | `gstermActions` for `focus:` threads; `FocusAuthorityError` |
| `gsterm::evidence_accompanies_effects` | `deriveEffects` — every effect carries evidence, including `none` |

## Deferred seams (catalogued, deliberately not built)

| Seam | State |
| --- | --- |
| **D1** | additional execution-world providers (WSL, cloud, browser-Linux) behind the same `process.exec` |
| **D2** | WebMCP capability *consumption* via `RemoteCapabilityOffer` — types and mapping tests exist; the loop does not |
| **D3** | checkpoints / world branching — the event log and folds make it possible; nothing blocks it |
| **D4** | additional shell adapters beyond bash |
| **D5** | multiple concurrent sessions, approval continuations |

Also preserved but not built: per-world authorisation (D-002 in the debt ledger).

## Relationship to the model

`.sea/interaction/interaction-model.sea` defines six entities (`Operator`, `Automation`,
`Observer`, `Terminal Session`, `Execution World`, `Cockpit`) and four resources (`Execution`,
`Effect`, `Evidence`, `World State`) in domain `controlplane`. The eight journey flows are resource
movement between entities.

The canonical distinction: **how an execution entered** (J1 observed-through-session vs J2
issued-by-automation) is a variant dimension of one journey kind, never a separate ontology. J2-W is a
further specialisation by actor and surface.

## Source trail

- `.sea/interaction/canonical-journey-catalog.md` — the canonical definitions
- `.sea/interaction/interaction-model.sea` — the model
- `.sea/interaction/handoff.md` — model → implementation bindings, agents, test traceability
- `src/semantic/concepts.ts` — `metadata.journeys` grounding per concept
- `test/journeys/` — journey-named tests
- `test/semantic-concepts.test.ts` — asserts every canonical journey is grounded by a concept