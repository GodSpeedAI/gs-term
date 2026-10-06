# How to validate a change

**Goal:** run the validation the project actually trusts, at the right strictness, and know which
gate a failure belongs to.

## The commands

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint --type-aware
bun run test        # bun test test/  — unit + journey + conformance + architecture
bun run e2e         # Playwright acceptance A–G + Phase 2/3
bun run doctor      # mechanism readiness
bun run verify      # typecheck + lint + test + e2e
```

The project's own gate is more useful because it also covers the Rust helper and the Python bridge:

```bash
bash scripts/verify-all.sh                # developer gate
bash scripts/verify-all.sh --node-free    # also proves `node` is invisible to the product
bash scripts/verify-all.sh --release      # the release oracle (implies --node-free)
```

## Two levels, and why the difference matters

**Developer gate.** Semantic mechanisms may skip *honestly* on an unbootstrapped checkout. A skip
is reported; it is not a failure. This keeps the gate usable while iterating.

**Release oracle.** `--release` sets `GSTERM_REQUIRE_SEMANTIC=1`, which turns any semantic skip into
a failure (see `test/support/semantic-gate.ts`); it rejects every `GSTERM_SKIP_*` variable; it runs the
DomainForge projection round-trip explicitly; it requires the Rust helper to be built; and it runs
`bun run doctor --require-semantic`, so bun, rg, zvec-grep Rust, zvec, the Potion model, SolidLSP,
Python/uv and the TypeScript server must all be `ready`.

A green release job means the semantic substrate actually ran — not that the framework skipped it.

## Inside devbox

```sh
devbox shell              # toolchain only: python 3.12, uv, rustup, ripgrep, git, openssh,
                          # cmake, gcc, libclang — no node
devbox run bootstrap      # pinned bun, rust build + artifacts, uv sync
devbox run verify         # the full gate with the node-free proof
devbox run verify-release # the release oracle
devbox run doctor         # doctor --probe inside the managed environment
```

Devbox is the reproducibility oracle, not a product requirement. `scripts/verify-all.sh` is
identical inside and outside devbox.

## Targeted skips

For a quick loop only:

| Variable | Effect |
| --- | --- |
| `GSTERM_SKIP_RUST=1` | skip `cargo test -p gsterm-semantic` |
| `GSTERM_SKIP_SOLIDLSP=1` | skip `uv run python selftest.py` |
| `GSTERM_SKIP_DOCTOR=1` | skip the doctor gate |
| `GSTERM_SKIP_E2E=1` | skip Playwright |

`--release` refuses all of them. Never ship a release verified with a skip.

## Which gate catches what

| Change | Minimum gate |
| --- | --- |
| UI-only | `typecheck && lint && e2e` |
| semantic layer / agents / bridge | `typecheck && test` |
| capability or policy | `typecheck && test` (the architecture suite is the point) |
| observers or effects | `test` + a manual `doctor` |
| focus / search | `test` and, ideally, a live search in the cockpit |
| Rust helper | `cargo test -p gsterm-semantic --release` |
| SolidLSP bridge | `cd solidlsp && uv run python selftest.py` |
| configuration / docs only | `typecheck` |

## Before you declare done

From `AGENTS.md`, checked explicitly:

1. Was a Cognate abstraction accidentally duplicated?
2. Does WebMCP usage match the current API (no `navigator.modelContext`)?
3. Can secrets leak?
4. Are processes and PTYs cleaned up?
5. Do subscriptions, watchers and WebSockets leak?
6. Is output or event storage unbounded?
7. Is unknown state being represented falsely as known?
8. Does donor code remain tracked?
9. Does dead experimental code remain?
10. Does the relevant suite pass?

Then read the final diff.

## Test layout

| Path | What it establishes |
| --- | --- |
| `test/architecture.test.ts` | layer and boundary invariants |
| `test/app.test.ts` | config, bindings, grants, containment |
| `test/semantic-concepts.test.ts` | the concept registry contract |
| `test/conformance/` | PTY behaviour, marker parsing, world providers |
| `test/journeys/` | J1, J2, J3, J5, J6, J9 end to end |
| `test/focus/` | focus lifecycle, attention, search, integration |
| `test/webmcp/` | projection, validation, offer mapping |
| `test/mechanisms/` | helper discovery, handshake, disposal |
| `e2e/acceptance.spec.ts` | real browser, server and PTY (A–G) |
| `rust/crates/gsterm-semantic/tests/` | helper protocol and engine |
| `solidlsp/selftest.py` | bridge lifecycle, provisioning, orphans |

## Interpreting failures

| Failure | Likely meaning |
| --- | --- |
| architecture suite red | a boundary was crossed — read the assertion message, it names the file |
| semantic tests skipped | the substrate is not ready; run `bun run doctor --probe` |
| `doctor` exit 1 | a mechanism is `unavailable` and mechanisms are enabled |
| `doctor` exit 2 under `--require-semantic` | mechanisms disabled, or a required mechanism is not ready |
| `node resolves to <path>` | an environment leak; the `--node-free` invariant is broken |
| Playwright missing browsers | `bunx playwright install chromium` inside the bootstrapped environment |
| flaky `who calls this?` latency | cold tsserver; the planner retries, but check `doctor` readiness |