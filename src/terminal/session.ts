// Terminal session: one real PTY (Bun.Terminal + Bun.spawn) with a real shell, shared by N
// WebSocket viewers (attach/detach), a bounded scrollback ring, and shell-integration markers
// routed to the semantic bridge. Mechanism layer — this file knows nothing about Cognate.
import { MarkerParser, type Marker } from "../shell/markers.ts";
import { Scrollback } from "./scrollback.ts";

export interface SessionExitInfo {
  readonly exitCode: number;
}

export interface TerminalSessionOptions {
  readonly id: string;
  readonly shell: string;
  /** Absolute path of the bash integration init file (`bash --init-file`). */
  readonly initFile: string;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly scrollbackBytes: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type OutputListener = (data: Uint8Array) => void;
export type MarkerListener = (marker: Marker) => void;
export type ExitListener = (info: SessionExitInfo) => void;
export type ResizeListener = (cols: number, rows: number) => void;

export class TerminalSession {
  readonly id: string;
  cols: number;
  rows: number;
  alive = false;
  exitCode: number | null = null;
  shellPid: number | undefined;

  private terminal: Bun.Terminal | undefined;
  private proc: Bun.Subprocess | undefined;
  private readonly parser = new MarkerParser();
  private readonly scrollback: Scrollback;
  private readonly outputListeners = new Set<OutputListener>();
  private readonly markerListeners = new Set<MarkerListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly resizeListeners = new Set<ResizeListener>();

  constructor(private readonly options: TerminalSessionOptions) {
    this.id = options.id;
    this.cols = options.cols;
    this.rows = options.rows;
    this.scrollback = new Scrollback(options.scrollbackBytes);
  }

  async start(): Promise<void> {
    if (this.terminal) throw new Error(`session ${this.id} already started`);
    this.terminal = new Bun.Terminal({
      cols: this.cols,
      rows: this.rows,
      data: (_term, data) => this.handleData(data),
    });
    // `Bun.spawn({terminal})` does not make the child a session leader (observed on Bun 1.4.0):
    // the shell then lacks job control and tty signals (Ctrl-C) never reach its processes.
    // `setsid` grants the shell its own session with the PTY as controlling terminal —
    // verified: bash reports `Ss+`, interrupt reaches foreground jobs, the shell survives.
    // Without `setsid` on PATH we fall back to a direct spawn and say so in the exit behavior.
    const setsid = Bun.which("setsid");
    const argv = setsid ? [setsid, this.options.shell, "--init-file", this.options.initFile] : [this.options.shell, "--init-file", this.options.initFile];
    this.proc = Bun.spawn(argv, {
      terminal: this.terminal,
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env, TERM: "xterm-256color" },
    });
    this.shellPid = this.proc.pid;
    this.alive = true;
    void this.proc.exited.then((code) => {
      this.alive = false;
      this.exitCode = code;
      const held = this.parser.flush();
      if (held.length > 0) this.broadcast(held);
      for (const listener of this.exitListeners) listener({ exitCode: code });
    });
  }

  private handleData(data: Uint8Array): void {
    const { clean, markers } = this.parser.push(data);
    if (clean.length > 0) this.broadcast(clean);
    for (const marker of markers) {
      // The integration's ready marker carries the shell's own pid (robust even if a
      // launcher wrapper forked) — it becomes the process-tree root for observations.
      if (marker.code === "R") this.shellPid = marker.pid;
      for (const listener of this.markerListeners) listener(marker);
    }
  }

  private broadcast(data: Uint8Array): void {
    this.scrollback.push(data);
    for (const listener of this.outputListeners) listener(data);
  }

  /** Viewer input (raw keystrokes). */
  write(data: Uint8Array | string): void {
    if (!this.alive || !this.terminal) return;
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 512 || rows > 256) return;
    this.cols = cols;
    this.rows = rows;
    if (this.alive && this.terminal) {
      this.terminal.resize(cols, rows);
      for (const listener of this.resizeListeners) listener(cols, rows);
    }
  }

  /** Attach a viewer: replays bounded scrollback first, then live bytes. Returns detach. */
  attach(options: { readonly output?: OutputListener; readonly marker?: MarkerListener; readonly exit?: ExitListener; readonly resize?: ResizeListener }): () => void {
    const detachFns: (() => void)[] = [];
    if (options.output) {
      const listener = options.output;
      this.outputListeners.add(listener);
      detachFns.push(() => this.outputListeners.delete(listener));
    }
    if (options.marker) {
      const listener = options.marker;
      this.markerListeners.add(listener);
      detachFns.push(() => this.markerListeners.delete(listener));
    }
    if (options.exit) {
      const listener = options.exit;
      this.exitListeners.add(listener);
      detachFns.push(() => this.exitListeners.delete(listener));
    }
    if (options.resize) {
      const listener = options.resize;
      this.resizeListeners.add(listener);
      detachFns.push(() => this.resizeListeners.delete(listener));
    }
    const replay = this.scrollback.replay();
    if (replay.length > 0 && options.output) options.output(replay);
    return () => {
      for (const fn of detachFns) fn();
    };
  }

  /** Deterministic teardown: PTY closed, shell killed, listeners cleared. */
  async close(): Promise<void> {
    this.outputListeners.clear();
    this.markerListeners.clear();
    this.exitListeners.clear();
    this.resizeListeners.clear();
    try {
      this.terminal?.close();
    } catch {
      // already closed
    }
    if (this.proc && this.alive) {
      this.proc.kill("SIGTERM");
      const timeout = setTimeout(() => this.proc?.kill("SIGKILL"), 2_000);
      await this.proc.exited.catch(() => undefined);
      clearTimeout(timeout);
    }
    this.alive = false;
    this.shellPid = undefined;
  }
}
