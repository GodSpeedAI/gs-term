# Documentation map

Every canonical documentation page: its purpose, primary reader need, Diátaxis classification,
prerequisites, related pages, and the concepts it owns. This file is the mechanism that prevents
duplicate or competing explanations.

Update it whenever a page is created, renamed, split, merged or removed.

## Reading order

| Layer | Reader need | Pages |
| --- | --- | --- |
| 0 | "What is this?" | [README.md](README.md) |
| — | "Let me run it" | [getting-started.md](getting-started.md) |
| 1 | "How does it fit together?" | [mental-model.md](mental-model.md), [concepts.md](concepts.md) |
| 2 | "I must modify it" | [architecture.md](architecture.md), [source-map.md](source-map.md) |
| 3 | "Tell me about this part" | [subsystems/](subsystems/) |
| 4 | "What happens when I do X?" | [workflows/](workflows/) |
| 5 | "Why is it like this?" | [explanation/](explanation/) |
| 6 | "Teach me by doing" | [getting-started.md](getting-started.md) |
| 7 | "Help me do a task" | [how-to/](how-to/) |
| 8 | "Give me the exact details" | [reference/](reference/) |
| — | "It is broken" | [troubleshooting.md](troubleshooting.md) |

---

## Orientation

### `docs/README.md`

- **Purpose:** entry point; the system in one picture, first concepts, a representative journey.
- **Reader need:** orientation. **Diátaxis:** mixed, deliberately shallow — it links out rather than
  explaining.
- **Prerequisites:** none.
- **Related:** getting-started, mental-model, architecture, documentation-map, source-map.
- **Owns:** the canonical one-picture mental model of surfaces → bridge → semantic → mechanism.

### `docs/getting-started.md`

- **Purpose:** a working setup from nothing; the human and machine doors both demonstrated.
- **Reader need:** tutorial. **Diátaxis:** tutorial.
- **Prerequisites:** none beyond a Linux/WSL shell.
- **Related:** reference/cli-and-commands, reference/configuration, troubleshooting.
- **Owns:** the canonical first-run procedure.

### `docs/documentation-map.md`

- **Purpose:** this file — canonical ownership and navigation integrity.
- **Reader need:** maintainer orientation.

---

## Mental model

### `docs/mental-model.md`

- **Purpose:** conceptual structure — layers, intent vs reality, two doors, state, time and causality,
  reduction, attention vs focus, trust boundaries.
- **Reader need:** explanation. **Diátaxis:** explanation.
- **Prerequisites:** README.
- **Related:** architecture, concepts, subsystems/observation-bridge.
- **Owns:** the canonical conceptual model (no file paths until its source trail).

### `docs/concepts.md`

- **Purpose:** the vocabulary every other page depends on, including what each term does *not* mean.
- **Reader need:** reference. **Diátaxis:** reference.
- **Prerequisites:** README.
- **Related:** reference/journeys, subsystems/focus-engine, subsystems/execution-worlds.
- **Owns:** canonical definitions of every repository-specific term.

---

## Architecture

### `docs/architecture.md`

- **Purpose:** the canonical high-level architectural model — logical, runtime, dependency, data,
  control flow, trust boundaries, extension points.
- **Reader need:** architecture. **Diátaxis:** reference/explanation hybrid.
- **Prerequisites:** mental-model.
- **Related:** mental-model, source-map, all subsystem pages.
- **Owns:** the canonical architecture. No other page may present a competing high-level architecture.

### `docs/source-map.md`

- **Purpose:** concepts, capabilities, workflows, subsystems and tests mapped to their implementation
  locations.
- **Reader need:** reference. **Diátaxis:** reference.
- **Prerequisites:** none.
- **Related:** documentation-map, every subsystem page's source trail.
- **Owns:** the repository-wide concept → implementation index.

---

## Subsystems

Each page uses the same structure: purpose, responsibilities, non-responsibilities, position,
core abstractions, internal operation, state, lifecycle, failure modes, extension points, source
trail. All are **explanation + reference** hybrids; the source trail is what makes them navigable.

| Page | Purpose | Owns |
| --- | --- | --- |
| [subsystems/runtime-composition.md](subsystems/runtime-composition.md) | configuration, model loading, explicit binding, runtime assembly, HTTP surface | the canonical startup/teardown order; the HTTP route table; the binding table |
| [subsystems/terminal-session.md](subsystems/terminal-session.md) | the real PTY, viewers, scrollback, shell markers | the marker protocol; the `setsid` requirement |
| [subsystems/observers.md](subsystems/observers.md) | world snapshots: files, git, processes, ports | observer mechanism detail and the honesty rules |
| [subsystems/observation-bridge.md](subsystems/observation-bridge.md) | the single mechanism↔semantics adapter | marker→run, reconciliation, discovered facts |
| [subsystems/semantic-execution.md](subsystems/semantic-execution.md) | the two journey agents and the executions projection | the agent contracts and the projection contract |
| [subsystems/effects-and-evidence.md](subsystems/effects-and-evidence.md) | snapshot-diff effect derivation with evidence | the both-sides-observed guard; the `none` effect |
| [subsystems/execution-worlds.md](subsystems/execution-worlds.md) | providers, credential references, world-scoped observation | the world registration grant boundary |
| [subsystems/capability-components.md](subsystems/capability-components.md) | the three capability components | the component pattern and position conversion |
| [subsystems/focus-engine.md](subsystems/focus-engine.md) | attention, SharedFocus, affordances, Syntelligent Search | the intents and the receipt |
| [subsystems/semantic-substrate.md](subsystems/semantic-substrate.md) | the Rust helper and the SolidLSP bridge | world gating and readiness |
| [subsystems/state-and-projections.md](subsystems/state-and-projections.md) | durability, projections, shared state, idempotency | tenant-partitioned keys and the run marker bridge |
| [subsystems/authority-and-policy.md](subsystems/authority-and-policy.md) | kernel policy, action policy, transport identity, secrets | the grant tables |
| [subsystems/webmcp.md](subsystems/webmcp.md) | capability descriptors and the single projection path | the one-invoker principle |
| [subsystems/cockpit.md](subsystems/cockpit.md) | the React/xterm UI as a projection | the client's data sources |

**Prerequisites for all subsystems:** mental-model, concepts.

---

## Workflows

| Page | Purpose | Owns |
| --- | --- | --- |
| [workflows/startup-and-shutdown.md](workflows/startup-and-shutdown.md) | ordered bring-up and ordered teardown | the runtime topology |
| [workflows/human-command-observation.md](workflows/human-command-observation.md) | J1 end to end | the marker→run trace |
| [workflows/structured-execution.md](workflows/structured-execution.md) | J2 end to end | the snapshot/exec/snapshot trace |
| [workflows/world-state-reconciliation.md](workflows/world-state-reconciliation.md) | J3 and J6 | the reconciliation and fan-out sequence |
| [workflows/attach-and-inspection.md](workflows/attach-and-inspection.md) | J4 and J5 | attach semantics and durability |
| [workflows/focus-search-and-governance.md](workflows/focus-search-and-governance.md) | J7–J15 | the routing tiers and the governance sequence |

**Prerequisites for all workflows:** the subsystem page they name.

---

## Explanation

| Page | Question answered | Owns |
| --- | --- | --- |
| [explanation/why-two-doors-one-world.md](explanation/why-two-doors-one-world.md) | why human and machine doors converge | the honest cost of convergence |
| [explanation/why-effects-require-evidence.md](explanation/why-effects-require-evidence.md) | why effects are diffed and evidenced | the `unknown` rule in code |
| [explanation/why-world-scoped-identity.md](explanation/why-world-scoped-identity.md) | why `worldId` is an input, not a verb | world-scoped resource identity |
| [explanation/why-human-governed-focus.md](explanation/why-human-governed-focus.md) | why an agent cannot change SharedFocus | attention sovereignty |
| [explanation/why-shell-integration-not-scraping.md](explanation/why-shell-integration-not-scraping.md) | why markers, not scraping | the command-boundary rationale |
| [explanation/why-semantic-reduction.md](explanation/why-semantic-reduction.md) | why search reduces rather than retrieves | the receipt as the product |
| [explanation/why-no-node.md](explanation/why-no-node.md) | why the product never needs Node | the node-free invariant |
| [explanation/why-cognate-boundaries.md](explanation/why-cognate-boundaries.md) | why Cognate primitives are never duplicated | the layer rules |

**Prerequisites for all explanation pages:** mental-model.

---

## How-to

| Page | Goal | Owns |
| --- | --- | --- |
| [how-to/bootstrap-the-environment.md](how-to/bootstrap-the-environment.md) | provision a machine | the bootstrap procedure |
| [how-to/add-a-capability.md](how-to/add-a-capability.md) | add a named capability | the six-step capability procedure |
| [how-to/add-an-execution-world.md](how-to/add-an-execution-world.md) | add a world | the config-only and code paths |
| [how-to/add-a-webmcp-tool.md](how-to/add-a-webmcp-tool.md) | expose a capability to a browser | the descriptor procedure |
| [how-to/add-a-concept.md](how-to/add-a-concept.md) | add a curated concept | concept authoring rules |
| [how-to/validate-a-change.md](how-to/validate-a-change.md) | run the right gate | the validation ladder and which gate catches what |
| [how-to/debug-a-common-failure.md](how-to/debug-a-common-failure.md) | diagnose a real failure | symptom-driven diagnosis |

All are **tutorial/how-to**. None contains a conceptual essay; they link to explanation and reference.

---

## Reference

| Page | Owns |
| --- | --- |
| [reference/configuration.md](reference/configuration.md) | every `gsterm.toml` key and environment variable |
| [reference/capabilities.md](reference/capabilities.md) | every capability: input, output, constraints, errors |
| [reference/events-and-projections.md](reference/events-and-projections.md) | the event, observation, evidence and projection reference |
| [reference/webmcp-tools.md](reference/webmcp-tools.md) | every WebMCP tool and the deliberately absent ones |
| [reference/journeys.md](reference/journeys.md) | J1–J15, named invariants, deferred seams |
| [reference/cli-and-commands.md](reference/cli-and-commands.md) | scripts, the gate, devbox, doctor, Rust and Python entry points |
| [reference/http-and-websocket-api.md](reference/http-and-websocket-api.md) | routes, health, meta, WebSocket frames |
| [reference/rust-helper-protocol.md](reference/rust-helper-protocol.md) | the Rust helper JSON-lines protocol |
| [reference/solidlsp-protocol.md](reference/solidlsp-protocol.md) | the SolidLSP bridge JSON-lines protocol |

### `docs/troubleshooting.md`

- **Purpose:** symptom-indexed diagnosis.
- **Reader need:** reference. **Diátaxis:** reference.
- **Related:** how-to/debug-a-common-failure, how-to/validate-a-change.
- **Owns:** the symptom tables. `.agents/DEBT.md` remains the canonical home for limitations *with
  owners and statuses*; this page is the reader-facing index to it.

---

## Canonical ownership rules

1. **One owner per concept.** If a second page starts explaining a concept rather than linking to its
   owner, one of the two is wrong.
2. **Architecture has one home.** `architecture.md` is the only high-level architecture page.
   `README.md` shows a deliberately smaller version for first contact and links onward.
3. **Failure detail lives in the subsystem, symptom tables in troubleshooting, owners in the debt
   ledger.** Explanation pages discuss consequences, not symptom lists.
4. **Procedures are not explanations.** How-to pages give steps; explanation pages give reasons; they
   link to each other rather than inlining each other.
5. **Reference does not teach.** Reference pages state facts. When a fact needs a reason, it links.

## Documents outside this system

These serve different audiences and are intentionally not part of this documentation system:

| Path | Audience |
| --- | --- |
| `AGENTS.md` | coding agents working in the repository |
| `.agents/CURRENT_STATUS.md`, `.agents/DEBT.md`, `.agents/plans/` | maintainers tracking working state and debt |
| `.sea/interaction/` | the canonical semantic model, journey catalog and model→implementation handoff |
| `rust/crates/gsterm-semantic/README.md`, `solidlsp/README.md` | the substrate projects' own operational docs |
| `src/*/README.md` | colocated module notes; each points at its canonical subsystem page |
| `scripts/README.md` | the operational reference for the scripts |