# gs-term

A browser-native **semantic terminal / control plane** built on
[Cognate](../cognate). The terminal is not the primary abstraction — it is one compatibility surface
over a computational world modelled semantically:

```
state → affordances → action → effects → evidence → new state
```

Humans type into a real PTY (`xterm → WebSocket → Bun.Terminal → bash`). Machines run structured
executions through Cognate capabilities (`WebMCP / cockpit → client → agent run → process.exec`).
Both doors produce the **same semantic kind of execution**: the same event vocabulary, the same
projection, the same reconciled world state. `source` (`pty` | `ui` | `webmcp`) is metadata, never a
separate ontology.

## Run

```bash
devbox run bootstrap      # pinned Bun, Rust helper, SolidLSP uv env (Node not required)
bun run dev               # http://127.0.0.1:7317 — cockpit + PTY + WebMCP + Cognate runtime
```

Without devbox: `bash scripts/bootstrap.sh && bun install && bun run dev`.

## Validate

```bash
bun run verify                       # typecheck + lint + test + e2e
bash scripts/verify-all.sh           # the project gate: + Rust tests, SolidLSP self test, doctor
bash scripts/verify-all.sh --release # the release oracle: node-free, no semantic skips
bun run doctor --probe               # per-mechanism readiness
```

## Documentation

**Start at [`docs/`](docs/README.md).**

| I want to | Go to |
| --- | --- |
| understand what this is | [docs/README.md](docs/README.md) |
| run it | [docs/getting-started.md](docs/getting-started.md) |
| understand the architecture | [docs/architecture.md](docs/architecture.md) |
| learn the vocabulary | [docs/concepts.md](docs/concepts.md) |
| change a part | [docs/subsystems/](docs/subsystems/) |
| trace an operation | [docs/workflows/](docs/workflows/) |
| know *why* it is built this way | [docs/explanation/](docs/explanation/) |
| do a task | [docs/how-to/](docs/how-to/) |
| look something up | [docs/reference/](docs/reference/) |
| debug something | [docs/troubleshooting.md](docs/troubleshooting.md) |
| find the implementation | [docs/source-map.md](docs/source-map.md) |

## Canonical semantic source

The interaction domain model lives in [`.sea/interaction/`](.sea/interaction/README.md): a validated
`.sea` model, the canonical journey catalog (J1–J15), and the model → Cognate handoff.
`domain/interaction-model.sea` symlinks to it so there is one source of truth.

## Repository guidance

- [`AGENTS.md`](AGENTS.md) — durable guidance for coding agents: mandatory Cognate workflow,
  architectural boundaries, scope discipline.
- [`.agents/DEBT.md`](.agents/DEBT.md) — the debt ledger; canonical home for known limitations with
  owners and statuses.
- [`.agents/CURRENT_STATUS.md`](.agents/CURRENT_STATUS.md) — current state and watch items.

## Stack

Bun (runtime, PTY, HTTP, WebSocket, SQLite, bundler, tests) · Cognate (vendored under
`.cognate/vendor`) · React + xterm.js (cockpit) · Rust `gsterm-semantic` (zvec-grep + zvec concept
store + model2vec) · Python `gsterm-solidlsp` under uv (language intelligence) · Playwright (e2e).

**Node is not required** — `bun run doctor` says so, and `scripts/verify-all.sh --node-free` proves
it by failing the build if the product path can resolve a real Node binary.