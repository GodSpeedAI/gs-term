# Why search reduces instead of retrieving

## The question

"who calls this?" and "why did this fail?" and "give me an overview of the observation architecture"
are different questions. Should one search engine answer all of them?

gs-term's answer is no. Search routes by **intent** and runs the fewest mechanisms that can answer
the question asked.

## The principle

The naive design runs every mechanism against the query and ranks the union. That produces a lot of
results, a slow answer, and a plausible-looking ranking whose basis you cannot explain.

The reduction design asks three questions first:

1. **What is being asked?** `detectIntent` maps the query to one of eight intents.
2. **What is the cheapest mechanism that can answer it?** An exact coordinate needs no discovery at
   all; an architecture question needs no source retrieval at all.
3. **What survived verification?** Candidates are checked against the world before being claimed.

## Routing as reduction

| Intent | Stages run | Deliberately absent |
| --- | --- | --- |
| `why-did-this-fail` | execution evidence → bounded code retrieval | broad source search before evidence |
| `who-calls-this` | exact coordinate → SolidLSP references | workspace symbol discovery; rg as a *supplement* |
| `what-is-this` | exact coordinate → SolidLSP definition | same |
| exact identifier | rg, bounded | semantic layers |
| `architecture` | concepts → structural scope → **stop** | zvec-grep, rg — the answer is the concept layer |
| `semantic` (natural language) | concepts → structural scope → zvec-grep → rg snippet verification | — |

For `who-calls-this` with a referent that has `path:line:column`, the answer goes straight to
SolidLSP references. No `workspaceSymbols`, no rg discovery. `test/journeys/journey-j9-…` asserts
this, because it is the difference between ~40 s cold and ~1 s warm.

## Symbol resolution is tiered and records its tier

The receipt records `TargetProvenance`:

| Tier | Trigger | Cost |
| --- | --- | --- |
| `exact-coordinate` | the referent already has one | none |
| `document-refined` | `path:line` known → read that line, find the identifier | one line read |
| `workspace-symbol` | name only → `workspaceSymbols` with bounded retries | one project query |
| `declaration-fallback` | still nothing → rg as a *position finder* only | one rg |

The tier is provenance, not telemetry. It tells a reader *how* the position was established, which is
exactly what is needed to trust a reference answer.

Note the discipline in the last tier: rg finds the **position**; the semantic answer still comes from
the language server. rg never becomes the semantic authority.

## Availability is observed, then reported

`resolveAvailability` reports per mechanism, per world:

- `rg` is probed through the world's own process port, so a remote world reports *its* ripgrep;
- `solidlsp`, `zvec-grep`, `zvec` are `ready` only when the managed client for **this** world probed
  successfully;
- a remote world gets no substrate client, and therefore reports those mechanisms `unavailable` with
  a reason.

Local results are never substituted for a remote world's. That is the J14 journey.

## The receipt is the product

`SearchReceipt` is not a debug artifact. It answers "why these?" with:

- the detected intent;
- the availability snapshot for this world;
- **every stage that actually ran, with its true candidate count** — a stage that did not run is
  never listed;
- the reduction funnel: `workspace → focusScope → structural → semantic → verified`;
- `provenance: {method, crossWorld: false}`.

Verification is real: a zvec-grep candidate's snippet must exist on disk (a bounded `rg -F` inside
that file). Unverified candidates are dropped, and `verified` reflects the survivors.

## Concepts retrieve; they do not create structure

The concept registry (`src/semantic/concepts.ts`) holds curated, human-authored descriptions of
gs-term's own domain concepts with **explicit links** into the repository. Vector similarity may
surface a concept; only `links` say what it is about.

Freshness is a digest over the registry (`conceptRegistryDigest`, sha256 over a canonical
serialisation). When the digest changes, the store is rebuilt with pruning. This is cheap because the
registry is the whole truth — there is no crawling to invalidate.

zvec-grep owns **source** retrieval; the zvec collection stores **only** concept objects. Splitting
the responsibility this way is why "architecture" questions can stop at the concept layer without
pretending a document search is a conceptual one.

## No language model

The whole planner is deterministic. Given the same world, the same snapshot, the same availability
and the same query, it produces the same results and the same receipt. That is testable, which is how
`test/focus/search.test.ts` and `test/journeys/journey-j9-…` assert routing without mocking.

## Ranking is a derivation, not an observation

Search results and reductions are computed and discarded. They never enter the durable log as facts
about the world. A test asserts the log stays free of ranking and pointer noise. This keeps
"what happened" separate from "what the system thought was relevant".

## Known limits

| Limit | Effect |
| --- | --- |
| Ambient referent limits — plain-language referents sometimes miss the intended entity (D-036) | the user must select or point |
| The structural map is deliberately minimal (D-035) | it eliminates candidates cheaply; it is not a mirror of the code |
| Cold tsserver can return empty or "No Project" (D-041) | bounded retries, then the rg position fallback |
| Max five results | by design |

## Source trail

- `src/focus/search.ts` — `syntelligentSearch`, `detectIntent`, `resolveSymbolTarget`, the receipt
- `src/focus/mechanisms.ts` — `resolveAvailability`, `buildStructuralMap`, `rgSearch`,
  `declarationPattern`, `declarationColumn`
- `src/focus/concept-index.ts` — `ensureConceptIndex`, `conceptQueryFor`
- `src/semantic/concepts.ts` — `CONCEPTS`, `conceptRegistryDigest`
- `src/components/focus.ts` — the capability wrapper
- `test/focus/search.test.ts`, `search-semantic.test.ts`
- `test/journeys/journey-j9-semantic-reduction.test.ts` — routing and latency
- `src/semantic/concepts.ts:100-126` — `concept:search.*`