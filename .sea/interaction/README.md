# gs-term interaction domain model (canonical)

This directory is the **canonical semantic source** for gs-term. Everything downstream (runtime
composition, capability bindings, agents, projections, WebMCP projection, cockpit, tests) projects
from here; nothing here depends on implementation code.

## Files

| file | role |
|---|---|
| `interaction-model.sea` | the model: entities, resources, journey flows (`@journey` ids), referenced policies |
| `canonical-journey-catalog.md` | J1–J5 journeys in full + deferred seams D1–D5 (**no journey is built unless catalogued here**) |
| `source-translation-map.md` | every material statement of the evidence traced to model concepts |
| `assumptions-and-unknowns.md` | A1–A10 assumptions, U1–U5 unknowns, contradiction records |
| `handoff.md` | model → Cognate bindings, agents, event vocabulary, authority, test traceability |
| `validation/` | DomainForge commands, outputs, diagnostics, limitations |

## Grammar/authoring authority

`.sea` syntax and CLI usage come from the `domainforge-sea` skill (bundled references), verified
against the installed `domainforge` CLI 0.19.0. The model never uses undeclared constructs.

## How to re-validate

```bash
domainforge validate --format human .sea/interaction/interaction-model.sea
domainforge parse --format human .sea/interaction/interaction-model.sea
```

`domainforge fmt --check` is expected to be non-clean on this file: the formatter rewrites
`forall` policies and drops `//` comments (known formatter defect, `domainforge-sea` SKILL).
**Do not run `fmt --out` on this file.**

## Re-export

`domain/interaction-model.sea` symlinks here so `cognate dev`/`loadSemanticProjection` consumers
read one source of truth (decision per `handoff.md`).

## Interaction grammar summary (downstream orientation)

- **Fundamental nouns:** six entities (actors `Operator`/`Automation`/`Observer`; structures
  `Terminal Session`/`Execution World`/`Cockpit`) and four resources (`Execution`, `Effect`,
  `Evidence`, `World State`), all in domain `controlplane`.
- **Fundamental verbs:** the eight journey flows — each is *resource movement from one entity to
  another*, carrying `@journey` back to the catalog. Canonical distinction: **how an execution
  entered** (J1 observed-through-session vs J2 issued-by-automation) is a *variant dimension of
  one journey kind*, never a separate ontology; the WebMCP surface (J2-W) is a further
  specialization of J2 by actor/surface, expressed as metadata (`source`).
- **Composition:** J1/J2 settle → J3 reconciles world state → J5 inspects; J4 is the surface
  lifecycle around J1. Everything an operator sees in the cockpit is a projection of
  J1–J3 outcomes (never UI-authored truth).
- **Canonical vs projection:** the `.sea` + this catalog are canonical; terminals, WebMCP tools,
  cockpit panels, and client state are projections/binding surfaces. Implementation-layer
  concepts (PTY bytes, WebSocket frames, xterm buffers, `/proc`, `ss`) are mechanism and appear
  only as *evidence methods* (`how`), never as model elements.
- **Variation dimensions preserved:** execution source (`pty`|`ui`|`webmcp`), observed-vs-unknown
  (U1–U5), settled-vs-unsettled observation, world kind (v0 `local`; D1 seam).
- **What the policies mean:** one machine-checked graph constraint; two referenced runtime
  invariants (named checks in app code) — see `validation/limitations.md`.

## Canonicality conclusion

> The Interaction Domain Model is sufficiently stable to serve as the canonical semantic source
> for downstream projections.

