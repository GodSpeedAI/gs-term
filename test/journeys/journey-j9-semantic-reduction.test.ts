// J9/J10 acceptance proof (Phases 3.5 + 3.6): the REAL semantic substrate —
// the built Rust helper (zvec-grep + zvec concepts) and the SolidLSP bridge —
// running against the gs-term repository itself.
//
// Phase 3.6 durable rule under test: known semantic coordinates outrank symbol
// discovery (coordinate > symbol lookup > textual declaration recovery).
//   A. exact coordinate  — AttentionSnapshot/ referent holds path+line+column;
//      SolidLSP.references executes DIRECTLY; workspaceSymbols and rg
//      declaration recovery are never invoked (proved via receipt stages).
//   B. name-only         — recovery chain: workspaceSymbols → (tolerated cold)
//     → rg position finder → document warm-up → SolidLSP references.
//   C. partial coordinate— file+line known, column absent → file-local
//      refinement → SolidLSP references (no workspace-wide discovery).
//   J10. conceptual query reduces 169 files to ≤5; architecture questions stop
//      at the concept layer.
// Skip discipline: developer mode skips honestly; GSTERM_REQUIRE_SEMANTIC=1
// (release/CI oracle) makes a missing substrate a FAILURE, not a skip.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import { json } from "../../src/agents/shared.ts";
import { REPO_ROOT, semanticSkipOrThrow } from "../support/semantic-gate.ts";

const webmcp: Caller = { tenant: "local", actor: { id: "webmcp", kind: "user" } };

let app: GsTermRuntime | undefined;
let skipReason: string | undefined;

function config(): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root: REPO_ROOT },
    session: { id: "main", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {},
  };
}

interface StageRecord {
  readonly name: string;
  readonly mechanism?: string;
  readonly candidates: number;
}

interface OutcomeShape {
  readonly results: readonly { entity: { id: string; name?: string; location?: { path?: string; line?: number } }; reason: string; mechanisms: readonly string[] }[];
  readonly receipt: { stages: readonly StageRecord[]; availability: { name: string; status: string }[]; reduction: Record<string, number>; provenance: { method: string; crossWorld: boolean } };
}

async function search(caller: Caller, query: string, options: { referent?: Record<string, unknown> } = {}): Promise<{ outcome: OutcomeShape; elapsedMs: number }> {
  const started = Date.now();
  const run = await app!.runtime.service.startRun(caller, {
    agent: "agent.focus",
    input: json({
      intent: "search",
      query,
      sessionId: "main",
      worldId: "local",
      ...(options.referent ? { referent: options.referent } : {}),
    }),
    idempotencyKey: crypto.randomUUID(),
    correlationId: "focus:main",
  });
  // Long deadline: the first start provisions the TypeScript language server.
  const deadline = Date.now() + 420_000;
  for (;;) {
    await app!.runtime.idle(50).catch(() => undefined);
    const state = await app!.runtime.service.getRun(caller, { runId: run.runId });
    if (state.status === "completed") {
      const elapsedMs = Date.now() - started;
      console.log(`query "${query}" (${caller.actor.id}) settled in ${elapsedMs}ms`);
      return { outcome: state.output as unknown as OutcomeShape, elapsedMs };
    }
    if (state.status === "failed" || state.status === "cancelled") {
      throw new Error(`search run failed: ${(state as { error?: string }).error ?? state.status}`);
    }
    if (Date.now() > deadline) throw new Error("search run timed out");
    await Bun.sleep(120);
  }
}

/** The true 1-based line and 0-based column of a symbol's export in the live source. */
async function trueDeclaration(relativePath: string, name: string): Promise<{ line: number; column: number }> {
  const lines = (await Bun.file(resolve(REPO_ROOT, relativePath)).text()).split("\n");
  const index = lines.findIndex((line) => line.includes(`function ${name}`) || line.includes(`const ${name}`) || line.includes(`class ${name}`));
  if (index < 0) throw new Error(`declaration of ${name} not found in ${relativePath}`);
  return { line: index + 1, column: lines[index]!.indexOf(name) };
}

beforeAll(async () => {
  skipReason = semanticSkipOrThrow("journey-j9/j10 semantic acceptance");
  if (skipReason) {
    console.log(`SKIP: ${skipReason}`);
    return;
  }
  app = await createGsTermRuntime({ config: config(), store: ":memory:", domainRoot: REPO_ROOT });
});

afterAll(async () => {
  await app?.close();
});

describe("J9 — / who calls this? (coordinate-first, Phase 3.6)", () => {
  test("A: exact semantic coordinate → SolidLSP.references directly; NO workspaceSymbols, NO rg recovery (webmcp caller)", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    const declaration = await trueDeclaration("src/focus/search.ts", "syntelligentSearch");
    // The focused CodeSymbol carries its true semantic coordinate.
    const { outcome, elapsedMs } = await search(webmcp, "who calls this?", {
      referent: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: `src/focus/search.ts:${declaration.line}`, name: "syntelligentSearch", location: { path: "src/focus/search.ts", line: declaration.line, column: declaration.column + 1 } },
    });
    expect(outcome.receipt.availability.find((a) => a.name === "solidlsp")?.status).toBe("ready");
    const stageNames = outcome.receipt.stages.map((stage) => stage.name);
    // The coordinate was spent, not rediscovered.
    expect(stageNames).toContain("attention-coordinate");
    expect(stageNames).not.toContain("workspace-symbol-resolution");
    expect(stageNames).not.toContain("declaration-position-fallback");
    const semanticStage = outcome.receipt.stages.find((stage) => stage.name === "semantic-references");
    expect(semanticStage?.candidates).toBeGreaterThan(0);
    // True caller found; bounded; world provenance preserved.
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.length).toBeLessThanOrEqual(5);
    expect(outcome.results.every((result) => result.mechanisms.includes("solidlsp"))).toBe(true);
    expect(outcome.results.some((result) => result.entity.location?.path === "src/app/runtime.ts")).toBe(true);
    expect(outcome.receipt.provenance.crossWorld).toBe(false);
    console.log(`A exact-coordinate latency: ${elapsedMs}ms (stages: ${stageNames.join(" → ")})`);
  }, 480_000);

  test("B: name-only recovery — workspaceSymbols → (cold tolerated) → rg position → warm-up → SolidLSP references", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    const { outcome, elapsedMs } = await search(webmcp, "who calls syntelligentSearch?", {
      referent: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: "syntelligentSearch", name: "syntelligentSearch" },
    });
    expect(outcome.receipt.availability.find((a) => a.name === "solidlsp")?.status).toBe("ready");
    // The final answer is semantic, never a lexical stand-in.
    const semanticStage = outcome.receipt.stages.find((stage) => stage.name === "semantic-references");
    expect(semanticStage?.candidates).toBeGreaterThan(0);
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.every((result) => result.mechanisms.includes("solidlsp"))).toBe(true);
    expect(outcome.results.some((result) => result.entity.location?.path === "src/app/runtime.ts")).toBe(true);
    // The recovery chain is visible in provenance (which leg ran is environment-dependent:
    // a warm project may satisfy workspaceSymbols; a cold one falls to rg + warm-up).
    const stageNames = outcome.receipt.stages.map((stage) => stage.name);
    expect(stageNames).not.toContain("attention-coordinate");
    console.log(`B name-only latency: ${elapsedMs}ms (stages: ${stageNames.join(" → ")})`);
  }, 480_000);

  test("C: partial coordinate (file+line, no column) → document refinement → SolidLSP references", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    const declaration = await trueDeclaration("src/focus/search.ts", "syntelligentSearch");
    const { outcome, elapsedMs } = await search(webmcp, "who calls this?", {
      referent: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: `src/focus/search.ts:${declaration.line}`, name: "syntelligentSearch", location: { path: "src/focus/search.ts", line: declaration.line } },
    });
    const stageNames = outcome.receipt.stages.map((stage) => stage.name);
    expect(stageNames).toContain("document-refinement");
    expect(stageNames).not.toContain("workspace-symbol-resolution");
    expect(stageNames).not.toContain("declaration-position-fallback");
    expect(outcome.receipt.stages.find((stage) => stage.name === "semantic-references")?.candidates).toBeGreaterThan(0);
    expect(outcome.results.some((result) => result.entity.location?.path === "src/app/runtime.ts")).toBe(true);
    console.log(`C partial-coordinate latency: ${elapsedMs}ms`);
  }, 480_000);
});

describe("J10 — conceptual query reduction (no literal overlap required)", () => {
  test("agent-focus-takeover question reduces to a bounded semantic slice", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    // Wording chosen to NOT appear in the implementation.
    const { outcome } = await search(webmcp, "where do we stop an agent from taking over what the human is looking at?");
    expect(outcome.receipt.availability.find((a) => a.name === "zvec")?.status).toBe("ready");
    expect(outcome.receipt.availability.find((a) => a.name === "zvec-grep")?.status).toBe("ready");
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.length).toBeLessThanOrEqual(5);
    // The concept layer must participate and the funnel is recorded.
    expect(outcome.receipt.stages.some((stage) => stage.name === "concept-retrieval")).toBe(true);
    expect(typeof outcome.receipt.reduction.workspace).toBe("number");
    console.log("reduction:", JSON.stringify(outcome.receipt.reduction));
    console.log("stages:", JSON.stringify(outcome.receipt.stages.map((stage) => `${stage.name}:${stage.candidates}`)));
  }, 480_000);

  test("architecture question stops at concepts without source retrieval", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    const { outcome } = await search(webmcp, "give me an overview of the observation architecture");
    expect(outcome.receipt.stages.some((stage) => stage.name === "concept-retrieval")).toBe(true);
    expect(outcome.receipt.stages.some((stage) => stage.mechanism === "zvec-grep")).toBe(false);
    expect(outcome.results.length).toBeGreaterThan(0);
  }, 480_000);
});
