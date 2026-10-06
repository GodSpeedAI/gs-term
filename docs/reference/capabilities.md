# Capability reference

Capabilities are named, versioned, policy-checked operations. This is the complete set; anything
else is denied by the kernel policy.

## Grant summary

| Capability | Version | Grated actors | Bound semantic object |
| --- | --- | --- | --- |
| `process.exec` | from `@cognate/execution` | `human`, `webmcp`, `system` | `controlplane::Execution` |
| `world.snapshot` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Evidence` |
| `focus.search` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Syntelligent Search` |
| `code.definition` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Code Symbol` |
| `code.references` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Code Symbol` |
| `code.implementations` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Code Symbol` |
| `code.diagnostics` | `1.0.0` | `human`, `webmcp`, `system` | `controlplane::Diagnostic` |

Recognised actors: `human`, `webmcp`, `system`. Anything else is denied.

---

## `process.exec`

Structured command execution in one execution world.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `worldId` | string | no | execution world id; defaults to the local world. Never a provider name. |
| `argv` | string[] | **yes** | non-empty, each element a non-empty string without NUL |
| `cwd` | string | no | contained inside the world's root; escape fails closed |
| `timeoutMs` | number | no | defaults to `execution.timeout_ms` or the world's `default_timeout_ms` |

**Output**

`{stdout, stderr, exitCode, timedOut}`

**Errors**

| Condition | Message |
| --- | --- |
| unregistered world | `unknown execution world: <id>` |
| `cwd` outside the root | containment failure (debt D-003) |
| capability not granted | `capability process.exec is not granted to this application` |

**Side effects** — spawns a process in the target world. The agent then snapshots before and after
and derives effects; the capability itself records nothing.

**Implementation** — `@cognate/execution`; providers registered in `src/app/worlds.ts`.

---

## `world.snapshot`

One coherent evidence snapshot of one world. The only evidence-gathering capability.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `worldId` | string | no | defaults to the session world; unknown or disposed worlds throw |

**Output** — `WorldSnapshot`

```ts
{ observedAt,
  world: { worldId, kind, metadata },
  root,
  walk: { method, truncated, excluded },
  files: [{ path, kind, size, version }],
  git: { status: "observed" | "no-repo" | "unknown", observedAt, method, root?, branch?, dirty?, changedFiles?, reason? },
  processes: Scoped<{pid, ppid, command}>,
  ports:    Scoped<{port, protocol, address, pid, process}> }
```

`Scoped<T>` is either `{status:"observed", observedAt, method, entries}` or
`{status:"unknown", observedAt, reason}`.

**Constraints**

- The filesystem walk is capped at 5 000 entries and excludes `.git`, `node_modules`, `.cognate`;
  hitting the cap sets `walk.truncated`.
- Processes come from the session's process tree via `/proc`; without a session root pid the scope is
  `unknown`.
- Ports are claimed only when attributable to that process tree via `ss -H -ltnp`.
- Remote worlds report processes and ports as `unknown` (D-010).

**Implementation** — `src/components/observers.ts`, `src/observers/*`.

---

## `focus.search`

Syntelligent Search: deterministic, intent-routed, bounded, world-local, with an inspectable
receipt.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `worldId` | string | **yes** | the world's process port is the world's identity |
| `query` | string | **yes** | non-empty |
| `intent` | SearchIntent | no | detected from the query when omitted |
| `snapshot` | AttentionSnapshot | no | frozen attention; makes referents stable |
| `focus` | SharedFocus | no | recorded as `sharedFocusVersion` in the receipt |
| `referent` | EntityRef | no | semantic referent, never a DOM path |
| `execution` | `{executionId, command, exitCode, affected[]}` | no | evidence-first for `why-did-this-fail` |

**Output**

```ts
{ results: SearchResult[], receipt: SearchReceipt }
```

- `results` — at most 5, de-duplicated by `entity.id`, each with `reason`, `evidence[]`,
  `mechanisms[]`, `location{snippet}`, `relevance`, and `affordances[]`.
- `receipt` — `{id, query, intent, worldId, workspace, snapshotId?, sharedFocusVersion,
  availability[], stages[{name, mechanism?, candidates}], reduction{workspace, focusScope,
  structural, semantic, verified}, results, provenance{method, crossWorld:false}, searchedAt}`.

**SearchIntent** — `what-is-this`, `why-did-this-fail`, `who-calls-this`, `related-tests`,
`changed-recently`, `what-opened-this-port`, `semantic`, `reconnect`, `architecture`.

**MechanismName** — `rg`, `solidlsp`, `zvec-grep`, `zvec`, `structural-map`.

**Errors** — `no workspace root for world <id>` when the world has no root.

**Implementation** — `src/components/focus.ts`, `src/focus/search.ts`, `src/focus/mechanisms.ts`.

---

## `code.definition` / `code.references` / `code.implementations` / `code.diagnostics`

Precise code semantics via SolidLSP. 1-based positions in, 1-based positions out.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `worldId` | string | **yes** | must be the local world |
| `file` | string | **yes** | workspace-relative |
| `line` | number | **yes** | 1-based, ≥ 1 |
| `column` | number | **yes** | 1-based, ≥ 1 |
| `includeDeclaration` | boolean | no | `references` only |

**Output**

| Capability | Output |
| --- | --- |
| `code.definition` | `{locations: [{file, start:{line,character}, end:{…}}]}` |
| `code.references` | same, optionally including the declaration |
| `code.implementations` | same |
| `code.diagnostics` | `{diagnostics: [{range, severity, message, code?}]}` |

**Errors** — `code capability requires worldId` / `requires a file` / `requires a 1-based line` /
`requires a 1-based column`; and
`code capabilities unavailable for world <id> (SolidLSP not mounted)` for any world where the
substrate is not mounted.

**Implementation** — `src/components/code.ts`, `src/mechanisms/solidlsp.ts`.

---

## Agent intents (`agent.focus`)

Not capabilities — an agent run that may invoke capabilities.

| Intent | Required input | Effect |
| --- | --- | --- |
| `search` | `query`, `sessionId` | invokes `focus.search`; emits `focus.search.completed` |
| `code` | `op`, `file`, `line`, `column`, `sessionId` | invokes a `code.*` capability; emits `focus.code.completed` |
| `propose` | `candidateId`, `proposedEntity`, `reason`, `sourceAgent`, `evidenceToken`, `sessionId` | emits `focus.candidate.proposed`; SharedFocus unchanged |
| `inspect` | `sessionId` | read-only SharedFocus + affordances |
| `accept` | `candidate`, `sessionId` | **human only**; updates SharedFocus |
| `pin` | `entity`, `sessionId` | **human only**; updates SharedFocus |
| `reject` | `candidate`, `sessionId` | **human only**; candidate marked rejected, SharedFocus unchanged |

## Source trail

- `src/app/policy.ts:13-21` — the grant allow-list
- `src/app/bindings.ts:39-47` — the binding table
- `src/components/observers.ts`, `focus.ts`, `code.ts` — contracts and versions
- `src/semantic/contracts.ts:89-98` — `WorldSnapshot`
- `src/semantic/focus.ts:114-184` — intents, mechanisms, receipt
- `src/agents/focus.ts` — intent dispatch and input requirements
- `/api/meta` — the runtime list of capability names and tool schemas