"""gsterm-solidlsp bridge: a stdio JSON-lines server hosting SolidLSP for TypeScript.

The Bun parent (gs-term) spawns this module as a long-lived subprocess:

    uv run python -m gsterm_solidlsp

and speaks JSON-lines over stdin/stdout:

    {"id": 1, "method": "start", "params": {"workspace": "/abs/ws"}}
    {"id": 1, "ok": true, "result": {"ready": true, ...}}
    {"id": 2, "ok": false, "error": {"message": "..."}}

Design constraints (see README.md for the full rationale and 1.7.0 file:line evidence):

- only the ``solidlsp`` package from the serena-agent 1.7.0 wheel is imported;
  never ``serena`` application code (the wheel is MIT at 1.7.0, main is GPL);
- Bun replaces Node: SolidLSP asserts ``which("node")``/``which("npm")`` and launches
  the installed ``node_modules/.bin/typescript-language-server`` (shebang
  ``#!/usr/bin/env node``) through ``sh -c "exec <shim> --stdio"``, so this bridge
  prepends a shim directory (node -> bun, npm -> bun add translation) to PATH
  before ``SolidLanguageServer.create``;
- all persistent state stays inside the caller-provided data dir;
- the request loop is strictly sequential (solidlsp is synchronous/thread-based);
- stdout carries only protocol lines; logs go to stderr.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from solidlsp.language_servers.typescript_language_server import TypeScriptLanguageServer
from solidlsp.ls import SolidLanguageServer
from solidlsp.ls_config import LanguageServerConfig, LanguageServerId
from solidlsp.ls_utils import PathUtils
from solidlsp.settings import SolidLSPSettings

log = logging.getLogger("gsterm_solidlsp")

NAME = "gsterm-solidlsp"
VERSION = "0.1.0"
SOLIDLSP_PROVENANCE = "serena-agent 1.7.0 (solidlsp, MIT)"

# Version pins mirroring solidlsp 1.7.0 defaults:
#   language_servers/typescript_language_server.py:28-31
#   INITIAL_TYPESCRIPT_VERSION = "5.9.3"
#   INITIAL_TYPESCRIPT_LANGUAGE_SERVER_VERSION = "5.1.3"
TYPESCRIPT_VERSION = "5.9.3"
TYPESCRIPT_LANGUAGE_SERVER_VERSION = "5.1.3"

# "ts-lsp" is the unversioned install dirname that 1.7.0 reserves for exactly this
# version pair (typescript_language_server.py:273-278); the parent directory comes from
# SolidLanguageServer.ls_resources_dir (ls.py:430-448):
#   <solidlsp_dir>/language_servers/static/TypeScriptLanguageServer
TS_LSP_DIRNAME = "ts-lsp"

START_TIMEOUT = 300.0
STOP_TIMEOUT = 5.0

NODE_SHIM = """#!/bin/sh
exec "${GSTERM_BUN:-bun}" "$@"
"""

# bun walks UP from --cwd when the directory has no package.json, which in a
# repo checkout means the PROJECT's manifest (and its file: deps) get installed
# into the language-server dir. Pin the install context with a minimal manifest.
ENSURE_PKG_JSON = "test -f \"$1/package.json\" 2>/dev/null || printf '{}' > \"$1/package.json\""

# Translates the single npm invocation shape used by solidlsp 1.7.0
# (language_servers/common.py:154-160 `build_npm_install_command`, run with
# shell=True and cwd=<ts-lsp dir> by common.py:102-128):
#     npm install --prefix <dir> <pkg>@<ver> [<pkg>@<ver> ...]
# into the bun equivalent:
#     bun add --cwd <abs dir> <pkgs...>
NPM_SHIM = """#!/bin/sh
# gsterm npm->bun shim (part of the gsterm-solidlsp bridge)
set -u
BUN="${GSTERM_BUN:-bun}"
if [ "${1:-}" != "install" ]; then
  echo "gsterm npm shim: unsupported npm invocation: npm $*" >&2
  echo "this shim only supports: npm install --prefix <dir> <pkg>@<ver>..." >&2
  exit 2
fi
shift
prefix=""
pkgs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      [ $# -ge 2 ] || { echo "gsterm npm shim: --prefix requires a value" >&2; exit 2; }
      prefix="$2"; shift 2 ;;
    --*)
      echo "gsterm npm shim: unsupported npm flag: $1" >&2; exit 2 ;;
    *)
      pkgs="$pkgs $1"; shift ;;
  esac
done
[ -n "$prefix" ] || { echo "gsterm npm shim: missing --prefix <dir>" >&2; exit 2; }
[ -n "$pkgs" ] || { echo "gsterm npm shim: no packages given" >&2; exit 2; }
case "$prefix" in
  /*) ;;
  *) prefix="$(pwd)/$prefix" ;;
esac
test -f "$prefix/package.json" 2>/dev/null || printf '{}' > "$prefix/package.json"
exec "$BUN" add --cwd "$prefix" $pkgs
"""


class BridgeError(Exception):
    """Protocol-level error surfaced as {"ok": false, "error": {"message": ...}}."""


class Bridge:
    """Holds the single SolidLanguageServer instance and dispatches requests."""

    def __init__(self) -> None:
        self._server: SolidLanguageServer | None = None
        self._workspace: str | None = None
        self._data_dir: str | None = None
        self._settings: SolidLSPSettings | None = None
        self._bun_path: str | None = None
        self._bun_version: str | None = None
        self.shutdown_requested = False

    # ------------------------------------------------------------------ env / provisioning

    def _resolve_bun(self, bun_path: str | None) -> str:
        bun = bun_path or os.environ.get("GSTERM_BUN") or shutil.which("bun")
        if not bun:
            raise BridgeError("bun executable not found; pass start.bun_path or add bun to PATH")
        return bun

    def _prepare_environment(self, data_dir: str, bun_path: str | None) -> str:
        """Write the node/npm shims and make every spawned subprocess resolve bun.

        Must run BEFORE SolidLanguageServer.create(): create() unconditionally asserts
        which("node")/which("npm") (typescript_language_server.py:268-271) and copies
        os.environ into the language-server process (subprocess_util.py:209-210).
        """
        bun = self._resolve_bun(bun_path)
        self._bun_path = bun

        shims_dir = os.path.join(data_dir, "shims")
        os.makedirs(shims_dir, exist_ok=True)
        node_shim = os.path.join(shims_dir, "node")
        npm_shim = os.path.join(shims_dir, "npm")
        _write_script(node_shim, NODE_SHIM)
        _write_script(npm_shim, NPM_SHIM)

        os.environ["GSTERM_BUN"] = bun
        # keep bun's global package cache inside the data dir as well
        bun_cache = os.path.join(data_dir, "bun-cache")
        os.makedirs(bun_cache, exist_ok=True)
        os.environ["BUN_INSTALL_CACHE_DIR"] = bun_cache
        path = os.environ.get("PATH", "")
        if shims_dir not in path.split(os.pathsep):
            os.environ["PATH"] = shims_dir + os.pathsep + path
        return shims_dir

    def _make_settings(self, data_dir: str) -> SolidLSPSettings:
        # Overrides the solidlsp defaults (~/.solidlsp and per-project defaults) so that
        # everything lands inside the data dir (settings.py:30-45).
        return SolidLSPSettings(
            solidlsp_dir=os.path.join(data_dir, "solidlsp"),
            project_data_path=os.path.join(data_dir, "solidlsp-cache"),
        )

    def _ts_lsp_install_dir(self, settings: SolidLSPSettings) -> str:
        return os.path.join(TypeScriptLanguageServer.ls_resources_dir(settings, mkdir=False), TS_LSP_DIRNAME)

    def _installed_versions(self, settings: SolidLSPSettings) -> dict[str, Any]:
        target = self._ts_lsp_install_dir(settings)
        ts_pkg = os.path.join(target, "node_modules", "typescript", "package.json")
        ls_pkg = os.path.join(target, "node_modules", "typescript-language-server", "package.json")
        shim = os.path.join(target, "node_modules", ".bin", "typescript-language-server")
        return {
            "installed": os.path.exists(shim),
            "typescript": _read_pkg_version(ts_pkg) or TYPESCRIPT_VERSION,
            "typescript_language_server": _read_pkg_version(ls_pkg) or TYPESCRIPT_LANGUAGE_SERVER_VERSION,
            "path": shim if os.path.exists(shim) else None,
        }

    # ------------------------------------------------------------------ protocol handlers

    def op_hello(self, params: dict[str, Any]) -> dict[str, Any]:
        info = self._installed_versions(self._settings) if self._settings else {
            "installed": False,
            "typescript": TYPESCRIPT_VERSION,
            "typescript_language_server": TYPESCRIPT_LANGUAGE_SERVER_VERSION,
            "path": None,
        }
        return {
            "name": NAME,
            "version": VERSION,
            "solidlsp": SOLIDLSP_PROVENANCE,
            "languages": ["typescript"],
            "ts_server": {
                "runtime": "bun",
                "runtime_version": self._bun_version_cached(),
                "language_server": f"typescript-language-server {info['typescript_language_server']}",
                "typescript": f"typescript {info['typescript']}",
                "installed": info["installed"],
                "executable": info["path"],
            },
        }

    def _bun_version_cached(self) -> str | None:
        if self._bun_version is None:
            bun = self._bun_path or os.environ.get("GSTERM_BUN") or shutil.which("bun") or "bun"
            try:
                proc = subprocess.run([bun, "--version"], capture_output=True, text=True, timeout=30)
                if proc.returncode == 0:
                    self._bun_version = proc.stdout.strip()
            except (OSError, subprocess.TimeoutExpired):
                log.warning("could not determine bun version", exc_info=True)
        return self._bun_version

    def op_provision(self, params: dict[str, Any]) -> dict[str, Any]:
        """One-time bun-driven install of the language-server resources.

        Replicates the layout solidlsp 1.7.0 checks for
        (typescript_language_server.py:280-292) so that the subsequent
        SolidLanguageServer.create() takes the "already installed" branch and
        performs no npm work itself.
        """
        data_dir = self._resolve_data_dir(params, required=True)
        os.makedirs(data_dir, exist_ok=True)
        self._prepare_environment(data_dir, params.get("bun_path"))
        settings = self._make_settings(data_dir)
        self._settings = settings
        target = self._ts_lsp_install_dir(settings)
        shim = os.path.join(target, "node_modules", ".bin", "typescript-language-server")

        installed = False
        if not os.path.exists(shim):
            os.makedirs(target, exist_ok=True)
            # Pin the install context: without a manifest, bun walks up to the
            # workspace root and installs the PROJECT's dependencies here.
            pkg_json = os.path.join(target, "package.json")
            if not os.path.exists(pkg_json):
                with open(pkg_json, "w", encoding="utf-8") as f:
                    f.write("{}\n")
            assert self._bun_path is not None
            cmd = [
                self._bun_path, "add", "--cwd", target,
                f"typescript@{TYPESCRIPT_VERSION}",
                f"typescript-language-server@{TYPESCRIPT_LANGUAGE_SERVER_VERSION}",
            ]
            log.info("provisioning language server resources: %s", cmd)
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if proc.returncode != 0:
                raise BridgeError(
                    "bun add failed (rc={}): {}".format(
                        proc.returncode, (proc.stdout + proc.stderr)[-2000:]
                    )
                )
            installed = True

        if not os.path.exists(shim):
            raise BridgeError(f"provisioning did not produce the expected shim at {shim}")
        info = self._installed_versions(settings)
        return {"installed": installed, "path": shim, "versions": {
            "typescript": info["typescript"],
            "typescript_language_server": info["typescript_language_server"],
        }}

    def op_start(self, params: dict[str, Any]) -> dict[str, Any]:
        workspace = params.get("workspace")
        if not workspace:
            raise BridgeError("start requires 'workspace'")
        workspace = os.path.abspath(workspace)
        if not os.path.isdir(workspace):
            raise BridgeError(f"workspace does not exist: {workspace}")

        data_dir = self._resolve_data_dir({**params, "workspace": workspace}, required=True)
        os.makedirs(data_dir, exist_ok=True)
        self._prepare_environment(data_dir, params.get("bun_path"))

        self._stop_server()
        settings = self._make_settings(data_dir)
        config = LanguageServerConfig(ls_id=LanguageServerId.TYPESCRIPT)
        log.info("creating language server for %s (data_dir=%s)", workspace, data_dir)
        ls = SolidLanguageServer.create(config, workspace, timeout=START_TIMEOUT, solidlsp_settings=settings)
        # NOTE: create() is where 1.7.0 provisions (its __init__ resolves the dependency
        # provider, ls.py:577/643 -> dependency_provider.py:158); a cold data_dir runs
        # `npm install --prefix ./ ...` here, which resolves to our npm->bun shim.
        ls.start()
        self._server, self._workspace, self._data_dir, self._settings = ls, workspace, data_dir, settings
        return {"ready": True, "running": self._running(), "workspace": workspace, "data_dir": data_dir}

    def op_ready(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"running": self._running()}

    def op_restart(self, params: dict[str, Any]) -> dict[str, Any]:
        if not self._workspace:
            raise BridgeError("cannot restart: language server was never started")
        self._stop_server()
        settings = self._make_settings(self._data_dir or "")
        config = LanguageServerConfig(ls_id=LanguageServerId.TYPESCRIPT)
        ls = SolidLanguageServer.create(
            config, self._workspace, timeout=START_TIMEOUT, solidlsp_settings=settings
        )
        ls.start()
        self._server, self._settings = ls, settings
        return {"ready": True, "running": self._running()}

    def op_shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        self.shutdown_requested = True
        return {"stopped": True}

    # ------------------------------------------------------------------ query handlers

    def _require_server(self) -> SolidLanguageServer:
        if self._server is None or not self._server.is_running():
            raise BridgeError("language server not running (call start, or restart after a termination)")
        return self._server

    def op_symbols(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        doc = ls.request_document_symbols(_required(params, "file"))
        return [_serialize_symbol(s) for s in doc.root_symbols]

    def op_workspace_symbols(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        symbols = ls.request_workspace_symbol(str(_required(params, "query")))
        return [_serialize_symbol(s, children=False) for s in (symbols or [])]

    def op_definition(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        file, line, col = _position_args(params)
        return [_serialize_location(loc) for loc in ls.request_definition(file, line, col)]

    def op_references(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        file, line, col = _position_args(params)
        include_declaration = bool(params.get("include_declaration", False))
        if not include_declaration:
            locations = ls.request_references(file, line, col)
            return [_serialize_location(loc) for loc in locations]
        # The public API hardcodes includeDeclaration=False (ls.py:1664-1671); honor the
        # flag via the documented low-level handler while keeping the didOpen dance.
        workspace = ls.repository_root_path
        with ls.open_file(file):
            response = ls.handler.send.references({
                "textDocument": {"uri": Path(os.path.join(workspace, file)).as_uri()},
                "position": {"line": line, "character": col},
                "context": {"includeDeclaration": True},
            })
        out: list[dict[str, Any]] = []
        for item in response or []:
            uri = item.get("uri")
            rng = item.get("range")
            if not uri or not rng:
                continue
            abs_path = PathUtils.uri_to_path(uri)
            rel = PathUtils.get_relative_path(abs_path, workspace)
            if rel is None or not os.path.exists(abs_path):
                continue
            out.append({"file": rel, "start": rng["start"], "end": rng["end"]})
        return out

    def op_implementations(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        file, line, col = _position_args(params)
        return [_serialize_location(loc) for loc in ls.request_implementation(file, line, col)]

    def op_hover(self, params: dict[str, Any]) -> dict[str, Any]:
        ls = self._require_server()
        file, line, col = _position_args(params)
        hover = ls.request_hover(file, line, col)
        return {"contents": _hover_contents_to_str(hover.get("contents") if hover else None)}

    def op_diagnostics(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        ls = self._require_server()
        diags = ls.request_text_document_diagnostics(_required(params, "file"))
        out = []
        for d in diags:
            item: dict[str, Any] = {
                "range": d["range"],
                "severity": d.get("severity"),
                "message": d["message"],
            }
            if d.get("code") is not None:
                item["code"] = d["code"]
            out.append(item)
        return out

    # ------------------------------------------------------------------ lifecycle helpers

    def _running(self) -> bool:
        return self._server is not None and self._server.is_running()

    def _resolve_data_dir(self, params: dict[str, Any], required: bool) -> str:
        data_dir = params.get("data_dir")
        if data_dir:
            return os.path.abspath(data_dir)
        workspace = params.get("workspace")
        if workspace:
            return os.path.join(os.path.abspath(workspace), ".gsterm")
        if self._data_dir:
            return self._data_dir
        if required:
            raise BridgeError("cannot determine data dir: pass 'data_dir' or 'workspace'")
        return ""

    def _stop_server(self) -> None:
        ls, self._server = self._server, None
        if ls is None:
            return
        try:
            ls.save_cache()
        except Exception:
            log.warning("saving language server caches failed", exc_info=True)
        try:
            # never raises (ls.py:3185-3197); kills the whole process group via killpg
            ls.stop(shutdown_timeout=STOP_TIMEOUT)
        except Exception:
            log.warning("stopping language server raised", exc_info=True)


# ------------------------------------------------------------------ serialization helpers

def _serialize_symbol(symbol: dict[str, Any], children: bool = True) -> dict[str, Any]:
    """Whitelist-serialize a UnifiedSymbolInformation.

    Drops the `parent` back-references and `body` objects (not JSON-safe) by
    construction; keeps name/kind/location and the child tree.
    """
    location = symbol.get("location") or {}
    rng = location.get("range")
    if not rng:
        rng = symbol.get("selectionRange") or symbol.get("range")
    out: dict[str, Any] = {"name": symbol.get("name"), "kind": symbol.get("kind")}
    if rng:
        out["location"] = {
            "file": location.get("relativePath"),
            "start": {"line": rng["start"]["line"], "character": rng["start"]["character"]},
            "end": {"line": rng["end"]["line"], "character": rng["end"]["character"]},
        }
    if children:
        out["children"] = [_serialize_symbol(c) for c in symbol.get("children") or []]
    return out


def _serialize_location(location: dict[str, Any]) -> dict[str, Any]:
    rng = location["range"]
    return {
        "file": location.get("relativePath"),
        "start": {"line": rng["start"]["line"], "character": rng["start"]["character"]},
        "end": {"line": rng["end"]["line"], "character": rng["end"]["character"]},
    }


def _hover_contents_to_str(contents: Any) -> str | None:
    if contents is None:
        return None
    if isinstance(contents, str):
        return contents
    if isinstance(contents, dict):
        value = contents.get("value")
        return str(value) if value is not None else None
    if isinstance(contents, list):
        parts = [_hover_contents_to_str(c) for c in contents]
        return "\n\n".join(p for p in parts if p) or None
    return str(contents)


def _required(params: dict[str, Any], key: str) -> Any:
    value = params.get(key)
    if value is None or value == "":
        raise BridgeError(f"missing required parameter '{key}'")
    return value


def _position_args(params: dict[str, Any]) -> tuple[str, int, int]:
    return (
        str(_required(params, "file")),
        int(_required(params, "line")),
        int(_required(params, "column")),
    )


def _read_pkg_version(pkg_json: str) -> str | None:
    try:
        with open(pkg_json, encoding="utf-8") as f:
            return json.load(f).get("version")
    except (OSError, ValueError):
        return None


def _write_script(path: str, content: str) -> None:
    existing = None
    try:
        with open(path, encoding="utf-8") as f:
            existing = f.read()
    except OSError:
        pass
    if existing != content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        os.chmod(path, 0o755)


# ------------------------------------------------------------------ dispatch / main loop

METHODS = {
    "hello": Bridge.op_hello,
    "provision": Bridge.op_provision,
    "start": Bridge.op_start,
    "ready": Bridge.op_ready,
    "restart": Bridge.op_restart,
    "symbols": Bridge.op_symbols,
    "workspace_symbols": Bridge.op_workspace_symbols,
    "definition": Bridge.op_definition,
    "references": Bridge.op_references,
    "implementations": Bridge.op_implementations,
    "hover": Bridge.op_hover,
    "diagnostics": Bridge.op_diagnostics,
    "shutdown": Bridge.op_shutdown,
}


def handle_line(bridge: Bridge, line: str) -> dict[str, Any]:
    request_id: Any = None
    try:
        request = json.loads(line)
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
        request_id = request.get("id")
        method = request.get("method")
        if not isinstance(method, str):
            raise BridgeError("missing or invalid 'method'")
        params = request.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise BridgeError("'params' must be an object")
        handler = METHODS.get(method)
        if handler is None:
            raise BridgeError(f"unknown method '{method}'")
        result = handler(bridge, params)
        return {"id": request_id, "ok": True, "result": result}
    except BridgeError as exc:
        return {"id": request_id, "ok": False, "error": {"message": str(exc)}}
    except Exception as exc:  # solidlsp errors (SolidLSPException, LanguageServerTerminatedException, ...)
        message = f"{type(exc).__name__}: {exc}"
        log.debug("request failed: %s", message, exc_info=True)
        return {"id": request_id, "ok": False, "error": {"message": message}}


def _configure_logging() -> None:
    level_name = os.environ.get("GSTERM_SOLIDLSP_LOG", "WARNING").upper()
    level = getattr(logging, level_name, logging.WARNING)
    logging.basicConfig(
        stream=sys.stderr,
        level=level,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    if level > logging.DEBUG:
        # solidlsp logs the whole LSP conversation at DEBUG; keep the default quiet
        logging.getLogger("solidlsp").setLevel(level)


def main() -> int:
    _configure_logging()
    bridge = Bridge()

    def _signal_handler(signum: int, _frame: Any) -> None:
        log.info("received signal %d, shutting down", signum)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    exit_code = 0
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            response = handle_line(bridge, line)
            sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
            sys.stdout.flush()
            if bridge.shutdown_requested:
                log.info("shutdown requested; exiting")
                break
    except SystemExit as exc:
        exit_code = int(exc.code or 0)
    except BrokenPipeError:
        exit_code = 0
    finally:
        # stop() never raises and terminates the whole language-server process group
        bridge._stop_server()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
