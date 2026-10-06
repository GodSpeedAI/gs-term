// Search mechanisms (Phase 3). Deterministic, world-scoped retrieval invoked THROUGH a world's
// ProcessPort — never the PTY. So `rg` in the local world runs locally and `rg` in an SSH world
// runs remotely (the world selects the provider). Mechanism layer: knows rg/files/imports and
// reports honest availability; it does not rank or decide relevance (that is search.ts).
import type { FilePort, ProcessPort } from "../semantic/contracts.ts";
import type { MechanismAvailability, StructuralEdge, StructuralMap, StructuralNode } from "../semantic/focus.ts";

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_FILES = 4_000;

async function run(process: ProcessPort, root: string, argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await process.exec({ argv: [...argv], cwd: root, timeoutMs: SEARCH_TIMEOUT_MS });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/** First-class reduction: the file inventory (`rg --files`). Empty when rg is unavailable. */
export async function rgFiles(process: ProcessPort, root: string): Promise<string[]> {
  try {
    const result = await run(process, root, ["rg", "--files", "--hidden", "-g", "!.git"]);
    if (result.code !== 0 && result.code !== 1) return [];
    return result.stdout.split("\n").filter(Boolean).slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

export interface RgMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** Exact lexical search. `pattern` is a fixed string (escaped) unless `regex` is set. */
export async function rgSearch(
  process: ProcessPort,
  root: string,
  pattern: string,
  options: { readonly regex?: boolean; readonly globs?: readonly string[]; readonly max?: number } = {},
): Promise<RgMatch[]> {
  const max = options.max ?? 50;
  const args = ["rg", "--line-number", "--no-heading", "--color", "never", "-m", String(max)];
  if (!options.regex) args.push("-F");
  for (const glob of options.globs ?? []) args.push("-g", glob);
  args.push("--", pattern);
  try {
    const result = await run(process, root, args);
    if (result.code !== 0 && result.code !== 1) return [];
    const matches: RgMatch[] = [];
    for (const raw of result.stdout.split("\n")) {
      if (!raw) continue;
      const first = raw.indexOf(":");
      const second = raw.indexOf(":", first + 1);
      if (first < 0 || second < 0) continue;
      const line = Number(raw.slice(first + 1, second));
      if (!Number.isInteger(line)) continue;
      matches.push({ path: raw.slice(0, first), line, text: raw.slice(second + 1) });
      if (matches.length >= max) break;
    }
    return matches;
  } catch {
    return [];
  }
}

/** Cheap deterministic import edges from source text (no full AST; enough to reduce search). */
function importTargets(text: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^;\n]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(re)) {
    const target = match[1] ?? match[2];
    if (target && (target.startsWith(".") || target.startsWith("/"))) out.push(target);
  }
  return out;
}

/** The narrow SolidLSP surface the structural enricher uses (SolidLspBridge satisfies this). */
export interface StructuralLsp {
  workspaceSymbols(query: string): Promise<readonly unknown[]>;
  definition(file: string, line: number, column: number): Promise<readonly { readonly file: string; readonly start: { readonly line: number; readonly character: number } }[]>;
  references(file: string, line: number, column: number): Promise<readonly { readonly file: string; readonly start: { readonly line: number; readonly character: number } }[]>;
}

const ENRICH_DEFINE_CAP = 40;
const ENRICH_REFERENCE_CAP = 10;

/**
 * The smallest deterministic structural graph that improves elimination: workspace → modules/tests,
 * import edges, and test→module edges. Graft-donor pattern (deterministic tier only): explicit
 * typed edges from evidence; no LLM summaries. Freshness is explicit.
 *
 * When a SolidLSP client is supplied, semantically verified edges are merged in (bounded): `defines`
 * edges from definition-verified exported declarations, and file-level `references` edges from
 * SolidLSP reference resolution. Edges the language server cannot establish are never invented —
 * failures degrade to the base tier with `enriched: false`.
 */
export async function buildStructuralMap(process: ProcessPort, root: string, worldId: string, workspace: string, revision?: string, solidlsp?: StructuralLsp): Promise<StructuralMap> {
  const files = await rgFiles(process, root);
  const sourceFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !f.includes("node_modules"));
  const nodes: StructuralNode[] = [
    { ref: { worldId, workspace, kind: "Module", id: workspace }, kind: "workspace", label: workspace },
  ];
  const edges: StructuralEdge[] = [];
  const isTest = (f: string) => /\.(test|spec)\.[^.]+$/.test(f) || f.includes("__tests__");
  const exportedCandidates: { file: string; line: number; name: string }[] = [];
  for (const file of sourceFiles.slice(0, MAX_FILES)) {
    const id = file;
    nodes.push({
      ref: { worldId, workspace, kind: isTest(file) ? "Test" : "Module", id, name: file.split("/").pop(), location: { path: file } },
      kind: isTest(file) ? "test" : "module",
      label: file.split("/").pop() ?? file,
    });
    edges.push({ from: workspace, to: id, kind: "contains", how: "file-topology" });
    const read = await run(process, root, ["sed", "-n", "1,240p", file]);
    if (read.code !== 0) continue;
    for (const target of importTargets(read.stdout)) {
      const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      const resolved = normalizeRelative(base, target);
      if (resolved && sourceFiles.includes(resolved)) edges.push({ from: id, to: resolved, kind: "imports", how: "regex-import" });
      if (resolved && isTest(file) && !isTest(resolved)) edges.push({ from: id, to: resolved, kind: "tests", how: "regex-import" });
    }
    // Exported declarations are the `defines` candidates for LSP verification.
    if (solidlsp && !isTest(file) && exportedCandidates.length < ENRICH_DEFINE_CAP * 2) {
      const lines = read.stdout.split("\n");
      for (const [index, line] of lines.entries()) {
        const declaration = /export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
        if (declaration?.[1]) {
          exportedCandidates.push({ file, line: index + 1, name: declaration[1] });
          if (exportedCandidates.length >= ENRICH_DEFINE_CAP * 2) break;
        }
      }
    }
  }

  let enriched = false;
  if (solidlsp) {
    try {
      const verified: { file: string; line: number; name: string; column: number }[] = [];
      for (const candidate of exportedCandidates.slice(0, ENRICH_DEFINE_CAP)) {
        const column = candidate.name.length > 0 ? await columnName(process, root, candidate.file, candidate.line, candidate.name) : 0;
        if (column === undefined) continue;
        // LSP is 0-based; the candidate is 1-based.
        const definitions = await solidlsp.definition(candidate.file, candidate.line - 1, column).catch(() => []);
        const hit = definitions.find((location) => location.file === candidate.file);
        if (!hit) continue;
        verified.push({ ...candidate, column });
        nodes.push({
          ref: { worldId, workspace, kind: "CodeSymbol", id: `${candidate.file}#${candidate.name}`, name: candidate.name, location: { path: candidate.file, line: candidate.line } },
          kind: "symbol",
          label: candidate.name,
        });
        edges.push({ from: candidate.file, to: `${candidate.file}#${candidate.name}`, kind: "defines", how: "solidlsp" });
        enriched = true;
      }
      // File-level reference edges for the most-verified symbols.
      for (const symbol of verified.slice(0, ENRICH_REFERENCE_CAP)) {
        const references = await solidlsp.references(symbol.file, symbol.line - 1, symbol.column).catch(() => []);
        for (const reference of references) {
          if (reference.file === symbol.file) continue;
          edges.push({ from: reference.file, to: symbol.file, kind: "references", how: "solidlsp" });
          enriched = true;
        }
      }
    } catch {
      // Degrade to the base tier; enriched stays false.
    }
  }

  return { worldId, workspace, revision, status: "ready", nodes, edges, fileCount: files.length, ...(enriched ? { enriched: true } : {}) };
}

/** Column (0-based) of the declaration name on its line, read from the world. */
async function columnName(process: ProcessPort, root: string, file: string, line: number, name: string): Promise<number | undefined> {
  const read = await run(process, root, ["sed", "-n", `${line}p`, file]);
  if (read.code !== 0) return undefined;
  return read.stdout.indexOf(name) >= 0 ? read.stdout.indexOf(name) : undefined;
}

function normalizeRelative(base: string, target: string): string | undefined {
  if (!target.startsWith(".")) return undefined;
  const parts = (base ? base.split("/") : []).concat(target.split("/"));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const path = stack.join("/");
  if (/\.(ts|tsx|js|jsx)$/.test(path)) return path;
  return `${path}.ts`;
}

/**
 * Honest per-world mechanism availability. rg is detected through the world's process port (so a
 * remote world reports remote rg). Substrate mechanisms (solidlsp / zvec-grep / zvec) report
 * readiness only when the managed client for THIS world probed successfully — a remote world
 * receives no substrate client and reports "not mounted", never a silent local substitution.
 */
export async function resolveAvailability(
  process: ProcessPort,
  root: string,
  mounted: ReadonlySet<string>,
  clients: { readonly helper?: unknown; readonly solidlsp?: unknown } = {},
): Promise<MechanismAvailability[]> {
  let rgReady = false;
  try {
    const probe = await run(process, root, ["rg", "--version"]);
    rgReady = probe.code === 0;
  } catch {
    rgReady = false;
  }
  const avail = (name: MechanismAvailability["name"]): MechanismAvailability =>
    mounted.has(name)
      ? { name, status: "ready", freshness: "current" }
      : { name, status: "unavailable", reason: `not mounted in world (no managed ${name} process)` };
  const substrateReady = (name: "solidlsp" | "zvec-grep" | "zvec", present: boolean): MechanismAvailability =>
    present
      ? { name, status: "ready", freshness: "current" }
      : { name, status: "unavailable", reason: `not mounted for this world (managed ${name} client absent or start failed)` };
  return [
    { name: "rg", status: rgReady ? "ready" : "unavailable", freshness: rgReady ? "current" : undefined, reason: rgReady ? undefined : "ripgrep not found in world" },
    avail("structural-map"),
    substrateReady("solidlsp", clients.solidlsp !== undefined),
    substrateReady("zvec-grep", clients.helper !== undefined),
    substrateReady("zvec", clients.helper !== undefined),
  ];
}
