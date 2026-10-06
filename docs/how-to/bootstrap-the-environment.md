# How to bootstrap the environment

**Goal:** provision a machine so gs-term runs, reproducibly and idempotently.

**Prerequisites:** `curl`, `python3`, `tar`, a working C compiler, network access. **Node is not
required.**

## The one command

```bash
devbox run bootstrap        # with devbox
bash scripts/bootstrap.sh   # or directly
```

The script is self-contained: a clean Linux machine with only `curl + python3 + tar` can run it. That
is exactly what CI proves (`.github/workflows/verify.yml`).

## What it does, in order

### 1. C toolchain sanity

It smoke-tests `cc` by compiling *and running* a trivial binary. If the compiler produces a binary
that cannot execute (observed with devbox's nix gcc wrapper under WSL), the nix toolchain directories
are stripped from `PATH` deterministically so the host compiler is used.

The toolchain boundary is explicit — never environmental guesswork. This step is the mitigation for
debt D-040.

### 2. Bun

Verifies `bun --version` equals `$BUN_VERSION` (default `1.4.2`). nixpkgs currently carries only Bun
1.3.x, so the pinned release is downloaded into `.devbin/bin/` (git-ignored). A network failure fails
loudly rather than falling back to an unpinned version.

### 3. JavaScript dependencies

```bash
bun install --frozen-lockfile
```

### 4. Rust

Installs rustup (minimal profile, pinned toolchain) if `cargo` is missing, then:

```bash
cd rust && cargo build --release -p gsterm-semantic
```

The toolchain is pinned by `rust/rust-toolchain.toml` to 1.98.0. The binary plus `libzvec_c_api.so`
and the jieba dictionaries are staged into `rust/artifacts/`.

### 5. SolidLSP

Installs `uv` if missing, then `uv sync` in `solidlsp/` — a locked environment pinned to
`serena-agent==1.7.0` (the only MIT-clean distribution; upstream main relicensed the application
GPL — do not track main).

## After bootstrapping

```bash
bun run doctor --probe     # start managed processes and report real readiness
bun run dev                # http://127.0.0.1:7317
bash scripts/verify-all.sh --release   # prove the whole thing on this machine
```

## devbox usage

```sh
devbox shell          # toolchain only, no node
devbox run bootstrap
devbox run verify
devbox run verify-release
devbox run doctor
```

Devbox's `init_hook` puts `.devbin/bin` and `~/.cargo/bin` on `PATH`, unsets a set of inherited
compiler variables that confuse the Rust build, and prints a reminder when Bun or cargo is missing.
`CARGO_TARGET_DIR` is set to `$PWD/rust/target`.

## Idempotency

Every step checks before acting. Re-running bootstrap on a provisioned machine is a no-op apart from
the install steps that are already satisfied. It is safe to run from CI on every push.

## Common failure symptoms

| Symptom | Cause | Fix |
| --- | --- | --- |
| `cc` builds but the binary will not run | nix toolchain wrapper under WSL | bootstrap step 1 strips it; re-run bootstrap |
| `bun: command not found` after install | `.devbin/bin` not on `PATH` | use the devbox shell, or add `.devbin/bin` |
| `cargo not found` | rustup missing | run bootstrap (it installs rustup) |
| Rust build fails on inherited `CC`/`CXX` | host variables leak into the build | `devbox shell` unsets them; outside devbox, unset them manually |
| `bun install` lockfile mismatch | lockfile changed | run without `--frozen-lockfile` once, commit the lockfile |
| SolidLSP sync fails | network or Python version | needs Python 3.12 per `devbox.json` |

## Related

- [validate-a-change.md](validate-a-change.md)
- [troubleshooting.md](../troubleshooting.md)
- `scripts/README.md` — the operational reference this page is derived from