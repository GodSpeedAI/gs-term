// Focus / attention / Syntelligent Search semantics (Phase 3). Pure data shapes — no framework,
// no I/O. World-scoped identity everywhere: a resource is (worldId, workspace, id) and equal
// paths in different worlds are never merged (Phase-2 invariant). DERIVED/semantic concepts,
// not Cognate events — the bridge/agents decide how they enter the log.
// Journey source: .sea/interaction/canonical-journey-catalog.md (J7–J15).

// ── World-scoped identity ─────────────────────────────────────────────────────

/** A semantic thing the human/agent can attend to. Identity = (worldId, workspace, kind, id). */
export interface EntityRef {
  readonly worldId: string;
  readonly workspace: string;
  readonly kind: "CodeSymbol" | "Diagnostic" | "Execution" | "Effect" | "Observation" | "WorkspaceResource" | "ListeningPort" | "Process" | "GitChange" | "SearchResult" | "FocusCandidate" | "Module" | "Test";
  readonly id: string;
  readonly name?: string;
  readonly location?: { readonly path?: string; readonly line?: number; readonly column?: number };
}

// ── Attention (transient; NOT SharedFocus) ────────────────────────────────────

/** Best estimate of what the human attends to. Transient; only meaningful boundaries persist. */
export interface HumanAttention {
  readonly worldId: string;
  readonly workspace: string;
  readonly primary?: EntityRef;
  readonly selection?: EntityRef;
  readonly keyboardFocus?: EntityRef;
  readonly pointerTarget?: EntityRef;
  readonly activeExecution?: { readonly executionId: string; readonly command: string };
  readonly activePanel?: string;
  readonly recentInteraction?: string;
  readonly updatedAt: string;
}

/** The agent may inspect entities independently; this never changes SharedFocus. */
export interface AgentAttention {
  readonly worldId: string;
  readonly workspace: string;
  readonly inspecting?: EntityRef;
  readonly updatedAt: string;
}

// ── AttentionSnapshot (frozen at `/`; referents do not silently mutate) ───────

export interface AttentionSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly sharedFocusVersion: number;
  readonly referent?: EntityRef;
  readonly pointerEntity?: EntityRef;
  readonly activeExecution?: { readonly executionId: string; readonly command: string };
  readonly activePanel?: string;
  readonly capturedAt: string;
  readonly provenance: { readonly method: string; readonly precedence: string };
}

// ── SharedFocus (human-governed collaborative context) ────────────────────────

export interface SharedFocus {
  readonly sessionId: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly version: number;
  readonly goal?: string;
  readonly primary?: EntityRef;
  readonly pinned: readonly EntityRef[];
  readonly workingSet: readonly EntityRef[];
  readonly unresolved: readonly string[];
  readonly evidence: readonly FocusEvidence[];
  readonly validation?: string;
  readonly updatedAt: string;
}

export interface FocusEvidence {
  readonly what: string;
  readonly how: string;
  readonly confidence: "observed" | "derived" | "unknown";
  readonly refs: readonly string[];
}

// ── FocusCandidate (the only normal path for an agent to propose a change) ────

export type CandidateStatus = "proposed" | "accepted" | "pinned" | "rejected" | "superseded";

export interface Affordance {
  readonly id: string;
  readonly label: string;
  /** The precise semantic operation behind the affordance (never a DOM path). */
  readonly operation: string;
  readonly target?: EntityRef;
}

export interface FocusCandidate {
  readonly id: string;
  readonly worldId: string;
  readonly workspace: string;
  readonly proposedEntity: EntityRef;
  readonly proposedGoalDelta?: string;
  readonly reason: string;
  readonly evidence: readonly FocusEvidence[];
  readonly expectedValue?: string;
  readonly suggestedNextActions: readonly Affordance[];
  readonly sourceAgent: string;
  readonly status: CandidateStatus;
  /** Materially-new-evidence token — gates identical reproposal after a rejection. */
  readonly evidenceToken: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
}

// ── Search mechanisms, availability, freshness ────────────────────────────────

export type MechanismName = "rg" | "solidlsp" | "zvec-grep" | "zvec" | "structural-map";
export type MechanismStatus = "ready" | "building" | "stale" | "unavailable";

export interface MechanismAvailability {
  readonly name: MechanismName;
  readonly status: MechanismStatus;
  readonly freshness?: string;
  readonly reason?: string;
}

// ── Structural map (deterministic graph used to reduce search) ────────────────

export interface StructuralNode {
  readonly ref: EntityRef;
  readonly kind: "workspace" | "package" | "module" | "symbol" | "test" | "capability" | "entrypoint";
  readonly label: string;
}

export interface StructuralEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "imports" | "defines" | "tests" | "calls" | "contains";
}

export interface StructuralMap {
  readonly worldId: string;
  readonly workspace: string;
  readonly revision?: string;
  readonly status: MechanismStatus;
  readonly nodes: readonly StructuralNode[];
  readonly edges: readonly StructuralEdge[];
  readonly fileCount: number;
}

// ── Search results + receipt (bounded; provenance-preserving) ─────────────────

export interface SearchResult {
  readonly entity: EntityRef;
  readonly reason: string;
  readonly evidence: readonly FocusEvidence[];
  readonly mechanisms: readonly MechanismName[];
  readonly freshness: MechanismStatus;
  readonly location?: { readonly path?: string; readonly line?: number; readonly snippet?: string };
  readonly relevance: "strongest" | "likely" | "related";
  readonly affordances: readonly Affordance[];
}

export type SearchIntent = "what-is-this" | "why-did-this-fail" | "who-calls-this" | "related-tests" | "changed-recently" | "what-opened-this-port" | "semantic" | "reconnect";

/** The inspectable reduction funnel + receipt for one Syntelligent Search invocation. */
export interface SearchReceipt {
  readonly id: string;
  readonly query: string;
  readonly intent: SearchIntent;
  readonly worldId: string;
  readonly workspace: string;
  readonly snapshotId?: string;
  readonly sharedFocusVersion: number;
  readonly availability: readonly MechanismAvailability[];
  readonly stages: readonly { readonly name: string; readonly mechanism?: MechanismName; readonly candidates: number }[];
  readonly reduction: { readonly workspace: number; readonly focusScope: number; readonly structural: number; readonly semantic: number; readonly verified: number };
  readonly results: readonly SearchResult[];
  readonly provenance: { readonly method: string; readonly crossWorld: false };
  readonly searchedAt: string;
}
