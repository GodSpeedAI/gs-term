# How to add an execution world

**Goal:** make a command runnable in another place — a remote host, WSL, a future sandbox — with no
change to the semantic layer.

**Prerequisites:** a Cognate `ExecutionWorldProvider` implementation. For SSH, none: the repository
already ships `sshExecutionWorld`.

## Option A — add an SSH world (configuration only)

### 1. Add the world to `gsterm.toml`

```toml
[worlds.ssh-test]
kind = "ssh"
display = "SSH test box"
host = "127.0.0.1"
port = 2222
username = "tester"
root = "/home/tester/gs-workspace"
auth = "agent"                            # or "key:~/.ssh/id_ed25519" / "password-env:MY_VAR"
host_key_fingerprints = ["SHA256:..."]    # pin the host key (required) …
host_keys_file = "~/.ssh/known_hosts"     # … and/or a known_hosts file
default_timeout_ms = 30000
ready_timeout_ms = 20000
```

Hard requirements, enforced by `parseSshWorld`: `kind = "ssh"`, `host`, `username`, `root`, a valid
`auth` reference, and host-key pinning (fingerprints and/or a known_hosts file). The world id must
not collide with the local world id.

### 2. Make the credential available

- `auth = "agent"` needs `SSH_AUTH_SOCK`.
- `auth = "key:<path>"` needs the key readable by the server process.
- `auth = "password-env:<VAR>"` needs that environment variable set before `bun run dev`; otherwise
  startup throws naming the variable.

Never put a secret value in `gsterm.toml` or in any event, log, projection or tool input.

### 3. Verify

```bash
bun run doctor                                   # SSH row should report ready
bun run dev                                      # then pick the world in the cockpit selector
```

Or drive it from a machine surface without touching the UI:

```
WebMCP tool: execute_command
{ "argv": ["sh", "-lc", "printf hello > semantic-world-proof.txt"], "worldId": "ssh-test" }
```

Inspect the result: the execution row shows the world that handled it, and the effects carry that
world's provenance. Run the same `argv` in `local` and you get two distinct resources — the
`(worldId, path)` identity rule.

## Option B — add a new world kind (code)

### 1. Build the provider

Create the provider (or use Cognate's) exposing the two structural ports the mechanism layer expects:

```ts
interface FilePort   { stat(path): Promise<FileStatLike | undefined>; list(path): Promise<entries> }
interface ProcessPort{ exec({argv, cwd, timeoutMs}): Promise<{stdout, stderr, exitCode, timedOut}> }
```

`src/semantic/contracts.ts` declares them structurally so mechanism code never imports the framework.

### 2. Add a configuration parser entry

In `src/config.ts`, extend `SshWorldConfig` handling with your own kind: parse, validate, apply
defaults. Reject unknown kinds explicitly so a typo fails at startup.

For credentials, follow the same pattern as `sshAuthOf`: configuration holds a **reference**; the
reference is resolved in `src/app/worlds.ts` and the secret stops there.

### 3. Register the provider

In `src/app/worlds.ts`, add your provider to the array passed to `createExecutionWorldRegistry`,
alongside `localExecutionWorld` and the SSH providers. Add its root to the `roots` map (or extend
`worldRootsOf` in `src/config.ts`).

### 4. Decide substrate availability

In `src/mechanisms/substrate.ts`, the `helperFor` / `solidlspFor` accessors are local-world-only. If
your world has its own substrate, extend them — and extend `resolveAvailability` in
`src/focus/mechanisms.ts` so the new world reports its mechanisms truthfully instead of appearing
unavailable.

### 5. Do not touch the semantic layer

No new capability, no new tool, no new event field. `worldId` is already an input property of
`agent.execute`, `process.exec`, `world.snapshot`, `focus.search` and `code.*`.

The architecture test enforces this: `/\bssh/i` (or any provider name) in `src/agents`,
`src/projections`, `src/webmcp` or `src/semantic` fails the build.

### 6. Validate

```bash
bun run test                  # includes journey-j2-worlds.test.ts
bash scripts/verify-all.sh
```

Add a test asserting: the provider describes itself without leaking credentials, world selection
routes by `worldId`, and equal paths in two worlds stay distinct.

## Common failure symptoms

| Symptom | Cause | Fix |
| --- | --- | --- |
| `host-key pinning is required` at startup | no fingerprints and no known_hosts file | pin the host key — this is not optional |
| `password-env reference <VAR> is not set` | variable missing | export it, or use `agent` / `key:` |
| `worlds.<id>: collides with the default local world id` | id equals `world.id` | rename the world |
| `unsupported kind <k> (v0 supports "ssh")` | parser does not know the kind | extend `parseSshWorld` / add a parser entry |
| `no workspace root configured for world <id>` | world registered without a root | set `root` |
| Remote processes/ports always `unknown` | session-tree attribution is local-only (D-010) | expected; document it, do not fake it |
| Connection hangs then fails | unreachable host or firewall | `ready_timeout_ms` bounds it |

## Related

- [execution-worlds.md](../subsystems/execution-worlds.md)
- [why-world-scoped-identity.md](../explanation/why-world-scoped-identity.md)
- [configuration.md](../reference/configuration.md)