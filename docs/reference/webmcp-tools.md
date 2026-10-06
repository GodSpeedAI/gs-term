# WebMCP tool reference

Tools are projections of `CAPABILITY_DESCRIPTORS` in `src/webmcp/descriptors.ts`, registered on
`document.modelContext` by `projectCapabilitiesToWebMCP`. The live list with input schemas is served at
`GET /api/meta`.

Every tool's `execute` runs through the same invoker as the cockpit. `source` is recorded as
`webmcp`; the same operation from the UI records `cockpit`.

Results are returned as `{content: [{type: "text", text: <JSON>}]}`. Invalid input returns
`{error: "..."}` in that text and has **no side effects**.

---

## `execute_command`

Run a command as a structured semantic execution in a workspace execution world.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `argv` | string[] | **yes** | non-empty; the structured path — prefer it over typing into the terminal |
| `cwd` | string | no | contained inside the world's root |
| `timeoutMs` | number | no | defaults to the configured execution timeout |
| `worldId` | string | no | execution world id — an input property of the same operation, never a provider |

Returns the agent's structured result: `executionId`, `worldId`, `command`, `argv`, `cwd`, timing,
`exitCode`, `timedOut`, `output`, and `effects[]`.

Errors: `argv must be a non-empty array of strings`; policy denial; `unknown execution world`;
containment failure.

---

## `get_world_state`

Read the current semantic world state. No input.

Returns cwd, shell, repository (status/branch/dirty/changed files), session processes, listening
ports, the last settled execution, and the observation timestamp. Scopes that could not be observed
return `unknown` with a reason.

---

## `focus_search`

Syntelligent Search through the same deterministic planner the cockpit uses.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | **yes** | non-empty |
| `worldId` | string | no | defaults to the local world |
| `referent` | EntityRef | no | a semantic referent, never a DOM path |

Returns `{results, receipt}` — at most 5 results plus the inspectable reduction receipt.

Errors: `query must be a non-empty string`; `no workspace root for world <id>`.

---

## `focus_inspect`

Inspect the shared collaborative focus. No input.

Returns `goal`, `worldId`, `primary`, `pinned`, `workingSet`, `unresolved`, `version`, and
`affordances` for the primary entity. Read-only; bounded — no source dump.

---

## `focus_propose_candidate`

Propose a `FocusCandidate`: an evidence-backed suggestion to shift the shared focus.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `proposedEntity` | EntityRef | **yes** | `{worldId, workspace?, kind, id, name?, location?}` |
| `reason` | string | no | free text |
| `evidence` | FocusEvidence[] | no | defaults to `[]` |
| `sourceAgent` | string | no | defaults to `agent.focus` |

Returns the candidate and `{sharedFocusChanged: false}`.

**The agent CANNOT accept, pin or reject.** SharedFocus changes only with human authority. There is
deliberately no tool for resolution — `test/webmcp/webmcp-projection.test.ts` asserts its absence.

---

## `code_references`

Semantic references of a symbol (who calls this) — language-server references, not text matching.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | string | **yes** | workspace-relative |
| `line` | number | **yes** | 1-based |
| `column` | number | **yes** | 1-based |
| `includeDeclaration` | boolean | no | include the declaration itself |
| `worldId` | string | no | defaults to the local world |

Returns `{locations: [...]}`. Unavailable for remote worlds and when language intelligence is not
mounted — use `focus_search` then.

---

## `code_definition`

Semantic definition of a symbol — where it is declared.

Same input as `code_references` (`file`, `line`, `column`, `worldId`), no `includeDeclaration`.
Returns `{locations: [...]}`.

---

## `code_diagnostics`

Language-server diagnostics for a file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | string | **yes** | workspace-relative |
| `worldId` | string | no | defaults to the local world |

Returns `{diagnostics: [{range, severity, message, code?}]}`.

---

## Deliberately absent

| Operation | Why |
| --- | --- |
| accept / pin / reject a focus candidate | SharedFocus is human-governed; a machine must not resolve its own suggestion |
| a provider-specific command tool | `worldId` is an input property of `execute_command`; there is no `ssh_*` tool, ever |
| raw PTY access | the terminal is a compatibility surface for humans, not a machine API |
| read the concept store or structural map directly | those are mechanisms behind `focus.search`, not capabilities |

The absence of these tools is enforced: `test/architecture.test.ts` fails if `registerTool` appears
outside the single projection path, and the projection test asserts no accept tool exists.

---

## The inverse seam (interface only)

`src/webmcp/consumption.ts` types the opposite direction: an external page's capability imported as a
Cognate `RemoteCapabilityOffer` — lease-bound, TTL-bounded, never authority-granting. The mapping is
tested; the consumption loop is deliberately not built (debt D-022).

## Source trail

- `src/webmcp/descriptors.ts` — `CAPABILITY_DESCRIPTORS`, `ToolInvoker`, `ToolDescriptor`
- `src/webmcp/project.ts` — `projectCapabilitiesToWebMCP`, `pageModelContext`
- `src/webmcp/consumption.ts` — `ExternalWebMCPTool`, `ExternalOfferRequest`
- `src/ui/invoker.ts` — the shared invoker
- `src/server/index.ts:101-112` — `/api/meta` exposure
- `test/webmcp/webmcp-projection.test.ts` — the contracts asserted above