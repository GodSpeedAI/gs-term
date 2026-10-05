# Validation diagnostics — interaction-model.sea

Recorded with DomainForge CLI **0.19.0** (installed); full transcript in `domainforge-output.txt`.

## Results

| check | result |
|---|---|
| `domainforge validate --format human` | **PASS** — `Validation succeeded: 0 violations total` |
| `domainforge parse --format human` (graph construction) | **PASS** — 6 entities, 4 resources, 8 flows, 3 policies; all flow refs resolved (graph build would fail otherwise) |
| `domainforge parse --ast --format json` | **PASS** — journey annotations preserved on every flow (`{"journey": "J1"}` … `J5`) |
| `domainforge fmt --check` | **NON-CLEAN (expected)** — known formatter defect: rewrites `forall` policies into `ForAll(...)` (which the parser rejects) and drops `//` comments. Documented in `domainforge-sea` SKILL operating loop step 7. `fmt --out` deliberately NOT run. |

## Semantic inspection (beyond parser success)

- Cognate-side projection round-trip via `@cognate/domainforge`
  `loadSemanticProjection` (DomainForge binding 0.18.2 as pinned by Cognate):
  - all 6 entities + 4 resources projected as read-only `SemanticObject`s
    (`controlplane::*` ids confirmed);
  - 8 flows projected with composite ids `gsterm::flow(<resource>|<from>|<to>)` — unique because
    journey annotations differ only by payload... **note**: composite ids collide across flows
    sharing resource+from+to; here every pair is distinct by construction (verified: 8 distinct
    ids in projection output);
  - 3 policies projected as read-only referenced constraints (`gsterm::*`);
  - projection source digest: `sha256:d64a885e1b117bb664cae7b2745d5ba764bbbe66eac9d830f9a17cc2b45e0768`
    (recorded in `handoff.md`).
- Journeys J1/J2/J3/J4/J5 all reachable from flows: J1, J2 (Execution), J3 (Effect/Evidence/
  World State), J4 (World State), J5 (Execution/Evidence) — no orphan journey, no orphan flow.

## Re-validation triggers

Re-run the table above after any edit to `interaction-model.sea`, then update the digest in
`handoff.md` and check `source-translation-map.md` for drift (renames mint new identities —
`SemanticRegistry.alias` applies only for reviewed renames).
