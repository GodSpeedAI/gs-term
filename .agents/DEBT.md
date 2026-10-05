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
- **Current behavior:** mechanism-layer facts (shell boundaries, fs changes, ports) enter Cognate
  only by starting an agent run (`startRun("agent.observe")` via `src/bridge/observation.ts`);
  runs are the only event door (`ctx.emit`).
- **Why debt:** INTENT ("execute this"), OBSERVATION ("file appeared / port opened / process
  exited"), and INFERENCE ("this execution caused this effect") are different semantic kinds;
  the log currently represents observations as if actions/runs occurred.
- **Consequence/risk:** event semantics conflate acting with noticing; consumers must know which
  runs are pseudo-runs; pressure grows per observed fact.
- **Workaround:** `agent.observe`/`agent.execute` runs with `source` metadata; catalog J1/J2
  document the mapping.
- **Evidence:** `.sea/interaction/assumptions-and-unknowns.md` A1; `runtime-api` service surface
  (no append/ingest method). Phase 2 adds a second physical reality source (SSH): remote file
  appeared / connection dropped have the same awkward entry.
- **Reconsider:** at the Phase-2 final debt review (observation-ingest pressure test).
- **Owner:** Cognate (general concern) · **Status:** `upstream-candidate`

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
- **Evidence:** `packages/execution/src/types.ts` (`ExecSpec.cwd` semantics); `src/agents/execute.ts`.
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
- **Evidence:** Phase-2 mandate ("world/resource identity"); `contracts.ts` docs.
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
- **Evidence:** Phase-2 SSH pressure test — strengthens D-001. · **Owner:** Cognate ·
  **Status:** `upstream-candidate` (folded into D-001 review)

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
  receive credentials. · **Owner:** gs-term · **Status:** `watch` (audit each release)

## Testing / validation debt

### D-029 SSH tests run against an in-process fixture server
- **Current behavior:** `@cognate/execution-ssh/fixture` runs a real `ssh2` server whose remote
  end is a test double over the real filesystem; the provider under test is genuine. No external
  SSH host in CI. · **Workaround:** manual proof path documented in README against a real host.
- **Owner:** gs-term · **Status:** `accepted`

### D-030 No dedicated linter
- **Current behavior:** gate = `typecheck` + `test` + `e2e` (no lint tool configured).
- **Owner:** gs-term · **Status:** `watch`

## Deferred architectural seams (not debt — intentionally un-built)

| seam | planned at | preserved by |
|---|---|---|
| multi-session / multi-world cockpit | Phase 3 | attach/detach viewers, session ids, thread-per-session state |
| running-app preview + WebMCP consumption | Phase 4 | `RemoteCapabilityOffer` seam (D-022) |
| checkpoints | Phase 5 | append-only events + fold projections |
| world branching | Phase 6 | same |
| remote interactive SSH PTY | later | session abstraction is provider-neutral |
| WSL/container worlds | later | `ExecutionWorldProvider` registry (D-011) |



