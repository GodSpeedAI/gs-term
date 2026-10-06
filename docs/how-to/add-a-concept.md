# How to add a curated concept

**Goal:** add a human-authored application-domain concept to the retrieval layer, so architecture and
domain questions can be answered from concepts rather than source search.

**Prerequisites:** you can identify the concept's authoritative structural links (repo-relative paths,
optionally `path#Symbol`).

## What a concept is

A concept is a *description in words that do not appear in the code* — which is the point of semantic
retrieval. It carries explicit `links` into the repository. Vector similarity may surface a concept;
**only the links say what it is about**. Concepts never replace source retrieval; zvec-grep owns
source.

## Procedure

### 1. Write the doc in `src/semantic/concepts.ts`

```ts
{
  id: "concept:observation.attribution",     // stable slug
  kind: "concept",
  label: "Attribution that admits ignorance",
  text:
    "2–5 sentences phrased in words that do not necessarily appear in the code. Describe the idea, " +
    "not the implementation. Say what an observer may and may not claim, and what happens when the " +
    "cause cannot be established.",
  metadata: { area: "observation", journeys: ["J3", "J6"] },
  links: [
    "src/bridge/observation.ts",
    "src/semantic/observations.ts",
    "src/semantic/contracts.ts",
  ],
}
```

Field rules, all enforced or asserted by tests:

| Field | Rule |
| --- | --- |
| `id` | unique, stable slug, `concept:<area>.<slug>` |
| `kind` | always `"concept"` |
| `text` | the embedding input; natural description, not identifier soup |
| `metadata.area` | one of `CONCEPT_AREAS` |
| `metadata.journeys` | catalogued journey ids (`J1`–`J15`) |
| `links` | repo-relative paths that must resolve; every journey must be grounded by ≥ 1 concept |

### 2. Nothing else

`conceptRegistryDigest()` covers the registry version and the serialised docs, so changing any doc
changes the digest. `ensureConceptIndex` rebuilds the store on the next search and prunes removed
concepts — the registry is the whole truth.

### 3. Validate

```bash
bun run test test/semantic-concepts.test.ts
```

That suite asserts the registry is curated-sized (18–24 concepts), ids are unique and stable, every
doc is well formed, every link resolves to a real repo path, every canonical journey is grounded,
the digest is deterministic and sha256-formatted, and it changes when content changes.

## How a concept is used

For an `architecture` intent, search retrieves the top 3 concepts, intersects their `links` with the
structural map to produce the "linked modules" scope, and **stops** — no source retrieval. For a
natural-language intent, concepts scope `zvec-grep` retrieval and boost linked files. The receipt
records the `concept-retrieval` stage with its true candidate count.

## Common failure symptoms

| Symptom | Cause |
| --- | --- |
| `every structural link resolves to a real repo path` fails | a link points at a path that does not exist |
| `every canonical journey J1–J15 is grounded` fails | a new journey was catalogued without a concept |
| `registry is curated-sized` fails | too few or too many concepts — this is a deliberate prompt to curate, not pad |
| Concept not retrieved | the `text` uses code vocabulary instead of natural language |
| Store never rebuilds | the digest marker matches; it rebuilds only when the digest changes |

## Related

- [focus-engine.md](../subsystems/focus-engine.md)
- [semantic-substrate.md](../subsystems/semantic-substrate.md)