# How to add a capability

**Goal:** add a new named, policy-checked capability, bind it to a semantic object, and expose it to
surfaces.

**Prerequisites:** a semantic id in `domain/interaction-model.sea` (or a deliberate decision to leave
the capability unbound), and familiarity with [capability-components.md](../subsystems/capability-components.md).

## Procedure

### 1. Write the contracts

Add the input shape and validation next to the component. Validate before any mechanism work:

```ts
interface ThingInput {
  readonly worldId: string;
  readonly query: string;
}

function parseThing(raw: unknown): ThingInput {
  const input = (raw ?? {}) as Partial<ThingInput>;
  if (typeof input.worldId !== "string" || input.worldId === "") throw new Error("thing capability requires worldId");
  if (typeof input.query !== "string" || input.query === "") throw new Error("thing capability requires a non-empty query");
  return { worldId: input.worldId, query: input.query };
}
```

### 2. Declare the contract and provide it

```ts
export const THING_CAPABILITY = "thing.inspect";
export const THING_VERSION = "1.0.0";

export function thingComponent(services: ThingServices): Component {
  const contract = { id: THING_CAPABILITY, version: THING_VERSION };
  return {
    id: "gsterm:thing",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (raw) => {
        const input = parseThing(raw);
        return services.thing(input);
      });
    },
  };
}
```

Translate between mechanism and semantic conventions here if needed (LSP is 0-based; semantic
positions are 1-based — see `src/components/code.ts`).

### 3. Bind it explicitly

In `src/app/bindings.ts`, add the capability id/version to the bindings array and, if it should carry
a semantic identity, add the id to the required set so a missing model object fails loudly:

```ts
const required = new Set([..., SEMANTIC_ID_THING]);
```

`bindCapabilities` is called in exactly one place by design; a test enforces it. If your capability
has no semantic object, simply omit the binding — an unbound capability has no `semanticRef`, which
is valid.

### 4. Grant it

In `src/app/policy.ts`, add the id to `GRANTED_CAPABILITIES`. Skipping this step means every caller
is denied with `capability <id> is not granted to this application`.

### 5. Register the component

In `src/app/runtime.ts`, add it to the `components` array. Pass the semantic ref if you bound one:

```ts
thingComponent({
  async thing(input) {
    const provider = worlds.registry.get(input.worldId);
    const root = worlds.roots[input.worldId];
    if (!root) throw new Error(`no workspace root for world ${input.worldId}`);
    return doTheThing(provider.process, root, input.query);
  },
}),
```

### 6. Expose it to surfaces

Add a descriptor in `src/webmcp/descriptors.ts` and a method on `ToolInvoker`, then implement it in
`src/ui/invoker.ts` (usually by starting an `agent.focus` intent, or a new agent). See
[add-a-webmcp-tool.md](add-a-webmcp-tool.md).

**Do not** call mechanism code from an agent. Agents invoke capabilities.

### 7. Validate

```bash
bun run typecheck
bun run test                 # architecture invariants + your tests
bash scripts/verify-all.sh   # the full gate
```

Add tests for: input rejection, the mechanism path, world scoping, and policy denial for an
unrecognised actor.

## Implementation locations

| Concern | File |
| --- | --- |
| component + contract | `src/components/*.ts` |
| binding | `src/app/bindings.ts` |
| grant | `src/app/policy.ts` |
| registration | `src/app/runtime.ts` |
| surface projection | `src/webmcp/descriptors.ts`, `src/ui/invoker.ts` |
| mechanism | `src/observers/*`, `src/mechanisms/*`, `src/focus/*` |

## Common failure symptoms

| Symptom | Cause |
| --- | --- |
| Every caller denied | missing `GRANTED_CAPABILITIES` entry |
| Startup aborts | the capability's semantic id was added to `required` but is absent from the model |
| `bindCapabilities is called in exactly one place` test fails | you called it from a new module |
| Direct mechanism access from a test only | the capability is not reachable; check the component is registered |

## Rollback

Remove the descriptor first (surfaces stop offering it), then the grant, then unregister the
component. Leave the binding in place if you may return; nothing else depends on it once the grant is
gone.