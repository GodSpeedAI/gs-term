# How to add a WebMCP tool

**Goal:** expose an existing capability to a browser's model context, without writing a second
implementation.

**Prerequisites:** the capability exists and is granted. See
[add-a-capability.md](add-a-capability.md) if it does not.

## The rule

WebMCP tools are **projections of capability descriptors**. There is exactly one registration path
(`src/webmcp/project.ts`) and exactly one invoker (`src/ui/invoker.ts`). A test fails the build if
`registerTool` appears anywhere else.

## Procedure

### 1. Decide the tool's shape

- `name`: stable, snake_case, domain meaning, no mechanism vocabulary.
- `description`: what it does in domain terms, plus an honest availability note if it is not always
  available.
- `inputSchema`: what a machine caller needs. Prefer semantic concepts over implementation details.

### 2. Extend `ToolInvoker`

In `src/webmcp/descriptors.ts`, add a method with a `source` parameter so the surface is recorded:

```ts
export interface ToolInvoker {
  // …
  thingInspect(args: { readonly query: string; readonly worldId?: string }, source: "ui" | "webmcp"): Promise<Json>;
}
```

### 3. Add the descriptor

```ts
export const CAPABILITY_DESCRIPTORS: readonly ToolDescriptor[] = [
  // …
  {
    name: "thing_inspect",
    description:
      "Inspect a thing in the workspace execution world (capability-backed). Positions are 1-based. Unavailable for remote worlds and when the mechanism is not mounted — use focus_search then.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "what to inspect" },
        worldId: { type: "string", description: "execution world id (input property, not a provider)" },
      },
      required: ["query"],
    },
    invoke: async (invoker, args) => {
      if (typeof args.query !== "string" || args.query === "") return toContent({ error: "query must be a non-empty string" });
      return toContent(await invoker.thingInspect({ query: args.query, ...(typeof args.worldId === "string" ? { worldId: args.worldId } : {}) }, "webmcp"));
    },
  },
];
```

Validate arguments **before** invoking, and return a structured error rather than throwing — a
malformed call must have no side effects.

### 4. Implement it in the shared invoker

In `src/ui/invoker.ts`, add the method. Two shapes are normal:

- a **read**: go through the client directly (`threadSharedState`, `readProjection`, `events`);
- an **action**: start an agent run, typically a new `agent.focus` intent so the agent owns the
  semantics.

```ts
async thingInspect(args, source) {
  return json(await client.startRun("agent.focus", json({
    intent: "thing", query: args.query, worldId: args.worldId ?? meta.worldId,
  }), { idempotencyKey: `thing:${…}` }).then((r) => client.run(r.runId).get().output));
}
```

The `source` argument becomes `surfaceFor(source)` → `cockpit` or `webmcp`. That is the only
difference between a cockpit button and a browser tool, and it is why the two doors converge.

### 5. It appears automatically

Boot reads `CAPABILITY_DESCRIPTORS` for `/api/meta` and `projectCapabilitiesToWebMCP` registers all of
them. No registration code needed. If registration fails, the failure is reported in the boot log
and the other tools still register.

## Do not expose human-only operations

There is deliberately **no** tool for accepting, pinning or rejecting a focus proposal. The action
policy would deny it, but advertising it would be a lie. `test/webmcp/webmcp-projection.test.ts`
asserts its absence.

## Common failure symptoms

| Symptom | Cause |
| --- | --- |
| Tool not registered | boot threw before projection; check the console warning |
| One tool missing, others present | that descriptor's `registerTool` threw; listed in `result.failed` |
| Tool throws a policy denial | capability not in `GRANTED_CAPABILITIES`, or the action is human-only |
| Wrong `source` on the execution | the invoker passed a literal instead of the `source` argument |
| `registerTool is only allowed in webmcp/project.ts` test fails | you registered somewhere else |

## Validate

```bash
bun run test          # test/webmcp/webmcp-projection.test.ts
bun run e2e           # acceptance D exercises WebMCP in a real browser
```

Add a test that registers the tool through `projectCapabilitiesToWebMCP`, invokes it with the shared
invoker, and asserts invalid input is rejected without side effects.

## Related

- [webmcp.md](../subsystems/webmcp.md)
- [webmcp-tools.md](../reference/webmcp-tools.md)