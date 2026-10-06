// Semantic routing tests (Phase 3.5): the planner's intent dispatch against a
// FAKE substrate — no native processes here (integration lives in
// test/mechanisms/). Asserts the reduction contract: which stages ran, in what
// order, and which did NOT run (never claiming an unrun stage).
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntelligentSearch, type SearchContext } from "../../src/focus/search.ts";
import type { SemanticHelper, ConceptMatch, ZgSearchItem } from "../../src/mechanisms/semantic-helper.ts";
import type { SolidLspBridge, SolidLspLocation } from "../../src/mechanisms/solidlsp.ts";
import type { SemanticSubstrate } from "../../src/mechanisms/substrate.ts";
import type { MechanismAvailability, StructuralMap } from "../../src/semantic/focus.ts";

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeCalls {
  readonly helper: string[];
  readonly solidlsp: string[];
  readonly rg: string[];
}

function fakeHelper(calls: FakeCalls, options: { startFails?: boolean; concepts?: readonly ConceptMatch[]; items?: readonly ZgSearchItem[]; failSearch?: boolean } = {}): SemanticHelper {
  return {
    get running() {
      return true;
    },
    async ensureStarted(): Promise<void> {
      if (options.startFails) throw new Error("start refused");
    },
    async modelStatus() {
      return { reference: "local/potion-code-16m-v2", ready: true, path: "/fake", dimension: 256, revision: "e9d2a44c" };
    },
    async conceptQuery(_store: string, _text: string, _topk: number): Promise<{ items: readonly ConceptMatch[] }> {
      calls.helper.push("conceptQuery");
      return { items: options.concepts ?? [] };
    },
    async zgSearch(_params: { root: string; query: string; mode: string; limit?: number }): Promise<{ source: string; coverage: string; items: readonly ZgSearchItem[] }> {
      calls.helper.push("zgSearch");
      if (options.failSearch) throw new Error("zg search failed");
      return { source: "index", coverage: "ranked_sample", items: options.items ?? [] };
    },
  } as unknown as SemanticHelper;
}

function fakeSolidLsp(calls: FakeCalls, options: { symbols?: readonly unknown[]; documentSymbols?: readonly unknown[]; references?: readonly SolidLspLocation[]; definitions?: readonly SolidLspLocation[] } = {}): SolidLspBridge {
  return {
    async ensureStarted(): Promise<void> {
      calls.solidlsp.push("ensureStarted");
    },
    async ready(): Promise<{ running: boolean }> {
      return { running: true };
    },
    async startWorkspace(_workspace: string, _dataDir?: string): Promise<{ ready: boolean; workspace: string }> {
      calls.solidlsp.push("startWorkspace");
      return { ready: true, workspace: _workspace };
    },
    async symbols(_file: string): Promise<readonly unknown[]> {
      calls.solidlsp.push("symbols");
      return options.documentSymbols ?? [];
    },
    async workspaceSymbols(_query: string): Promise<readonly unknown[]> {
      calls.solidlsp.push("workspaceSymbols");
      return options.symbols ?? [];
    },
    async references(_file: string, _line: number, _column: number): Promise<readonly SolidLspLocation[]> {
      calls.solidlsp.push("references");
      return options.references ?? [];
    },
    async definition(_file: string, _line: number, _column: number): Promise<readonly SolidLspLocation[]> {
      calls.solidlsp.push("definition");
      return options.definitions ?? [];
    },
  } as unknown as SolidLspBridge;
}

function fakeSubstrate(helper?: SemanticHelper, solidlsp?: SolidLspBridge): SemanticSubstrate {
  return {
    enabled: helper !== undefined || solidlsp !== undefined,
    dataDir: "/fake",
    helper: helper ?? ({} as SemanticHelper),
    solidlsp: solidlsp ?? ({} as SolidLspBridge),
    helperFor: (worldId: string) => (worldId === "local" ? helper : undefined),
    solidlspFor: (worldId: string) => (worldId === "local" ? solidlsp : undefined),
    readiness: async () => [],
    dispose: async () => undefined,
  };
}

function spawnPort(root: string) {
  return {
    async exec({ argv, cwd }: { argv: readonly string[]; cwd: string }) {
      const proc = Bun.spawnSync({ cmd: [...argv], cwd: cwd || root });
      const stdout = new TextDecoder().decode(proc.stdout);
      const stderr = new TextDecoder().decode(proc.stderr);
      return { argv: [...argv], cwd, stdout, stderr, exitCode: proc.exitCode ?? 0, timedOut: false };
    },
  };
}

function context(root: string, substrate?: SemanticSubstrate): SearchContext {
  return {
    process: spawnPort(root) as unknown as SearchContext["process"],
    root,
    worldId: "local",
    workspace: "ws",
    mounted: new Set(["structural-map"]),
    ...(substrate ? { substrate, conceptStorePath: join(root, "concepts") } : {}),
  };
}

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsterm-planner-"));
  writeFileSync(join(dir, "alpha.ts"), "export function greet(name: string): string {\n  return 'hi ' + name;\n}\n");
  writeFileSync(join(dir, "beta.ts"), "import { greet } from './alpha';\nexport function run(): string {\n  return greet('x');\n}\n");
  return dir;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("planner routing with a substrate", () => {
  test("who-calls-this routes SolidLSP-first; rg is NOT the primary", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(
        fakeHelper(calls),
        fakeSolidLsp(calls, {
          symbols: [{ name: "greet", location: { file: "alpha.ts", start: { line: 0, character: 16 } } }],
          references: [
            { file: "beta.ts", start: { line: 2, character: 9 }, end: { line: 2, character: 14 } },
            { file: "alpha.ts", start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
          ],
        }),
      );
      const outcome = await syntelligentSearch({ query: "who calls greet?", intent: "who-calls-this", referent: { worldId: "local", workspace: "ws", kind: "CodeSymbol", id: "alpha.ts:1", name: "greet" } }, context(root, substrate));
      expect(calls.solidlsp).toContain("workspaceSymbols");
      expect(calls.solidlsp).toContain("references");
      expect(outcome.results.length).toBeGreaterThan(0);
      // Semantic references are the primary answer: 1-based line conversion (LSP line 2 → 3).
      expect(outcome.results.every((result) => result.mechanisms.includes("solidlsp"))).toBe(true);
      expect(outcome.results[0]!.location?.line).toBe(3);
      // rg did not produce the answer.
      expect(outcome.results.some((result) => result.reason.includes("exact lexical"))).toBe(false);
      expect(outcome.receipt.stages.some((stage) => stage.mechanism === "solidlsp" && stage.candidates > 0)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exact semantic coordinate goes straight to references — NO workspaceSymbols, NO rg discovery", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(
        fakeHelper(calls),
        fakeSolidLsp(calls, {
          references: [{ file: "beta.ts", start: { line: 2, character: 9 }, end: { line: 2, character: 14 } }],
        }),
      );
      // The focused CodeSymbol already knows path/line/column (1-based semantic convention).
      const outcome = await syntelligentSearch({ query: "who calls greet?", intent: "who-calls-this", referent: { worldId: "local", workspace: "ws", kind: "CodeSymbol", id: "alpha.ts:1", name: "greet", location: { path: "alpha.ts", line: 1, column: 17 } } }, context(root, substrate));
      // Coordinate > symbol lookup: discovery mechanisms were never consulted.
      expect(calls.solidlsp).not.toContain("workspaceSymbols");
      expect(calls.solidlsp).toContain("references");
      expect(calls.solidlsp.filter((call) => call === "references").length).toBe(1);
      // The known coordinate was converted 1-based → 0-based for the mechanism.
      expect(outcome.results.length).toBe(1);
      expect(outcome.results[0]!.location?.line).toBe(3);
      // Receipt proves the negative: only the coordinate and the semantic stage ran.
      const stageNames = outcome.receipt.stages.map((stage) => stage.name);
      expect(stageNames).toContain("attention-coordinate");
      expect(stageNames).toContain("semantic-references");
      expect(stageNames).not.toContain("workspace-symbol-resolution");
      expect(stageNames).not.toContain("declaration-position-fallback");
      expect(stageNames).not.toContain("document-warmup");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("partial coordinate refines file-locally (line read), never workspace-wide", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(
        fakeHelper(calls),
        fakeSolidLsp(calls, {
          references: [{ file: "beta.ts", start: { line: 2, character: 9 }, end: { line: 2, character: 14 } }],
        }),
      );
      // File+line known, column absent: the smallest refinement reads that one line.
      const outcome = await syntelligentSearch({ query: "who calls greet?", intent: "who-calls-this", referent: { worldId: "local", workspace: "ws", kind: "CodeSymbol", id: "alpha.ts:1", name: "greet", location: { path: "alpha.ts", line: 1 } } }, context(root, substrate));
      expect(calls.solidlsp).not.toContain("workspaceSymbols");
      expect(calls.solidlsp).toContain("references");
      expect(outcome.results.length).toBe(1);
      const stageNames = outcome.receipt.stages.map((stage) => stage.name);
      expect(stageNames).toContain("document-refinement");
      expect(stageNames).not.toContain("workspace-symbol-resolution");
      expect(stageNames).not.toContain("declaration-position-fallback");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("partial coordinate falls back to document symbols when the line read is ambiguous", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(
        fakeHelper(calls),
        fakeSolidLsp(calls, {
          documentSymbols: [{ name: "other", location: { start: { line: 3, character: 7 } }, children: [{ name: "greet", location: { start: { line: 0, character: 16 } } }] }],
          references: [{ file: "beta.ts", start: { line: 2, character: 9 }, end: { line: 2, character: 14 } }],
        }),
      );
      // Line points somewhere the name does not appear: refinement uses document symbols.
      const outcome = await syntelligentSearch({ query: "who calls greet?", intent: "who-calls-this", referent: { worldId: "local", workspace: "ws", kind: "CodeSymbol", id: "alpha.ts:4", name: "greet", location: { path: "alpha.ts", line: 4 } } }, context(root, substrate));
      expect(calls.solidlsp).toContain("symbols");
      expect(calls.solidlsp).not.toContain("workspaceSymbols");
      expect(outcome.receipt.stages.map((stage) => stage.name)).toContain("document-refinement");
      expect(outcome.results.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("architecture questions stop at concepts + structural scope (no zvec-grep)", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const concepts: readonly ConceptMatch[] = [
        { id: "concept:focus.human-governance", kind: "concept", label: "Human-governed shared focus", score: 0.31, metadata: { area: "focus" }, links: ["alpha.ts"] },
      ];
      const substrate = fakeSubstrate(fakeHelper(calls, { concepts }), fakeSolidLsp(calls));
      const outcome = await syntelligentSearch({ query: "how is authority over attention designed?", intent: "architecture" }, context(root, substrate));
      expect(calls.helper).toContain("conceptQuery");
      expect(calls.helper).not.toContain("zgSearch");
      expect(outcome.results.some((result) => result.entity.id === "concept:focus.human-governance")).toBe(true);
      expect(outcome.results.some((result) => result.entity.location?.path === "alpha.ts")).toBe(true);
      expect(outcome.receipt.stages.some((stage) => stage.mechanism === "zvec-grep")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("natural-language semantic query runs concept → zg → rg-verification in order", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const concepts: readonly ConceptMatch[] = [
        { id: "c:1", kind: "concept", label: "Greeting", score: 0.4, metadata: {}, links: ["alpha.ts"] },
      ];
      const items: readonly ZgSearchItem[] = [
        { relative_path: "beta.ts", start_line: 2, end_line: 2, snippet: "return greet('x');", score: 0.2, matched_by: "fts+vector", symbol_name: "run", symbol_type: "function", status: "fresh" },
        { relative_path: "alpha.ts", start_line: 1, end_line: 1, snippet: "return 'hi ' + name;", score: 0.3, matched_by: "vector", symbol_name: "greet", symbol_type: "function", status: "fresh" },
      ];
      const substrate = fakeSubstrate(fakeHelper(calls, { concepts, items }));
      const outcome = await syntelligentSearch({ query: "where do we build greeting text" }, context(root, substrate));
      expect(calls.helper.indexOf("conceptQuery")).toBeLessThan(calls.helper.indexOf("zgSearch"));
      const stageNames = outcome.receipt.stages.map((stage) => stage.name);
      expect(stageNames).toContain("concept-retrieval");
      expect(stageNames).toContain("semantic-retrieval");
      expect(stageNames).toContain("exact-verification");
      // All results carry observed snippet verification.
      expect(outcome.results.every((result) => result.evidence.some((e) => e.how === "rg"))).toBe(true);
      // Concept-linked module ranks strongest.
      expect(outcome.results[0]!.relevance).toBe("strongest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("helper start failure degrades honestly; rg still bounds results", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(fakeHelper(calls, { startFails: true }), fakeSolidLsp(calls, { symbols: [] }));
      const outcome = await syntelligentSearch({ query: "greet" }, context(root, substrate));
      expect(outcome.receipt.availability.find((a) => a.name === "zvec-grep")?.status).toBe("unavailable");
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(outcome.results.every((result) => result.mechanisms.includes("rg"))).toBe(true);
      expect(outcome.receipt.stages.some((stage) => stage.name === "hybrid-semantic")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("solidlsp-unavailable who-calls-this falls back to rg and states it", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      // Substrate has a helper but no bridge → solidlsp unavailable.
      const substrate = fakeSubstrate(fakeHelper(calls), undefined);
      const outcome = await syntelligentSearch({ query: "who calls greet?", intent: "who-calls-this", referent: { worldId: "local", workspace: "ws", kind: "CodeSymbol", id: "alpha.ts:1", name: "greet" } }, context(root, substrate));
      expect(outcome.receipt.availability.find((a) => a.name === "solidlsp")?.status).toBe("unavailable");
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(outcome.results[0]!.mechanisms).toContain("rg");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote worlds receive no substrate clients and availability stays truthful", async () => {
    const calls: FakeCalls = { helper: [], solidlsp: [], rg: [] };
    const root = workspace();
    try {
      const substrate = fakeSubstrate(fakeHelper(calls), fakeSolidLsp(calls));
      const remote = { ...context(root, substrate), worldId: "ssh-box" };
      const outcome = await syntelligentSearch({ query: "greet" }, remote);
      expect(calls.helper).toEqual([]);
      expect(outcome.receipt.availability.find((a) => a.name === "zvec-grep")?.status).toBe("unavailable");
      expect(outcome.receipt.provenance.crossWorld).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("structural map enrichment", () => {
  test("merges SolidLSP-verified defines/references edges with provenance", async () => {
    const { buildStructuralMap } = await import("../../src/focus/mechanisms.ts");
    const root = workspace();
    try {
      const solidlsp = {
        workspaceSymbols: async () => [],
        definition: async (file: string, _line: number, _column: number) => [{ file, start: { line: 0, character: 16 } }],
        references: async () => [{ file: "beta.ts", start: { line: 2, character: 9 }, end: { line: 2, character: 14 } }],
      };
      const map = await buildStructuralMap(spawnPort(root) as never, root, "local", "ws", undefined, solidlsp);
      expect(map.enriched).toBe(true);
      const defines = map.edges.filter((edge) => edge.kind === "defines" && edge.how === "solidlsp");
      expect(defines.length).toBeGreaterThan(0);
      const references = map.edges.filter((edge) => edge.kind === "references" && edge.how === "solidlsp");
      expect(references.some((edge) => edge.from === "beta.ts" && edge.to === "alpha.ts")).toBe(true);
      // Base tier survived.
      expect(map.edges.some((edge) => edge.kind === "imports" && edge.how === "regex-import")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("LSP failure degrades to the base tier with enriched=false", async () => {
    const { buildStructuralMap } = await import("../../src/focus/mechanisms.ts");
    const root = workspace();
    try {
      const solidlsp = {
        workspaceSymbols: async () => [],
        definition: async () => {
          throw new Error("lsp died");
        },
        references: async () => [],
      };
      const map = await buildStructuralMap(spawnPort(root) as never, root, "local", "ws", undefined, solidlsp);
      expect(map.enriched).toBeUndefined();
      expect(map.edges.every((edge) => edge.how !== "solidlsp")).toBe(true);
      expect(map.edges.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("declaration-position recovery (fallback only)", () => {
  let declarationPattern: (name: string) => string;
  let declarationColumn: (lineText: string, name: string) => number;
  beforeAll(async () => {
    ({ declarationPattern, declarationColumn } = await import("../../src/focus/mechanisms.ts"));
  });

  test("recognizes common declaration forms with modifiers and whitespace", () => {
    const pattern = declarationPattern("greet");
    const cases = [
      "function greet() {}",
      "async function greet() {}",
      "export function greet() {}",
      "export async function greet() {}",
      "export default async function greet() {}",
      "const greet = () => {}",
      "export const greet = 1;",
      "let greet: number;",
      "var greet = 2;",
      "class greet {}",
      "export class greet {}",
      "export abstract class greet {}",
      "interface greet {}",
      "export interface greet {}",
      "type greet = string;",
      "export  type  greet  =  string;",
    ];
    for (const line of cases) expect(new RegExp(pattern).test(line), line).toBe(true);
    // Non-declarations must not match.
    for (const line of ["return greet;", "this.greet();", "mygreet(1);", "const notgreet = 1;"]) {
      expect(new RegExp(pattern).test(line), line).toBe(false);
    }
  });

  test("escapes regex metacharacters in symbol names", () => {
    const pattern = declarationPattern("weird$Name.x");
    expect(new RegExp(pattern).test("const weird$Name.x = 1;")).toBe(true);
    expect(new RegExp(pattern).test("const weirdXName = 1;")).toBe(false);
    expect(new RegExp(pattern).test("export const weird$Namex = 1;")).toBe(false);
  });

  test("declarationColumn finds a boundary-respecting occurrence", () => {
    expect(declarationColumn("export async function greet(name: string) {", "greet")).toBe(22);
    expect(declarationColumn("const greet$ = 1;", "greet")).toBe(6); // `greet$` is a different identifier… name `greet$` itself:
    expect(declarationColumn("const greet$ = 1;", "greet$")).toBe(6);
    expect(declarationColumn("export const greet=1;", "greet")).toBe(13);
    expect(declarationColumn("no match here", "greet")).toBe(0);
  });
});
