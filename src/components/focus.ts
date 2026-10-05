// The `focus.search` capability component: Syntelligent Search as a Cognate capability so agents,
// the cockpit, and WebMCP all invoke the SAME deterministic planner through policy-checked
// invocation. One capability for every execution world — worldId selects the world's process port.
// This is mechanism/retrieval only; it does not write focus state (that is agent.focus + authority).
import type { Component } from "@cognate/kernel-api";
import type { SearchOutcome, SearchRequest } from "../focus/search.ts";

export const FOCUS_SEARCH_CAPABILITY = "focus.search";
export const FOCUS_SEARCH_VERSION = "1.0.0";

/** Input to the search capability — a semantic request, world-scoped. */
export interface FocusSearchInput extends SearchRequest {
  readonly worldId: string;
  /** Optional focused-execution context for evidence-first search (why did this fail). */
  readonly execution?: { readonly executionId: string; readonly command: string; readonly exitCode: number | null; readonly affected: readonly string[] };
}

export interface FocusServices {
  /** Run Syntelligent Search in the given world (the app supplies the world's process port). */
  search(input: FocusSearchInput): Promise<SearchOutcome>;
}

export function focusComponent(services: FocusServices): Component {
  const contract = { id: FOCUS_SEARCH_CAPABILITY, version: FOCUS_SEARCH_VERSION };
  return {
    id: "gsterm:focus",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (raw): Promise<SearchOutcome> => {
        return services.search((raw ?? {}) as FocusSearchInput);
      });
    },
  };
}
