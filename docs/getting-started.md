# Getting started

This walks a working setup from nothing. It assumes you can install packages and run a terminal
on Linux (or WSL).

## Prerequisites

| Need | Why | Check |
| --- | --- | --- |
| `curl`, `python3`, `tar` | `scripts/bootstrap.sh` only needs these | — |
| A C toolchain (`cc`) | building the Rust helper | `cc --version` |
| `curl` network access | pinned Bun download, cargo crates, uv packages | — |

Node is **not** a prerequisite. The runtime is Bun; native search is Rust; language intelligence is
Python under `uv`. See [why-no-node.md](explanation/why-no-node.md).

If you have [Devbox](https://www.jetify.com/devbox), it supplies the toolchain (Python 3.12, uv,
ripgrep, git, openssh, cmake, gcc, libclang — still no node) and pins
`CARGO_TARGET_DIR`. Devbox is a reproducibility convenience, not a product requirement.

## 1. Provision the environment

```bash
devbox run bootstrap      # if you have devbox
# or, on a bare machine with only curl + python3 + tar:
bash scripts/bootstrap.sh
```

Bootstrap is idempotent. It:

1. smoke-tests `cc` and, if the compiler cannot execute a built binary, strips the offending nix
   toolchain directories from `PATH` so the host compiler is used (debt D-040);
2. verifies `bun --version` matches `$BUN_VERSION` (default `1.4.2`) and downloads the pinned
   release into `.devbin/bin/` if nixpkgs carries an older one;
3. runs `bun install --frozen-lockfile`;
4. installs rustup if `cargo` is missing and builds `cargo build --release -p gsterm-semantic`,
   staging the binary plus `libzvec_c_api.so` into `rust/artifacts/`;
5. installs `uv` if missing and runs `uv sync` in `solidlsp/`.

Details: [how-to/bootstrap-the-environment.md](how-to/bootstrap-the-environment.md).

## 2. Start the server

```bash
bun run dev
```

Expected output:

```
gs-term listening on http://127.0.0.1:7317 (workspace: /path/to/your/project)
```

Then open <http://127.0.0.1:7317>.

What just happened:

1. `gsterm.toml` was read and merged with `GSTERM_*` environment overrides.
2. `domain/interaction-model.sea` was parsed into semantic objects and bound explicitly to
   capability contracts.
3. The Cognate runtime was created over the SQLite store at `.cognate/app.sqlite`.
4. A real PTY was started with `setsid bash --init-file src/shell/bash-init.sh`.
5. The cockpit bundle was built and served at `/app.js` and `/app.css`.

## 3. See the human door work

In the terminal panel, type:

```bash
touch getting-started-proof.txt
```

Within a second the **Executions** panel shows a row for that command. Click it: the inspector
shows `file.created` with an evidence line naming the two world snapshots the claim came from. The
Output field reads `unknown` — that is correct, not a bug. A PTY-observed execution does not
capture stdout, and gs-term refuses to reconstruct it.

The **World** panel now shows the repository as dirty. This is observed via `git status`, not
inferred from the file list.

## 4. See the machine door converge on the same model

Use the structured runner in the cockpit: put `touch getting-started-agent.txt` in the structured
run input and press Run. The new execution row carries a `ui` badge rather than `pty`, and its
inspector shows a real captured `Output` section — the structured path does capture stdout.

The event vocabulary, the projection row shape and the effects are otherwise identical. That is
the core invariant: **one semantic kind of execution, two doors**.

## 5. Check what is actually available

```bash
bun run doctor
```

This prints truthful per-mechanism readiness (Bun, PTY, rg, the zvec-grep Rust helper, zvec, the
Potion embedding model, SolidLSP, Python/uv, the TypeScript server, SSH) and ends with
`Node: not required`. Use `--probe` to actually start managed processes instead of only probing
discovery, and `--require-semantic` to fail unless the whole semantic substrate is ready.

## 6. Validate your checkout

```bash
bun run verify              # typecheck + lint + test + e2e
bash scripts/verify-all.sh  # the project's own gate; see reference/cli-and-commands.md
```

The developer gate may skip semantic proofs honestly on an unbootstrapped checkout. The release
oracle (`bash scripts/verify-all.sh --release`) refuses to.

## Troubleshooting the setup

- `bun: command not found` → run `bash scripts/bootstrap.sh`, then use the shell Devbox sets up, or
  add `.devbin/bin` to `PATH`.
- `cargo not found` → the pinned toolchain comes from `rust/rust-toolchain.toml` (1.98.0); install
  rustup or run bootstrap.
- PTY shows "no job control" or Ctrl-C does nothing → `setsid` is not on `PATH`. `doctor` reports
  PTY as `degraded`; the cause and the fix are in
  [troubleshooting.md](troubleshooting.md).
- Port 7317 already in use → `GSTERM_PORT=7400 bun run dev`, or set `server.port` in `gsterm.toml`.

## Next

- [mental-model.md](mental-model.md) — how the pieces fit conceptually.
- [architecture.md](architecture.md) — the layers, boundaries and runtime topology.
- [configuration.md](reference/configuration.md) — every configuration key and environment
  variable.