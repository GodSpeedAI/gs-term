# Limitations — `.sea` representation compromises

Recorded per `deriving-interaction-domain-models` step 6 (nearest-valid-representation rule; the
grammar was NOT extended):

1. **Journeys are carried as flow annotations** (`@journey "J1"`), not first-class grammar
   elements. `.sea` has no journey primitive; the Flow + annotation form is the nearest valid
   representation. The catalog (`canonical-journey-catalog.md`) owns journey semantics; the model
   owns the ontology and transform edges.
2. **Actor entities double as journey roles.** Roles/Relations grammar exists (`Role`,
   `Relation` with `subject/predicate/object/via`), but v0 journeys each have a single initiating
   actor and no counterparty-role predicate; declaring unused roles would invent structure.
   Decision: entities `Operator`/`Automation`/`Observer` are the actors; their *roles* are named
   per journey in the catalog. Revisit when a two-role predicate appears (e.g. D2 approval
   patterns) — then declare `Role`s and `Relation`s.
3. **Referenced policies with `as: true` bodies** (`evidence_accompanies_effects`,
   `machine_authority_is_explicit`): SEA policy evaluation is over graph data (quantified flow
   constraints); runtime authority/evidence invariants are not graph properties. They are
   declared as referenced constraints — Cognate never evaluates them (spec behavior) — and the
   runtime checks carrying these names live in app code, named after their `.sea` declarations.
   `every_journey_flow_carries_unit` is a genuine graph constraint and is machine-checked.
4. **Effect/evidence structures are not representable in `.sea`** (no schema primitive for JSON
   shapes); their schemas are fixed in `handoff.md` and enforced in tests.
5. **Instances omitted.** The concrete local world (`world:local`) is configuration, not domain
   meaning; modeling it would hard-code a provider (contradicts D1).
6. **Formatter defect** prevents `fmt --check` cleanliness (see `diagnostics.md`); hand-formatting
   follows the formatter's style where it doesn't conflict with comments/quantifiers.
