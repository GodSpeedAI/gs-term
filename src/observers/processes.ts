// Process observer: descendants of the session's root process, read from /proc.
// Mechanism layer — no Cognate imports. Linux /proc; failure surfaces as `unknown`.
import type { ProcessObservation, Scoped } from "../semantic/contracts.ts";

const METHOD = "/proc descendant walk (ppid chain)";

interface ProcStat {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

async function readAllStats(): Promise<ProcStat[] | undefined> {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const pids = await readdir("/proc");
    const stats: ProcStat[] = [];
    for (const entry of pids) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const raw = await readFile(`/proc/${entry}/stat`, "utf8");
        // comm may contain spaces/parens; everything after the last ')' is well-formed.
        const close = raw.lastIndexOf(")");
        const comm = raw.slice(raw.indexOf("(") + 1, close);
        const rest = raw.slice(close + 2).split(" ");
        stats.push({ pid: Number(entry), ppid: Number(rest[1]), command: comm });
      } catch {
        // process exited mid-scan
      }
    }
    return stats;
  } catch {
    return undefined;
  }
}

/** Collect `rootPid` plus every descendant (breadth-first over ppid edges). */
export async function observeSessionProcesses(rootPid: number | undefined): Promise<Scoped<ProcessObservation>> {
  const observedAt = new Date().toISOString();
  if (rootPid === undefined || rootPid <= 0) {
    return { status: "unknown", observedAt, reason: "no live session root process" };
  }
  const stats = await readAllStats();
  if (!stats) return { status: "unknown", observedAt, reason: "/proc unavailable" };
  const byPid = new Map(stats.map((stat) => [stat.pid, stat]));
  const children = new Map<number, ProcStat[]>();
  for (const stat of stats) {
    const list = children.get(stat.ppid) ?? [];
    list.push(stat);
    children.set(stat.ppid, list);
  }
  const root = byPid.get(rootPid);
  if (!root) return { status: "unknown", observedAt, reason: `root process ${rootPid} not found` };
  const entries: ProcessObservation[] = [];
  const queue: ProcStat[] = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.pid)) continue;
    seen.add(current.pid);
    entries.push({ pid: current.pid, ppid: current.ppid, command: current.command });
    for (const child of children.get(current.pid) ?? []) queue.push(child);
  }
  return { status: "observed", observedAt, method: METHOD, entries };
}
