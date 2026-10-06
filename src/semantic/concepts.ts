// Curated concept registry (Phase 3 substrate prep): gs-term's own application-domain concepts —
// what a semantic query retrieves BEFORE any source chunk (zvec-grep owns source). Pure data
// module, no I/O (CryptoHasher is pure computation). Provenance: curated, human-authored; the
// `links` are the AUTHORITATIVE structure into the codebase/structural graph — vector similarity
// NEVER creates topology, embeddings only retrieve. Docs become zvec collection entries
// (fields id/kind/label/text/metadata/links) via the Rust helper's `concept.replace`.
// `conceptRegistryDigest` (version + docs, in order) drives concept-store freshness: rebuild the
// store when the digest changes. Journey grounding: .sea/interaction/canonical-journey-catalog.md.

// ── Shape ─────────────────────────────────────────────────────────────────────

/** A curated application concept with explicit structural links into the repo. */
export interface ConceptDoc {
  /** Stable slug, e.g. "concept:focus.human-governance". */
  readonly id: string;
  /** zvec filter field — concepts are always kind "concept" (never source chunks). */
  readonly kind: "concept";
  /** Short human name. */
  readonly label: string;
  /**
   * 2–5 sentences of natural description — THE embedding input. Phrases the concept in words
   * that do NOT necessarily appear in the code: that is the point of semantic retrieval.
   */
  readonly text: string;
  /** area = the coarse part of the system; journeys = canonical J-ids the concept grounds. */
  readonly metadata: { readonly area: string; readonly journeys: readonly string[] };
  /**
   * Repo-relative paths (optionally `path#Symbol`). Authoritative structural links — similarity
   * may surface a concept, but only these links say what it is about.
   */
  readonly links: readonly string[];
}

/** Bump when curated content changes → concept store rebuild (digest includes it). */
export const CONCEPT_REGISTRY_VERSION = 1;

/** The coarse system areas a concept can belong to (kept in one place so curation stays consistent). */
export const CONCEPT_AREAS = [
  "focus", "search", "worlds", "execution", "observation", "effects", "webmcp",
  "terminal", "shell", "projection", "authority", "persistence",
] as const;

// ── Registry ──────────────────────────────────────────────────────────────────

export const CONCEPTS: readonly ConceptDoc[] = [
  // ── Focus / attention ────────────────────────────────────────────────────────
  {
    id: "concept:focus.human-governance",
    kind: "concept",
    label: "Human-governed shared focus",
    text:
      "This is the rule that keeps the human in charge of what deserves attention: the shared working context between user and agent can only be changed by an explicit human decision. An assistant that believes something matters may suggest it, but accepting, pinning, or rejecting that suggestion is an intentional human act — enforced by a server-side action policy on the focus thread, not by hiding buttons in the UI. A suggestion the human turned down cannot come back unchanged; it needs materially new evidence before it may be proposed again. This is where the system prevents an agent from quietly taking over the user's focus or wearing down attention with repeated pitches.",
    metadata: { area: "focus", journeys: ["J11", "J12", "J15"] },
    links: [
      "src/semantic/focus.ts",
      "src/focus/focus.ts",
      "src/agents/focus.ts",
      "src/app/policy.ts#gstermActions",
      ".sea/interaction/interaction-model.sea",
    ],
  },
  {
    id: "concept:focus.attention-snapshot",
    kind: "concept",
    label: "Frozen attention snapshot",
    text:
      "When the user opens contextual search, the system freezes what \"this\" pointed to at that exact moment. Pointer movement, world switches, or later activity can never silently change the referent of an already-open question; a search resolves against the world and entity captured when it started unless the user explicitly refreshes. Resolution follows a fixed, inspectable precedence — an explicit selection outranks keyboard focus, which outranks where the pointer happened to rest — rather than a made-up confidence number, and near-miss candidates are surfaced as alternatives instead of guessed away.",
    metadata: { area: "focus", journeys: ["J7", "J13"] },
    links: ["src/focus/attention.ts", "src/focus/search.ts", "src/semantic/focus.ts"],
  },
  {
    id: "concept:focus.engine",
    kind: "concept",
    label: "Deterministic focus engine loop",
    text:
      "Around any goal, the cockpit reduces the whole computational world to the smallest useful working set, deterministically and without a language model. Inputs are the user's stated goal, a transient estimate of human attention, the accepted shared focus, the current world, and observed reality; the output is a bounded working set plus the actions that make sense on it. Whenever executions settle and new effects and evidence arrive, the reduction is recomputed from the new facts. Ranking and reduction are derivations — they are never recorded as observations of the world.",
    metadata: { area: "focus", journeys: ["J7", "J10", "J11", "J12"] },
    links: ["src/semantic/focus.ts", "src/focus/search.ts", "src/focus/affordances.ts"],
  },
  {
    id: "concept:focus.candidates",
    kind: "concept",
    label: "Agent focus proposals",
    text:
      "When an agent wants to influence what the human looks at, its only channel is a structured proposal: the entity it thinks matters, why, the evidence backing that belief, the value it expects, and the next actions it would suggest. Submitting a proposal changes nothing by itself — the shared focus stays exactly as it was until a human resolves it. The proposal lifecycle records who proposed, when, and how it was resolved, and a rejected proposal is blocked from resubmission unless the evidence has materially changed. Suggested next actions are semantic operations, so a machine proposal renders the same actions a human would see.",
    metadata: { area: "focus", journeys: ["J11"] },
    links: ["src/focus/focus.ts", "src/agents/focus.ts", "src/semantic/focus.ts"],
  },
  {
    id: "concept:focus.affordances",
    kind: "concept",
    label: "Contextual affordances for focused entities",
    text:
      "Whatever the user is focused on, the system offers only the operations that genuinely apply to that kind of thing: a code symbol offers to trace references and find related tests; a listening port offers to reveal its owning process and the execution that opened it; a finished execution offers to inspect its evidence or run again. Each offered action names a precise semantic operation rather than a screen location, so the same affordances surface for a human clicking in the cockpit and for a machine reading them through a tool.",
    metadata: { area: "focus", journeys: ["J7", "J15"] },
    links: ["src/focus/affordances.ts", "src/semantic/focus.ts", "src/agents/focus.ts"],
  },

  // ── Syntelligent Search ──────────────────────────────────────────────────────
  {
    id: "concept:search.syntelligent",
    kind: "concept",
    label: "Syntelligent Search with reduction receipts",
    text:
      "This is how questions like \"what is this?\", \"why did this fail?\", or \"who calls this?\" get answered without dumping a haystack: the planner picks the cheapest useful retrieval path, narrows the space step by step, and returns a small bounded result set. Crucially it also returns a receipt — an inspectable record of the reduction funnel showing which stages ran, how many candidates each stage eliminated, and which mechanisms produced the survivors — so \"why these results?\" always has an answer. Ranking is a derivation from evidence; it is never claimed as an observation of the world.",
    metadata: { area: "search", journeys: ["J7", "J8", "J9", "J10"] },
    links: ["src/focus/search.ts", "src/semantic/focus.ts"],
  },
  {
    id: "concept:search.mechanism-availability",
    kind: "concept",
    label: "Honest mechanism availability and degradation",
    text:
      "Retrieval mechanisms — exact text search, a language server, hybrid or vector indexes — are each reported with truthful availability and freshness for the world being searched. If a mechanism is not mounted, search degrades honestly: the answer says what was unavailable and why, and it never silently falls back to a local index when the question was about a remote world. Commands run through the target world's own process port, so the same grep mechanism runs wherever the target world lives. Crossing worlds is a deliberate user act, never a silent substitution.",
    metadata: { area: "search", journeys: ["J10", "J14"] },
    links: ["src/focus/mechanisms.ts", "src/focus/search.ts", "src/semantic/focus.ts"],
  },
  {
    id: "concept:search.structural-map",
    kind: "concept",
    label: "Deterministic structural map tier",
    text:
      "Between plain text matching and semantic retrieval sits a deliberately minimal deterministic graph: the workspace, its modules and tests, import edges, and which tests exercise which modules — extracted from actual evidence, with explicit freshness, and nothing more. It exists to eliminate candidates cheaply before any expensive mechanism runs, and it intentionally contains no generated summaries: typed edges from observed facts only. Not every syntactic detail is modeled; the map is a reduction instrument, not a mirror of the code.",
    metadata: { area: "search", journeys: ["J10"] },
    links: ["src/focus/mechanisms.ts", "src/semantic/focus.ts"],
  },

  // ── Execution worlds / execution model ───────────────────────────────────────
  {
    id: "concept:worlds.execution-worlds",
    kind: "concept",
    label: "Execution worlds: one capability, many providers",
    text:
      "The same operation — run this command — can happen on the local machine or on a remote host without becoming a different operation. Which physical place a run happens in is an input property of the execution, chosen by world id, and there is deliberately no per-provider verb for remote access anywhere in the semantic layer; a provider registry maps the id to concrete mechanics below the semantic boundary. A resource's identity is the pair of world and path, so the same filename on the local world and on a remote world are two different resources whose provenance is never normalized away. Worlds exist only where configured — an unregistered world id fails closed rather than defaulting somewhere.",
    metadata: { area: "worlds", journeys: ["J2"] },
    links: ["src/app/worlds.ts", "src/agents/execute.ts", "src/semantic/contracts.ts"],
  },
  {
    id: "concept:execution.two-doors",
    kind: "concept",
    label: "Two doors, one semantic execution model",
    text:
      "A human typing in the terminal and a machine calling a capability are two doors into one world. Whatever surface a command came from — the terminal, a button in the cockpit, or a browser tool — it becomes the same kind of execution with the same event vocabulary, the same history projection, and the same reconciled world state; the originating surface is recorded as plain metadata and never forks the model into separate ontologies. This convergence is the core invariant of the whole system: actor and surface describe who and how, not what a thing is.",
    metadata: { area: "execution", journeys: ["J1", "J2"] },
    links: ["src/agents/execute.ts", "src/agents/observe.ts", "src/semantic/contracts.ts", "src/bridge/observation.ts"],
  },

  // ── Observation / effects / evidence ─────────────────────────────────────────
  {
    id: "concept:observation.ingestion",
    kind: "concept",
    label: "First-class observation ingestion (facts without runs)",
    text:
      "Noticing a fact is not the same as performing an action, and this is where the two are kept apart. Things discovered outside any command — a file appearing on its own, a port opening, a connection dropping, a foreign change on a remote host — enter the durable log as run-less observations carrying observation provenance, instead of pretending an action produced them. Causation is cited only when it is actually established; when the cause is unknown it stays unknown. High-value effects of real executions fan out into this same door as idempotent observations that remain correlated with, but distinct from, the intent that produced them. The story of this mechanism — a missing ingest primitive recognized as framework debt and then resolved — is itself part of the record.",
    metadata: { area: "observation", journeys: ["J3", "J6"] },
    links: ["src/semantic/observations.ts", "src/bridge/observations.ts", "src/bridge/observation.ts", ".agents/DEBT.md"],
  },
  {
    id: "concept:effects.evidence",
    kind: "concept",
    label: "Effects derived with evidence and provenance",
    text:
      "Claiming that a command changed the world requires proof, and this is where such claims are derived and disciplined. Effects come from diffing a coherent snapshot taken before an execution against one taken after, and every effect carries its evidence: what was observed, by what method, with what confidence, and which snapshots support it. Exit code zero is never treated as proof that side effects happened, and an unobserved scope is never asserted as unchanged — a clean run with no observed difference yields \"no observed change\", which is itself evidence rather than a guess.",
    metadata: { area: "effects", journeys: ["J1", "J2", "J3"] },
    links: ["src/semantic/effects.ts", "src/semantic/contracts.ts"],
  },
  {
    id: "concept:worlds.state-reconciliation",
    kind: "concept",
    label: "World state reconciliation",
    text:
      "The cockpit's picture of the world — current directory, repository state, the session's processes, listening ports, the last settled execution — is re-derived from observed facts whenever a command settles or a viewer attaches. It is published as versioned shared state written with an expected version and idempotency, so readers always see a coherent snapshot rather than a torn mix. Fields that could not be observed carry an explicit unknown with a reason, and a previously observed value is retained rather than flipped to false when an observer hiccups. Because the state is durable, the view survives restarts.",
    metadata: { area: "worlds", journeys: ["J3", "J4"] },
    links: ["src/bridge/observation.ts", "src/observers/snapshot.ts", "src/semantic/contracts.ts"],
  },
  {
    id: "concept:observers.ports-processes",
    kind: "concept",
    label: "Port and process observation with attribution",
    text:
      "Listening sockets and processes are observed under a strict attribution rule: a port is claimed only when it can be attributed to the session's own process tree, and a listener nobody can attribute is left unclaimed rather than guessed. This is what lets the system answer \"what opened this port?\" with evidence — the port, the process behind it, and the execution that started it. On remote worlds, where session-tree attribution is a local concept, these scopes are reported honestly as unknown instead of being faked.",
    metadata: { area: "observation", journeys: ["J3"] },
    links: ["src/observers/ports.ts", "src/observers/processes.ts", "src/semantic/contracts.ts"],
  },
  {
    id: "concept:observers.filesystem-git",
    kind: "concept",
    label: "Filesystem and git observation",
    text:
      "File trees and repository state are gathered through the target world's own ports, so a local workspace and a remote host produce the same evidence shapes. Repository facts keep three distinct truths apart — outside any repository, observed clean or dirty, and simply not observed — and never collapse \"couldn't check\" into \"no changes\". The directory walk is capped and flags truncation, keeping snapshots bounded and honest about what they did not see.",
    metadata: { area: "observation", journeys: ["J1", "J3"] },
    links: ["src/observers/filesystem.ts", "src/observers/git.ts", "src/semantic/contracts.ts"],
  },

  // ── WebMCP projection ────────────────────────────────────────────────────────
  {
    id: "concept:webmcp.projection",
    kind: "concept",
    label: "WebMCP as a projection of capabilities",
    text:
      "Tools exposed to the browser are projections of the very same capability definitions the cockpit buttons use — there is exactly one implementation of each operation and every surface delegates to it. Tool names and descriptions speak in domain meaning (execute a command, read world state, search the current focus) and never leak mechanism vocabulary. One deliberate omission encodes a rule: there is no tool for accepting, pinning, or rejecting a focus proposal, because a machine must never be able to resolve its own suggestion into shared focus.",
    metadata: { area: "webmcp", journeys: ["J2", "J15"] },
    links: ["src/webmcp/descriptors.ts", "src/webmcp/project.ts", "src/app/policy.ts"],
  },
  {
    id: "concept:webmcp.remote-offers",
    kind: "concept",
    label: "Remote capability offer seam (consumption)",
    text:
      "This is the preserved seam for the inverse direction: an external page offering a capability that the system could consume as a remote, leased capability rather than something it owns. The mapping from a foreign tool description to a lease-bound offer with a bounded lifetime is typed and tested, and importing identity never imports authority — an offer describes what can be asked, not who is allowed. The actual consumption loop is deliberately not built; the seam exists so the future can be added without re-architecture.",
    metadata: { area: "webmcp", journeys: [] },
    links: ["src/webmcp/consumption.ts", "src/webmcp/descriptors.ts", ".sea/interaction/canonical-journey-catalog.md"],
  },

  // ── Terminal / shell ─────────────────────────────────────────────────────────
  {
    id: "concept:terminal.pty-surface",
    kind: "concept",
    label: "Real PTY terminal compatibility surface",
    text:
      "The terminal is a real terminal: a genuine pseudo-terminal hosting the user's real bash, never a simulated shell. Any number of viewers attach and detach over sockets while the session lives on across disconnects, and on attach each new viewer receives a bounded replay of recent scrollback held in memory — raw terminal bytes are never written to durable storage or the semantic log. Resizes propagate to the real tty, and when the shell dies its exit is shown honestly rather than papered over with a respawn.",
    metadata: { area: "terminal", journeys: ["J1", "J4"] },
    links: ["src/terminal/session.ts", "src/terminal/scrollback.ts", "src/terminal/protocol.ts"],
  },
  {
    id: "concept:shell.integration-markers",
    kind: "concept",
    label: "Shell integration command boundaries",
    text:
      "Command boundaries are established by shell integration, never by scraping rendered prompt text. A bash init file installs a pre-execution trap that marks when a command starts and a prompt hook that marks when it finishes with its exit code and directory; these markers ride the byte stream as escape sequences and are parsed and stripped server-side before any viewer renders the output. Hooks inherited from a parent shell or IDE integration are discarded or absorbed inside guarded wrappers so that prompt machinery can never masquerade as a user command.",
    metadata: { area: "shell", journeys: ["J1"] },
    links: ["src/shell/bash-init.sh", "src/shell/markers.ts", "src/terminal/session.ts"],
  },

  // ── Projections / authority / persistence ────────────────────────────────────
  {
    id: "concept:projection.executions",
    kind: "concept",
    label: "Execution history projection",
    text:
      "Execution history is a derived read model rather than authoritative state: a deterministic fold of execution events that can be rebuilt from the log at any time. Each entry carries status, the argument vector, world, actor, timing, exit code, and the effects that were derived — everything the cockpit inspector needs to answer \"what ran, where, and what did it change\". A marker-key bridge lets runtime-level failures, which only know the run, still land on the execution entry they belong to. Because the underlying events are durable, history is still there after a restart.",
    metadata: { area: "projection", journeys: ["J5"] },
    links: ["src/projections/executions.ts"],
  },
  {
    id: "concept:authority.machine-explicit",
    kind: "concept",
    label: "Explicit machine authority (dev boundary)",
    text:
      "The human's unrestricted shell is a compatibility surface, and no machine permission is ever inferred from it. What automation may do is granted explicitly and everything else denies by default: a small allow-list of capabilities for recognized actors, checked at the kernel boundary, plus service-level action rules for runs, threads, and observations. Transport identity is a development bearer token carrying tenant, actor, and actor kind — an honest development boundary that is explicitly not production authentication. The policy identifiers trace back to named invariants in the interaction domain model.",
    metadata: { area: "authority", journeys: ["J1", "J2"] },
    links: ["src/app/policy.ts", "src/server/index.ts"],
  },
  {
    id: "concept:security.secrets-isolation",
    kind: "concept",
    label: "Secrets stay provider-side",
    text:
      "Credentials never travel. Key material, passwords, and agent-socket references live inside the provider configuration and go no further; everything else in the system can see at most the authentication kind and a host-key fingerprint — enough to prove how a world authenticates without ever exposing the secret itself. Events, logs, the cockpit, and browser-facing tools are kept clean of credential values, and tests assert the leak cannot regress silently.",
    metadata: { area: "authority", journeys: ["J2"] },
    links: ["src/app/worlds.ts", "src/semantic/contracts.ts", "src/app/policy.ts"],
  },
  {
    id: "concept:persistence.durability",
    kind: "concept",
    label: "Durable events and deterministic reconstruction",
    text:
      "Durable truth lives in a local SQLite event store, and everything else is rebuilt from it. World state is versioned shared state, execution history is a fold with a versioned checkpoint, and observations replay idempotently through stable keys — so a restart loses nothing and cannot double-record. The property being protected is deterministic reconstruction: given the facts and events, reducing them always yields the same current state.",
    metadata: { area: "persistence", journeys: ["J1", "J5"] },
    links: ["src/app/runtime.ts", "src/server/index.ts", "src/projections/executions.ts"],
  },
];

// ── Freshness digest ──────────────────────────────────────────────────────────

/** Canonical per-doc serialization (fixed field order → stable regardless of key insertion order). */
function serializeConcept(doc: ConceptDoc): string {
  return JSON.stringify([doc.id, doc.kind, doc.label, doc.text, doc.metadata.area, doc.metadata.journeys, doc.links]);
}

/**
 * Stable sha256 over the serialized registry (registry version + docs, in order).
 * Format `sha256:<hex>` (matches the domain-model digest convention). The concept store uses
 * this for freshness: rebuild when the digest changes. Accepts an override so tests can prove
 * the digest actually tracks content.
 */
export function conceptRegistryDigest(registry: readonly ConceptDoc[] = CONCEPTS): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`v${CONCEPT_REGISTRY_VERSION}\n`);
  for (const doc of registry) hasher.update(`${serializeConcept(doc)}\n`);
  return `sha256:${hasher.digest("hex")}`;
}
