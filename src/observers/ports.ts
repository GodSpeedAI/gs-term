// Port observer: listening TCP sockets attributable to the session's process tree.
// Mechanism layer — no Cognate imports. Uses `ss -H -ltnp`; unattributed listeners are
// not claimed (absence of attribution is never asserted as absence of the port).
import type { PortObservation, Scoped } from "../semantic/contracts.ts";

const METHOD = "ss -H -ltnp (session-tree attribution)";

export function parseSsOutput(output: string, allowedPids: ReadonlySet<number>): readonly PortObservation[] {
  const listeners: PortObservation[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const columns = line.trim().split(/\s+/);
    // STATE Recv-Q Send-Q Local Address:Port Peer Address:Port [users:(("name",pid=N,fd=F))]
    const local = columns[3] ?? "";
    const colon = local.lastIndexOf(":");
    if (colon < 0) continue;
    const port = Number(local.slice(colon + 1));
    if (!Number.isFinite(port)) continue;
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    const pid = users ? Number(users[2]) : null;
    const process = users ? users[1]! : null;
    if (pid === null || !allowedPids.has(pid)) continue; // attribution rule (U3)
    listeners.push({ port, protocol: "tcp", address: local.slice(0, colon), pid, process });
  }
  return listeners;
}

export async function observeSessionPorts(sessionPids: ReadonlySet<number>): Promise<Scoped<PortObservation>> {
  const observedAt = new Date().toISOString();
  if (sessionPids.size === 0) {
    return { status: "unknown", observedAt, reason: "no observed session processes to attribute ports to" };
  }
  try {
    const proc = Bun.spawn(["ss", "-H", "-ltnp"], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) return { status: "unknown", observedAt, reason: `ss failed: ${stderr.trim()}` };
    return { status: "observed", observedAt, method: METHOD, entries: parseSsOutput(stdout, sessionPids) };
  } catch (error) {
    return { status: "unknown", observedAt, reason: error instanceof Error ? error.message : String(error) };
  }
}
