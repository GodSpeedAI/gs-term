# gs-term debt ledger

Durable record of known architectural, semantic, implementation, testing, UX, and framework
debt. Created in Phase 2 as mandated; updated while evidence is fresh. **Append/extend, never
silently drop.** Detailed background lives in the referenced artifacts — this file is the
summary of record.

Statuses: `open` · `watch` · `blocked` · `upstream-candidate` · `accepted` · `resolved`.
Owners: `gs-term` · `Cognate` · `DomainForge` · `Bun` · `unresolved`.

---

## Cognate / framework debt

### D-001 No external observation-ingest primitive
- **Current behavior:** mechanism-layer facts (shell boundaries, fs changes, ports) enter Cognate only
  by starting an agent run (`startRun("agent.observe")` via `src/bridge/observation.ts`); runs are the
  only event door (`ctx.emit`).
- **Why debt:** INTENT ("execute this"), OBSERVATION ("file appeared / port opened / process
  exited"), and INFERENCE ("this execution caused this effect") are different semantic kinds; the log
  currently represents observations as if actions/runs occurred.
- **Consequence/risk:** event semantics conflate acting with noticing; consumers must know which runs
  are pseudo-runs; pressure grows per observed fact.
- **Workaround:** `agent.observe`/`agent.execute` runs with `source` metadata; catalog J1/J2 document
  the mapping. No fake local observation bus was invented.
- **Evidence:** `.sea/interaction/assumptions-and-unknowns.md` A1; `runtime-api` service surface (no
  append/ingest method). **Phase-2 pressure test (SSH, second physical reality source) STRENGTHENED
  the case:**
  1. remote facts *during* an execution (remote file appeared) settle through the same pseudo-run
     door as local facts — the door did not generalize, it just got more traffic;
  2. facts *outside* any execution remain unrepresentable at all: the SSH connection dropping, a
     foreign remote change, fixture shutdown — recording them would require inventing an action;
  3. world-state reconciliation records observations as `state.changed` with
     `metadata.source: "caller"` — an observation disguised as a caller edit;
  4. `world.snapshot` computes rich facts that are silently discarded unless a run or a shared-state
     write consumes them.
- **Phase-2.5 framework-gap validation (building-with-cognate) — CONFIRMED a general Cognate gap.**
  Existing primitives considered and rejected as the door: `RunContext.emit` (run-bound), `startRun`
  (fabricates intent), `updateSharedState` (`source:"caller"` = mutation provenance), RealityTrace
  `Observation` (an **outbound** evidence adapter — requires an existing `eventId`, `observationId`
  derived from the source event; direction is event-log → external, not reality → log), `NewEvent`/
  `DurableStore.commit` (already supports `runId:null`/`causationId:null` but is a low-level store
  port bypassing governor/idempotency), `cognitive-api` `SourceType:"observation"` (indexing, not
  ingest). The envelope and evidence layer already anticipated observations; the **inbound ingest
  door** was missing. General: any Cognate app with an external reality source faces this.
- **Implementation (Phase 2.5):** smallest general primitive — `RuntimeService.observe(caller, input)`
  appends a run-less `observation.recorded` event with observation provenance
  (`metadata.source:"observation"`), `runId:null`, `causationId` set ONLY when
  `attribution.kind==="caused"` (unknown causation stays null — never invented), world-scoped
  `(worldId, resource)` identity, `observation.record` authority, deterministic idempotent replay;
  `emit` reserves `observation.` so a run cannot fabricate one. Reuses the existing envelope/governor/
  idempotency/projections and feeds RealityTrace's `Observation` (outbound) — no parallel event bus.
- **Migration evidence (gs-term):** `src/bridge/observation.ts` reconciliation discovered facts (a
  port appearing, a tree turning dirty) now enter via `service.observe` (`src/semantic/observations.ts`
  builders) as observations — no manufactured action/run. Proofs in
  `test/journeys/journey-j6-observations.test.ts`: **D** a foreign fact enters without a fabricated
  run (runId:null, source:"observation"); **E** an execution's effect retains correlation + cited
  causation while remaining `runId:null`; **F** `observed:true, causedBy:unknown` (causationId null,
  attribution not "caused"); **G** `(worldId, resource)` identity preserved across local/ssh. The
  J1 PTY command remains a run (a real execution); effects are still correctly execution-associated
  (Phase-1/2 model unchanged).
- **Cognate commit:** `fb7c250b3c164776c2585e53c810106ea9d6ad0a` (feat: add first-class observation
  ingestion). Tests: `packages/runtime-bun/test/observation.test.ts` (11 green) + gs-term j6 (4 green).
- **Reconsider:** on a third reality source, continuous observation, or if effect-evidence fan-out to
  observations is later wanted (auto-deriving observations for every effect in the follower).
- **Owner:** Cognate (primitive) + gs-term (migration) · **Status:** `resolved`

### D-002 Kernel `Policy` cannot distinguish execution worlds
- **Current behavior:** `AuthorizationRequest` carries `{capability, providerId, actor, tenant,
  scopeId, correlationId}` — no input, and `providerId` is the shared component id
  (`execution:worlds`) for every world. Per-world authority is not expressible.
- **Why debt:** "local `process.exec` allowed" must not imply "every SSH world allowed", but the
  policy decision point cannot see `worldId`.
- **Consequence/risk:** world-level grants/denials can only be enforced outside kernel policy.
- **Workaround:** capability-level allow-list (existing) + **registration is the grant boundary**
  (unconfigured world ids fail closed with `WorldUnavailableError`); no parallel permission
  registry invented.
- **Evidence:** `packages/kernel-api/src/types.ts` (`AuthorizationRequest`); `packages/execution/src/capabilities.ts`
  routes by input `worldId` after authorization.
- **Phase-2 evidence:** the registration-boundary workaround is implemented and tested
  (unregistered world ids fail closed — `journey-j2-worlds.test.ts` authority test).
- **Reconsider:** when per-world actor authority is actually needed; upstream proposal only via
  the `building-with-cognate` gap method.
- **Owner:** Cognate · **Status:** `upstream-candidate`

### D-003 `process.exec` does not canonicalize `cwd` (containment is caller-side)
- **Current behavior:** `ExecSpec.cwd` reaches the provider raw; symlink-safe containment exists
  only on `fileSystem.resolve`. gs-term applies string containment (`resolveLocal(root, cwd)`)
  in `agent.execute`.
- **Why debt:** string containment does not catch symlink escapes in `cwd`.
- **Consequence/risk:** a symlinked cwd could escape the workspace root before exec.
- **Workaround:** string checks with per-world roots; file ops still go through `resolve`-guarded
  ports.
- **Evidence:** `packages/execution/src/types.ts` (`ExecSpec.cwd` semantics); `src/agents/execute.ts`
  (Phase 2: string containment now applies per-world roots, including remote POSIX roots).
- **Reconsider:** if untrusted callers can name arbitrary cwd values.
- **Owner:** unresolved (contract design) · **Status:** `watch`

### D-004 DomainForge formatter defect (quantifiers + comments)
- **Current behavior:** `domainforge fmt --check` is non-clean on `interaction-model.sea`;
  `fmt --out` would rewrite `forall` into a form the parser rejects and drop `//` comments.
- **Why debt:** model files cannot be formatter-enforced.
- **Workaround:** never run `fmt --out` on the model; documented in
  `.sea/interaction/validation/diagnostics.md`.
- **Evidence:** `domainforge-sea` SKILL step 7. · **Reconsider:** when DomainForge fixes it.
- **Owner:** DomainForge · **Status:** `watch`

## Semantic / model debt

### D-005 World-scoped resource identity is an app-level convention
- **Current behavior:** Cognate defines no cross-world resource identity type; paths are
  world-scoped implicitly (provider-owned). gs-term effects carry `(worldId, path)` as identity.
- **Why debt:** identity convention lives in `src/semantic/contracts.ts`, not the framework;
  string-equal paths across worlds must never be merged.
- **Consequence/risk:** consumers could compare `target` alone and collide worlds.
- **Workaround:** `Effect.worldId` + `ExecutionEntry.worldId` + snapshot `world` provenance;
  the Phase-2 collision test asserts distinctness.
- **Evidence:** Phase-2 mandate ("world/resource identity"); `contracts.ts`; implemented via
  `Effect.worldId` + snapshot `world` provenance; collision-tested (`journey-j2-worlds.test.ts`:
  identical paths stay distinct).
- **Reconsider:** if a third identity dimension appears (containers, branches).
- **Owner:** unresolved → possibly Cognate · **Status:** `watch`

### D-006 World state is single-world (session-local) scoped
- **Current behavior:** the J3 world view (cwd/repo/processes/ports) describes the local PTY
  world only; the `session:<id>` thread state has no per-world layout.
- **Why debt:** with multiple worlds, "current world state" needs a per-world model.
- **Workaround:** executions/effects carry world identity; world panel shows the session world.
- **Evidence:** `src/bridge/observation.ts` (`buildWorldState`); catalog J3.
- **Reconsider:** Phase 3 (multi-session / multi-world cockpit). · **Owner:** gs-term ·
  **Status:** `accepted`

### D-007 Journey identity expressed as `.sea` flow annotations
- **Current behavior:** no journey primitive in `.sea`; `@journey` annotations + the catalog own
  journey semantics (`.sea/interaction/validation/limitations.md`).
- **Owner:** DomainForge · **Status:** `watch`

### D-008 Roles/Relations omitted from the `.sea` model
- **Current behavior:** actor entities double as journey roles; no two-role predicate exists yet.
- **Owner:** gs-term · **Status:** `accepted`

## Execution / provider debt

### D-009 No `~/.ssh/config` alias resolution
- **Current behavior:** SSH worlds are fully explicit in `gsterm.toml` (host/port/user/auth);
  `ssh2` does not parse OpenSSH config, so `Host` aliases are not resolved.
- **Why debt:** users with aliased hosts must duplicate settings.
- **Workaround:** explicit config; `auth = "agent"` still uses `SSH_AUTH_SOCK`.
- **Reconsider:** if alias support becomes a real need (provider-side, not app-side).
- **Owner:** gs-term/Cognate provider · **Status:** `watch`

### D-010 Remote processes/ports are not observed for SSH worlds
- **Current behavior:** session-tree/`ss` observation is a local-PTY concept; SSH snapshots mark
  `processes`/`ports` as `unknown` with a stated reason instead of inventing attribution.
- **Why debt:** a remote effect like "server started on the remote host" would go unobserved.
- **Workaround:** honest `unknown` (never false); files + git are observed remotely.
- **Reconsider:** Phase 3+ if remote port discovery matters. · **Owner:** gs-term ·
  **Status:** `accepted`

### D-011 WSL provider exists but is unregistered
- **Current behavior:** Cognate ships `@cognate/execution-wsl`; gs-term registers local + SSH
  only (Phase-2 scope).
- **Owner:** gs-term · **Status:** `accepted` (deferred seam; trivial later registration)

### D-031 Local `exec` kill semantics diverge from the SSH supervisor
- **Current behavior:** on timeout/abort the local provider kills the spawned process but not its
  process group; grandchildren holding the stdio pipes keep `exec` pending until they exit. The
  SSH provider's supervisor ends the command's process group.
- **Why debt:** same capability, different cancellation/timeout closure semantics per provider —
  surfaced by Cognate's own conformance suite with a `sh -c "sleep 30"` slow command.
- **Consequence/risk:** wrapper commands that spawn background children can delay or mask timeout
  settlement on the local world.
- **Workaround:** express long-running commands as direct argv (`["sleep","30"]`) in tests; app
  timeouts still bound typical commands.
- **Evidence:** `test/conformance/worlds.test.ts` run before/after harness fix (2 failures);
  `packages/execution/src/local.ts` vs `execution-ssh` `supervisedExecScript` kill paths.
- **Reconsider:** when provider parity on group-kill matters (remote PTY, daemons).
- **Owner:** Cognate (provider contract parity) · **Status:** `upstream-candidate`

## Terminal / shell debt

### D-012 Bash-only shell integration
- **Current behavior:** `src/shell/bash-init.sh` (DEBUG-trap preexec + PROMPT_COMMAND precmd).
- **Workaround/notes:** marker protocol (`markers.ts`) is shell-agnostic. · **Owner:** gs-term ·
  **Status:** `accepted`

### D-013 One PTY session per server
- **Current behavior:** single durable session (`session.id = main`); N viewers attach.
- **Reconsider:** Phase 3 (multi-session). · **Owner:** gs-term · **Status:** `accepted`

### D-014 Compound shell lines record the first simple command
- **Current behavior:** DEBUG-trap `BASH_COMMAND` semantics (README limitations). · **Owner:** gs-term ·
  **Status:** `accepted`

### D-015 PTY-observed stdout/stderr represented as `unknown`
- **Current behavior:** A6: output lives in the terminal stream; observe-runs record `output: "unknown"`.
- **Owner:** gs-term · **Status:** `accepted`

### D-016 `setsid` wrapper required for job control (Bun PTY spawn limitation)
- **Current behavior:** `Bun.spawn({terminal})` (Bun 1.4.0) does not session-lead the child; gs-term
  spawns `setsid bash …` (verified: job control, Ctrl-C, `Ss+`).
- **Why debt:** environmental workaround for a runtime gap; without `setsid` on PATH the fallback
  silently loses interrupt semantics.
- **Workaround:** `Bun.which("setsid")` guard + documented fallback. · **Owner:** Bun ·
  **Status:** `watch`

## Observation / evidence debt

### D-017 Settlement-time snapshots, not continuous watchers
- **Current behavior:** fs/git/process/port facts gathered at execution settlement or attach;
  between-settlement changes surface at the next observation (U4). · **Owner:** gs-term ·
  **Status:** `accepted`

### D-018 Marker loss on abnormal PTY death leaves unsettled commands
- **Current behavior:** absence, never fabrication (U5). · **Owner:** gs-term · **Status:** `accepted`

### D-019 Snapshot walk cap and preSnapshot payload size
- **Current behavior:** fs walk capped (5000 entries, `truncated` flag); J1 preSnapshot travels in
  run input (KBs typical, ~300KB worst case).
- **Why debt:** fat durable events; cap trades completeness for boundedness. · **Owner:** gs-term ·
  **Status:** `watch`

### D-020 Remote observations outside runs have no entry point (see D-001)
- **Current behavior:** remote facts observed during execution settle via the execution run;
  facts outside an execution (connection dropped, foreign remote change) cannot enter the log
  without a pseudo-run.
- **Evidence:** Phase-2 SSH pressure test — folded into D-001's verdict (3: primitive warranted).
  · **Resolution (Phase 2.5):** the first-class observation door (`RuntimeService.observe`) represents
  any out-of-run fact, remote included — `(worldId, resource)` keeps it world-scoped; j6 proofs cover
  foreign + unknown-causation cases. · **Owner:** Cognate + gs-term (via D-001) · **Status:** `resolved` (Cognate `fb7c250`)

## WebMCP debt

### D-021 WebMCP polyfill API drift
- **Current behavior:** installed `@mcp-b/webmcp-polyfill` v5 exposes `initializeWebMCPPolyfill`
  and `executeTool(tool, inputArgsJson: string)`; docs describe a newer object-input API.
- **Workaround:** typed against the verified dist; tests pin the shape. · **Owner:** upstream ·
  **Status:** `watch`

### D-022 WebMCP consumption (D2) is a typed seam only
- **Current behavior:** `offerRequestFromExternalTool` → `RemoteCapabilityOffer` mapped +
  round-trip tested; no tab control, no import loop. · **Owner:** gs-term · **Status:** `accepted`

## UI / UX debt

### D-023 World availability is probed on demand
- **Current behavior:** selecting a world shows kind/host from `registry.list()`; live availability
  comes from an on-demand `world.snapshot` (existing capability), not a persistent connection
  status. · **Reconsider:** Phase 3. · **Owner:** gs-term · **Status:** `accepted`

### D-024 Client timeline capped at 2000 events; minimal argv splitter
- **Current behavior:** UI caps retained events; runner splits on whitespace + double quotes
  (advanced quoting belongs to the PTY). · **Owner:** gs-term · **Status:** `accepted`

## Persistence / state debt

### D-025 Projection `run:<id>` marker keys leak into raw reads
- **Current behavior:** `readProjection` returns marker keys; consumers filter with `isMarkerKey`.
- **Owner:** gs-term · **Status:** `accepted`

## Security / authority debt

### D-026 Dev-token authenticator
- **Current behavior:** `Bearer <tenant>:<actorId>[:<kind>]` in `src/server/index.ts`; a
  development boundary, not production auth. · **Owner:** gs-term · **Status:** `accepted`

### D-027 Unrestricted human PTY
- **Current behavior:** compatibility surface by design; machine authority never inferred from it
  (`gsterm::machine_authority_is_explicit`). · **Owner:** gs-term · **Status:** `accepted`

### D-028 SSH credentials are provider-only — enforced, watched
- **Current behavior:** key material/passwords live in provider config (env refs or key paths);
  world `metadata` exposes only `auth` *kind* + host-key fingerprint; events/logs/UI/WebMCP never
  receive credentials. Enforced by `test/conformance/worlds.test.ts` (metadata leak assertions)
  and the ephemeral-keypair E2E world (no credentials in the repo). · **Owner:** gs-term ·
  **Status:** `watch` (audit each release)

## Testing / validation debt

### D-029 SSH tests run against an in-process fixture server
- **Current behavior:** `@cognate/execution-ssh/fixture` runs a real `ssh2` server whose remote
  end is a test double over the real filesystem; the provider under test is genuine. Phase 2 runs
  the world proof + provider conformance against it (19 conformance cases). No external SSH host
  in CI. · **Workaround:** manual proof path documented in README against a real host.
- **Owner:** gs-term · **Status:** `accepted`

### D-030 No dedicated linter
- **Current behavior:** resolved in Phase 3 — `bun run lint` runs `oxlint --type-aware` (oxlint 1.87 +
  oxlint-tsgolint 7.0 type-aware path); `tsc --noEmit` kept as a separate gate. Deterministic, green
  (0 errors; correctness warnings advisory). · **Owner:** gs-term · **Status:** `resolved`

### D-032 Vendored SSH fixture is loaded untyped
- **Current behavior:** the `@cognate/execution-ssh/fixture` .ts source carries a DOM/Node stream
  typing clash under gs-term's browser-lib tsconfig; tests load it through a non-literal dynamic
  import (`test/support/ssh-fixture.ts`) so TS skips it while Bun runs the real module.
- **Why debt:** fixture types are hand-declared locally and can drift from upstream.
- **Workaround:** hand-written fixture interface; runtime remains the genuine module.
- **Evidence:** `tsc` failure inside the vendored `fixture.ts` before the loader existed.
- **Reconsider:** when the upstream fixture compiles under DOM-lib tsconfigs.
- **Owner:** Cognate (fixture typing) · **Status:** `watch`

## Phase 3 (Focus Engine / Syntelligent Search) debt

### D-033 SolidLSP not mounted (language semantics)
- **Resolution (Phase 3.5):** mounted for real. `solidlsp/src/gsterm_solidlsp/bridge.py` hosts
  SolidLSP from PyPI **`serena-agent==1.7.0`** (uv-locked, MIT — audited: upstream main later
  relicensed the Serena application GPL; SolidLSP-at-1.7.0 is the clean distribution) behind the
  managed stdio JSON-lines seam. The TypeScript language server (typescript-language-server 5.1.3
  + tsserver 5.9.3) is provisioned by bun and runs **under Bun 1.4.x** via a node→bun PATH shim —
  byte-identical LSP behavior vs Node was verified before choosing this path. Lifecycle:
  start/ready/restart/dispose with process-tree cleanup (selftest-proven, no orphans). Planning
  note: tsserver `workspace/symbol` (navto) needs loaded projects; the planner warms the declaring
  file before reference resolution. · **Owner:** gs-term · **Status:** `resolved`

### D-034 zvec-grep / zvec not mounted (hybrid semantic retrieval)
- **Resolution (Phase 3.5):** mounted as ONE managed Rust helper (`rust/crates/gsterm-semantic`,
  stdio JSON-lines) hosting the zvec-grep **engine** (`zg-engine` cargo git dep @ `28ef200`,
  Apache-2.0 — the upstream Rust rewrite is 0.0.1/unpublished; git dep verified resolvable) and a
  **zvec concept collection** (`zvec-rust` 0.7.2) over gs-term's curated concept objects
  (`src/semantic/concepts.ts`, digest-marked store; embeddings are retrieval-only, explicit links
  stay authoritative). `local/potion-code-16m-v2` (dim 256, sha256-pinned) is shared with the
  engine cache; the concept embedder ports the engine's exact mean-pool math. Scores are cosine
  DISTANCES. zvec collections are single-writer (exclusive LOCK) — one helper process owns a
  store; never open it elsewhere. Transitive pin: `llama-cpp-2 ==0.1.154` (zg-engine breaks
  against >= 0.1.155). · **Owner:** gs-term · **Status:** `resolved`

### D-035 Structural map is a minimal deterministic tier
- **Update (Phase 3.5):** the base tier is unchanged (deterministic, provenance-tagged
  `file-topology`/`regex-import`), and a bounded **SolidLSP enrichment tier** was added:
  definition-verified `defines` edges and file-level `references` edges with `how:"solidlsp"`
  (caps: 40 defines / 10 reference sweeps; failures degrade to the base tier with
  `enriched:false`). No relationships the language server cannot establish are invented; call
  hierarchy stays out (unsupported for TS). · **Owner:** gs-term · **Status:** `accepted`

### D-036 Ambiguous referent limits
- **Current behavior:** referent resolution is a fixed precedence; when several near-precedence
  candidates exist it surfaces alternatives ("I think you mean") rather than guessing. Arbitrary
  numeric confidence is not modeled. · **Owner:** gs-term · **Status:** `accepted`

### D-037 Dynamic WebMCP affordance registration not used
- **Current behavior:** a stable WebMCP core (execute_command, get_world_state, focus_search,
  focus_inspect, focus_propose_candidate) is registered; context-relevant dynamic tool churn is
  deliberately not relied on (Chromium reliability). `focus_inspect` returns current affordances.
  Human resolution (accept/pin/reject) is intentionally NOT a WebMCP tool (agent cannot self-resolve).
  · **Owner:** gs-term · **Status:** `accepted`

### D-038 Effect→observation fan-out is bounded and optional
- **Current behavior:** `src/bridge/observations.ts` `recordEffectObservations` fans out only
  Focus-relevant effects (file/port/git/process) as idempotent observations correlated to their
  execution; `none`/noise excluded. Full auto-fan-out in the settlement follower is the remaining
  increment (available + tested on demand). Updates D-001 'Reconsider'. · **Owner:** gs-term ·
  **Status:** `watch`

### D-039 Multi-session seam preserved
- **Current behavior:** SharedFocus/Attention are scoped to `focus:<sessionId>` threads +
  `(worldId, workspace, id)` entity identity; no global singleton. Session A→local→Focus A /
  Session B→ssh→Focus B is possible without redesign. Not implemented (Phase 3 scope). · **Owner:**
  gs-term · **Status:** `accepted`

## Phase 3.5 new debt

### D-040 Devbox nix toolchain cannot build the Rust helper on this host
- **Current behavior:** the devbox shell's nix gcc 16.2 wrapper produces build-script binaries
  that SIGSEGV under this WSL2 kernel (proc-macro2/quote/ort-sys build scripts crash);
  `export CC/CXX` from the gcc-wrapper is unset in `devbox.json`'s init_hook so builds use the
  rustup-managed 1.98.0 toolchain with the host linker. Devbox still provides python/uv/rg/git/ssh
  deterministically; the Rust toolchain comes from rustup (`rust-toolchain.toml` pin).
- **Why debt:** the "clean machine" story currently assumes a working host C toolchain for the
  Rust half; a fresh-machine proof of the FULL build needs either a fixed nixpkgs gcc or
  CI (GitHub Actions runner) to be the oracle. The full gate DID pass node-free on this host with
  the pinned bun bootstrap + host rustup.
- **Evidence:** `devbox run bootstrap` segfault logs (2026-10-05); `scripts/README.md` notes.
- **Reconsider:** first CI run, or when nixpkgs gcc/glibc updates land. · **Owner:** gs-term ·
  **Status:** `watch`

### D-041 SolidLSP workspace/symbol (navto) needs loaded projects on tsserver
- **Current behavior:** on a freshly started workspace, tsserver answers navto with
  `No Project` / empty until files are opened; the planner therefore warms the declaring file
  (document symbols) before reference resolution and falls back to an rg **position finder**
  (declaration pattern) when the workspace search is empty — the semantic answer itself still
  comes from SolidLSP references (J9 proof: 13 references incl. the true caller).
- **Reconsider:** if solidlsp gains an explicit "load project" API or tsserver navto behavior
  changes. · **Owner:** gs-term (planner) · **Status:** `watch`

### D-042 Node appears on dev PATHs; the shim boundary must stay explicit
- **Current behavior:** Bun executes typescript-language-server (a Node program) through a
  `node→bun` shim; SolidLSP's `which("node")`/`which("npm")` asserts are satisfied by that shim
  and an npm→bun translator. This is proven-safe (byte-identical LSP results, Node absent from
  PATH in the selftest and the node-free gate) but remains a compatibility surface to re-verify
  when Bun or typescript-language-server upgrades. · **Reconsider:** each Bun/TSL upgrades;
  long-term via a native Rust LSP client (see plan's elimination note). · **Owner:** gs-term ·
  **Status:** `watch`

## Deferred architectural seams (not debt — intentionally un-built)

| seam | planned at | preserved by |
|---|---|---|
| multi-session / multi-world cockpit | Phase 3 | attach/detach viewers, session ids, thread-per-session state |
| running-app preview + WebMCP consumption | Phase 4 | `RemoteCapabilityOffer` seam (D-022) |
| checkpoints | Phase 5 | append-only events + fold projections |
| world branching | Phase 6 | same |
| remote interactive SSH PTY | later | session abstraction is provider-neutral |
| WSL/container worlds | later | `ExecutionWorldProvider` registry (D-011) |



