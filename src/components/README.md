# src/components

Cognate `Component`s that provide gs-term's capabilities:

- `observersComponent` → `world.snapshot` (evidence gathering, one capability for every world)
- `focusComponent` → `focus.search` (Syntelligent Search, world-scoped)
- `codeComponent` → `code.definition` / `code.references` / `code.implementations` /
  `code.diagnostics` (SolidLSP-backed, local world only)

Canonical documentation: [docs/subsystems/capability-components.md](../../docs/subsystems/capability-components.md).