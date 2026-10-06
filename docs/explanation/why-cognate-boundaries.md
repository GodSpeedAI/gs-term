# Why the semantic layer sits above Cognate, not inside it

## The question

`AGENTS.md` forbids parallel application-local implementations of Cognate primitives. That is an
unusual constraint on an application repository. Why?

## The reasoning

gs-term is not a consumer of a library; it is a demonstration that Cognate *models a real
computational environment*. If the repository carried its own event bus, policy engine, capability
registry, tool registry or agent registry, it would no longer demonstrate anything — it would
demonstrate a parallel framework that happens to import Cognate.

So the rules are:

| Rule | Enforced by |
| --- | --- |
| mechanism files import no `@cognate/*` | `test/architecture.test.ts` |
| no local `CapabilityRegistry`, `PolicyEngine`, `ToolRegistry`, `EventBus`, `SemanticEventLedger`, `AgentToolRegistry` | `test/architecture.test.ts` |
| `bindCapabilities` is called in exactly one place | `test/architecture.test.ts` |
| the semantic layer never names a provider | `test/architecture.test.ts` |

These are executable, which is the point. A rule that lives only in a Markdown file decays.

## What gs-term owns versus what Cognate owns

| Cognate owns | gs-term owns |
| --- | --- |
| the event log and its durability | which events to emit, and what they mean |
| runs, agent execution, cancellation | which journeys exist and what they do |
| projections and checkpoints | the `executions` fold and its key discipline |
| shared thread state with versioning | which threads exist and what they hold |
| kernel `Policy` and the action surface | the specific grants and rules |
| capability invocation and semantic refs | which capabilities exist and what they do |
| the Connect transport | the HTTP/WS surface around it |
| execution-world providers | which worlds are registered, with which roots |

Cognate is generic; gs-term is specific. The application supplies configuration, bindings and
mechanism implementations, not framework substitutes.

## The layering follows from this

```
src/terminal, src/shell, src/observers   mechanism — knows nothing about Cognate
src/semantic                              pure contracts — no framework, no I/O
src/focus                                 deterministic reduction — no framework
src/components                            capabilities — @cognate/kernel-api only
src/bridge                                the one crossing point
src/agents                                journeys — @cognate/runtime-api
src/app                                   composition, worlds, policy, bindings
src/server                                transports
```

Two module families carry explicit purity rules:

- `src/semantic/*.ts` — "pure data shapes, no framework, no I/O". Contracts, effect derivation,
  observation builders, focus shapes, the concept registry.
- `src/observers/*` and `src/terminal/*` — mechanism, so no `@cognate/*`.

Purity in `src/semantic/` is what makes effects, observations and focus transitions directly unit
testable without a runtime.

## When a gap is found

The decision procedure in `AGENTS.md`: is the gap a *general Cognate concern* or an
*application-specific mechanism*?

Worked examples from this repository:

| Gap found | Where it went |
| --- | --- |
| no first-class observation ingest | upstream — Cognate gained `RuntimeService.observe`; gs-term now calls it (resolved, D-001) |
| kernel `Policy` cannot distinguish worlds | upstream candidate — not worked around (D-002) |
| `process.exec` does not canonicalise `cwd` | worked around caller-side with `resolveLocal`, and recorded (D-003) |
| focus needs reduction and receipts | application — genuinely specific to this product |
| SolidLSP needs a Bun shim | application mechanism — the shim is the smallest thing that works |

`.agents/DEBT.md` records each case with its owner and status. That ledger is the mechanism by which
"we could have worked around it but chose not to" stays visible.

## What this buys

- **The tests mean something.** A boundary invariant that is enforced cannot quietly erode.
- **Upstream improvements arrive for free.** When Cognate gains a primitive, gs-term deletes code
  instead of maintaining a parallel one.
- **The demo stays honest.** A newcomer reading this repository sees Cognate used as intended, not
  decorated.

## Source trail

- `AGENTS.md` — the mandatory Cognate workflow and the duplication ban
- `test/architecture.test.ts` — the executable invariants
- `src/app/bindings.ts` — the single binding site
- `src/app/runtime.ts` — hand-composed runtime (documented alternative to profiles)
- `.agents/DEBT.md` — the ledger, including upstream candidates D-001, D-002, D-003