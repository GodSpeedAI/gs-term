# HTTP and WebSocket API

The server serves a small, fixed set of routes. Everything semantic goes through the Cognate
Connect transport, which is reverse-proxied.

## Transport identity

Development boundary, honestly labelled (debt D-026):

```
Authorization: Bearer <tenant>:<actorId>[:<kind>]
```

`kind` defaults to `user` and is constrained to `user | agent | service | system`. Requests to the
Connect transport must present this; other routes do not require it.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | GET | the cockpit HTML shell (inline, loads `/app.css` and `/app.js`) |
| `/app.js` | GET | the browser bundle, built at startup with `Bun.build` |
| `/app.css` | GET | the stylesheet |
| `/health` | GET | liveness and readiness summary |
| `/api/meta` | GET | session/thread/tenant identity, worlds, and tool descriptors |
| `/ws` | GET | terminal WebSocket upgrade |
| `/cognate.v1.RuntimeService/*` | any | reverse-proxied to the internal Connect server |
| anything else | — | `404 not found` |

### `GET /health`

```json
{
  "ok": true,
  "session": { "id": "main", "alive": true, "cols": 120, "rows": 32, "exitCode": null },
  "semantic": { "objects": 48, "digest": "sha256:4dddc4862e4c…" },
  "capabilities": ["process.exec", "world.snapshot", "focus.search", "code.definition", …],
  "root": "/abs/path/to/workspace"
}
```

Useful for: confirming the model loaded (object count + digest), which capabilities exist, and whether
the PTY is alive.

### `GET /api/meta`

```json
{
  "sessionId": "main",
  "threadId": "session:main",
  "tenant": "local",
  "worldId": "local",
  "defaultWorldId": "local",
  "worlds": [{ "worldId": "local", "kind": "local", "metadata": { "root": "…", "host": "localhost" } }],
  "tools": [{ "name": "execute_command", "description": "…", "inputSchema": { … } }]
}
```

`worlds[].metadata` never contains credentials — only provider-safe facts such as host, port,
username, auth kind and host-key material.

## WebSocket `/ws`

The terminal. One session, many viewers.

### Server → client

| Frame | Encoding | When |
| --- | --- | --- |
| control frame | JSON text | on open (`session`), on exit (`exit`), in reply to `ping` |
| terminal bytes | binary | continuously while alive |
| scrollback replay | binary | immediately after the open control frame |

Control frames are `{type, …}`; the `session` control frame carries `id`, `cols`, `rows`, `alive`,
`exitCode`. The `exit` frame carries `exitCode`.

Shell-integration markers are **stripped** before broadcast, so a viewer never sees an OSC 7311
sequence.

### Client → server

| Frame | Encoding | Effect |
| --- | --- | --- |
| control frame | JSON text | `{"type":"resize","cols":…,"rows":…}` or `{"type":"ping"}` |
| keystrokes | binary | written directly to the PTY |

Resize values must be integers with `cols ≥ 1`, `rows ≥ 1`, `cols ≤ 512`, `rows ≤ 256`; out-of-range
values are ignored.

### Attach semantics

- On open, listeners are registered and the bounded scrollback ring is replayed, then live bytes.
- On close, listeners are detached. **The session continues** — it belongs to the server.
- Every attach triggers `bridge.reconcile("attach")`, re-deriving the world view from observed facts.
- A non-upgrade request to `/ws` returns `400 websocket upgrade required`.

## Cognate transport

`/cognate.v1.RuntimeService/*` is proxied to an internal Connect server bound to `127.0.0.1:0`
(an ephemeral loopback port). The body is streamed with `duplex: "half"`.

Surfaces use it for `startRun`, `run`, projection reads, shared-state reads/writes, and the event
stream (`follow: true`). That is where the semantic protocol lives — not in bespoke HTTP endpoints.

## Shutdown

`SIGINT`/`SIGTERM` run the ordered teardown in [startup-and-shutdown.md](../workflows/startup-and-shutdown.md).
The HTTP server stops with `stop(true)`, dropping open connections.

## Source trail

- `src/server/index.ts:95-128` — `Bun.serve` and the route table
- `src/server/index.ts:149-164` — the HTML shell
- `src/server/index.ts:172-207` — `websocketHandlers`
- `src/terminal/protocol.ts` — `encodeControl`, `decodeClientControl`
- `src/server/index.ts:33-42` — `bearerAuthenticator`, `bearerToken`
- `e2e/serve.ts` — the test server wrapper