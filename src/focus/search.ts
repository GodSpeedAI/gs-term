// Syntelligent Search (Phase 3): the deterministic narrowing entry point. It chooses the cheapest
// useful mechanism path for the query + attention + world, reduces the search space BEFORE returning
// information, and records an inspectable receipt (reduction funnel + provenance). It never silently
// crosses worlds (the process port IS the world). Ranking is derivation; it is not an observation.
import type { ProcessPort } from "../semantic/contracts.ts";
import type {
  AttentionSnapshot, EntityRef, FocusEvidence, MechanismName, SearchIntent, SearchReceipt,
  SearchResult, SharedFocus, StructuralMap,
} from "../semantic/focus.ts";
import { affordancesFor } from "./affordances.ts";
import { buildStructuralMap, resolveAvailability, rgFiles, rgSearch } from "./mechanisms.ts";

const MAX_RESULTS = 5;

export interface SearchContext {
  readonly process: ProcessPort;
  readonly root: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly mounted: ReadonlySet<string>;
  readonly structuralMap?: StructuralMap;
  readonly execution?: { readonly executionId: string; readonly command: string; readonly exitCode: number | null; readonly affected: readonly string[] };
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

export function detectIntent(query: string): SearchIntent {
  const q = query.toLowerCase();
  if (/who calls|callers|references|called by/.test(q)) return "who-calls-this";
  if (/why did .* fail|why did this fail|failure|failed/.test(q)) return "why-did-this-fail";
  if (/related test|which test|tests for/.test(q)) return "related-tests";
  if (/changed recently|recent change|recently/.test(q)) return "changed-recently";
  if (/what opened|which process|this port|opened this/.test(q)) return "what-opened-this-port";
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

export async function syntelligentSearch(request: SearchRequest, context: SearchContext): Promise<SearchOutcome> {
  const intent = request.intent ?? detectIntent(request.query);
  const availability = await resolveAvailability(context.process, context.root, context.mounted);
  const byName = new Map(availability.map((a) => [a.name, a]));
  const usable = (name: MechanismName): boolean => byName.get(name)?.status === "ready";
  const structural = context.structuralMap ?? (usable("structural-map") ? await buildStructuralMap(context.process, context.root, context.worldId, context.workspace) : undefined);

  const stages: { name: string; mechanism?: MechanismName; candidates: number }[] = [];
  const results: SearchResult[] = [];
  const workspaceCount = structural?.fileCount ?? (await rgFiles(context.process, context.root)).length;
  let focusScope = workspaceCount;
  let structuralCount = 0;
  let semanticCount = 0;
  let verified = 0;

  const evidenceFor = (mechanism: MechanismName): FocusEvidence[] => [
    { what: "retrieved via " + mechanism + " in world " + context.worldId, how: mechanism, confidence: "observed", refs: [context.worldId + ":" + context.workspace] },
  ];

  const scopePath = request.referent?.location?.path ?? request.snapshot?.referent?.location?.path;
  if (scopePath && structural) {
    const dir = scopePath.includes("/") ? scopePath.slice(0, scopePath.lastIndexOf("/")) : "";
    const scoped = structural.nodes.filter((n) => n.ref.location?.path?.startsWith(dir));
    if (scoped.length > 0) focusScope = scoped.length;
  }

  if (intent === "why-did-this-fail" && context.execution) {
    stages.push({ name: "execution-evidence", candidates: context.execution.affected.length });
    for (const affected of context.execution.affected.slice(0, MAX_RESULTS)) {
      const ref: EntityRef = { worldId: context.worldId, workspace: context.workspace, kind: "WorkspaceResource", id: affected, name: affected.split("/").pop(), location: { path: affected } };
      const ev: FocusEvidence[] = [{ what: "execution " + context.execution.command + " affected " + affected, how: "effect-observation", confidence: "observed", refs: [context.execution.executionId] }];
      results.push(toResult(ref, "affected by failed execution " + context.execution.executionId + " (exit " + context.execution.exitCode + ")", ev, ["rg"], undefined, "strongest"));
    }
    semanticCount = results.length;
    verified = results.length;
  }

  if (results.length < MAX_RESULTS && usable("rg")) {
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
        results.push(toResult(ref, "matched \"" + term + "\" (exact lexical)", evidenceFor("rg"), ["rg"], match.text.trim(), relevance));
      }
      semanticCount = results.length;
      verified = results.length;
    }
  }

  if (intent === "related-tests" && structural && scopePath) {
    const tests = structural.edges.filter((e) => e.kind === "tests" && e.to === scopePath).map((e) => e.from);
    stages.push({ name: "structural-tests", mechanism: "structural-map", candidates: tests.length });
    for (const testPath of tests.slice(0, MAX_RESULTS)) {
      const ref: EntityRef = { worldId: context.worldId, workspace: context.workspace, kind: "Test", id: testPath, name: testPath.split("/").pop(), location: { path: testPath } };
      results.push(toResult(ref, "tests " + scopePath + " (structural edge)", evidenceFor("structural-map"), ["structural-map"], undefined, "likely"));
    }
    verified = results.length;
  }

  if (intent === "semantic" && !usable("zvec-grep")) {
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
