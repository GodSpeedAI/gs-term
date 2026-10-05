// Snapshot orchestrator: one coherent WorldSnapshot from the individual observers.
// This is the single function the `world.snapshot` capability delegates to (via composition),
// and the state view builder for world-state reconciliation (J3).
import type { WorldSnapshot, WorldStateView } from "../semantic/contracts.ts";
import { isScoped } from "../semantic/contracts.ts";
import { walkWorkspace } from "./filesystem.ts";
import { observeGit } from "./git.ts";
import { observeSessionPorts } from "./ports.ts";
import { observeSessionProcesses } from "./processes.ts";

export interface SnapshotOptions {
  readonly root: string;
  readonly sessionPid?: number | undefined;
}

export async function takeWorldSnapshot(options: SnapshotOptions): Promise<WorldSnapshot> {
  const observedAt = new Date().toISOString();
  const [walk, git, processes] = await Promise.all([
    walkWorkspace(options.root),
    observeGit(options.root),
    observeSessionProcesses(options.sessionPid),
  ]);
  const pids = isScoped(processes) ? new Set(processes.entries.map((entry) => entry.pid)) : new Set<number>();
  const ports = await observeSessionPorts(pids);
  return {
    observedAt,
    root: options.root,
    walk: { method: walk.method, truncated: walk.truncated, excluded: [".git", "node_modules", ".cognate"] },
    files: walk.files,
    git,
    processes,
    ports,
  };
}

/** Fold a snapshot + session facts into the world state view (J3). Pure. */
export function buildWorldState(input: {
  readonly sessionId: string;
  readonly shell: string;
  readonly cwd: string;
  readonly terminal: WorldStateView["terminal"];
  readonly snapshot: WorldSnapshot;
  readonly lastExecution: WorldStateView["lastExecution"];
}): WorldStateView {
  return {
    sessionId: input.sessionId,
    shell: input.shell,
    cwd: input.cwd,
    terminal: input.terminal,
    repository: input.snapshot.git,
    processes: input.snapshot.processes,
    ports: input.snapshot.ports,
    lastExecution: input.lastExecution,
    observedAt: input.snapshot.observedAt,
  };
}
