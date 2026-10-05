You are building a new project from an essentially empty repository.

The project root currently contains only:

- `.agents/`
- `.tmp/`
- `AGENTS.md`

Your job is to build the first production-quality vertical slice of a new kind of terminal: a browser-hosted real terminal whose underlying computational world is modeled semantically through Cognate and exposed to humans, agents, and WebMCP through the same capabilities.

This is NOT primarily “a terminal UI project.”

It is the first implementation of a browser-native computational control plane where:

> state → affordances → action → effects → evidence → new state

is the governing abstraction, and the traditional PTY terminal is one compatibility/input/output surface over that world.

The long-term system should eventually support local execution, SSH, remote sandboxes, browser-local Linux, checkpointing, world branching, application previews, WebMCP discovery/consumption, and agents.

DO NOT attempt all of that now.

Build the smallest serious vertical slice that proves the architecture is real.

---

# FIRST: mandatory Cognate workflow

Before planning or writing code:

1. Read the project's existing `AGENTS.md` completely.
2. Read and follow this skill completely:

`/home/sprime01/projects/cognate/.agents/skills/building-with-cognate/SKILL.md`

This task MUST be performed using that skill.

3. Inspect the current Cognate implementation in:

`/home/sprime01/projects/cognate`

Do not assume Cognate's APIs from memory, prior versions, or this prompt.

The checked-out Cognate source is authoritative.

Understand the current implementation of whatever Cognate concepts are relevant, including its actual current equivalents of:

- capabilities
- providers
- contexts/components
- invocation
- effects
- events
- leases / authority
- derived state
- durable state/replay if present
- execution worlds if present
- RealityTrace/evidence if present
- projections/adapters

Use Cognate's existing abstractions rather than building parallel terminal-specific versions of them.

### Critical rule

If something needed by this application already has a Cognate primitive:

**USE COGNATE.**

Do not introduce local replacements such as:

- `CapabilityRegistry`
- `PolicyEngine`
- `ToolRegistry`
- `EventBus`
- `SemanticEventLedger`
- `AgentToolRegistry`
- another effect system
- another authority system

unless careful inspection proves Cognate genuinely lacks the required general abstraction.

If you encounter a true framework gap, apply the `building-with-cognate` skill's prescribed method for dealing with it.

Ask:

> Is this missing concept generally required by Cognate applications, or is it merely terminal implementation detail?

Only general semantic primitives belong upstream in Cognate.

Do not contaminate Cognate with PTY, xterm, shell escape sequence, `/proc`, WebSocket, or other terminal-specific implementation concerns.

---

# Architectural thesis

There are two worlds that must remain separate.

## Mechanism layer

Ordinary low-level infrastructure:

- Bun PTY
- process spawning
- xterm.js
- WebSockets
- shell integration
- filesystem observation
- Git inspection
- process inspection
- port inspection
- browser APIs
- WebMCP adapter

This layer reports facts and performs operations.

It should know as little about Cognate as practical.

## Semantic application layer

Cognate represents meaning:

- what exists
- what can currently be done
- who may do it
- which provider executes it
- what action occurred
- what effects it produced
- what evidence supports those effects
- what the resulting world state is

The boundary should resemble:

mechanism:

`process 8174 appeared`
`file src/foo.ts changed`
`port 5173 began listening`
`command exited with 1`

→ Cognate application →

semantics:

`Execution`
`Resource`
`Effect`
`Evidence`
`Capability`
`World transition`

Do not allow OS implementation details to become the semantic model.

---

# Core invariant

The system must support two interaction paths.

## Human path

Human
→ xterm.js
→ real PTY
→ real interactive shell
→ observe command/effects
→ Cognate semantic state

## Structured capability path

Agent/WebMCP/UI
→ Cognate capability
→ structured execution provider
→ command/effects
→ same Cognate semantic state

These paths MUST converge on the same semantic representation.

Different mechanisms.

Same world.

That is the central proof.

---

# Execution hierarchy

Design around this preference order:

1. semantic Cognate capability
2. structured process execution
3. PTY interaction
4. pixel/GUI automation

Higher levels are preferred because they preserve more meaning.

Do not make an agent type commands into xterm when a structured capability exists.

The human terminal remains unrestricted enough to run arbitrary interactive terminal software.

---

# Runtime

Target the current installed Bun 1.4.x environment unless inspection of this machine establishes a compelling compatibility reason otherwise.

Exploit Bun 1.4 capabilities rather than carrying Node-era baggage.

Especially inspect and use the current native APIs for:

- `Bun.Terminal`
- `Bun.spawn({ terminal })`
- structured `Bun.spawn`
- WebSockets
- HTTP serving
- SQLite via `bun:sqlite`
- bundling
- any other current Bun 1.4 primitive that removes a dependency

DO NOT add `node-pty`.

We have a native PTY.

Keep Node compatibility dependencies out unless they provide a clear capability Bun does not.

Prefer one Bun application/process for the initial implementation.

Long term this should be capable of becoming a single deployable executable if that can be achieved cleanly with current Bun, but do not distort the architecture merely to force that packaging in this vertical slice.

---

# Donor strategy

We strongly prefer:

**reuse > adapt > create**

Do not invent solved terminal/browser infrastructure.

Clone useful donors temporarily beneath:

`.tmp/donors/`

Use shallow clones where practical.

Prefer `gh repo clone OWNER/REPO ... -- --depth 1` where convenient.

At minimum investigate these repositories:

### `xtermjs/xterm.js`

Purpose:

- terminal rendering
- addon patterns
- resize behavior
- terminal input/output handling
- accessibility
- browser lifecycle

Use xterm.js as a dependency unless inspection gives a compelling reason not to.

Do not fork/reimplement its emulator.

### `compoundingtech/pty`

Purpose:

- persistent PTY/session architecture
- agent-readable terminal state
- typed session operations
- detach/attach lifecycle
- terminal ownership
- terminal events
- conformance testing
- distinction between PTY/process/session/terminal state

This is primarily an architectural donor.

Do NOT add Rust/libghostty complexity to v0 merely because this donor uses it.

We already have Bun.Terminal for the first execution provider.

Study its abstractions and tests, not just its implementation language.

### `WebMCP-org/npm-packages`

Purpose:

- current WebMCP browser APIs
- WebMCP types
- polyfill
- transport architecture
- extension architecture
- iframe/tool composition
- current patterns for registering and consuming tools

Prefer appropriate upstream packages over copied code.

IMPORTANT:

Treat this repository/current WebMCP spec as more authoritative than older WebMCP donors.

The platform is moving quickly.

Verify current APIs rather than assuming `navigator.modelContext`, `document.modelContext`, package names, or type signatures.

### `ripulio/web-mcp`

Purpose:

- WebMCP browser bridge architecture
- extension ↔ browser tab ↔ MCP/server patterns
- DevTools/tool inspection ideas

This repo may contain older WebMCP API shapes.

Use it for architecture only where its implementation differs from the current standard.

Do NOT regress the project onto a stale API.

### `kilian-ai/linuxontab`

Purpose:

- browser Linux architecture
- xterm integration
- browser-local execution
- snapshots/persistence
- port forwarding concepts

Browser Linux is NOT required for this first vertical slice.

Use this donor to ensure our backend/provider boundary will support it later without redesigning the semantic system.

### `cloudflare/sandbox-sdk`

Purpose:

- isolated execution abstractions
- sessions
- command execution
- ports/previews
- remote sandbox lifecycle

Cloudflare is NOT a required runtime dependency for v0.

Study it so our execution-provider boundary does not prevent adding cloud sandboxes later.

### optional: VS Code shell integration

Inspect the current VS Code terminal shell-integration design if needed for reliable command boundaries, CWD changes, prompt boundaries, or OSC sequences.

Do not clone the entire VS Code history.

Use sparse/shallow techniques if cloning it becomes useful.

---

# Donor rules

Donors are disposable source material.

For every donor:

1. identify the exact capability/pattern we need;
2. inspect implementation and tests;
3. understand why it works;
4. extract the smallest useful pattern;
5. prefer an upstream dependency where appropriate;
6. independently implement/adapt where that is more appropriate;
7. preserve license/attribution obligations;
8. do not cargo-cult an entire subsystem.

Check licenses before copying source.

Do not introduce copyleft obligations accidentally.

`.tmp/donors/` must not become project architecture.

Delete disposable donor clones after the relevant implementation/recon is complete.

Do not commit donor repositories.

---

# Scope of this build

Build the FIRST END-TO-END PROOF.

Do NOT add an LLM or agent runtime.

No model should be necessary to make the system appear intelligent.

The architecture must prove itself deterministically first.

The vertical slice should implement:

### 1. Real browser terminal

Browser:
- xterm.js
- real interactive shell
- resize
- keyboard input
- Ctrl+C / signals
- ANSI/interactive programs
- correct lifecycle/reconnect behavior where reasonably achievable

Server:
- Bun
- native `Bun.Terminal`
- real shell on the host/WSL environment
- WebSocket transport

The user should genuinely be able to use the terminal.

It is not a simulated shell.

---

# 2. Structured execution

Implement a structured execution provider separate from PTY typing.

Conceptually:

`execution.run(argv, cwd, env...)`

Do NOT implement the public API based literally on this pseudocode; express it using the actual current Cognate abstractions discovered during recon.

Structured execution should retain, where available:

- argv
- cwd
- safe environment metadata
- actor/source
- start/end
- process ID
- exit code
- stdout
- stderr
- duration
- cancellation/signal support
- resource usage if cheaply available

Do not leak secret environment values into logs/events.

Structured execution is the preferred machine/agent path.

---

# 3. Shell integration

For v0, support Bash well.

Do not attempt every shell badly.

Instrument command boundaries semantically rather than trying to reconstruct them from arbitrary terminal text.

Use established shell-integration techniques/escape sequences where appropriate.

We need to know at least:

- prompt/command boundary
- command text when safely observable
- CWD
- command start
- command completion
- exit code

The terminal remains a byte stream for rendering, but semantic command boundaries must be communicated independently of ordinary screen scraping.

Design a shell adapter boundary so Zsh/Fish/etc. can be added later.

---

# 4. Unified Execution semantics

A command manually typed by the human should create an observed semantic execution.

A command invoked through a structured Cognate capability should create the same semantic kind of execution.

For example:

Human types:

`touch semantic-proof-human.txt`

and structured/WebMCP execution invokes:

`touch semantic-proof-agent.txt`

Both should end up represented through the same semantic execution/effect system, despite coming through different mechanisms.

Do not special-case the downstream world model based on whether an action came from human, UI, WebMCP, or future agent.

Track actor/source as metadata, not as a different ontology.

---

# 5. Effects + evidence

Implement cheap, deterministic observation before sophisticated tracing.

Start with useful scopes such as:

### filesystem

Observe relevant project/workspace changes.

At minimum distinguish where practical:

- file created
- file modified
- file deleted

### Git

Observe useful repository state such as:

- repository root
- branch
- dirty state
- changed files

Do not continuously run expensive Git operations unnecessarily.

### process

Observe relevant spawned/running processes sufficiently for the world view.

### ports

On Linux/WSL, detect listening ports associated with the workspace/execution where reasonably possible.

Keep OS-specific discovery behind adapters.

Do not pretend unsupported observations are known.

Every semantic claim should carry the equivalent of:

- confidence
- provenance
- evidence

If the system does not know whether an action made a network request, represent that as unknown rather than false.

Do NOT add eBPF/syscall tracing yet.

That can come later.

---

# 6. Cognate-native capability surface

The application's semantic operations should be Cognate capabilities.

The eventual useful surface includes concepts like:

- execution run/inspect/cancel
- terminal create/send/resize/interrupt
- workspace describe
- Git status/diff
- processes list/inspect
- ports list/open
- application previews
- checkpoints

But DO NOT mechanically create all of these because this prompt listed them.

Implement only the set required for the vertical slice and express them according to current Cognate idioms.

The capability definition should be the authoritative semantic definition.

Do not implement:

one UI action +
one WebMCP tool +
one agent function

as three unrelated implementations.

The direction should be:

Cognate capability
→ projection to UI
→ projection to WebMCP
→ later projection to other agent/MCP surfaces

Meaning once.

Surfaces many.

---

# 7. WebMCP provider

Expose the appropriate Cognate capabilities through the CURRENT WebMCP standard.

Important:

Do not hard-code a second WebMCP implementation for every operation.

Create a projection/adapter from Cognate capability metadata to WebMCP tool registration.

Use the current WebMCP API after inspecting the current specification/packages.

Use native WebMCP when available and an appropriate current polyfill for development/browser compatibility where necessary.

Do not rely on obsolete WebMCP API names merely because a donor contains them.

At minimum, the browser page should expose a structured execution capability through WebMCP.

There must be an automated/in-page way to prove:

1. tools are registered;
2. the structured execution tool is discoverable;
3. it can be invoked;
4. it flows through Cognate;
5. the resulting execution/effects are represented identically to equivalent human terminal activity.

This is one of the main acceptance proofs.

---

# 8. WebMCP consumption boundary

Do NOT build arbitrary browser-tab control yet.

But establish a clean boundary for future:

WebMCP external page
→ discovered external capability
→ Cognate external provider/capability
→ normal authority/event/effect/evidence machinery

If the current Cognate design has a better formulation, follow Cognate.

Do not overbuild this.

A type/interface plus architecture test may be enough for this slice.

The important thing is that adding an application's WebMCP capabilities later must not require redesigning the kernel.

---

# 9. Semantic world UI

The UI must make the architectural distinction visible.

Build a functional cockpit, not merely an xterm rectangle.

At minimum show:

### Terminal

The real xterm surface.

### World

Live semantic state such as:

- current CWD
- repository
- branch
- dirty state
- relevant processes
- listening ports
- current/recent execution

### Execution inspector

Selecting an execution should expose useful structured facts:

- origin/actor
- command
- cwd
- timing
- status
- exit code
- stdout/stderr where applicable
- discovered effects
- evidence/provenance

### Event/activity timeline

Show meaningful semantic events without dumping every byte/event indiscriminately.

The PTY stream is not the event ledger.

Keep the interface serious, dense, legible, and operational.

Avoid decorative dashboard chrome.

This should feel like a tool an expert could actually use.

---

# 10. Persistence

First inspect Cognate.

If Cognate already defines the appropriate durable event/replay/state mechanism, use it.

Do not build a duplicate event ledger merely because SQLite is convenient.

If the application legitimately owns persistence below Cognate or Cognate expects a persistence adapter, `bun:sqlite` is preferred for the local implementation.

The desired property is:

events/facts
→ deterministic reduction
→ current semantic state

The application should be able to survive a process restart without pretending nothing previously happened, where the current Cognate architecture supports that.

Do not overbuild distributed infrastructure.

No Postgres.

No NATS.

No Redis.

No external services for v0.

---

# Security and authority

The PTY is the human's unrestricted terminal surface.

Machine-invoked structured capabilities should be subject to Cognate's current authority/lease model.

Do not simply expose unrestricted arbitrary shell execution to WebMCP without considering Cognate authority.

At minimum:

- distinguish human interactive shell authority from programmatic capability authority;
- scope structured operations to the selected workspace/context where appropriate;
- do not serialize secret environment values into events;
- do not expose secrets merely because a command can use them;
- consequential capability metadata should survive projection to WebMCP where the current standard supports equivalent hints.

Prefer:

`secret can be used by provider`

over:

`secret value is shown to agent`

where applicable.

Do not build a huge permission editor yet.

Use Cognate's existing authority semantics.

---

# Execution backend abstraction

The first backend is local Bun/WSL.

However the mechanism/provider seam must make these future backends possible:

- local
- SSH
- Cloudflare Sandbox
- generic remote sandbox
- browser-local Linux

Do not define the semantic world as:

`ssh.run`
`cloudflare.run`
`browserLinux.run`
`local.run`

if Cognate's provider model allows us to instead define semantic execution once and choose its provider/world separately.

The intended long-term property is:

same capability
+ different Execution World/provider
= different execution location

Do not implement those additional providers now.

Prove the seam.

---

# Architecture constraints

Keep boundaries sharp.

A reasonable physical organization might resemble:

`src/`
- `app/`
- `kernel/` or Cognate application definitions
- `execution/`
- `terminal/`
- `shell/`
- `observers/`
- `webmcp/`
- `server/`
- `ui/`

but DO NOT force this exact tree if current Cognate project conventions imply something cleaner.

Do not create a 20-package monorepo for an MVP.

Use package boundaries only where they buy actual isolation.

Avoid speculative abstractions.

Build the smallest architecture that cleanly admits the known next providers/features.

---

# Do NOT build yet

Explicitly out of scope unless trivially enabled by the architecture:

- LLM integration
- agent orchestration
- SSH provider
- Cloudflare provider
- browser Linux provider
- arbitrary browser-tab WebMCP bridge
- extension
- full checkpoint/restore
- world branching
- parallel agents
- CRDT/collaboration
- syscall/eBPF tracing
- Kubernetes
- microservices
- Postgres
- distributed event buses
- plugin marketplace
- custom terminal emulator
- custom shell
- giant settings system

Leave deliberate seams.

Do not build speculative implementations.

---

# Required vertical-slice acceptance test

The implementation is not done until this sequence works.

## A. Real PTY

1. Start the application.
2. Open it in the browser.
3. A real Bash terminal appears.
4. Run normal commands.
5. ANSI output works.
6. interactive terminal behavior works.
7. resize works.
8. Ctrl+C works.

## B. Human semantic observation

From the real xterm terminal:

1. `cd` into a Git repository.
2. World state recognizes repository/CWD/branch.
3. Run a normal command.
4. An execution appears in structured state.
5. Exit code is captured.
6. Semantic events are emitted.

Then run:

`touch semantic-proof-human.txt`

The system should produce evidence supporting a file-created effect associated with that activity.

Clean the proof file afterward.

## C. Structured Cognate execution

Invoke the Cognate-backed structured execution capability without typing into xterm.

Execute the equivalent of:

`touch semantic-proof-agent.txt`

The result must:

1. create a structured execution;
2. go through Cognate;
3. produce the same semantic kind of file-created effect;
4. provide evidence;
5. appear in the world/execution UI.

Clean the proof file afterward.

## D. WebMCP

Using the currently correct WebMCP mechanism:

1. discover the terminal application's exposed tools;
2. verify the structured execution capability is present;
3. invoke it;
4. verify it routes through the same Cognate capability;
5. verify the execution and effects appear in the same semantic world.

There must not be a separate fake WebMCP execution implementation.

## E. Git state

Modify a tracked file.

The world view must correctly reflect the repository becoming dirty.

Restore the file.

The world view must return to clean.

## F. Process/port proof

Run a small local HTTP server from the terminal or structured execution path.

The system should discover the relevant process/listening port to the degree supported by the implemented observer.

Stopping the process should update state.

## G. Restart/persistence

Where supported by current Cognate persistence semantics:

restart the application and verify that durable semantic history/state behaves according to the architecture rather than silently resetting incorrectly.

---

# Tests

Testing is part of the architecture.

Use:

- unit tests for reducers/domain logic
- integration tests around Bun execution and PTY boundaries
- tests for shell integration parsing/protocol
- tests for observer → semantic effect translation
- WebMCP projection tests
- end-to-end browser tests where useful

Prefer behavioral tests over mocks for critical boundaries.

A serious terminal must be tested against real terminal behavior.

Study `compoundingtech/pty` specifically for its conformance-testing philosophy.

At minimum establish commands analogous to:

- test
- typecheck
- lint/check
- build
- e2e

using Bun-native tooling where appropriate.

All must pass before completion.

---

# Instrumentation

Make the system debuggable.

We need to be able to answer:

- which actor initiated this execution?
- through which capability?
- which provider executed it?
- what facts were observed?
- what semantic effects were inferred?
- what evidence supports them?
- which state transition followed?
- what is unknown?

Prefer one coherent trace/correlation identifier flowing through an action rather than unrelated logs.

Do not log every PTY byte into normal application logs.

---

# Development method

Work in dependency order.

## Stage 0 — Recon

Read:

- `AGENTS.md`
- mandatory Cognate skill
- current Cognate source
- Bun terminal APIs in installed types/docs
- donor implementations

Before major coding, establish:

- Cognate primitives we will use
- genuine gaps, if any
- donor patterns selected
- minimum architecture
- acceptance plan

Do not spend the whole task writing planning documents.

Once the architecture is grounded, build.

## Stage 1 — execution substrate

Get:

Bun.Terminal
↔ WebSocket
↔ xterm.js
↔ Bash

working correctly.

## Stage 2 — semantic execution

Add structured execution through Cognate.

Create the unified semantic execution representation.

## Stage 3 — shell observation

Instrument Bash command boundaries and CWD.

Human PTY activity now enters the semantic world.

## Stage 4 — effects

Add the minimum filesystem/Git/process/port observers needed for the acceptance proof.

## Stage 5 — WebMCP

Project Cognate capability definitions into current WebMCP tools.

Prove structured invocation end to end.

## Stage 6 — cockpit

Expose world state, execution details, evidence and events clearly.

## Stage 7 — hardening

Run real end-to-end tests.

Fix lifecycle races.

Reconnect.

Resize.

Cancellation.

Resource cleanup.

Error propagation.

Authority.

Security/redaction.

Then remove donor checkouts.

---

# Avoid these failure modes

Do not:

- create a pretty xterm page and call the project complete;
- parse ANSI terminal output to reconstruct everything an agent needs;
- make xterm the source of truth;
- make React state the source of truth;
- create WebMCP-specific business logic;
- duplicate Cognate capabilities locally;
- build an agent before deterministic semantics work;
- model unknown observations as false;
- hide framework gaps behind application hacks;
- introduce Rust simply because a donor uses Rust;
- introduce Docker;
- introduce cloud infrastructure;
- over-generalize before the first vertical slice passes;
- create dozens of abstractions that have only one implementation;
- leave donor source checked into the repository;
- optimize for demo appearance over architectural proof.

---

# Desired architectural property

At the end, this diagram must be true:

                  HUMAN
                    │
                  xterm
                    │
               real PTY/bash
                    │
                    ▼
              observed action
                    │
                    │
                    ▼
              COGNATE WORLD
             /      │       \
       Capability  Effect   Evidence
             \      │       /
                    │
                    ▼
               derived state
                    ▲
                    │
              Cognate capability
                    ▲
                    │
             WebMCP / future agent

A human typing into Bash and a machine invoking a structured capability should modify **the same world**, not two parallel representations.

---

# Long-term seams to preserve

Do not implement these yet, but make sure today's architecture does not block them.

## Execution worlds

One semantic operation should later be movable among:

- local WSL
- SSH
- cloud sandbox
- browser Linux

without changing application-level meaning.

## WebMCP consumption

A running application should eventually be able to expose its own WebMCP capabilities which are imported into Cognate as external capabilities/providers.

## Checkpoints

The world should eventually support capturing:

- filesystem state
- Git state
- environment metadata
- application state
- process state where feasible
- semantic history

## Branching

Eventually:

World W0
→ fork
→ experiment A
→ experiment B
→ compare evidence
→ settle one result

Do not hard-code assumptions today that make that impossible.

---

# Documentation

Keep documentation concise and architectural.

Update/create only what future agents need to understand:

- what the system is
- architectural invariants
- important boundaries
- how to run it
- how to test it
- donor-derived decisions worth preserving
- known limitations
- deliberate next seams

Do not create documentation theater.

The implementation and tests are the source of truth.

If configuration is needed, prefer appropriate TOML/YAML/environment configuration rather than turning Markdown into runtime configuration.

---

# Final cleanup

Before finishing:

1. run the full validation suite;
2. verify the vertical acceptance sequence manually or through E2E automation;
3. inspect for duplicated Cognate abstractions;
4. inspect for stale WebMCP APIs;
5. inspect for leaked secrets/environment values;
6. inspect process/PTY cleanup;
7. inspect WebSocket reconnect/disconnect behavior;
8. inspect unbounded event/output retention;
9. delete disposable `.tmp/donors/*`;
10. ensure donor repositories are not tracked;
11. leave `.tmp/` itself intact;
12. update architecture/status documentation concisely;
13. inspect `git diff`;
14. remove experimental/dead code;
15. run tests again.

If this repository already has a configured remote and normal project workflow permits it, commit the completed coherent vertical slice with an appropriate commit message. Do not create or alter a remote merely to satisfy this step.

---

# Final report

When finished, report concisely:

1. what was built;
2. the Cognate primitives used;
3. any Cognate gaps discovered and how they were handled;
4. donors inspected and what was extracted from each;
5. architecture actually implemented;
6. acceptance tests and their results;
7. important limitations;
8. exact next architectural step you recommend.

Do not report success unless the real PTY + human semantic observation + structured Cognate execution + WebMCP projection all work end to end.

The objective is not:

> make a terminal that happens to use Cognate.

The objective is:

> prove that Cognate can model a real computational environment in which humans and machines operate the same semantic world through different surfaces.

Build that proof.