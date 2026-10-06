# Repository and source map

Where significant concepts, capabilities, workflows and subsystems are implemented. Prefer this over
a directory listing — it is organised by meaning, not by folder.

## Concepts → implementation

| Concept | Primary implementation |
| --- | --- |
| Semantic world / snapshot | `src/semantic/contracts.ts` (`WorldSnapshot`), `src/observers/snapshot.ts` |
| Execution world | `src/app/worlds.ts`, `src/config.ts` (`SshWorldConfig`) |
| Resource identity `(worldId, resource)` | `src/semantic/contracts.ts:82`, `src/semantic/effects.ts` (worldId on every effect) |
| Execution | `src/semantic/contracts.ts:170`, `src/agents/execute.ts`, `src/agents/observe.ts` |
| Action / run | Cognate runtime; gs-term's agents in `src/agents/*` |
| Observation | `src/semantic/observations.ts`, `src/bridge/observations.ts`, `src/bridge/observation.ts` |
| Effect | `src/semantic/effects.ts` (`deriveEffects`) |
| Evidence | `src/semantic/contracts.ts:105` (`Evidence`), produced in `src/semantic/effects.ts` |
| Marker (OSC 7311) | `src/shell/markers.ts`, `src/shell/bash-init.sh` |
| Scrollback | `src/terminal/scrollback.ts` |
| Capability | `src/components/*.ts`, grants in `src/app/policy.ts` |
| Semantic object / model | `.sea/interaction/interaction-model.sea`, parsed in `src/app/bindings.ts` |
| Component | `src/components/observers.ts`, `focus.ts`, `code.ts` |
| Projection | `src/projections/executions.ts` |
| Shared thread state | `src/bridge/observation.ts` (`writeWorldState`), `src/agents/focus.ts` |
| Journey | `.sea/interaction/canonical-journey-catalog.md`; tests in `test/journeys/` |
| Attention / snapshot | `src/focus/attention.ts`, `src/semantic/focus.ts` |
| SharedFocus / candidate | `src/focus/focus.ts`, `src/semantic/focus.ts` |
| Affordance | `src/focus/affordances.ts` |
| Syntelligent Search / receipt | `src/focus/search.ts` |
| Mechanism | `src/focus/mechanisms.ts` (`resolveAvailability`, `buildStructuralMap`) |
| Semantic substrate | `src/mechanisms/substrate.ts` |
| Structural map | `src/focus/mechanisms.ts` (`buildStructuralMap`) |
| Concept (curated) | `src/semantic/concepts.ts`, indexed by `src/focus/concept-index.ts` |
| Truthfulness (`unknown` ≠ false) | `src/observers/*`, `src/semantic/effects.ts` (`scopedDiff` guard) |

## Capabilities → implementation

| Capability | Component | Mechanism | Grounded by |
| --- | --- | --- | --- |
| `process.exec` | `@cognate/execution` via `executionWorldsComponent` | local / ssh providers in `src/app/worlds.ts` | `test/journeys/journey-j2-*.test.ts` |
| `world.snapshot` | `src/components/observers.ts` | `src/observers/*` | `test/journeys/journey-j3-*.test.ts` |
| `focus.search` | `src/components/focus.ts` | `src/focus/search.ts`, `src/focus/mechanisms.ts` | `test/focus/*`, `journey-j9` |
| `code.*` | `src/components/code.ts` | `src/mechanisms/solidlsp.ts` | `test/journeys/journey-j9-*.test.ts` |

## Workflows → implementation

| Workflow | Entry | Core | Tests |
| --- | --- | --- | --- |
| startup / shutdown | `src/server/index.ts:209` | `createGsTermRuntime`, `TerminalSession.start`, `ObservationBridge.startFollower` | `e2e/serve.ts` |
| J1 human observation | `src/bridge/observation.ts:125` `recordObservation` | `src/agents/observe.ts` | `journey-j1-human-command-observation.test.ts` |
| J2 structured execution | `src/ui/invoker.ts` / WebMCP | `src/agents/execute.ts` | `journey-j2-structured-execution.test.ts` |
| J3 reconciliation | `src/bridge/observation.ts:81` `reconcile` | `src/observers/snapshot.ts` | `journey-j3-world-state-reconciliation.test.ts` |
| J4 attach | `src/server/index.ts:172` `websocketHandlers` | `src/terminal/session.ts` | `test/conformance/pty.test.ts` |
| J5 inspection / durability | projection subscription | `src/projections/executions.ts` | `journey-j5-restart-durability.test.ts` |
| J6 observation ingest | `src/bridge/observations.ts` | `src/semantic/observations.ts` | `journey-j6-observations.test.ts` |
| J7–J15 focus | `src/agents/focus.ts` | `src/focus/*` | `test/focus/*`, `journey-j9-…` |

## Subsystems → module map

| Subsystem | Modules |
| --- | --- |
| Runtime composition | `src/server/index.ts`, `src/app/runtime.ts`, `src/app/bindings.ts`, `src/config.ts`, `src/doctor.ts` |
| Capability components | `src/components/observers.ts`, `focus.ts`, `code.ts` |
| Journey agents | `src/agents/execute.ts`, `observe.ts`, `focus.ts`, `shared.ts` |
| Observation bridge | `src/bridge/observation.ts`, `src/bridge/observations.ts` |
| Observers | `src/observers/snapshot.ts`, `filesystem.ts`, `git.ts`, `processes.ts`, `ports.ts` |
| Terminal / shell | `src/terminal/session.ts`, `scrollback.ts`, `protocol.ts`, `src/shell/markers.ts`, `bash-init.sh` |
| Execution worlds | `src/app/worlds.ts` |
| Effects & evidence | `src/semantic/effects.ts`, `src/semantic/observations.ts`, `contracts.ts` |
| Focus engine | `src/focus/search.ts`, `mechanisms.ts`, `focus.ts`, `attention.ts`, `affordances.ts`, `concept-index.ts` |
| Semantic substrate | `src/mechanisms/substrate.ts`, `semantic-helper.ts`, `solidlsp.ts`, `jsonlines.ts`, `readiness.ts` |
| State & projections | `src/projections/executions.ts` |
| Authority | `src/app/policy.ts`, `bearerAuthenticator` |
| WebMCP | `src/webmcp/descriptors.ts`, `project.ts`, `consumption.ts` |
| Cockpit | `src/ui/*` |

## Semantic substrate (outside `src/`)

| Piece | Location |
| --- | --- |
| Rust helper | `rust/crates/gsterm-semantic/` (`main.rs`, `zgrep.rs`, `concepts.rs`, `model2vec.rs`, `proto.rs`) |
| Prebuilt artifacts | `rust/artifacts/bin/`, `rust/artifacts/lib/` |
| Artifact staging | `rust/scripts/install-artifacts.sh` |
| Python bridge | `solidlsp/src/gsterm_solidlsp/bridge.py`, `__main__.py` |
| Bridge self test | `solidlsp/selftest.py` |
| Locked Python env | `solidlsp/pyproject.toml`, `solidlsp/uv.lock` |

## Canonical semantic source

| File | Role |
| --- | --- |
| `domain/interaction-model.sea` | symlink to the model so `loadSemanticProjection` and `cognate dev` read one source of truth |
| `.sea/interaction/interaction-model.sea` | entities, resources, journey flows, referenced policies |
| `.sea/interaction/canonical-journey-catalog.md` | J1–J15 in full plus deferred seams |
| `.sea/interaction/source-translation-map.md` | statements traced to model concepts |
| `.sea/interaction/assumptions-and-unknowns.md` | assumptions and unknowns |
| `.sea/interaction/handoff.md` | model → Cognate bindings, agents, event vocabulary, authority |
| `.sea/interaction/validation/` | DomainForge commands, outputs, diagnostics, limitations |

## Tests

| Path | Contract |
| --- | --- |
| `test/architecture.test.ts` | layer and boundary invariants |
| `test/app.test.ts` | config, bindings, grants, containment, first-boot execution |
| `test/semantic-concepts.test.ts` | the concept registry contract |
| `test/conformance/pty.test.ts` | PTY, resize, interrupt, exit, cleanup |
| `test/conformance/shell-markers.test.ts` | marker parser edge cases |
| `test/conformance/worlds.test.ts` | provider self-description without credential leaks |
| `test/journeys/` | J1, J2, J2-worlds, J3, J5, J6, J9 |
| `test/focus/` | attention, focus lifecycle, search, semantic search, integration |
| `test/webmcp/webmcp-projection.test.ts` | projection, validation, absent accept tool, offer mapping |
| `test/mechanisms/mechanisms.test.ts` | helper discovery, handshake, concept lifecycle, disposal |
| `test/support/semantic-gate.ts` | `GSTERM_REQUIRE_SEMANTIC` skip-to-failure |
| `test/support/ssh-fixture.ts` | in-process SSH server fixture (D-029) |
| `e2e/acceptance.spec.ts` | real browser/server/PTY, acceptance A–G |
| `rust/crates/gsterm-semantic/tests/integration.rs` | helper protocol |
| `solidlsp/selftest.py` | bridge lifecycle, provisioning, orphans |

## Configuration and infrastructure

| Path | Role |
| --- | --- |
| `gsterm.toml` | runtime configuration |
| `cognate.config.ts` | optional vendored `cognate dev` profile |
| `devbox.json` / `devbox.lock` | reproducible toolchain (no node) |
| `package.json`, `bun.lock` | scripts and dependencies |
| `tsconfig.json`, `.oxlintrc.json` | type checking and linting |
| `playwright.config.ts` | e2e |
| `scripts/bootstrap.sh`, `scripts/verify-all.sh` | provisioning and the validation gate |
| `.github/workflows/verify.yml` | the clean-machine release oracle |

## Working-state documents (separate audiences)

| Path | Role |
| --- | --- |
| `AGENTS.md` | durable coding-agent guidance for this repository |
| `.agents/CURRENT_STATUS.md` | current state and watch items |
| `.agents/DEBT.md` | the debt ledger — canonical home for known limitations with owners |
| `.agents/plans/` | tranche plans |
| `.agents/prompts/start.md` | the acceptance sequence A–G origin |

## Generated and ignored directories

`.gsterm/` (concept store, SolidLSP data, model cache), `.cognate/` (vendored Cognate tarballs and the
app store), `rust/target/`, `.devbin/` (bootstrapped Bun and the node shim), `node_modules/`,
`test-results/`, `playwright-report/`.

## Source trail

This page is derived from the file tree, `tsconfig.json` include paths, and the import graph reachable
from `src/server/index.ts`. Subsystem pages carry per-page source trails with symbol-level detail.