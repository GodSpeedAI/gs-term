# Why worlds are an input, not a verb

## The question

gs-term can run a command locally or on an SSH host. How should that be expressed without the remote
case leaking into the model?

The obvious bad answer is a family of verbs: `ssh.run`, `local.run`, `browser.run`. The moment those
exist, the semantic layer has to ask "which kind is this?", the event vocabulary branches, and every
consumer grows a switch.

## The rule

> A capability describes **what** is being done. The execution world determines **where** it happens.

`worldId` is an input property of one capability:

```ts
ctx.invoke("process.exec", { worldId, argv, cwd, timeoutMs });
```

The same call, the same event vocabulary, the same effect model — a different provider behind it.

## Where the mechanics actually live

`src/app/worlds.ts` is the only module that knows a provider exists:

- `localExecutionWorld({worldId, metadata, timeoutMs})` — root-contained local execution.
- `sshExecutionWorld({worldId, host, port, username, auth, hostKeys, timeouts})` — SFTP file port,
  remote exec, mandatory host-key pinning.

Both produce an `ExecutionWorldProvider`, and both go into one registry. Everything above the
registry — agents, capabilities, projections, WebMCP descriptors — sees only `worldId` plus the
provider's `fileSystem` and `process` ports.

That structural port pair is what makes the mechanism layer world-agnostic: `walkWorldFiles` and
`observeGit` are written against `FilePort` / `ProcessPort`, which happen to be exactly what Cognate's
providers already expose. `git -C <root> status` therefore runs *on the remote host* for an SSH world,
producing the same `GitObservation` shape.

## This is enforced, not just intended

`test/architecture.test.ts` fails the build if `/\bssh/i` appears anywhere in `src/agents`,
`src/projections`, `src/webmcp` or `src/semantic`. A provider reference in the semantic layer is a
test failure, not a style preference.

The counterpart invariant is enforced too: mechanism files may not import `@cognate/*`.

## Resource identity follows

If `worldId` is an input, then a resource must be identified by `(worldId, resource)`.
`semantic-world-proof.txt` in `local` and in `ssh-test` are two different resources:

- snapshots carry `world: {worldId, kind, metadata}`;
- effects carry `worldId` and a `target`;
- observations carry `subject.worldId`;
- search receipts carry `worldId` and `provenance: {crossWorld: false}`;
- the concept store and structural map are scoped to the world they were built for.

The system never merges equal paths across worlds, and never silently substitutes one world's
mechanism results for another's. A remote world reports the semantic mechanisms unavailable, because
the substrate is mounted for the local world only.

## Fail closed

World registration is the **execution grant boundary**. `registry.get(id)` on an unknown or disposed
world throws `WorldUnavailableError`; a world with no configured root throws the same. An agent asking
for an unregistered world fails with `unknown execution world` before any event is emitted.

This is deliberate: a typo'd `worldId` must never silently run a command somewhere else.

## Known gaps

| Gap | Debt |
| --- | --- |
| The kernel policy cannot distinguish worlds — registration is the only boundary | D-002 |
| `process.exec` does not canonicalise `cwd`, so containment is caller-side | D-003 |
| Remote processes/ports are `unknown` (session-tree attribution is a local-PTY concept) | D-010 |
| `~/.ssh/config` aliases are not resolved | D-009 |
| Local exec timeout kills the process but not its process group; the SSH supervisor kills the group | D-031 |
| A WSL provider exists upstream but is not registered here | D-011 |

## Why identity is a convention (D-005)

World-scoped resource identity is enforced by convention plus tests rather than by the type system.
The pairs are spread across many payload shapes. Cognate would be the right place to make this a
first-class rule; until then, the tests are the guard.

## Source trail

- `src/app/worlds.ts` — `createExecutionWorlds`, `sshAuthOf`, `hostKeyPolicyOf`, the observer
- `src/agents/execute.ts:48-77` — world resolution, containment, `worldId` passed to `process.exec`
- `src/semantic/contracts.ts:82-98` — `WorldProvenance`, `WorldSnapshot`
- `src/focus/search.ts` — world-scoped search and `crossWorld: false`
- `test/architecture.test.ts:77-83` — no provider reference in the semantic layer
- `test/journeys/journey-j2-worlds.test.ts` — same command, two worlds, distinct resources
- `test/conformance/worlds.test.ts` — providers describe themselves without leaking credentials
- `src/semantic/concepts.ts:129-137` — `concept:worlds.execution-worlds`