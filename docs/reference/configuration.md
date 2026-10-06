# Configuration reference

All runtime configuration is `gsterm.toml` plus environment overrides. `AGENTS.md` forbids using
Markdown as runtime configuration.

- Loader: `src/config.ts` — `loadConfig(cwd)`
- Types: `GsTermConfig`, `SshWorldConfig`, `MechanismsConfig`
- Precedence: **environment override → `gsterm.toml` → built-in default**

## Environment variables

| Variable | Effect | Default |
| --- | --- | --- |
| `GSTERM_ROOT` | workspace root (containment boundary and observation scope) | `gsterm.toml` `world.root`, else the process cwd |
| `GSTERM_HOSTNAME` | HTTP bind address | `127.0.0.1` |
| `GSTERM_PORT` | HTTP port (numeric) | `7317` |
| `GSTERM_STORE` | SQLite store path | `<domainRoot>/.cognate/app.sqlite` |
| `BUN_VERSION` | pinned Bun version used by bootstrap | `1.4.2` (set by `devbox.json`) |
| `CARGO_TARGET_DIR` | Rust build output | `$PWD/rust/target` (set by `devbox.json`) |
| `GSTERM_HELPER_BIN` | explicit path to `gsterm-semantic`, beating discovery | — |
| `GSTERM_REQUIRE_SEMANTIC` | turns any semantic test skip into a failure | unset |
| `GSTERM_SKIP_RUST` / `_SOLIDLSP` / `_DOCTOR` / `_E2E` | targeted skips; **rejected** by `--release` | unset |

A non-empty `world.root` is resolved to an absolute path. An empty root means "the process cwd", and
`workspaceRoot(config)` resolves it at use time.

## `[server]`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `hostname` | string | `127.0.0.1` | loopback by default; the Cockpit and WebSocket are unauthenticated beyond the dev bearer token |
| `port` | number | `7317` | taken when not open; port 0 picks an ephemeral port |

## `[world]`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `local` | the registry id of the local provider; a `[worlds.*]` entry may not collide with it |
| `root` | string | `""` (process cwd) | containment boundary for structured execution and the scope of the filesystem observer |

## `[session]`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | `main` | stable across restarts on purpose: the world-state thread `session:<id>` is durable while the PTY is a fresh process every boot |
| `shell` | string | `bash` | spawned as `setsid <shell> --init-file src/shell/bash-init.sh` |
| `cols` | number | `120` | initial PTY width |
| `rows` | number | `32` | initial PTY height |
| `scrollback_bytes` | number | `262144` | bounded in-memory ring for reconnect replay; PTY bytes are never written to durable storage |

## `[execution]`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `timeout_ms` | number | `30000` | default structured-execution timeout; an SSH world may override with `default_timeout_ms` |

## `[mechanisms]`

The native semantic substrate. `enabled` gates **mounting**, never honesty: when disabled, mechanisms
report unavailable.

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | mount the substrate when its pieces are ready |
| `helper_binary` | string | `""` | explicit path; empty means discovery (`rust/artifacts`, then `rust/target/release`) |
| `solidlsp_project` | string | `solidlsp` | uv project directory, repo-relative |
| `model` | string | `local/potion-code-16m-v2` | local embedding model reference |
| `data_dir` | string | `""` → `<root>/.gsterm` | indexes, concept store, language-server resources |

## `[worlds.<id>]`

Additional execution worlds. v0 supports `kind = "ssh"` only. Each world gets the **same**
`process.exec` capability; `worldId` is an input property.

| Key | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `kind` | string | no | `ssh` | anything else is rejected at load time |
| `display` | string | no | `<username>@<host>` | human label |
| `host` | string | **yes** | — | — |
| `port` | number | no | `22` | — |
| `username` | string | **yes** | — | — |
| `root` | string | **yes** | — | the workspace root this world's paths resolve inside |
| `auth` | string | no | `agent` | `agent`, `key:<path>`, or `password-env:<VAR>` — a **reference**, never a value |
| `host_key_fingerprints` | string[] | **one of these two** | `[]` | host-key pinning is mandatory |
| `host_keys_file` | string | **one of these two** | — | a `known_hosts` file |
| `default_timeout_ms` | number | no | `30000` | per-world execution timeout |
| `ready_timeout_ms` | number | no | `20000` | connection establishment bound, so failures settle promptly instead of hanging runs |

Configuration is rejected at load time when: `kind` is unsupported, `host`/`username`/`root` are
missing, `auth` is not a recognised reference, host-key pinning is absent, or a world id collides with
the local world id.

### Example

```toml
[worlds.ssh-test]
kind = "ssh"
display = "SSH test box"
host = "127.0.0.1"
port = 2222
username = "tester"
root = "/home/tester/gs-workspace"
auth = "agent"
host_key_fingerprints = ["SHA256:..."]
host_keys_file = "~/.ssh/known_hosts"
```

## Worked example

```toml
# gs-term runtime configuration (non-Markdown, per AGENTS.md).

[server]
hostname = "127.0.0.1"
port = 7317

[world]
id = "local"
# Workspace root: the containment boundary for structured execution and the
# observation scope of the filesystem observer. Empty = process cwd.

[session]
id = "main"
shell = "bash"
cols = 120
rows = 32
scrollback_bytes = 262144   # bounded in-memory scrollback ring for reconnect replay

[execution]
timeout_ms = 30000

[mechanisms]
enabled = true
helper_binary = ""                    # empty = discover (rust/artifacts, then rust/target/release)
solidlsp_project = "solidlsp"
model = "local/potion-code-16m-v2"
data_dir = ""                         # empty = <root>/.gsterm
```

## Note on `cognate.config.ts`

The repository root also has a `cognate.config.ts` with a `copilot` profile. It is an **optional entry
for the vendored `cognate dev` chat-profile demo over the same domain model**. It is not used by
`bun run dev`, which is the product entry point (`src/server/index.ts`).

## Source trail

- `src/config.ts` — every interface, `parseSshWorld`, `loadConfig`, `workspaceRoot`, `worldRootsOf`
- `gsterm.toml` — the checked-in configuration
- `cognate.config.ts` — the optional profile entry
- `devbox.json` — `BUN_VERSION`, `CARGO_TARGET_DIR`, the shell scripts
- `test/app.test.ts` — config loading with environment overrides