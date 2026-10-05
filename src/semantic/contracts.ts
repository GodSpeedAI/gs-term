// Semantic contracts shared by the mechanism observers (type-only imports) and the Cognate
// semantic layer (agents, projections, bridge). Pure data shapes — no framework, no I/O.
// Journey source: .sea/interaction/handoff.md (event vocabulary + snapshot/effect/evidence).

export type ObservationMethod = string;

export interface FileObservation {
  /** Path relative to the world's workspace root, `/`-separated. Identity = (worldId, path). */
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  /** Provider-owned staleness token (changes when content changes); opaque above the provider. */
  readonly version: string;
}

export interface GitObservation {
  /** `observed` = facts gathered; `no-repo` = verified outside a repository; `unknown` = not observed. */
  readonly status: "observed" | "no-repo" | "unknown";
  readonly observedAt: string;
  readonly method: string;
  readonly root?: string;
  readonly branch?: string | null;
  readonly dirty?: boolean;
  readonly changedFiles?: readonly string[];
  readonly reason?: string;
}

export interface ProcessObservation {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

export interface PortObservation {
  readonly port: number;
  readonly protocol: "tcp" | "udp";
  readonly address: string;
  readonly pid: number | null;
  readonly process: string | null;
}

export interface ScopeObservation<T> {
  readonly status: "observed";
  readonly observedAt: string;
  readonly method: string;
  readonly entries: readonly T[];
}

export interface UnknownScope {
  readonly status: "unknown";
  readonly observedAt: string;
  readonly reason: string;
}

export type Scoped<T> = ScopeObservation<T> | UnknownScope;

/**
 * Structural port shapes (matching Cognate's FileSystemPort/ProcessPort subsets) so the
 * mechanism layer can observe ANY execution world without importing the framework.
 */
export interface FileStatLike {
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly version: string;
}

export interface FilePort {
  stat(path: string): Promise<FileStatLike | undefined>;
  list(path: string): Promise<readonly { readonly name: string; readonly kind: "file" | "directory" | "other" }[]>;
}

export interface ProcessPort {
  exec(spec: { readonly argv: readonly string[]; readonly cwd: string; readonly timeoutMs?: number }): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly timedOut: boolean;
  }>;
}

/** Which physical world facts were observed in — provenance, never normalized away. */
export interface WorldProvenance {
  readonly worldId: string;
  readonly kind: string;
  /** Provider-safe identity (host, port, username, auth kind, host key…); never credentials. */
  readonly metadata: Readonly<Record<string, string>>;
}

export interface WorldSnapshot {
  readonly observedAt: string;
  readonly world: WorldProvenance;
  readonly root: string;
  readonly walk: { readonly method: string; readonly truncated: boolean; readonly excluded: readonly string[] };
  readonly files: readonly FileObservation[];
  readonly git: GitObservation;
  readonly processes: Scoped<ProcessObservation>;
  readonly ports: Scoped<PortObservation>;
}

export function isScoped<T>(value: Scoped<T>): value is ScopeObservation<T> {
  return "entries" in value;
}

/** Provenance-bearing claim. `observed` > `derived`; `unknown` is not false. */
export interface Evidence {
  readonly what: string;
  readonly how: string;
  readonly confidence: "observed" | "derived" | "unknown";
  readonly refs: readonly string[];
}

export type EffectKind =
  | "file.created"
  | "file.modified"
  | "file.deleted"
  | "git.dirty"
  | "git.clean"
  | "process.started"
  | "process.stopped"
  | "port.opened"
  | "port.closed"
  | "none";

export interface Effect {
  readonly kind: EffectKind;
  /** Resource identity is the pair (worldId, target) — equal paths in different worlds are different resources. */
  readonly worldId: string;
  readonly target: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly evidence: readonly Evidence[];
}

// ── Observations (a fact noticed about reality — never an action/run) ──────────
// Distinct semantic kind from an execution. Causation is cited only when established; otherwise it
// is left unknown. Resource identity is the pair (worldId, resource) — never merged across worlds.

export type ObservationAttributionKind = "unattributed" | "correlated" | "caused";
export type ObservationConfidence = "observed" | "inferred" | "unknown";

export interface ObservationAttribution {
  readonly kind: ObservationAttributionKind;
  readonly correlationId?: string;
  /** The execution event id this fact was caused by (only when `kind === "caused"`). */
  readonly causationEventId?: string;
  readonly confidence?: ObservationConfidence;
}

export interface ObservationSource {
  readonly observer: string;
  readonly provider?: string;
  readonly method?: string;
}

export interface ObservationRecord {
  readonly kind: string;
  readonly subject: { readonly worldId?: string; readonly resource: string; readonly kind?: string };
  readonly facts: unknown;
  readonly source: ObservationSource;
  readonly evidence?: unknown;
  readonly attribution: ObservationAttribution;
  readonly observedAt: string;
  readonly idempotencyKey: string;
}

export type ExecutionSource = "pty" | "ui" | "webmcp";

// ── Event payloads (durable vocabulary; see handoff.md) ───────────────────────

export interface ExecutionStartedPayload {
  readonly executionId: string;
  readonly source: ExecutionSource;
  readonly surface: string;
  readonly worldId: string;
  readonly command: string;
  readonly argv?: readonly string[];
  readonly cwd: string;
  readonly startedAt: string;
  readonly actor: string;
}

export interface EffectObservedPayload {
  readonly executionId: string;
  readonly observedAt: string;
  readonly effects: readonly Effect[];
}

export interface ExecutionCompletedPayload {
  readonly executionId: string;
  readonly exitCode: number | null;
  readonly timedOut?: boolean;
  readonly endedAt: string;
  readonly durationMs: number;
  /** Structured executions capture output; PTY-observed executions do not (unknown, never invented). */
  readonly output: { readonly stdout: string; readonly stderr: string } | "unknown";
  readonly effectsCount: number;
  readonly settled: "observed" | "derived";
}

/** Explicit non-settlement: the run could not reach `execution.completed` (e.g. denied, failed). */
export interface ExecutionFailedPayload {
  readonly executionId: string;
  readonly failedAt: string;
  readonly reason: string;
}

// ── Agent inputs ──────────────────────────────────────────────────────────────

export interface ExecuteAgentInput {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly worldId: string;
  readonly source: ExecutionSource;
  readonly surface: string;
  readonly requestedBy: string;
  readonly timeoutMs?: number;
}

export interface ObserveAgentInput {
  readonly observationId: string;
  readonly sessionId: string;
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly preSnapshot: WorldSnapshot;
  readonly source: "pty";
  readonly surface: string;
}

// ── World state (shared thread state, threadId = `session:<sessionId>`) ──────

export interface WorldStateView {
  readonly sessionId: string;
  readonly shell: string;
  readonly cwd: string;
  readonly terminal: { readonly alive: boolean; readonly cols: number; readonly rows: number; readonly pid: number | null };
  readonly repository: GitObservation;
  readonly processes: Scoped<ProcessObservation>;
  readonly ports: Scoped<PortObservation>;
  readonly lastExecution: {
    readonly executionId: string;
    readonly worldId: string;
    readonly source: ExecutionSource;
    readonly command: string;
    readonly exitCode: number | null;
    readonly endedAt: string;
  } | null;
  readonly observedAt: string;
}
