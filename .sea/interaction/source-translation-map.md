# Source translation map — gs-term interaction model

Every material source statement from the evidence (`start.md` = task prompt; `AGENTS.md` = project
guidance) traced to modeled concepts. Status ∈ {represented, canonicalized, variant/projection,
contradicted, unsupported, ambiguous, intentionally-excluded, unresolved}. Evidence class ∈
{declared, observed, inferred, proposed, unknown}.

## Evidence: `.agents/prompts/start.md` (task prompt)

| Source | Source Statement | Extracted Concepts | Canonical Journey | Status | Evidence Class | Notes |
|---|---|---|---|---|---|---|
| start.md:9-17 | browser-hosted real terminal; governing model `state→affordances→action→effects→evidence→new state`; PTY is one surface over that world | control plane; PTY as compatibility surface | J1-J5 (whole) | represented | declared | model is the catalog itself |
| start.md:19 | eventually SSH/remote/browser-Linux/checkpointing/branching/previews/WebMCP discovery/agents | execution worlds; checkpoints; branching | D1-D3 deferred | intentionally-excluded | declared | seams catalogued; not implemented |
| start.md:31-36 | read AGENTS.md + building-with-cognate skill; Cognate checkout authoritative | method compliance | — | represented | declared | workflow followed |
| start.md:65-90 | use Cognate primitives; no parallel CapabilityRegistry/PolicyEngine/ToolRegistry/EventBus/etc. | primitive reuse invariant | — | represented | declared | enforced by architecture test |
| start.md:94-110 | two worlds: mechanism (Bun PTY, xterm, WS, observers) vs semantic (Cognate) | layer boundary | J1-J5 | represented | declared | `src/terminal|shell|observers` vs `src/app` |
| start.md (stage 1) | prove Bun.Terminal ↔ WS ↔ xterm ↔ Bash transport with resize/interrupt/reconnect/cleanup | PTY substrate | J4 | represented | observed | `Bun.Terminal` API verified in Bun 1.4.0 types |
| start.md (stage 2) | structured execution through Cognate with real identity/argv/cwd/timing/exit/stdout/stderr/cancel/authority | structured execution | J2 | represented | declared | `process.exec` via `@cognate/execution` |
| start.md (stage 3) | deterministic shell-integration observation of command boundaries/CWD/exit; NOT prompt-text scraping | shell adapter | J1 | represented | declared | bash preexec/precmd markers |
| start.md (stage 3) | PTY observations + structured capability executions produce THE SAME downstream semantic concepts | convergence invariant | J1+J2 same events | canonicalized | declared | shared `execution.*`/`effect.observed` event vocabulary |
| start.md (stage 4) | cheap deterministic observers: filesystem changes, Git state, process state, listening ports | effect observers | J3 | represented | declared | behind `world.snapshot` |
| start.md (stage 4) | effects carry provenance: what/how/confidence/evidence; observed over assumed; unknown over probably-false | evidence discipline | J1-J3 | represented | declared | effect schema `{what,how,confidence,refs}` |
| start.md (stage 5) | WebMCP is projection of Cognate capabilities; current spec + upstream packages; no stale `navigator.modelContext` | WebMCP projection | J2-W | represented | observed | `document.modelContext` + `@mcp-b/webmcp-polyfill` verified from donor |
| start.md (stage 6) | cockpit with terminal/world/execution inspector/event timeline; not dashboard chrome; no decorative UI | cockpit | J5 | represented | declared | operational dark UI |
| start.md (stage 7) | hardening: reconnect/resize/cleanup/idempotency/authority/redaction/unbounded-growth/restart-durability/dead-code/donors | hardening gates | T7 | represented | declared | validation suite |
| start.md (acceptance A) | xterm surface into real shell; type command; see output | terminal end-to-end | J4+J1 | represented | declared | E2E test |
| start.md (acceptance B) | human command creating file → execution + file-created effect + evidence in world | observed effects | J1+J3 | represented | declared | journey test J1 |
| start.md (acceptance C) | structured capability execution creating file → same semantic effect kind, evidence, appears in UI | convergence proof | J2 | represented | declared | journey test J2 |
| start.md (acceptance D) | WebMCP tool discoverable + invocable in-page; produces same semantic result as Cognate path | WebMCP specialization | J2-W | represented | declared | in-page proof + E2E |
| start.md (acceptance E) | repo operations → world view tracks repository/CWD/branch/dirty | git observer | J3 | represented | declared | journey test J3 |
| start.md (acceptance F) | start local server → session-associated process/port discovered in world view; stop → cleared | process/port observers | J3 | represented | declared | `/proc` + `ss`, session-tree scoped |
| start.md (acceptance G) | reconnect resumes terminal without losing semantic state; restart preserves durable history per architecture | durability | J4+J5 | represented | declared | bounded ring is memory-only (assumption recorded) |
| start.md (WebMCP §) | capability definition is the authoritative semantic definition; no separate WebMCP implementation | projection, not parallel API | J2-W | represented | declared | descriptor registry → thin adapter |
| start.md (WebMCP §) | future external WebMCP capability → Cognate external capability/provider; DO NOT overbuild | consumption seam | D2 | intentionally-excluded | declared | type-level seam + arch test only |

## Evidence: `AGENTS.md` (project guidance)

| Source | Source Statement | Extracted Concepts | Canonical Journey | Status | Evidence Class | Notes |
|---|---|---|---|---|---|---|
| AGENTS.md purpose | different surfaces converge on one semantic world; actor/source is metadata | single ontology | J1+J2 | canonicalized | declared | `source` field only |
| AGENTS.md action hierarchy | prefer capability > structured op > PTY > pixel automation | affordance ranking | J2 over J1 for machines | represented | declared | machines must not type into terminals |
| AGENTS.md boundaries | mechanism layer knows as little about Cognate as practical | layer rule | — | represented | declared | observers are plain functions |
| AGENTS.md runtime | prefer Bun 1.4 native; no node-pty; no Node-era libs | runtime constraint | — | represented | observed | `Bun.Terminal` native PTY confirmed |
| AGENTS.md terminal architecture | real PTY + real shell; PTY byte stream not semantic source of truth; no scraping rendered output | PTY honesty | J1 | represented | declared | markers, not output parsing |
| AGENTS.md execution | separate interactive vs structured paths converging on one execution model; structured preserves argv/cwd/actor/timing/exit/cancel | execution duality | J1+J2 | canonicalized | declared | two agents, one event vocabulary |
| AGENTS.md observation | prefer deterministic observation (shell integration) over regex parsing; represent uncertainty explicitly | observation discipline | J1+J3 | represented | declared | `unknown` states |
| AGENTS.md evidence | claims retain provenance; observed/unknown over assumed/probably-false | evidence discipline | J1-J3 | represented | declared | effect schema |
| AGENTS.md WebMCP | Cognate capability → WebMCP tool; verify APIs; do not copy stale donors | WebMCP projection | J2-W | represented | observed | current spec verified |
| AGENTS.md donor policy | reuse > adapt > create; donors under `.tmp/donors/`; remove after recon; never commit | donor discipline | — | represented | declared | cleanup step T7 |
| AGENTS.md security | do not expose unrestricted machine shell merely because human can type; protect secrets; never persist/log secret env values | authority separation | J2 policy | represented | declared | kernel policy default-deny + redaction test |
| AGENTS.md UI | cockpit not dashboard chrome; React state not authoritative; UI projects application state | cockpit rule | J5 | represented | declared | projection/state reads |
| AGENTS.md persistence | inspect Cognate before persistence; `bun:sqlite` if app-owned; facts→reduction→state | durable state | J3+J5 | represented | declared | Cognate store + shared state used; no app-owned DB |
| AGENTS.md testing | behavioral correctness; real implementations; PTY/resize/signals/shell-integration/WebMCP/cleanup/reconnect/restart coverage; project commands for test/typecheck/build/e2e | test gates | T7 | represented | declared | journey + E2E suites |
| AGENTS.md instrumentation | trace who/which surface/which capability/what facts/effects/evidence/state; correlation identity; no raw PTY bytes in logs | traceability | J1+J2 | represented | declared | correlationId + run events; ring buffer only in memory |
| AGENTS.md scope discipline | do not prematurely build LLM, agent orchestration, SSH/cloud/browser providers, checkpoints, branching, CRDT, k8s, etc. | scope | D1-D5 | intentionally-excluded | declared | deferred journeys |
| AGENTS.md design rule | no speculative abstractions; only real multi-impl seams | minimal structure | — | represented | declared | reviewed at completion |
| AGENTS.md config | runtime config as toml/yaml/env; never Markdown-as-config | configuration | — | represented | declared | `gsterm.toml` |
| AGENTS.md completion checklist | duplicate Cognate abstractions / stale WebMCP / secrets / PTY cleanup / WS leaks / unbounded retention / donor tracking / git diff | final audit | T7 | represented | declared | audit list |

## Contradictions, unsupported, ambiguous

- None material. The prompt and AGENTS.md restate each other; where the prompt is more specific
  (acceptance sequence), the prompt wins; where AGENTS.md is more specific (config formats,
  checklist), AGENTS.md wins.
- "Pixel/GUI automation" in the action hierarchy has no modeling need in v0 — intentionally
  excluded (no journey performs it).

