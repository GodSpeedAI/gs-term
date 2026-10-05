// Dynamic affordance reduction (Phase 3): show only the operations that matter for what is
// focused. Affordances map to precise semantic operations (capability ids) — never DOM paths.
import type { Affordance, EntityRef } from "../semantic/focus.ts";

/** The useful next actions for a focused entity, by kind. */
export function affordancesFor(entity: EntityRef): Affordance[] {
  const t = entity;
  switch (entity.kind) {
    case "CodeSymbol":
      return [
        { id: "definition", label: "Go to definition", operation: "code.definition", target: t },
        { id: "references", label: "Trace references", operation: "code.references", target: t },
        { id: "related-tests", label: "Related tests", operation: "test.related", target: t },
        { id: "diagnostics", label: "Diagnostics", operation: "code.diagnostics", target: t },
      ];
    case "Execution":
      return [
        { id: "inspect-evidence", label: "Inspect evidence", operation: "evidence.inspect", target: t },
        { id: "affected-resources", label: "Affected resources", operation: "effect.affected", target: t },
        { id: "rerun", label: "Rerun", operation: "execution.rerun", target: t },
      ];
    case "ListeningPort":
      return [
        { id: "owning-process", label: "Owning process", operation: "process.inspect", target: t },
        { id: "opening-execution", label: "Opening execution", operation: "execution.inspect", target: t },
      ];
    case "GitChange":
      return [
        { id: "diff", label: "Diff", operation: "git.diff", target: t },
        { id: "affected-tests", label: "Affected tests", operation: "test.related", target: t },
      ];
    case "Test":
      return [
        { id: "run", label: "Run test", operation: "test.run", target: t },
        { id: "related", label: "Related code", operation: "code.references", target: t },
      ];
    case "Diagnostic":
      return [
        { id: "definition", label: "Go to cause", operation: "code.definition", target: t },
        { id: "affected-tests", label: "Affected tests", operation: "test.related", target: t },
      ];
    default:
      return [{ id: "inspect", label: "Inspect", operation: "focus.inspect", target: t }];
  }
}
