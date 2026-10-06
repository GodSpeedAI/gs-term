// Client for the `gsterm-solidlsp` Python bridge (SolidLSP from the MIT
// serena-agent 1.7.0 wheel, provisioning the TypeScript language server under
// Bun). Mechanism layer: lifecycle + protocol only. The bridge is responsible
// for its own child language-server processes; dispose() is always protocol
// shutdown first so the bridge can kill its process tree.
import { resolve } from "node:path";
import { JsonLinesProcess } from "./jsonlines.ts";

export interface SolidLspLocation {
  readonly file: string;
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

export interface SolidLspDiagnostic {
  readonly range: unknown;
  readonly severity: number;
  readonly message: string;
  readonly code?: string;
}

export interface SolidLspHello {
  readonly name: string;
  readonly version: string;
  readonly solidlsp: string;
  readonly languages: readonly string[];
  readonly ts_server: {
    readonly runtime: string;
    readonly runtime_version: string | null;
    readonly language_server: string;
    readonly typescript: string;
    readonly installed: boolean;
    readonly executable: string | null;
  };
}

export interface SolidLspOptions {
  /** Repo root; the bridge project dir resolves under it. */
  readonly repoRoot: string;
  readonly projectDir: string;
  /** Pinned bun executable for the node→bun shim (defaults to `bun` on PATH). */
  readonly bunPath?: string;
  readonly requestTimeoutMs?: number;
}

export class SolidLspBridge {
  private process: JsonLinesProcess | undefined;
  private hello: SolidLspHello | undefined;
  private lastWorkspace: string | undefined;

  constructor(private readonly options: SolidLspOptions) {}

  get running(): boolean {
    return this.process?.running === true;
  }

  get info(): SolidLspHello | undefined {
    return this.hello;
  }

  private spawnCommand(): string[] {
    const projectDir = resolve(this.options.repoRoot, this.options.projectDir);
    return ["uv", "run", "--project", projectDir, "python", "-m", "gsterm_solidlsp"];
  }

  async start(): Promise<SolidLspHello> {
    if (this.running && this.hello) return this.hello;
    const process = new JsonLinesProcess({
      command: this.spawnCommand(),
      ...(this.options.bunPath ? { env: { GSTERM_BUN: this.options.bunPath } } : {}),
      requestTimeoutMs: this.options.requestTimeoutMs ?? 120_000,
    });
    process.start();
    this.process = process;
    try {
      const hello = (await process.call("hello", {}, 30_000)) as SolidLspHello;
      this.hello = hello;
      return hello;
    } catch (error) {
      this.process = undefined;
      await process.dispose();
      throw error;
    }
  }

  async ensureStarted(): Promise<SolidLspHello> {
    if (!this.running) return this.start();
    return this.hello!;
  }

  /**
   * Start (or keep) the language server for one workspace. `start` may take
   * minutes on a cold data dir (bun-driven provisioning) — bounded here.
   */
  async startWorkspace(workspace: string, dataDir?: string): Promise<{ ready: boolean; workspace: string }> {
    await this.ensureStarted();
    if (this.lastWorkspace === workspace && (await this.ready()).running) {
      return { ready: true, workspace };
    }
    const result = (await this.process!.call("start", { workspace, ...(dataDir ? { data_dir: dataDir } : {}) }, 420_000)) as { ready: boolean; workspace: string };
    this.lastWorkspace = workspace;
    return result;
  }

  async ready(): Promise<{ running: boolean }> {
    return (await this.process!.call("ready", {})) as { running: boolean };
  }

  async restart(): Promise<{ ready: boolean }> {
    return (await this.process!.call("restart", {}, 180_000)) as { ready: boolean };
  }

  async symbols(file: string): Promise<readonly unknown[]> {
    return (await this.process!.call("symbols", { file })) as readonly unknown[];
  }

  async workspaceSymbols(query: string): Promise<readonly unknown[]> {
    return (await this.process!.call("workspace_symbols", { query })) as readonly unknown[];
  }

  async definition(file: string, line: number, column: number): Promise<readonly SolidLspLocation[]> {
    return (await this.process!.call("definition", { file, line, column })) as readonly SolidLspLocation[];
  }

  async references(file: string, line: number, column: number, includeDeclaration = false): Promise<readonly SolidLspLocation[]> {
    return (await this.process!.call("references", { file, line, column, include_declaration: includeDeclaration })) as readonly SolidLspLocation[];
  }

  async implementations(file: string, line: number, column: number): Promise<readonly SolidLspLocation[]> {
    return (await this.process!.call("implementations", { file, line, column })) as readonly SolidLspLocation[];
  }

  async hover(file: string, line: number, column: number): Promise<{ contents: string | null }> {
    return (await this.process!.call("hover", { file, line, column })) as { contents: string | null };
  }

  async diagnostics(file: string): Promise<readonly SolidLspDiagnostic[]> {
    return (await this.process!.call("diagnostics", { file })) as readonly SolidLspDiagnostic[];
  }

  async dispose(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.hello = undefined;
    this.lastWorkspace = undefined;
    await process?.dispose();
  }
}
