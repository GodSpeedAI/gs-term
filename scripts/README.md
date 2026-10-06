# scripts

Two entry points; both are the real project gates, identical inside and outside devbox.

## `scripts/bootstrap.sh`

Idempotent environment provisioning:

1. **Bun** — verifies `bun --version` equals `$BUN_VERSION` (default 1.4.2). nixpkgs currently
   carries only bun 1.3.x, so devbox environments bootstrap the pinned release into `.devbin/bin/`
   (gitignored) via the GitHub release zip. If the network is unavailable the script fails loudly.
2. **JS deps** — `bun install --frozen-lockfile`.
3. **Rust helper** — `cargo build --release -p gsterm-semantic` (toolchain pinned by
   `rust/rust-toolchain.toml` → 1.98.0 via rustup), then `rust/scripts/install-artifacts.sh`
   stages the binary + `libzvec_c_api.so` into `rust/artifacts/`.
4. **SolidLSP** — `uv sync` in `solidlsp/` (locked environment, `serena-agent==1.7.0`).

## `scripts/verify-all.sh [--node-free]`

The validation gate: typecheck → lint → unit/integration tests → Rust tests →
SolidLSP selftest → `gs-term doctor` → e2e.

`--node-free` first scrubs PATH of every node/npm manager source (`node`, `nvm`, `.nub`,
`mise`, `volta`, `fnm`, `pnpm`, `npm`, `yarn`, `/mnt/c/...`) and **fails if `node` is still
visible** — the required stack is Bun + Rust + Python/uv + native tools, and the gate proves it.

Skips (for targeted runs, never for release verification): `GSTERM_SKIP_RUST=1`,
`GSTERM_SKIP_SOLIDLSP=1`, `GSTERM_SKIP_DOCTOR=1`, `GSTERM_SKIP_E2E=1`.

## Devbox usage

```sh
devbox shell          # toolchain: python 3.12, uv, rustup (1.98.0 via rust-toolchain.toml),
                      # ripgrep, git, openssh, cmake, gcc, libclang — NO node
devbox run bootstrap  # then: bun deps + rust build + artifacts + uv sync
devbox run verify     # the full gate with the node-free proof
devbox run doctor     # gs-term doctor --probe inside the managed environment
```

Devbox is the **reproducibility oracle** (clean machine → `bootstrap` → `verify`), not the
product installer; gs-term at runtime requires none of it beyond the tools themselves.
