# CLI, scripts and environment reference

## npm/bun scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | start the server: `src/server/index.ts` on the configured host/port |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `oxlint --type-aware` |
| `bun run test` | `bun test test/` — unit, journey, conformance, architecture |
| `bun run e2e` | `playwright test` — acceptance A–G plus Phase 2/3 |
| `bun run doctor` | mechanism readiness; `--probe` starts managed processes, `--require-semantic` fails unless the semantic substrate is fully ready |
| `bun run verify` | `typecheck && lint && test && e2e` |

## The project gate

```bash
bash scripts/verify-all.sh [--node-free] [--release]
```

| Flag | Effect |
| --- | --- |
| *(none)* | developer gate; semantic mechanisms may skip honestly on an unbootstrapped checkout |
| `--node-free` | scrubs `PATH` of every node/npm manager source, installs only its own Bun shim, and **fails if `node` resolves anywhere else** |
| `--release` | the release oracle: implies `--node-free`, sets `GSTERM_REQUIRE_SEMANTIC=1`, rejects every `GSTERM_SKIP_*`, runs the DomainForge projection round-trip, requires the Rust helper to be built, and requires `doctor --require-semantic` |

Stage order: typecheck → lint → *(release: model round-trip)* → tests → Rust tests → SolidLSP selftest
→ doctor → e2e.

### Targeted skips (never for release)

`GSTERM_SKIP_RUST=1`, `GSTERM_SKIP_SOLIDLSP=1`, `GSTERM_SKIP_DOCTOR=1`, `GSTERM_SKIP_E2E=1`.

## Bootstrap

```bash
bash scripts/bootstrap.sh
```

Idempotent, self-contained. Steps and rationale: [../how-to/bootstrap-the-environment.md](../how-to/bootstrap-the-environment.md).

## devbox

| Command | What it does |
| --- | --- |
| `devbox shell` | toolchain only (python 3.12, uv, rustup, ripgrep, git, openssh, cmake, gcc, libclang — no node) |
| `devbox run bootstrap` | `bash scripts/bootstrap.sh` |
| `devbox run verify` | `bash scripts/verify-all.sh --node-free` |
| `devbox run verify-release` | `bash scripts/verify-all.sh --release` |
| `devbox run doctor` | `bun run src/doctor.ts --probe` |

Devbox sets `BUN_VERSION=1.4.2` and `CARGO_TARGET_DIR=$PWD/rust/target`, and its `init_hook` puts
`.devbin/bin` and `~/.cargo/bin` on `PATH`, unsets inherited compiler variables, and warns when Bun or
cargo is missing.

## `gs-term doctor`

```bash
bun run doctor [--probe] [--require-semantic]
```

Output is grouped into sections — Runtime, Native semantic search, Language intelligence, Search,
Remote — and ends with `Node: not required` and a `ready/total` count.

| Mechanism | Implementation |
| --- | --- |
| Bun | bun |
| PTY | bun |
| zvec-grep Rust | rust |
| zvec-rust | rust |
| Potion model | native |
| SolidLSP | python |
| Python/uv | python |
| TypeScript server | bun (the LSP runs on Bun) |
| rg | native |
| SSH | native |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | all ready, or only `degraded`, or mechanisms disabled |
| `1` | at least one mechanism is `unavailable` while mechanisms are enabled |
| `2` | `--require-semantic` not satisfied (mechanisms disabled, or a required mechanism is not ready) |

Light mode (default) starts no managed processes — discovery is the signal. `--probe` starts them and
reports provisioned truth.

## Rust helper

```bash
cd rust && cargo test -p gsterm-semantic --release
cd rust && cargo build --release -p gsterm-semantic
```

Toolchain pinned by `rust/rust-toolchain.toml` (1.98.0). Artifacts stage into `rust/artifacts/`
(`gsterm-semantic`, `libzvec_c_api.so`, jieba dictionaries). Protocol:
[rust-helper-protocol.md](rust-helper-protocol.md).

## SolidLSP bridge

```bash
cd solidlsp && uv sync
cd solidlsp && uv run python selftest.py
```

The self test covers cold provisioning (bun), cold provisioning through the npm shim, warm start, the
full protocol suite, restart, shutdown, orphan and stray-write checks — all under a `PATH` scrubbed of
node and npm. Protocol: [solidlsp-protocol.md](solidlsp-protocol.md).

## e2e

```bash
bun run e2e
```

Requires Playwright browsers. If provisioning fails inside the managed environment, invoke Playwright
through the bootstrapped Bun binary directly. The suite drives the real browser, server and PTY
against acceptance scenarios A–G using `/tmp/gsterm-e2e-workspace` and `/tmp/gsterm-e2e-remote`.

## Environment variables

See [configuration.md](configuration.md) for the full list, including `GSTERM_ROOT`,
`GSTERM_HOSTNAME`, `GSTERM_PORT`, `GSTERM_STORE`, `GSTERM_HELPER_BIN`, `GSTERM_REQUIRE_SEMANTIC` and
the `GSTERM_SKIP_*` family.

## Source trail

- `package.json` — scripts
- `scripts/verify-all.sh`, `scripts/bootstrap.sh`, `scripts/README.md`
- `devbox.json` — packages, env, shell scripts
- `src/doctor.ts` — sections, exit codes, `SEMANTIC_REQUIRED`
- `rust/rust-toolchain.toml`, `solidlsp/pyproject.toml`
- `.github/workflows/verify.yml` — the clean-machine oracle
- `playwright.config.ts`, `e2e/serve.ts`