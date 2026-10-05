// The observation bridge: the single adapter between the Cognate-free mechanism layer and the
// semantic world. Shell-integration markers arrive here; the bridge turns them into catalogued
// journey runs (J1 agent.observe) and reconciles world shared state (J3) after settlements.
// It never writes events directly — Cognate's only door to durable truth is agent runs.
import type { Caller, RuntimeService, StateUpdate } from "@cognate/runtime-api";
import type { Json } from "@cognate/events";
import type { CommandDoneMarker, CommandStartMarker, Marker } from "../shell/markers.ts";
import type { WorldSnapshot, WorldStateView } from "../semantic/contracts.ts";
import { buildWorldState } from "../observers/snapshot.ts";
import { json } from "../agents/shared.ts";

export const ACTOR_SYSTEM = "system";

function isExecutionSource(value: string | undefined): value is "pty" | "ui" | "webmcp" {
  return value === "pty" || value === "ui" || value === "webmcp";
}

export interface ObservationBridgeOptions {
  readonly service: RuntimeService;
  readonly sessionId: string;
  /** The execution world hosting the PTY session (observed executions + world view live here). */
  readonly sessionWorldId: string;
  readonly root: string;
  readonly shell: string;
  readonly sessionPid: () => number | undefined;
  readonly terminalInfo: () => WorldStateView["terminal"];
  readonly tenant?: string;
  readonly onError?: (context: string, error: unknown) => void;
}

interface TerminalRunOutput {
  readonly executionId?: string;
  readonly worldId?: string;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly endedAt?: string;
  readonly source?: string;
}

export class ObservationBridge {
  private readonly caller: Caller;
  private pendingCommand: CommandStartMarker | undefined;
  private pendingPre: Promise<WorldSnapshot> | undefined;
  private lastCwd: string | undefined;
  private chain: Promise<void> = Promise.resolve();
  private follower: AbortController | undefined;
  private closed = false;

  constructor(private readonly options: ObservationBridgeOptions) {
    this.caller = { tenant: options.tenant ?? "local", actor: { id: ACTOR_SYSTEM, kind: "system" } };
  }

  /** Feed every shell-integration marker (already parsed from the PTY stream). */
  handleMarker(marker: Marker): void {
    if (this.closed) return;
    if (marker.code === "R") {
      if (!this.pendingPre) this.pendingPre = this.snapshot();
      return;
    }
    if (marker.code === "A") {
      this.pendingCommand = marker;
      if (!this.pendingPre) this.pendingPre = this.snapshot();
      return;
    }
    if (marker.code === "D") {
      const command = this.pendingCommand;
      const pre = this.pendingPre ?? this.snapshot();
      this.pendingCommand = undefined;
      this.lastCwd = marker.cwd; // shell-builtin `cd` changes the world here, not in effects
      // Rotate IMMEDIATELY (synchronously): the next command's pre-state starts at this prompt.
      this.pendingPre = this.snapshot();
      if (command) {
        const prePromise = pre;
        this.enqueue(() => this.recordObservation(command, marker, prePromise));
      }
    }
  }

  /** J3 trigger from J4: attach/refresh reconciles the world view. */
  reconcile(trigger: string): void {
    this.enqueue(() => this.reconcileWorld(undefined, trigger));
  }

  /** Follow durable run settlements and reconcile world state after each session-scoped run. */
  startFollower(): void {
    if (this.follower) return;
    const controller = new AbortController();
    this.follower = controller;
    void this.followRuns(controller.signal);
  }

  private async followRuns(signal: AbortSignal): Promise<void> {
    const correlationPrefix = `session:${this.options.sessionId}`;
    try {
      for await (const event of this.options.service.events(this.caller, { follow: true, signal })) {
        if (this.closed) break;
        if (event.eventType !== "run.completed" && event.eventType !== "run.failed" && event.eventType !== "run.cancelled") continue;
        if (!event.correlationId.startsWith(correlationPrefix)) continue;
        const output = event.eventType === "run.completed" ? ((event.payload as { output?: TerminalRunOutput }).output ?? undefined) : undefined;
        const agent = (event.metadata as { agent?: string } | undefined)?.agent;
        this.enqueue(() => this.reconcileWorld(output && agent === "agent.observe" ? output : undefined, `${event.eventType} ${event.runId ?? ""}`));
      }
    } catch (error) {
      if (!this.closed) this.options.onError?.("followRuns", error);
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch((error) => {
      this.options.onError?.("bridge-chain", error);
    });
  }

  private snapshot(): Promise<WorldSnapshot> {
    const pending = this.options.service
      .invoke(this.caller, { capability: "world.snapshot", input: json({ worldId: this.options.sessionWorldId }) })
      .then((result) => result as unknown as WorldSnapshot);
    // Rotated/abandoned snapshots must never surface as unhandled rejections (shutdown races).
    pending.catch(() => undefined);
    return pending;
  }

  /** J1: settle the observed command as a durable semantic execution (agent.observe). */
  private async recordObservation(command: CommandStartMarker, done: CommandDoneMarker, pre: Promise<WorldSnapshot>): Promise<void> {
    const preSnapshot = await pre;
    const observationId = `obs_${crypto.randomUUID()}`;
    await this.options.service.startRun(this.caller, {
      agent: "agent.observe",
      input: json({
        observationId,
        sessionId: this.options.sessionId,
        command: command.command,
        cwd: command.cwd,
        exitCode: done.exitCode,
        startedAt: new Date(command.startedAtMs).toISOString(),
        endedAt: new Date(done.endedAtMs).toISOString(),
        preSnapshot,
        source: "pty",
        surface: "terminal",
      }),
      idempotencyKey: `observe:${this.options.sessionId}:${observationId}`,
      correlationId: `session:${this.options.sessionId}`,
    });
  }

  /** J3: fold observed facts into durable, versioned world shared state (honest about unknowns). */
  private async reconcileWorld(lastExecution: TerminalRunOutput | undefined, trigger: string): Promise<void> {
    const snapshot = await this.snapshot();
    const previous = await this.options.service.readSharedState(this.caller, { threadId: this.threadId() });
    const previousState = (previous.state ?? null) as WorldStateView | null;
    const prior = previousState?.lastExecution ?? null;
    const state = buildWorldState({
      sessionId: this.options.sessionId,
      shell: this.options.shell,
      cwd: this.lastCwd ?? previousState?.cwd ?? this.options.root,
      terminal: this.options.terminalInfo(),
      snapshot,
      lastExecution:
        lastExecution && lastExecution.executionId
          ? {
              executionId: lastExecution.executionId,
              worldId: lastExecution.worldId ?? this.options.sessionWorldId,
              source: isExecutionSource(lastExecution.source) ? lastExecution.source : "pty",
              command: lastExecution.command ?? "",
              exitCode: lastExecution.exitCode ?? null,
              endedAt: lastExecution.endedAt ?? snapshot.observedAt,
            }
          : prior,
    });
    await this.writeWorldState(state, trigger);
  }

  private async writeWorldState(state: WorldStateView, trigger: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.options.service.readSharedState(this.caller, { threadId: this.threadId() });
      const update: StateUpdate = { snapshot: state as unknown as Json };
      try {
        await this.options.service.updateSharedState(this.caller, {
          threadId: this.threadId(),
          update,
          idempotencyKey: `world:${this.options.sessionId}:${crypto.randomUUID()}`,
          expectedVersion: current.version,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("version") && attempt < 4) continue; // stale writer: re-read and retry
        this.options.onError?.(`world-state ${trigger}`, error);
        return;
      }
    }
  }

  threadId(): string {
    return `session:${this.options.sessionId}`;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.follower?.abort();
    await this.chain.catch(() => undefined);
  }
}

