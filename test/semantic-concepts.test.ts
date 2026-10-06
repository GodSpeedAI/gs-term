// Registry gate for the curated concept index (src/semantic/concepts.ts): shape, link
// integrity against the real repo, journey grounding, and digest freshness. No zvec here —
// indexing happens in the substrate integration; these tests only pin what curation promises.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONCEPTS,
  CONCEPT_AREAS,
  conceptRegistryDigest,
  type ConceptDoc,
} from "../src/semantic/concepts.ts";

/** Canonical journey ids (J1–J15; J6 = observations, journey-j6-observations.test.ts). */
const KNOWN_JOURNEYS = new Set(Array.from({ length: 15 }, (_, index) => `J${index + 1}`));
const AREA_SET = new Set<string>(CONCEPT_AREAS);
const MIN_TEXT_CHARS = 200;

/** `path#Symbol` → repo-relative path (the fragment names an anchor, not a file). */
function linkPath(link: string): string {
  const hash = link.indexOf("#");
  return hash === -1 ? link : link.slice(0, hash);
}

describe("concept registry shape", () => {
  test("registry is curated-sized (18–24 concepts)", () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(18);
    expect(CONCEPTS.length).toBeLessThanOrEqual(24);
  });

  test("ids are unique stable concept slugs", () => {
    const ids = CONCEPTS.map((doc) => doc.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^concept:[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/);
  });

  test("every doc is a well-formed concept", () => {
    for (const doc of CONCEPTS) {
      expect(doc.kind).toBe("concept");
      expect(doc.label.trim().length).toBeGreaterThan(0);
      // The embedding input must be a real natural-language description, not a bare identifier.
      expect(doc.text.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
      expect((doc.text.match(/[.!?]/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(AREA_SET.has(doc.metadata.area)).toBe(true);
      for (const journey of doc.metadata.journeys) expect(KNOWN_JOURNEYS.has(journey)).toBe(true);
      expect(doc.links.length).toBeGreaterThan(0);
    }
  });

  test("every structural link resolves to a real repo path", () => {
    for (const doc of CONCEPTS) {
      for (const link of doc.links) {
        const path = linkPath(link);
        expect(path.startsWith("/")).toBe(false); // repo-relative, never absolute
        expect(path.startsWith("..")).toBe(false);
        expect(existsSync(resolve(process.cwd(), path))).toBe(true);
      }
    }
  });

  test("every canonical journey J1–J15 is grounded by at least one concept", () => {
    const covered = new Set(CONCEPTS.flatMap((doc) => doc.metadata.journeys));
    for (const journey of KNOWN_JOURNEYS) expect(covered.has(journey)).toBe(true);
  });
});

describe("concept registry digest", () => {
  test("is deterministic and sha256-formatted", () => {
    const first = conceptRegistryDigest();
    expect(conceptRegistryDigest()).toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("changes when curated content changes", () => {
    const baseline = conceptRegistryDigest();
    const retitled: readonly ConceptDoc[] = CONCEPTS.map((doc, index) =>
      index === 0 ? { ...doc, text: `${doc.text} Amended.` } : doc,
    );
    expect(conceptRegistryDigest(retitled)).not.toBe(baseline);
    const relinked: readonly ConceptDoc[] = CONCEPTS.map((doc, index) =>
      index === 0 ? { ...doc, links: [...doc.links, "src/semantic/concepts.ts"] } : doc,
    );
    expect(conceptRegistryDigest(relinked)).not.toBe(baseline);
    expect(conceptRegistryDigest(relinked)).not.toBe(conceptRegistryDigest(retitled));
  });
});
