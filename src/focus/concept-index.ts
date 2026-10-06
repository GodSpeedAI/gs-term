// Concept index (raw zvec, gs-term-owned): retrieval over the curated concept
// registry — NEVER over source chunks (zvec-grep owns source). Freshness is
// explicit: a digest marker file beside the store; the store rebuilds when the
// registry digest changes. Links inside a match are the authoritative
// structure; similarity only surfaced it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ConceptMatch, SemanticHelper } from "../mechanisms/semantic-helper.ts";
import { CONCEPTS, conceptRegistryDigest } from "../semantic/concepts.ts";

export interface ConceptIndexState {
  readonly docCount: number;
  readonly digest: string;
  readonly rebuilt: boolean;
}

function markerPath(storePath: string): string {
  return `${storePath}.digest`;
}

function storedDigest(storePath: string): string | undefined {
  try {
    return existsSync(markerPath(storePath)) ? readFileSync(markerPath(storePath), "utf8").trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Flatten the curated structured metadata onto the zvec string-map schema. */
function flattenMetadata(metadata: { area: string; journeys: readonly string[] }): Record<string, string> {
  return { area: metadata.area, journeys: metadata.journeys.join(",") };
}

/**
 * Open-or-rebuild the concept store. Rebuilds when the digest marker mismatches
 * the current registry (or the store is empty) and replaces all docs with
 * pruning — the registry is the whole truth, so stale concepts never linger.
 */
export async function ensureConceptIndex(helper: SemanticHelper, storePath: string): Promise<ConceptIndexState> {
  const digest = conceptRegistryDigest();
  const stats = await helper.conceptStats(storePath).catch(() => ({ doc_count: 0 }));
  const fresh = storedDigest(storePath) === digest && stats.doc_count > 0;
  if (fresh) return { docCount: stats.doc_count, digest, rebuilt: false };

  await helper.conceptReplace(
    storePath,
    CONCEPTS.map((concept) => ({
      id: concept.id,
      kind: concept.kind,
      label: concept.label,
      text: concept.text,
      metadata: flattenMetadata(concept.metadata),
      links: [...concept.links],
    })),
    true,
  );
  try {
    writeFileSync(markerPath(storePath), digest, "utf8");
  } catch {
    // A missing marker only costs a rebuild next time; never fail the query path.
  }
  const rebuilt = await helper.conceptStats(storePath).catch(() => ({ doc_count: CONCEPTS.length }));
  return { docCount: rebuilt.doc_count, digest, rebuilt: true };
}

/** Concept retrieval with links; thin wrapper so callers never touch raw helper types. */
export async function conceptQueryFor(helper: SemanticHelper, storePath: string, text: string, topk = 5): Promise<readonly ConceptMatch[]> {
  const outcome = await helper.conceptQuery(storePath, text, topk, "concept");
  return outcome.items;
}
