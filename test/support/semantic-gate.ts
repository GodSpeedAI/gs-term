// Semantic-gate policy shared by every test that needs the native substrate.
//
// Two validation levels (Phase 3.6):
//   developer  — missing semantic dependencies SKIP honestly (console reason);
//   release    — GSTERM_REQUIRE_SEMANTIC=1 turns the same missing dependency
//                into a THROW: a release gate may never silently skip.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverHelperBinary } from "../../src/mechanisms/semantic-helper.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export interface SemanticDeps {
  readonly ready: boolean;
  readonly reason?: string;
}

/**
 * The dependencies the semantic proofs need. `scope: "helper"` checks only the
 * Rust helper; `"full"` (default) also requires the SolidLSP bridge environment.
 */
export function semanticDependencies(scope: "helper" | "full" = "full"): SemanticDeps {
  const helper = discoverHelperBinary("", REPO_ROOT);
  if (helper === undefined) {
    return { ready: false, reason: "gsterm-semantic not built (run scripts/bootstrap.sh)" };
  }
  if (scope === "helper") return { ready: true };
  if (!existsSync(resolve(REPO_ROOT, "solidlsp/pyproject.toml"))) {
    return { ready: false, reason: "solidlsp/ project missing" };
  }
  if (!existsSync(resolve(REPO_ROOT, "solidlsp/.venv"))) {
    return { ready: false, reason: "solidlsp/.venv missing (run: cd solidlsp && uv sync)" };
  }
  return { ready: true };
}

/**
 * Returns a skip reason in developer mode, or THROWS in release mode
 * (GSTERM_REQUIRE_SEMANTIC=1). `undefined` means: run the test.
 */
export function semanticSkipOrThrow(context: string, scope: "helper" | "full" = "full"): string | undefined {
  const deps = semanticDependencies(scope);
  if (deps.ready) return undefined;
  if (process.env.GSTERM_REQUIRE_SEMANTIC === "1") {
    throw new Error(`release gate [${context}]: required semantic mechanism unavailable — ${deps.reason}`);
  }
  return deps.reason;
}
