# gsterm-solidlsp

The gs-term language-intelligence bridge: a stdio JSON-lines server that hosts
[SolidLSP](https://github.com/oraios/serena) for TypeScript workspaces, run and managed
by `uv`, with **Bun replacing Node as the JavaScript runtime**.

The Bun parent (gs-term) spawns this bridge as a long-lived subprocess and speaks the
JSON-lines protocol below. The bridge is the only place that touches `solidlsp`; gs-term
never imports it.

## Upstream provenance

| Item | Value |
| --- | --- |
| Distribution | PyPI wheel `serena-agent==1.7.0` (SolidLSP is not standalone on PyPI) |
| Version pin | **exactly** `1.7.0` — see warning below |
| Imported code | only the bundled `solidlsp` package (`solidlsp/*`); never `serena` application code |
| License at 1.7.0 | MIT (wheel metadata: `License: MIT`, `Classifier: License :: OSI Approved :: MIT License`) |
| Local reference copy (read-only) | `~/.local/share/uv/tools/serena-agent/lib/python3.13/site-packages/solidlsp/` |
| Managed by | uv 0.12.1, Python 3.12 (`uv python pin 3.12`, `uv sync` → committed `uv.lock`) |

> **License trap.** Upstream `main` relicensed the Serena application to GPL *after* the
> 1.7.0 release. Do not upgrade the pin, and do not depend on `serena` application code.
> The `solidlsp` package as shipped inside the 1.7.0 wheel is MIT-licensed; the bridge
> imports nothing else from the wheel at runtime.

## Running

```sh
cd solidlsp
uv sync                     # creates .venv (gitignored) from the committed uv.lock
uv run python -m gsterm_solidlsp        # stdin/stdout JSON-lines server
uv run python selftest.py               # end-to-end self test (cold + warm)
```

No global pip, no writes outside the data dir and `/tmp`:
`SolidLSPSettings(solidlsp_dir=<data_dir>/solidlsp, project_data_path=<data_dir>/solidlsp-cache)`
keeps every solidlsp resource and cache inside the data dir (defaults would be `~/.solidlsp`
and `<workspace>/.solidlsp` — both overridden, see `solidlsp/settings.py:30-45` in 1.7.0).
Bun's own install cache is pinned into the data dir via `BUN_INSTALL_CACHE_DIR`.
The self test asserts that `~/.serena`, `~/.solidlsp` and `./cache` are not written.

## Protocol (stdio JSON-lines)

One JSON object per line, in and out. Sequential dispatch; solidlsp is synchronous and
thread-based, so requests are handled one at a time in a single-threaded loop.

Request:

```json
{"id": 1, "method": "start", "params": {"workspace": "/abs/ws"}}
```

Response — either

```json
{"id": 1, "ok": true, "result": {...}}
```

or

```json
{"id": 1, "ok": false, "error": {"message": "..."}}
```

A malformed input line produces `{"id": null, "ok": false, "error": {...}}` and the loop
continues. On stdin EOF, `shutdown`, SIGTERM or SIGINT the bridge stops the language
server and exits 0 — no orphan `typescript-language-server`/`tsserver` processes remain
(the self test verifies this with `pgrep`).

### Methods

| Method | Params | Result |
| --- | --- | --- |
| `hello` | `{}` | `{name, version, solidlsp, languages, ts_server}` — reports discovered installed versions when the resources exist, else the pinned defaults |
| `provision` | `{data_dir?}` (or `{workspace}`; default data dir `<workspace>/.gsterm`) | `{installed, path, versions}` — one-time bun-driven install of the language-server resources |
| `start` | `{workspace, data_dir?, bun_path?}` | `{ready: true, workspace, data_dir}` — creates settings + `LanguageServerConfig(ls_id=TYPESCRIPT)`, `SolidLanguageServer.create(..., timeout=300)`, `start()`. May provision on first use (~1 min) |
| `ready` | `{}` | `{running: bool}` |
| `restart` | `{}` | `{ready: true}` — `stop()` then create/start again (solidlsp has no auto-restart) |
| `symbols` | `{file}` | recursive document symbols: `{name, kind, location: {file, range}, children}` (`parent` back-references and `body` objects are stripped — not JSON-safe) |
| `workspace_symbols` | `{query}` | flattened list of the same symbol shape |
| `definition` | `{file, line, column}` | `[{file, start, end}]` — workspace-relative paths, 0-based positions |
| `references` | `{file, line, column, include_declaration?}` (default `false`) | same shape list |
| `implementations` | `{file, line, column}` | same shape list |
| `hover` | `{file, line, column}` | `{contents: string \| null}` |
| `diagnostics` | `{file}` | `[{range, severity, message, code?}]` |
| `shutdown` | `{}` | stops the server (never raises), replies ok, exits 0 |

All positions/ranges are 0-based `{line, character}`. All file paths in results are
relative to the workspace root (solidlsp's `Location.relativePath`).

## How Bun replaces Node

Established fact (proven before this bridge was written): `typescript-language-server`
+ `tsserver` run correctly under **Bun 1.4.0** — byte-identical LSP results vs Node, with
`node` absent from `PATH`. The language server forks `tsserver` via `process.execPath`,
which is the bun binary itself.

SolidLSP 1.7.0 nevertheless assumes Node/npm in three places (file:line references are
into the 1.7.0 wheel):

1. `language_servers/typescript_language_server.py:268-271` — `_get_or_install_core_dependency`
   unconditionally asserts `shutil.which("node")` and `shutil.which("npm")`. This runs at
   `SolidLanguageServer.create()` time (called from `ls.py:577` → `ls.py:643` →
   `dependency_provider.py:158`), on **every** create, warm or cold.
2. `language_servers/typescript_language_server.py:282-286` — if
   `<resources>/TypeScriptLanguageServer/ts-lsp/node_modules/.bin/typescript-language-server`
   exists, npm installation is **skipped entirely**; otherwise
   `RuntimeDependencyCollection.install()` runs the npm commands.
3. `language_servers/common.py:154-160` (`build_npm_install_command`) — the exact install
   commands are `npm install --prefix ./ typescript@5.9.3` and
   `npm install --prefix ./ typescript-language-server@5.1.3`, executed by
   `common.py:102-128` as `sh -c <cmd>` with `cwd=<ts-lsp dir>` and
   `stdin=/dev/null`, output captured.

The language server process itself is launched by `util/subprocess_util.py:199-253` as
`sh -c "exec <...>/node_modules/.bin/typescript-language-server --stdio"` (the `exec`
prefix preserves the `PR_SET_PDEATHSIG` registration). The `.bin` entry is a symlink to
`typescript-language-server/lib/cli.mjs` whose shebang is `#!/usr/bin/env node`
(bun produces exactly this layout — verified).

The bridge therefore provides a **PATH shim directory** (`<data_dir>/shims/`) prepended
to `os.environ["PATH"]` *before* `SolidLanguageServer.create`:

- `node` → `exec "${GSTERM_BUN:-bun}" "$@"` — satisfies the `which("node")` assert and
  the `#!/usr/bin/env node` shebang; every `node` invocation becomes bun.
- `npm` → translates exactly `npm install --prefix <dir> <pkg>@<ver> ...` into
  `bun add --cwd <abs dir> <pkgs>...` and errors clearly on any other npm usage.
  Satisfies the `which("npm")` assert and makes solidlsp's own install path work under bun.

`GSTERM_BUN` pins the exact bun executable (set by the bridge from the `bun_path`
parameter or `shutil.which("bun")`), so the shims are hermetic even under a scrubbed PATH.

## Provisioning strategy (A: pre-provisioned + npm shim fallback)

Both paths ship; both end in the same on-disk layout that solidlsp 1.7.0 checks for:

```
<data_dir>/solidlsp/language_servers/static/TypeScriptLanguageServer/ts-lsp/
├── package.json            (created by bun add)
├── bun.lock
└── node_modules/
    ├── typescript/                      (5.9.3)
    ├── typescript-language-server/      (5.1.3)
    └── .bin/typescript-language-server  → ../typescript-language-server/lib/cli.mjs
```

(The `TypeScriptLanguageServer` path component comes from `ls.py:430-448`:
`<solidlsp_dir>/language_servers/static/<LS class name>`; the `ts-lsp` suffix from
`typescript_language_server.py:273-280` — the "initial" version pair 5.9.3/5.1.3 uses the
unversioned legacy dirname.)

- **`provision` (primary, explicit)**: the bridge runs
  `bun add --cwd <ts-lsp dir> typescript@5.9.3 typescript-language-server@5.1.3` once,
  directly with bun. Subsequent `start`s take the skip branch
  (`typescript_language_server.py:282`) and perform no npm work — but the shims must
  still be on PATH for the unconditional asserts.
- **SolidLSP-driven (fallback)**: if the resources are missing at `create()` time,
  solidlsp runs its own `npm install --prefix ./ ...` commands, which resolve to the
  npm→bun shim. Both provisioning paths and the warm path are exercised by `selftest.py`.

Network access happens **only** during this one-time provisioning (npm registry via bun);
there is no network at request time.

## Lifecycle and orphan strategy

- The language server runs in its own session/process group
  (`start_new_session=True`, `ls_config.py:972` default) with `PR_SET_PDEATHSIG=SIGTERM`
  registered through a dedicated spawner thread (`subprocess_util.py:190-281`), so it
  cannot outlive the bridge even if the bridge is SIGKILLed.
- `stop()` (`ls.py:3185-3197`) never raises; it sends LSP `shutdown`/`exit`, closes
  stdin, then terminates the whole process group via `os.killpg` with a SIGKILL fallback
  (`subprocess_util.py:338-384`). `tsserver` is forked by the language server within the
  same group, so it dies with it.
- `shutdown`, EOF, SIGTERM, SIGINT all funnel into the same stop path; the bridge then
  exits 0. `restart` is stop + create + start (fresh instance, same settings).
- solidlsp errors (e.g. `LanguageServerTerminatedException` wrapped in
  `SolidLSPException`) surface as clean `{"ok": false}` responses; `restart` recovers.

## Files

- `src/gsterm_solidlsp/bridge.py` — the JSON-lines server (`uv run python -m gsterm_solidlsp`)
- `selftest.py` — end-to-end test: cold provision (bun), cold provision (solidlsp via npm
  shim), warm start, full protocol suite, restart, shutdown, orphan + stray-write checks,
  all under a PATH scrubbed of node/npm
- `uv.lock` — committed; `uv sync` reproduces the environment deterministically

---

> Reader-facing documentation for this bridge lives in
> [docs/reference/solidlsp-protocol.md](../docs/reference/solidlsp-protocol.md), and its place in the
> system in [docs/subsystems/semantic-substrate.md](../docs/subsystems/semantic-substrate.md).
> `docs/explanation/why-no-node.md` covers the Bun-instead-of-Node rationale and the licensing pin.
> This file remains the bridge's own operational reference.
