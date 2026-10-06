// Client for the `gsterm-semantic` Rust helper (zvec-grep engine + zvec concept
// store + model2vec). Mechanism layer: knows the stdio protocol and nothing
// about Cognate. Crash policy: one transparent restart attempt per call, then
// surface the error — callers degrade honestly instead of retry-storming.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JsonLinesProcess, MechanismProcessError } from "./jsonlines.ts";

export interface ZgSearchItem {
  readonly relative_path: string;
  readonly start_line: number | null;
  readonly end_line: number | null;
  readonly snippet: string;
  readonly score: number | null;
  readonly matched_by: string;
  readonly symbol_name: string | null;
  readonly symbol_type: string | null;
  readonly status: string;
}

export interface ZgSearchResult {
  readonly source: string;
  readonly coverage: string;
  readonly items: readonly ZgSearchItem[];
}

export interface ZgModelStatus {
  readonly reference: string;
  readonly ready: boolean;
  readonly path: string;
  readonly dimension: number;
  readonly revision: string;
}

/** gs-term concept object (see src/semantic/concepts.ts; zvec doc fields). */
export interface ConceptDoc {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly text: string;
  readonly metadata: Record<string, string>;
  readonly links: readonly string[];
}

export interface ConceptMatch {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** Cosine DISTANCE — lower is closer. */
  readonly score: number;
  readonly metadata: Record<string, string>;
  readonly links: readonly string[];
}

export interface SemanticHelperInfo {
  readonly name: string;
  readonly version: string;
  readonly zg_engine_revision: string;
  readonly zvec_version: string;
  readonly model: { readonly reference: string; readonly dimension: number };
}

/** Discovery order: explicit config → GSTERM_HELPER_BIN → artifacts → target/release. */
export function discoverHelperBinary(explicit: string, repoRoot: string): string | undefined {
  const candidates = [
    ...(explicit === "" ? [] : [explicit]),
    ...(Bun.env.GSTERM_HELPER_BIN ? [Bun.env.GSTERM_HELPER_BIN] : []),
    resolve(repoRoot, "rust/artifacts/bin/gsterm-semantic"),
    resolve(repoRoot, "rust/target/release/gsterm-semantic"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // stat failed: try the next candidate
    }
  }
  return undefined;
}

export interface SemanticHelperOptions {
  readonly binary: string;
  readonly modelCache?: string;
  readonly requestTimeoutMs?: number;
}

export class SemanticHelper {
  private process: JsonLinesProcess | undefined;
  private info: SemanticHelperInfo | undefined;
  private readonly restarts = new Map<string, number>();

  constructor(private readonly options: SemanticHelperOptions) {}

  get running(): boolean {
    return this.process?.running === true;
  }

  get hello(): SemanticHelperInfo | undefined {
    return this.info;
  }

  async start(): Promise<SemanticHelperInfo> {
    if (this.running && this.info) return this.info;
    const env: Record<string, string> = {};
    if (this.options.modelCache) env.GSTERM_MODEL_CACHE = this.options.modelCache;
    const process = new JsonLinesProcess({
      command: [this.options.binary],
      env,
      requestTimeoutMs: this.options.requestTimeoutMs ?? 120_000,
    });
    process.start();
    this.process = process;
    try {
      const hello = (await process.call("hello", {}, 30_000)) as SemanticHelperInfo;
      this.info = hello;
      return hello;
    } catch (error) {
      this.process = undefined;
      await process.dispose();
      throw error;
    }
  }

  async ensureStarted(): Promise<void> {
    if (!this.running) await this.start();
  }

  async zgSearch(params: { root: string; query: string; mode: "hybrid" | "fts" | "vector"; limit?: number; refresh?: "off" | "wait"; file_types?: readonly string[] }): Promise<ZgSearchResult> {
    return (await this.callWithRestart("zg.search", params)) as ZgSearchResult;
  }

  async zgIndex(root: string, options: { embedding?: string; rebuild?: boolean } = {}): Promise<unknown> {
    return this.callWithRestart("zg.index", { root, embedding: options.embedding, rebuild: options.rebuild });
  }

  async zgInfo(root: string, includeStatus = true): Promise<unknown> {
    return this.callWithRestart("zg.info", { root, include_status: includeStatus });
  }

  async zgDrop(root: string): Promise<{ dropped: boolean }> {
    return (await this.callWithRestart("zg.drop", { root })) as { dropped: boolean };
  }

  async modelStatus(): Promise<ZgModelStatus> {
    return (await this.callWithRestart("model.status", {})) as ZgModelStatus;
  }

  async conceptEnsure(path: string): Promise<{ doc_count: number }> {
    return (await this.callWithRestart("concept.ensure", { path })) as { doc_count: number };
  }

  async conceptReplace(path: string, docs: readonly ConceptDoc[], prune = false): Promise<{ written: number; pruned: number }> {
    return (await this.callWithRestart("concept.replace", { path, docs, prune })) as { written: number; pruned: number };
  }

  async conceptQuery(path: string, text: string, topk = 8, kind?: string): Promise<{ items: readonly ConceptMatch[] }> {
    return (await this.callWithRestart("concept.query", { path, text, topk, kind })) as { items: readonly ConceptMatch[] };
  }

  async conceptStats(path: string): Promise<{ doc_count: number }> {
    return (await this.callWithRestart("concept.stats", { path })) as { doc_count: number };
  }

  async dispose(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.info = undefined;
    await process?.dispose();
  }

  /**
   * One call with one crash-restart attempt. The restart map bounds repeated
   * failures per method: after two failed restarts for the same method the
   * error surfaces without another spawn attempt this process lifetime.
   */
  private async callWithRestart(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    try {
      return await this.process!.call(method, params);
    } catch (error) {
      if (!(error instanceof MechanismProcessError) || this.process?.running === true) throw error;
      const attempts = this.restarts.get(method) ?? 0;
      if (attempts >= 2) throw error;
      this.restarts.set(method, attempts + 1);
      this.process = undefined;
      await this.start();
      return this.process!.call(method, params);
    }
  }
}
