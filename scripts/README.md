# scripts

Two entry points; both are the real project gates, identical inside and outside devbox.

| Script | Purpose |
| --- | --- |
| `bootstrap.sh` | idempotent environment provisioning (C toolchain sanity, pinned Bun, JS deps, Rust helper + artifacts, SolidLSP uv env) |
| `verify-all.sh [--node-free] [--release]` | the validation gate: typecheck → lint → tests → Rust tests → SolidLSP self test → doctor → e2e |

Canonical documentation:
[docs/reference/cli-and-commands.md](../docs/reference/cli-and-commands.md),
[docs/how-to/bootstrap-the-environment.md](../docs/how-to/bootstrap-the-environment.md) and
[docs/how-to/validate-a-change.md](../docs/how-to/validate-a-change.md).

The rest of this file is the operational detail.

## `scripts/bootstrap.sh`

Idempotent environment provisioning:

1. **C toolchain sanity (D-040)** — smoke-tests `cc` (compile + run a trivial binary); if the
   binary cannot execute (observed: devbox's nix gcc wrapper under WSL), the nix toolchain dirs
   are stripped from PATH deterministically so the host compiler is used. The toolchain boundary
   is explicit, never environmental guesswork.
2. **Bun** — verifies `bun --version` equals `$BUN_VERSION` (default 1.4.2). nixpkgs currently
   carries only bun 1.3.x, so the pinned release is downloaded into `.devbin/bin/` (gitignored).
   Network failure fails loudly.
3. **JS deps** — `bun install --frozen-lockfile`.
4. **Rust** — installs rustup (minimal profile, pinned toolchain) if `cargo` is missing, then
   `cargo build --release -p gsterm-semantic` (toolchain pinned by `rust/rust-toolchain.toml`
   → 1.98.0) and stages the binary + `libzvec_c_api.so` into `rust/artifacts/`.
5. **SolidLSP** — installs uv if missing, then `uv sync` in `solidlsp/` (locked environment,
   `serena-agent==1.7.0`).

The script is self-contained: a clean Linux machine with only curl + python3 + tar can run it.
That is what CI proves (`.github/workflows/verify.yml`).

## `scripts/verify-all.sh [--node-free] [--release]`

The validation gate: typecheck → lint → unit/integration tests → Rust tests →
SolidLSP selftest → `gs-term doctor` → e2e.

`--node-free` first scrubs PATH of every node/npm manager source (`node`, `nvm`, `.nub`,
`mise`, `volta`, `fnm`, `pnpm`, `npm`, `yarn`, `/mnt/c/...`) and **fails if `node` is still
visible** — the required stack is Bun + Rust + Python/uv + native tools, and the gate proves it.

`--release` is the RELEASE/CI ORACLE (implies node-free): `GSTERM_REQUIRE_SEMANTIC=1` makes
every semantic test skip a failure (test/support/semantic-gate.ts), `GSTERM_SKIP_*` variables
are rejected, the DomainForge projection round-trip runs explicitly, and doctor must satisfy
`bun run doctor --require-semantic` (bun, rg, zvec-grep Rust, zvec, Potion model, SolidLSP,
Python/uv, TypeScript server all ready). A green release job means the semantic substrate
actually ran — not that the framework skipped it. `devbox run verify-release` is the same gate.

Skips (for targeted runs, never for release verification): `GSTERM_SKIP_RUST=1`,
`GSTERM_SKIP_SOLIDLSP=1`, `GSTERM_SKIP_DOCTOR=1`, `GSTERM_SKIP_E2E=1`.

## Devbox usage

```sh
devbox shell          # toolchain: python 3.12, uv, rustup (1.98.0 via rust-toolchain.toml),
                      # ripgrep, git, openssh, cmake, gcc, libclang — NO node
devbox run bootstrap  # then: bun deps + rust build + artifacts + uv sync
devbox run verify     # the full gate with the node-free proof
devbox run verify-release  # the release oracle: node-free, no semantic skips
devbox run doctor     # gs-term doctor --probe inside the managed environment
```

Devbox is the **reproducibility oracle** (clean machine → `bootstrap` → `verify`), not the
product installer; gs-term at runtime requires none of it beyond the tools themselves.