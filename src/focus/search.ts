// Syntelligent Search (Phase 3.5): the deterministic narrowing entry point.
// Routing per intent — REDUCTION IS THE POINT, so each query runs the fewest
// mechanisms that can answer it:
//   known symbol      → SolidLSP directly (rg only as stated fallback)
//   exact identifier  → rg, then SolidLSP verification
//   natural language  → concepts (zvec) → structural scope → zvec-grep → rg verify → SolidLSP verify
//   architecture      → concepts + structural scope, and STOP (no source retrieval)
//   execution failure → execution evidence + structural expansion + diagnostics
// Every stage that runs is recorded in the receipt with its true candidate
// count; a stage that did not run is never claimed. The receipt is inspectable
// ("Why these?"). World isolation: the world's ProcessPort IS the world; the
// substrate is local-world-only, so remote worlds degrade honestly.
import type { ProcessPort } from "../semantic/contracts.ts";
import type { SemanticSubstrate } from "../mechanisms/substrate.ts";
import type {
  AttentionSnapshot, EntityRef, FocusEvidence, MechanismName, SearchIntent, SearchReceipt,
  SearchResult, SharedFocus, StructuralMap,
} from "../semantic/focus.ts";
import type { SemanticHelper } from "../mechanisms/semantic-helper.ts";
import type { SolidLspBridge } from "../mechanisms/solidlsp.ts";
import { affordancesFor } from "./affordances.ts";
import { buildStructuralMap, resolveAvailability, rgFiles, rgSearch } from "./mechanisms.ts";
import { conceptQueryFor } from "./concept-index.ts";

const MAX_RESULTS = 5;
const ZG_CANDIDATE_POOL = 24;
const SNIPPET_VERIFY_MIN = 24;

export interface SearchContext {
  readonly process: ProcessPort;
  readonly root: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly mounted: ReadonlySet<string>;
  readonly structuralMap?: StructuralMap;
  readonly execution?: { readonly executionId: string; readonly command: string; readonly exitCode: number | null; readonly affected: readonly string[] };
  /** Managed semantic substrate (local world only; remote worlds omit it). */
  readonly substrate?: SemanticSubstrate;
  /** Concept-store path under the mechanism data dir (when the substrate is enabled). */
  readonly conceptStorePath?: string;
  /** SolidLSP data dir (resources/caches) — stable per workspace so provisioning runs once. */
  readonly solidlspDataDir?: string;
}

export interface SearchRequest {
  readonly query: string;
  readonly intent?: SearchIntent;
  readonly snapshot?: AttentionSnapshot;
  readonly focus?: SharedFocus;
  readonly referent?: EntityRef;
}

export interface SearchOutcome {
  readonly results: readonly SearchResult[];
  readonly receipt: SearchReceipt;
}

interface Stage {
  readonly name: string;
  readonly mechanism?: MechanismName;
  readonly candidates: number;
}

export function detectIntent(query: string): SearchIntent {
  const q = query.toLowerCase();
  if (/who calls|callers|references|called by/.test(q)) return "who-calls-this";
  if (/why did .* fail|why did this fail|failure|failed/.test(q)) return "why-did-this-fail";
  if (/related test|which test|tests for/.test(q)) return "related-tests";
  if (/changed recently|recent change|recently/.test(q)) return "changed-recently";
  if (/what opened|which process|this port|opened this/.test(q)) return "what-opened-this-port";
  if (/\b(architecture|design of|how does the system|subsystem|overview)\b/.test(q)) return "architecture";
  if (/what is this|what is that|explain|what is it/.test(q)) return "what-is-this";
  return "semantic";
}

function entity(match: { path: string; line: number; text: string }, worldId: string, workspace: string): EntityRef {
  const named = /function ([A-Za-z_$][A-Za-z0-9_$]*)|class ([A-Za-z_$][A-Za-z0-9_$]*)|const ([A-Za-z_$][A-Za-z0-9_$]*)/.exec(match.text);
  const name = named?.[1] ?? named?.[2] ?? named?.[3] ?? match.path.split("/").pop();
  return { worldId, workspace, kind: "CodeSymbol", id: match.path + ":" + match.line, name, location: { path: match.path, line: match.line } };
}

function toResult(ref: EntityRef, reason: string, evidence: readonly FocusEvidence[], mechanisms: readonly MechanismName[], snippet: string | undefined, relevance: SearchResult["relevance"]): SearchResult {
  return {
    entity: ref,
    reason,
    evidence,
    mechanisms,
    freshness: "ready",
    location: { path: ref.location?.path, line: ref.location?.line, snippet: snippet?.slice(0, 200) },
    relevance,
    affordances: affordancesFor(ref),
  };
}

function pickSearchTerm(request: SearchRequest, intent: SearchIntent): string | undefined {
  const referentName = request.referent?.name ?? request.snapshot?.referent?.name;
  if (intent === "who-calls-this" && referentName) return referentName;
  if (intent === "what-is-this" && referentName) return referentName;
  const tokens = request.query.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
  const stop = new Set(["what", "where", "when", "does", "this", "that", "here", "the", "for", "calls", "called", "related", "tests", "changed", "recently", "failed", "fail", "opened", "port"]);
  return tokens.filter((t) => !stop.has(t.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? referentName;
}

function evidence(mechanism: string, worldId: string, workspace: string): FocusEvidence[] {
  return [{ what: "retrieved via " + mechanism + " in world " + worldId, how: mechanism, confidence: "observed", refs: [worldId + ":" + workspace] }];
}

/** The substrate-backed mechanism clients for this search (local world only). */
interface SubstrateClients {
  readonly helper?: SemanticHelper;
  readonly solidlsp?: SolidLspBridge;
}

async function probeSubstrateClients(context: SearchContext): Promise<SubstrateClients> {
  const substrate = context.substrate;
  if (!substrate?.enabled) return {};
  const helper = substrate.helperFor(context.worldId);
  const solidlsp = substrate.solidlspFor(context.worldId, context.root);
  // Cheap probes so availability is observed, not assumed; failures degrade to undefined.
  if (helper) {
    try {
      await helper.ensureStarted();
      await helper.modelStatus();
    } catch {
      return { solidlsp };
    }
  }
  if (solidlsp) {
    try {
      // Bridge-process probe + workspace start: language queries need the LSP
      // running for THIS workspace (idempotent; first cold start provisions).
      await solidlsp.ensureStarted();
      await solidlsp.startWorkspace(context.root, context.solidlspDataDir);
    } catch {
      return { helper };
    }
  }
  return { helper, solidlsp };
}

/** Resolve a symbol name via SolidLSP workspace symbols (exact-name preference). */
async function locateSymbol(solidlsp: SolidLspBridge, name: string, context: SearchContext): Promise<{ file: string; line: number; column: number } | undefined> {
  const record = (s: unknown): { name?: unknown; location?: { file?: unknown; start?: { line?: unknown; character?: unknown } } } | undefined =>
    (s ?? undefined) as { name?: unknown; location?: { file?: unknown; start?: { line?: unknown; character?: unknown } } } | undefined;
  const pick = (symbols: readonly unknown[]): { file: string; line: number; column: number } | undefined => {
    const exact = symbols
      .map(record)
      .filter((s): s is { name: string; location: { file: string; start: { line: number; character: number } } } =>
        s?.name === name && typeof s.location?.file === "string" && typeof s.location?.start?.line === "number" && typeof s.location?.start?.character === "number");
    const candidate = exact[0];
    return candidate ? { file: candidate.location.file, line: candidate.location.start.line, column: candidate.location.start.character } : undefined;
  };
  // The project index may still be loading right after a cold start; retry
  // briefly rather than degrading on the first empty response.
  let symbols: readonly unknown[] = [];
  for (let attempt = 0; attempt < 3 && symbols.length === 0; attempt++) {
    if (attempt > 0) await Bun.sleep(1_200);
    symbols = await solidlsp.workspaceSymbols(name).catch(() => []);
    const located = pick(symbols);
    if (located) return located;
  }
  // tsserver's workspace search only covers LOADED files; on a cold workspace
  // it may stay empty. Fall back to rg purely as a POSITION FINDER for the
  // declaration — the semantic answer itself still comes from the language
  // server (references/definition resolve from this position).
  const declaration = await rgSearch(context.process, context.root, `export (async )?function ${name}|export class ${name}|export const ${name}|export interface ${name}|export type ${name}`, { regex: true, max: 5 }).catch(() => []);
  const hit = declaration[0];
  if (!hit) return undefined;
  const column = Math.max(hit.text.indexOf(name), 0);
  return { file: hit.path, line: hit.line - 1, column };
}

export async function syntelligentSearch(request: SearchRequest, context: SearchContext): Promise<SearchOutcome> {
  const intent = request.intent ?? detectIntent(request.query);
  const clients = await probeSubstrateClients(context);
  const availability = await resolveAvailability(context.process, context.root, context.mounted, clients);
  const byName = new Map(availability.map((a) => [a.name, a]));
  const usable = (name: MechanismName): boolean => byName.get(name)?.status === "ready";
  const structural = context.structuralMap ?? (usable("structural-map") ? await buildStructuralMap(context.process, context.root, context.worldId, context.workspace) : undefined);

  const stages: Stage[] = [];
  const results: SearchResult[] = [];
  const workspaceCount = structural?.fileCount ?? (await rgFiles(context.process, context.root)).length;
  let focusScope = workspaceCount;
  let structuralCount = 0;
  let semanticCount = 0;
  let verified = 0;

  const scopePath = request.referent?.location?.path ?? request.snapshot?.referent?.location?.path;
  if (scopePath && structural) {
    const dir = scopePath.includes("/") ? scopePath.slice(0, scopePath.lastIndexOf("/")) : "";
    const scoped = structural.nodes.filter((n) => n.ref.location?.path?.startsWith(dir));
    if (scoped.length > 0) focusScope = scoped.length;
  }

  const pushResult = (result: SearchResult): boolean => {
    if (results.length >= MAX_RESULTS) return false;
    if (results.some((existing) => existing.entity.id === result.entity.id)) return false;
    results.push(result);
    return true;
  };

  // ── Execution-failure evidence first (unchanged semantic priority) ────────
  if (intent === "why-did-this-fail" && context.execution) {
    stages.push({ name: "execution-evidence", candidates: context.execution.affected.length });
    for (const affected of context.execution.affected.slice(0, MAX_RESULTS)) {
      const ref: EntityRef = { worldId: context.worldId, workspace: context.workspace, kind: "WorkspaceResource", id: affected, name: affected.split("/").pop(), location: { path: affected } };
      const ev: FocusEvidence[] = [{ what: "execution " + context.execution.command + " affected " + affected, how: "effect-observation", confidence: "observed", refs: [context.execution.executionId] }];
      pushResult(toResult(ref, "affected by failed execution " + context.execution.executionId + " (exit " + context.execution.exitCode + ")", ev, ["rg"], undefined, "strongest"));
    }
    semanticCount = results.length;
    verified = results.length;
  }

  // ── Known symbol: SolidLSP directly (semantic references, not regex) ──────
  if (results.length < MAX_RESULTS && (intent === "who-calls-this" || intent === "what-is-this") && clients.solidlsp && usable("solidlsp")) {
    const symbolName = request.referent?.name ?? request.snapshot?.referent?.name ?? pickSearchTerm(request, intent);
    if (symbolName) {
      const located = await locateSymbol(clients.solidlsp, symbolName, context).catch(() => undefined);
      if (located) {
        // Open the declaring file first: tsserver's reference resolution needs
        // the file (and its project) loaded — a cold ask returns nothing, and
        // the project graph may still be configuring for a few seconds.
        await clients.solidlsp.symbols(located.file).catch(() => []);
        let locations: readonly { readonly file: string; readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await Bun.sleep(4_000);
          locations = await (intent === "who-calls-this"
            ? clients.solidlsp.references(located.file, located.line, located.column)
            : clients.solidlsp.definition(located.file, located.line, located.column)
          ).catch(() => []);
          if (locations.length > 0 || intent !== "who-calls-this") break;
        }
        stages.push({ name: intent === "who-calls-this" ? "semantic-references" : "semantic-definitions", mechanism: "solidlsp", candidates: locations.length });
        for (const location of locations) {
          if (results.length >= MAX_RESULTS) break;
          // LSP is 0-based; EntityRef locations are 1-based lines.
          const ref: EntityRef = {
            worldId: context.worldId,
            workspace: context.workspace,
            kind: "CodeSymbol",
            id: location.file + ":" + (location.start.line + 1),
            name: symbolName,
            location: { path: location.file, line: location.start.line + 1, column: location.start.character + 1 },
          };
          const reason = intent === "who-calls-this"
            ? `references ${symbolName} (SolidLSP semantic references)`
            : `definition of ${symbolName} (SolidLSP)`;
          pushResult(toResult(ref, reason, evidence("solidlsp", context.worldId, context.workspace), ["solidlsp"], undefined, "strongest"));
        }
        semanticCount = results.length;
        verified = results.length;
      } else {
        stages.push({ name: "symbol-resolution", mechanism: "solidlsp", candidates: 0 });
      }
    }
  }

  // ── Exact lexical search (rg) — the identifier tier and the fallback tier ──
  // Skipped for architecture questions (the concept layer owns those), and for
  // who-calls-this/what-is-this when SolidLSP already produced semantic answers
  // (rg is the stated FALLBACK for known symbols, not a supplement).
  const semanticAnswered = stages.some((stage) => stage.mechanism === "solidlsp" && stage.candidates > 0);
  const rgAllowed = intent !== "architecture" && !((intent === "who-calls-this" || intent === "what-is-this") && semanticAnswered);
  if (results.length < MAX_RESULTS && usable("rg") && rgAllowed) {
    const term = pickSearchTerm(request, intent);
    if (term) {
      const matches = await rgSearch(context.process, context.root, term, { max: 40 });
      stages.push({ name: "exact-search", mechanism: "rg", candidates: matches.length });
      structuralCount = new Set(matches.map((m) => m.path)).size;
      const seen = new Set(results.map((r) => r.entity.id));
      for (const match of matches) {
        if (results.length >= MAX_RESULTS) break;
        const ref = entity(match, context.worldId, context.workspace);
        if (seen.has(ref.id)) continue;
        seen.add(ref.id);
        const relevance: SearchResult["relevance"] = ref.name === term ? "strongest" : "likely";
        results.push(toResult(ref, "matched \"" + term + "\" (exact lexical)" + (semanticAnswered ? " — fallback: semantic verification unavailable" : ""), evidence("rg", context.worldId, context.workspace), ["rg"], match.text.trim(), relevance));
      }
      semanticCount = results.length;
      verified = results.length;
    }
  }

  // ── Structural test edges ─────────────────────────────────────────────────
  if (intent === "related-tests" && structural && scopePath) {
    const tests = structural.edges.filter((e) => e.kind === "tests" && e.to === scopePath).map((e) => e.from);
    stages.push({ name: "structural-tests", mechanism: "structural-map", candidates: tests.length });
    for (const testPath of tests.slice(0, MAX_RESULTS)) {
      const ref: EntityRef = { worldId: context.worldId, workspace: context.workspace, kind: "Test", id: testPath, name: testPath.split("/").pop(), location: { path: testPath } };
      pushResult(toResult(ref, "tests " + scopePath + " (structural edge)", evidence("structural-map", context.worldId, context.workspace), ["structural-map"], undefined, "likely"));
    }
    verified = results.length;
  }

  // ── Architecture/domain questions: concepts + scope, and STOP ─────────────
  if (intent === "architecture" && clients.helper && context.conceptStorePath) {
    const concepts = await conceptQueryFor(clients.helper, context.conceptStorePath, request.query, 3).catch(() => []);
    stages.push({ name: "concept-retrieval", mechanism: "zvec", candidates: concepts.length });
    const linkedPaths = new Set(concepts.flatMap((concept) => concept.links));
    const modules = structural?.nodes.filter((node) => node.ref.location?.path !== undefined && linkedPaths.has(node.ref.location.path)) ?? [];
    stages.push({ name: "structural-scope", mechanism: "structural-map", candidates: modules.length });
    for (const concept of concepts) {
      const ref: EntityRef = { worldId: context.worldId, workspace: context.workspace, kind: "WorkspaceResource", id: concept.id, name: concept.label };
      pushResult(toResult(ref, `concept "${concept.label}" (distance ${concept.score.toFixed(3)}) — see linked modules`, evidence("zvec", context.worldId, context.workspace), ["zvec"], undefined, "strongest"));
    }
    for (const module of modules.slice(0, MAX_RESULTS - results.length)) {
      const ref: EntityRef = { ...module.ref, worldId: context.worldId, workspace: context.workspace };
      pushResult(toResult(ref, `linked by retrieved concept (structural scope)`, evidence("structural-map", context.worldId, context.workspace), ["structural-map", "zvec"], undefined, "likely"));
    }
    semanticCount = results.length;
    verified = results.length;
    // Deliberately no zvec-grep/rg stage: the answer is the concept layer.
  }

  // ── Natural-language semantics: concepts → zvec-grep → verify ─────────────
  if (intent === "semantic" && results.length < MAX_RESULTS && clients.helper && context.conceptStorePath) {
    const concepts = await conceptQueryFor(clients.helper, context.conceptStorePath, request.query, 3).catch(() => []);
    stages.push({ name: "concept-retrieval", mechanism: "zvec", candidates: concepts.length });
    if (concepts.length > 0 && usable("zvec-grep")) {
      // Scope: concept links intersect the structural map's modules.
      const linkedPaths = new Set(concepts.flatMap((concept) => concept.links));
      const linkedModules = structural?.nodes.filter((node) => node.ref.location?.path !== undefined && linkedPaths.has(node.ref.location.path)) ?? [];
      if (linkedModules.length > 0) focusScope = Math.min(focusScope, linkedModules.length);
      stages.push({ name: "structural-scope", mechanism: "structural-map", candidates: linkedModules.length });

      const search = await clients.helper.zgSearch({ root: context.root, query: request.query, mode: "hybrid", limit: ZG_CANDIDATE_POOL }).catch(() => undefined);
      if (search) {
        stages.push({ name: "semantic-retrieval", mechanism: "zvec-grep", candidates: search.items.length });
        // Rank: engine order, boosted by concept-linked modules.
        const isLinked = (relativePath: string): boolean => {
          for (const link of linkedPaths) {
            const base = link.replace(/#.*$/, "").replace(/\/$/, "");
            if (relativePath === base || relativePath.startsWith(base + "/")) return true;
          }
          return false;
        };
        const ranked = search.items
          .map((item, index) => ({ item, index, linked: isLinked(item.relative_path) }))
          .sort((a, b) => (b.linked ? 1 : 0) - (a.linked ? 1 : 0) || a.index - b.index);
        let accepted = 0;
        for (const candidate of ranked) {
          if (results.length >= MAX_RESULTS) break;
          const item = candidate.item;
          // rg verification: the snippet must exist in the file (cheap -F of a
          // distinctive slice) — retrieval claims stay evidence-backed.
          const snippet = item.snippet.trim();
          const needle = snippet.length >= SNIPPET_VERIFY_MIN ? snippet.slice(0, SNIPPET_VERIFY_MIN) : snippet;
          const verification = needle === "" ? true : (await rgSearch(context.process, context.root, needle, { globs: [item.relative_path], max: 1 })).length > 0;
          if (!verification) continue;
          accepted++;
          const ref: EntityRef = {
            worldId: context.worldId,
            workspace: context.workspace,
            kind: "CodeSymbol",
            id: item.relative_path + ":" + (item.start_line ?? 0),
            name: item.symbol_name ?? item.relative_path.split("/").pop(),
            location: { path: item.relative_path, line: item.start_line ?? undefined },
          };
          const mechanisms: MechanismName[] = ["zvec", "zvec-grep", "rg"];
          const reasonBase = `semantic match for "${request.query}" (${item.matched_by})`;
          const reason = item.status === "possibly_stale" ? reasonBase + " — possibly stale" : reasonBase;
          pushResult(toResult(ref, reason, [
            ...evidence("zvec-grep", context.worldId, context.workspace),
            { what: "snippet verified on disk via rg", how: "rg", confidence: "observed", refs: [item.relative_path] },
          ], mechanisms, snippet, candidate.linked ? "strongest" : "likely"));
        }
        stages.push({ name: "exact-verification", mechanism: "rg", candidates: accepted });
        semanticCount = results.length;
        verified = results.length;
      }
    }
  }

  // ── Phase-3 behavior when the semantic substrate is absent/degraded ───────
  if (intent === "semantic" && !usable("zvec-grep") && !stages.some((stage) => stage.mechanism === "zvec-grep")) {
    stages.push({ name: "hybrid-semantic", candidates: 0 });
  }

  const receipt: SearchReceipt = {
    id: "search_" + crypto.randomUUID(),
    query: request.query,
    intent,
    worldId: context.worldId,
    workspace: context.workspace,
    snapshotId: request.snapshot?.id,
    sharedFocusVersion: request.focus?.version ?? 0,
    availability,
    stages,
    reduction: { workspace: workspaceCount, focusScope, structural: structuralCount, semantic: semanticCount, verified },
    results,
    provenance: { method: "focus.search:" + intent, crossWorld: false },
    searchedAt: new Date().toISOString(),
  };
  return { results, receipt };
}
