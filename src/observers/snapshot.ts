// Snapshot orchestrator: one coherent WorldSnapshot per world, gathered through that world's
// provider ports (local, SSH, …) — SAME evidence shape everywhere, provenance says where.
// Processes/ports are session-tree facts (a local-PTY concept, DEBT D-010): without a session
// root pid they are honestly `unknown`, never invented.
import type { FilePort, ProcessPort, WorldProvenance, WorldSnapshot, WorldStateView } from "../semantic/contracts.ts";
import { walkWorldFiles } from "./filesystem.ts";
import { observeGit } from "./git.ts";
import { observeSessionPorts } from "./ports.ts";
import { observeSessionProcesses } from "./processes.ts";

export interface WorldSnapshotOptions {
  readonly world: WorldProvenance;
  readonly fileSystem: FilePort;
  readonly process: ProcessPort;
  readonly root: string;
  /** Live session root pid — only meaningful for the world hosting the PTY session. */
  readonly sessionPid?: number | undefined;
}

export async function takeWorldSnapshot(options: WorldSnapshotOptions): Promise<WorldSnapshot> {
  const observedAt = new Date().toISOString();
  const [walk, git, processes] = await Promise.all([
    walkWorldFiles(options.fileSystem, options.root),
    observeGit(options.process, options.root),
    observeSessionProcesses(options.sessionPid),
  ]);
  const pids = "entries" in processes ? new Set(processes.entries.map((entry) => entry.pid)) : new Set<number>();
  const ports = await observeSessionPorts(pids);
  return {
    observedAt,
    world: options.world,
    root: options.root,
    walk: { method: `${walk.method} world=${options.world.worldId}`, truncated: walk.truncated, excluded: [".git", "node_modules", ".cognate"] },
    files: walk.files,
    git,
    processes,
    ports,
  };
}

/** Fold a snapshot + session facts into the world state view (J3, session world). Pure. */
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

