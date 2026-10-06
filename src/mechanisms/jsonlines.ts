// Generic stdio JSON-lines process client (mechanism layer). Speaks the shared
// envelope over a managed child process spawned with Bun.spawn: requests carry
// a monotonic numeric id; responses correlate by id; id-less lines are
// notifications. Structured process calls ONLY — never the PTY (AGENTS.md).
export interface JsonLinesOptions {
  readonly command: readonly string[];
  /** Environment additions; `PATH` additions must be explicit (never inherited implicitly). */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  /** Per-request timeout (ms); long provisioning calls may override per call. */
  readonly requestTimeoutMs?: number;
  /** Notifications (id-less lines) for progress-aware callers. */
  readonly onNotification?: (method: string, params: unknown) => void;
}

export class MechanismProcessError extends Error {
  constructor(message: string, readonly stderrTail: string) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const STDERR_RING_LIMIT = 8_000;

export class JsonLinesProcess {
  private process: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrRing = "";
  private writeChain: Promise<void> = Promise.resolve();
  private readonly opts: Required<Pick<JsonLinesOptions, "requestTimeoutMs">> & JsonLinesOptions;
  private exited = false;
  private malformedCount = 0;

  constructor(options: JsonLinesOptions) {
    this.opts = { requestTimeoutMs: 60_000, ...options };
  }

  get running(): boolean {
    return this.process !== undefined && !this.exited && this.process.exitCode === null;
  }

  start(): void {
    if (this.running) return;
    this.exited = false;
    this.stderrRing = "";
    const spawnOptions: Parameters<typeof Bun.spawn>[1] = { stdin: "pipe", stdout: "pipe", stderr: "pipe" };
    if (this.opts.env) spawnOptions.env = { ...Bun.env, ...this.opts.env };
    if (this.opts.cwd) spawnOptions.cwd = this.opts.cwd;
    const proc = Bun.spawn([...this.opts.command], spawnOptions);
    this.process = proc;
    void this.pumpStdout(proc);
    void this.pumpStderr(proc);
    void proc.exited.then((code) => {
      this.exited = true;
      // Surface a precise error to every waiter when the process dies.
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new MechanismProcessError(`mechanism process exited (code ${code})`, this.stderrTail()));
      }
      this.pending.clear();
    });
  }

  /** Send a request and await its correlated response. */
  async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.running) throw new MechanismProcessError("mechanism process is not running", this.stderrTail());
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.opts.requestTimeoutMs;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MechanismProcessError(`${method} timed out after ${timeout}ms`, this.stderrTail()));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
    await this.writeLine({ id, method, params: params ?? {} });
    return promise;
  }

  /** Protocol shutdown: ask politely, wait briefly, then kill. Never orphans. */
  async dispose(): Promise<void> {
    const proc = this.process;
    if (!proc || this.exited) return;
    try {
      await this.call("shutdown", {}, 3_000);
    } catch {
      // fall through to kill
    }
    const deadline = Date.now() + 2_000;
    while (proc.exitCode === null && Date.now() < deadline) {
      await Bun.sleep(50);
    }
    if (proc.exitCode === null) proc.kill();
    await proc.exited;
    this.process = undefined;
  }

  private async writeLine(value: unknown): Promise<void> {
    const proc = this.process;
    if (!proc) throw new MechanismProcessError("mechanism process is not running", this.stderrTail());
    // Serialize writes so concurrent callers cannot interleave lines.
    const previous = this.writeChain;
    let release: () => void = () => undefined;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      proc.stdin.write(`${JSON.stringify(value)}\n`);
      await new Promise<void>((resolve, reject) => {
        proc.stdin.flush();
        resolve();
        void reject;
      });
    } finally {
      release();
    }
  }

  private async pumpStdout(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
    const reader = proc.stdout.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          this.handleLine(line);
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      // process died mid-read: pending requests are rejected by proc.exited
    }
  }

  private async pumpStderr(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Bounded ring: diagnostics for failures, never an unbounded log.
        this.stderrRing = (this.stderrRing + decoder.decode(value)).slice(-STDERR_RING_LIMIT);
      }
    } catch {
      // ignore
    }
  }

  private handleLine(line: string): void {
    if (line === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.malformedCount++;
      return;
    }
    const record = value as { id?: unknown; method?: unknown; result?: unknown; error?: { message?: string } };
    if (typeof record.id !== "number") {
      if (typeof record.method === "string") this.opts.onNotification?.(record.method, record.result ?? null);
      return;
    }
    const pending = this.pending.get(record.id);
    if (!pending) return;
    this.pending.delete(record.id);
    clearTimeout(pending.timer);
    if (record.error !== undefined && record.error !== null) {
      pending.reject(new MechanismProcessError(String(record.error.message ?? "mechanism error"), this.stderrTail()));
    } else {
      pending.resolve(record.result);
    }
  }

  private stderrTail(): string {
    return this.stderrRing.length > 0 ? this.stderrRing.slice(-600) : "";
  }

  get diagnostics(): { malformed: number; pending: number } {
    return { malformed: this.malformedCount, pending: this.pending.size };
  }
}
