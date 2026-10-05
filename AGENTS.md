# AGENTS.md

## Project purpose

This repository implements a browser-native semantic terminal/control plane built with Cognate.

The terminal is not the primary abstraction.

The governing model is:

`state → affordances → action → effects → evidence → new state`

Humans, agents, UI controls, WebMCP tools, and future external systems should operate the same semantic world through different interaction surfaces.

The traditional terminal/PTY exists as a universal compatibility surface for humans and arbitrary terminal software.

---

## Mandatory Cognate workflow

For substantive implementation work, first read and follow:

`/home/sprime01/projects/cognate/.agents/skills/building-with-cognate/SKILL.md`

Also inspect the current Cognate source at:

`/home/sprime01/projects/cognate`

Do not assume Cognate APIs, semantics, or architecture from memory.

The checked-out Cognate implementation is authoritative.

If this application needs a concept that Cognate already provides, use Cognate.

Do not create parallel application-local replacements for Cognate primitives such as:

- capability registries
- effect systems
- authority or policy systems
- semantic event systems
- tool registries
- provider abstractions
- world/context models

unless inspection establishes that Cognate genuinely lacks the required general primitive.

When a gap appears, determine whether it is:

1. a general Cognate concern; or
2. terminal/application-specific mechanism.

Only the former belongs upstream in Cognate.

---

## Core invariant

Different interaction mechanisms must converge on the same semantic world.

Example:

Human:

`xterm → PTY → Bash → observed execution`

Machine:

`WebMCP/UI/agent → Cognate capability → structured execution`

Both must produce the same downstream semantic concepts:

- execution
- effects
- evidence
- state transitions
- available affordances

Actor/source is metadata.

It must not create a separate ontology.

---

## Preferred action hierarchy

When multiple ways exist to perform an operation, prefer:

1. Cognate semantic capability
2. structured process/API operation
3. PTY interaction
4. pixel/GUI automation

Use the highest level that preserves the required behavior.

Do not make an agent type into a terminal when a structured capability already exists.

---

## Architectural boundaries

Keep mechanism and meaning separate.

### Mechanism layer

Examples:

- Bun PTY
- process spawning
- xterm.js
- WebSockets
- shell integration
- filesystem watching
- Git inspection
- process inspection
- port inspection
- browser APIs
- WebMCP transport/projection

This layer performs operations and reports observable facts.

It should know as little about Cognate as practical.

### Semantic layer

Cognate represents:

- resources
- capabilities
- authority
- providers
- executions
- effects
- evidence
- events
- state
- affordances

Do not leak low-level implementation details into the semantic model unless they materially affect meaning.

---

## Runtime

Prefer Bun and current Bun-native functionality.

Use the installed Bun 1.4.x environment unless a concrete compatibility constraint requires otherwise.

Prefer Bun-native facilities for:

- PTY
- process spawning
- HTTP
- WebSockets
- SQLite
- bundling
- testing

Do not add `node-pty`.

Do not add Node-era compatibility libraries when Bun provides the required primitive adequately.

Avoid Docker, external databases, and distributed infrastructure unless a future requirement genuinely needs them.

---

## Terminal architecture

The terminal must remain a real terminal.

Use a real PTY and real shell.

Do not implement a simulated shell for the main execution environment.

xterm.js is the browser presentation layer unless evidence supports replacing it.

The PTY byte stream exists for terminal compatibility.

It is not the semantic source of truth.

Do not reconstruct semantic state by scraping rendered terminal output when structured information can be obtained directly.

---

## Execution

Maintain separate paths for:

### Interactive execution

Used primarily by humans and interactive terminal applications.

`xterm → PTY → shell`

### Structured execution

Used primarily by semantic capabilities, automation, WebMCP, and future agents.

Preserve structured information where available:

- argv
- cwd
- safe environment metadata
- actor/source
- process identity
- stdout
- stderr
- exit status
- timing
- cancellation
- effects
- evidence

Both paths must converge into the same semantic execution model.

---

## Observation

Prefer deterministic observation over inference.

Use established shell-integration mechanisms for:

- command boundaries
- CWD
- command completion
- exit status

Do not parse arbitrary terminal text with brittle regexes when shell integration or process metadata can provide the fact directly.

For effects, begin with cheap observable evidence such as:

- filesystem changes
- Git state
- process state
- listening ports

Represent uncertainty explicitly.

Unknown is not false.

Do not claim an effect without evidence.

---

## Evidence

Semantic claims should retain provenance.

Where practical, effects should identify:

- what was observed
- how it was observed
- confidence
- supporting evidence

Prefer:

`observed`

over:

`assumed`

and:

`unknown`

over:

`probably false`

The system should make it possible to inspect why it believes a state transition occurred.

---

## WebMCP

WebMCP is a projection of Cognate capabilities, not a separate application API.

The intended direction is:

`Cognate capability → WebMCP tool`

Do not reimplement business logic inside WebMCP handlers.

Use the current WebMCP specification and current upstream packages.

WebMCP is evolving quickly.

Verify APIs before using them.

Do not blindly copy stale donor implementations such as older `navigator.modelContext` APIs if the current standard differs.

Eventually the system should support the inverse direction:

`external WebMCP capability → Cognate external capability/provider`

but do not overbuild this before it is needed.

---

## Donor policy

Prefer:

`reuse > adapt > create`

Temporary donor repositories belong under:

`.tmp/donors/`

Use shallow or sparse clones where practical.

Donors are reference material, not permanent project architecture.

For each donor:

1. identify the exact useful capability or pattern;
2. inspect implementation and tests;
3. understand why it works;
4. extract the smallest useful design;
5. prefer upstream dependencies when appropriate;
6. verify licensing;
7. remove the donor checkout when recon is complete.

Do not commit donor repositories.

Do not cargo-cult an entire subsystem because one useful idea exists inside it.

---

## Current important donors

Useful sources include:

- `xtermjs/xterm.js`
- `compoundingtech/pty`
- `WebMCP-org/npm-packages`
- `ripulio/web-mcp`
- `kilian-ai/linuxontab`
- `cloudflare/sandbox-sdk`

These are not mandatory runtime dependencies.

Use each only for the capability or architectural pattern it contributes.

---

## Future execution worlds

The architecture should admit multiple execution providers without changing semantic application meaning.

Expected future worlds include:

- local WSL/Linux
- SSH
- cloud sandbox
- browser-local Linux

Do not model application semantics as provider-specific operations such as:

- `ssh.run`
- `cloudflare.run`
- `browserLinux.run`

when Cognate can instead express one semantic capability executed through different providers/worlds.

---

## Security and authority

Human PTY access and machine-invoked structured capabilities are not automatically equivalent in authority.

Use Cognate's current authority/lease model.

Do not expose unrestricted machine shell access merely because the user can type arbitrary shell commands manually.

Protect secrets.

Prefer allowing a provider to use a credential without exposing the credential value to an agent, UI, log, event, or WebMCP caller.

Never persist or log secret environment values unless explicitly required and safely handled.

---

## UI

The UI is an operational cockpit, not decorative dashboard chrome.

Prioritize:

- terminal
- current world state
- execution history
- effects
- evidence
- processes
- ports
- repository state
- available actions

Keep important causal relationships inspectable.

Do not make React state authoritative for semantic world state.

UI state should project underlying application state.

---

## Persistence

Inspect Cognate before introducing persistence infrastructure.

If Cognate already defines durable event/state behavior, use it.

If an application-owned persistence adapter is appropriate, prefer `bun:sqlite` for local storage.

Avoid external infrastructure without demonstrated need.

The desired property is deterministic reconstruction where appropriate:

`facts/events → reduction → current state`

---

## Testing

Behavioral correctness matters more than mocking convenience.

Test important boundaries with real implementations where practical.

Important coverage includes:

- PTY behavior
- terminal resizing
- interrupt/signals
- process lifecycle
- shell integration
- structured execution
- observer-to-effect translation
- Git state
- port detection
- WebMCP projection
- Cognate capability invocation
- cleanup
- reconnect behavior
- persistence/replay where supported

Maintain project commands for:

- tests
- type checking
- lint/check
- build
- end-to-end validation

Run the full relevant validation suite before considering substantive work complete.

---

## Instrumentation

A consequential action should be traceable across layers.

We should be able to determine:

- who initiated it
- through which surface
- which Cognate capability was invoked
- which provider executed it
- what facts were observed
- what effects were derived
- what evidence supports them
- what resulting state changed

Prefer one coherent correlation/trace identity through the action.

Do not flood normal logs with raw PTY bytes.

---

## Scope discipline

Do not prematurely build:

- LLM integration
- agent orchestration
- arbitrary browser-tab control
- browser extensions
- SSH provider
- cloud provider
- browser-Linux provider
- checkpoints
- world branching
- collaboration
- CRDTs
- eBPF tracing
- microservices
- Kubernetes
- Postgres
- distributed event buses
- plugin marketplaces
- custom terminal emulators
- custom shells

Preserve seams for future capabilities without implementing them before they are justified.

---

## Design rule

Avoid speculative abstractions.

An abstraction should exist because:

- multiple implementations already require it;
- a known upcoming provider requires the seam; or
- Cognate defines it as part of the semantic architecture.

Do not create layers merely because they may become useful later.

---

## Configuration

Prefer runtime configuration in appropriate formats such as:

- `.toml`
- `.yaml`
- `.env`

Do not use Markdown files as runtime configuration.

`AGENTS.md` contains durable agent guidance only.

---

## Documentation

Keep documentation concise and useful to future implementers.

Document:

- architectural invariants
- important boundaries
- non-obvious decisions
- current limitations
- how to run
- how to validate
- deliberate future seams

Avoid documentation theater.

Implementation and tests remain authoritative.

---

## Before completing substantive changes

Always inspect:

1. whether a Cognate abstraction was accidentally duplicated;
2. whether WebMCP usage matches the current API;
3. whether secrets can leak;
4. whether processes and PTYs are cleaned up;
5. whether subscriptions/watchers/WebSockets leak;
6. whether output or event storage is unbounded;
7. whether unknown state is being represented falsely as known;
8. whether donor code remains accidentally tracked;
9. whether dead experimental code remains;
10. whether the relevant validation suite passes.

Review the final `git diff` before declaring completion.

---

## Governing principle

This project should not become:

> a terminal that happens to use Cognate.

It should demonstrate:

> Cognate modeling a real computational environment in which humans and machines operate the same semantic world through different surfaces.

When deciding between implementations, preserve that property above convenience.