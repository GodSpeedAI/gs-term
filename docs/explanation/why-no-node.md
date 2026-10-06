# Why the product never needs Node

## The statement

`bun run doctor` ends with:

```
Node
  not required   (JS runs on Bun; native search in Rust; SolidLSP under Python/uv)
```

This is an architectural claim, and it is verified rather than asserted:
`scripts/verify-all.sh --node-free` scrubs the host `PATH` of every Node/npm manager source and
**fails the build** if `node` still resolves to anything other than the project's own Bun shim.

## The four runtimes that do exist

| Concern | Runtime | Why that one |
| --- | --- | --- |
| application, cockpit bundle, tests | **Bun** | PTY, HTTP, WebSocket, SQLite, bundler, test runner in one runtime |
| native semantic search | **Rust** (`gsterm-semantic`) | the zvec-grep engine and zvec are Rust libraries; wrapping them in JS would mean reimplementing or bridging |
| language intelligence | **Python** under **uv** (`gsterm-solidlsp`) | SolidLSP is a Python package; the only MIT-clean distribution is `serena-agent==1.7.0` |
| toolchain | native (`rg`, `git`, `ss`, C toolchain) | already present, cheap to invoke |

Four runtimes is a lot. The point is not minimalism — it is that **no runtime was chosen that the
work does not require**, and that the seams between them are explicit processes speaking JSON lines.

## The hard case: the TypeScript language server

`typescript-language-server` is a Node program. gs-term needs it for precise code semantics, and it
does not want a Node dependency in the product.

The resolution is an explicit shim inside the bridge's data directory. The SolidLSP bridge provisions
the language server by invoking `node`; gs-term places a shim on the `PATH` the bridge uses:

```
.devbin/shims/node → exec <path to bun> "$@"
```

Bun runs the TypeScript language server chain. The language server works; no real Node binary is in
the runtime graph.

This is why the `--node-free` gate scrubs `node`, `nvm`, `.nub`, `mise`, `volta`, `fnm`, `pnpm`,
`npm`, `yarn` and `/mnt/c/...` from `PATH` and then installs *only its own shim*. The invariant is
precisely: **`node` may resolve to our Bun shim or to nothing at all — never to a real Node
binary.**

The invariant is not "the machine has zero Node binaries". Devbox's own provisioning and Playwright's
installer may use Node. The invariant is that gs-term's bootstrap, runtime and verification path do
not depend on or resolve Node.

## Why it is worth enforcing

- **CI proves portability.** `.github/workflows/verify.yml` runs on a fresh `ubuntu-latest` runner:
  install Nix → Devbox → `devbox run bootstrap` → `devbox run verify-release`. A green job means the
  documented setup works from nothing.
- **One JavaScript runtime to reason about.** Bun is the only place application JavaScript executes.
  No "works under Node, differently under Bun" class of bug.
- **No Node-era compatibility shims.** AGENTS.md forbids them for the same reason: Bun already
  provides the primitives, and a shim is a second thing to keep correct.

## The cost

- **Bun must be pinned and bootstrapped.** nixpkgs carries only Bun 1.3.x, so bootstrap downloads the
  pinned release into `.devbin/bin/`. `scripts/bootstrap.sh` fails loudly on a network failure rather
  than falling back to an unpinned version.
- **The shim is a real boundary that must stay explicit** (debt D-042). It exists because a Node
  program must be launched; it must never become a general Node compatibility layer.
- **SolidLSP's licensing constrains the pin.** Upstream main relicensed the Serena application to
  GPL; gs-term pins `serena-agent==1.7.0`, which was fully MIT at that exact release. Do not track
  main.
- **Four runtimes means four failure surfaces.** The doctor's `require-semantic` profile exists
  precisely so a missing runtime is a hard failure instead of a quiet degradation in CI.

## Licensing note (preserved from the original recon)

Phase 3.5 recon inspected `zvec-ai/zvec-grep` at a pinned commit (the engine is a cargo **git
dependency**, not a fork) and audited the PyPI `serena-agent==1.7.0` metadata. Earlier recon used
shallow clones under `.tmp/donors/` for `WebMCP-org/npm-packages`, `compoundingtech/pty`,
`xtermjs/xterm.js`, `ripulio/web-mcp`, `kilian-ai/linuxontab` and `cloudflare/sandbox-sdk`; those
checkouts were removed after extraction.

## Source trail

- `src/doctor.ts:81-83` — the Node statement
- `scripts/verify-all.sh:38-62` — the `--node-free` PATH scrub and check
- `scripts/bootstrap.sh` — pinned Bun download
- `.github/workflows/verify.yml` — the clean-machine oracle
- `solidlsp/README.md` — "How Bun replaces Node", provisioning, orphan strategy
- `solidlsp/src/gsterm_solidlsp/bridge.py` — where the shim is installed
- `devbox.json` — the toolchain package list (no node)
- `.agents/DEBT.md` D-042 — the shim boundary watch item