# SolidLSP bridge protocol (`gsterm-solidlsp`)

A stdio JSON-lines server hosting SolidLSP for TypeScript workspaces, run and managed by `uv`, with
**Bun replacing Node** as the JavaScript runtime. gs-term spawns it as a long-lived subprocess; the
bridge is the only place that touches `solidlsp`.

Client: `src/mechanisms/solidlsp.ts` (`SolidLspBridge`).

## Provenance

- The upstream is [oraios/serena](https://github.com/oraios/serena).
- gs-term pins the PyPI distribution `serena-agent==1.7.0`, the **only MIT-clean** release at that
  version. Upstream main later relicensed the Serena application to GPL — **do not track main**.
- `solidlsp/uv.lock` is committed; `uv sync` reproduces the environment deterministically.
- typescript-language-server 5.1.3 + typescript 5.9.3 are provisioned through a **node → bun shim**,
  so Bun runs the whole TypeScript LSP chain and no real Node binary enters the runtime graph.

## Wire format

One JSON object per line. Sequential dispatch — SolidLSP is synchronous and thread-based, so requests
are handled one at a time in a single-threaded loop.

Request:

```json
{"id": 1, "method": "start", "params": {"workspace": "/abs/ws"}}
```

Response — either

```json
{"id": 1, "ok": true,  "result": { }}
```

or

```json
{"id": 1, "ok": false, "error": {"message": "..."}}
```

A malformed input line produces `{"id": null, "ok": false, "error": {...}}` and the loop continues.
On stdin EOF, `shutdown`, `SIGTERM` or `SIGINT` the bridge stops the language server and exits 0 — no
orphan `typescript-language-server` / `tsserver` processes remain (the self test verifies this with
`pgrep`).

## Methods

| Method | Params | Result |
| --- | --- | --- |
| `hello` | `{}` | `{name, version, solidlsp, languages, ts_server}` — reports discovered installed versions when the resources exist, else the pinned defaults |
| `provision` | `{data_dir?}` (or `{workspace}`; default `<workspace>/.gsterm`) | `{installed, path, versions}` — one-time Bun-driven install of language-server resources |
| `start` | `{workspace, data_dir?, bun_path?}` | `{ready: true, workspace, data_dir}` — creates settings, `LanguageServerConfig(ls_id=TYPESCRIPT)`, `SolidLanguageServer.create(..., timeout=300)`, `start()`. May provision on first use (~1 min) |
| `ready` | `{}` | `{running: bool}` |
| `restart` | `{}` | `{ready: true}` — `stop()` then create/start again (SolidLSP has no auto-restart) |
| `symbols` | `{file}` | recursive document symbols: `{name, kind, location: {file, range}, children}[]` — `parent` back-references and `body` objects are stripped as not JSON-safe |
| `workspace_symbols` | `{query}` | flattened list of the same symbol shape |
| `definition` | `{file, line, column}` | `[{file, start, end}]` — workspace-relative paths, 0-based positions |
| `references` | `{file, line, column, include_declaration?}` (default `false`) | same shape list |
| `implementations` | `{file, line, column}` | same shape list |
| `hover` | `{file, line, column}` | `{contents: string \| null}` |
| `diagnostics` | `{file}` | `[{range, severity, message, code?}]` |
| `shutdown` | `{}` | stops the server (never raises), replies ok, exits 0 |

**Position convention.** All positions and ranges are 0-based `{line, character}`. All file paths in
results are workspace-relative. The capability layer converts to the 1-based semantic convention, so
no surface ever sees a 0-based position.

## Lifecycle and orphan strategy

- The language server runs in its own session/process group
  (`start_new_session=True`), with `PR_SET_PDEATHSIG=SIGTERM` registered through a dedicated spawner
  thread — so it cannot outlive the bridge even if the bridge is `SIGKILL`ed.
- `stop()` never raises: it sends LSP `shutdown`/`exit`, closes stdin, then terminates the whole
  process group via `os.killpg` with a `SIGKILL` fallback. `tsserver` is forked by the language
  server within the same group, so it dies with it.
- `shutdown`, EOF, `SIGTERM` and `SIGINT` all funnel into that stop path, then exit 0.
- `restart` is stop + create + start.
- SolidLSP errors (e.g. `LanguageServerTerminatedException` wrapped in `SolidLSPException`) surface as
  clean `{"ok": false}` responses; `restart` recovers.

## Provisioning strategy

Resources are pre-provisioned where possible; the npm shim is the fallback for a cold start. A stable
per-workspace data dir means provisioning runs **once**: the search planner starts the workspace
idempotently on every query.

## Running it directly

```bash
cd solidlsp && uv sync
cd solidlsp && uv run python -m gsterm_solidlsp     # the JSON-lines server
cd solidlsp && uv run python selftest.py            # end-to-end self test
```

`selftest.py` covers cold provision (bun), cold provision (solidlsp via npm shim), warm start, the
full protocol suite, restart, shutdown, and orphan + stray-write checks — all under a `PATH` scrubbed
of node and npm.

## Files

- `solidlsp/src/gsterm_solidlsp/bridge.py` — the JSON-lines server
- `solidlsp/src/gsterm_solidlsp/__main__.py` — the entry point
- `solidlsp/selftest.py` — the self test
- `solidlsp/pyproject.toml`, `solidlsp/uv.lock` — the pinned environment

## Source trail

- `solidlsp/README.md` — the canonical protocol documentation
- `solidlsp/src/gsterm_solidlsp/bridge.py`
- `solidlsp/selftest.py`
- `src/mechanisms/solidlsp.ts` — the Bun client
- `src/components/code.ts` — position conversion
- `src/mechanisms/readiness.ts` — deep-mode readiness probing
- `src/semantic/concepts.ts:185-187` — SolidLSP-provenance concepts