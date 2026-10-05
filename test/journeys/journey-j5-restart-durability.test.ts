// J5 durability (acceptance G): semantic history and world state survive a full restart.
// The Cognate SQLite store is the durable truth; the PTY is a fresh process — exactly the
// architecture's claim: facts/events → reduction → current state, across restarts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { startServer, type GsTermServerHandle } from "../../src/server/index.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { WorldStateView } from "../../src/semantic/contracts.ts";
import type { ExecutionEntry } from "../../src/projections/executions.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };

let workspace = "";
let storeDir = "";
let storePath = "";
let first: GsTermServerHandle | undefined;
let second: GsTermServerHandle | undefined;

function config(root: string, port: number): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port },
    world: { id: "local", root },
    session: { id: "restart-test", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {},
  };
}

async function settleAndExecute(handle: GsTermServerHandle, command: string): Promise<ExecutionEntry> {
  const view = await handle.app.runtime.service.startRun(system, {
    agent: "agent.execute",
    input: { argv: ["touch", command], cwd: ".", worldId: "local", source: "ui", surface: "test", requestedBy: "restart-test" },
    idempotencyKey: `restart-${command}`,
    correlationId: "session:restart-test",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    await handle.app.runtime.idle(2_000);
    const run = await handle.app.runtime.service.getRun(system, { runId: view.runId });
    if (run.status === "completed") break;
    if (Date.now() > deadline) throw new Error(`run did not settle: ${run.status}`);
    await Bun.sleep(25);
  }
  const rows = await handle.app.runtime.service.readProjection(system, { name: "executions" });
  return rows.map((row) => row.value as unknown as ExecutionEntry).find((entry) => entry.command?.includes(command))!;
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gsterm-restart-"));
  // The store lives OUTSIDE the observed workspace so its churn never pollutes effect diffs.
  storeDir = await mkdtemp(join(tmpdir(), "gsterm-restart-store-"));
  storePath = join(storeDir, "store.sqlite");
  first = await startServer({ config: config(workspace, 0), domainRoot: REPO_ROOT, store: storePath });
});

afterAll(async () => {
  await second?.stop();
  await first?.stop();
  if (workspace) await rm(workspace, { recursive: true, force: true });
  if (storeDir) await rm(storeDir, { recursive: true, force: true });
});

describe("J5 restart durability (acceptance G)", () => {
  let executionId = "";

  test("first boot settles a structured execution", async () => {
    const entry = await settleAndExecute(first!, "persist-proof.txt");
    executionId = entry.executionId;
    expect(entry.status).toBe("settled");
    expect(await stat(join(workspace, "persist-proof.txt"))).toBeDefined();
  });

  test("semantic history and world state survive a full restart", async () => {
    await first!.stop();
    first = undefined;
    second = await startServer({ config: config(workspace, 0), domainRoot: REPO_ROOT, store: storePath });

    // Projection (derived read model) rebuilt its fold from the durable log.
    const rows = await second.app.runtime.service.readProjection(system, { name: "executions" });
    const entry = rows.map((row) => row.value as unknown as ExecutionEntry).find((candidate) => candidate.executionId === executionId);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("settled");
    expect(entry!.effects.some((effect) => effect.kind === "file.created")).toBe(true);

    // Events are still individually addressable (append-only truth).
    const events: string[] = [];
    for await (const event of second.app.runtime.service.events(system, { runId: entry!.runId })) {
      events.push(event.eventType);
    }
    expect(events).toContain("execution.completed");

    // World shared state reads back (session thread is stable across restarts by design).
    await new Promise((resolve) => setTimeout(resolve, 400)); // boot reconcile
    const shared = await second.app.runtime.service.readSharedState(system, { threadId: "session:restart-test" });
    const view = shared.state as unknown as WorldStateView;
    expect(view.cwd).toBe(workspace);
  });
});
