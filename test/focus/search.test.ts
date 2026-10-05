// Syntelligent Search (J8–J10/J14): exact search uses rg; the structural map narrows; the reduction
// funnel is bounded and monotonic; evidence-first for failed executions; and a world with unavailable
// mechanisms degrades truthfully (never a silent cross-world substitution).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessPort } from "../../src/semantic/contracts.ts";
import { buildStructuralMap, rgFiles, rgSearch, resolveAvailability } from "../../src/focus/mechanisms.ts";
import { detectIntent, syntelligentSearch } from "../../src/focus/search.ts";

// A real ProcessPort that runs commands through Bun (structured, never the PTY).
const spawnPort: ProcessPort = {
  async exec(spec) {
    const proc = Bun.spawn({ cmd: [...spec.argv], cwd: spec.cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode, timedOut: false };
  },
};

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gsterm-search-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "test"), { recursive: true });
  await writeFile(join(root, "src", "session.ts"), "export function reconnectSession() { return restoreSession(); }\nexport function restoreSession() { return 1; }\n");
  await writeFile(join(root, "src", "other.ts"), "import { reconnectSession } from \"./session.ts\";\nexport const x = reconnectSession;\n");
  await writeFile(join(root, "test", "session.test.ts"), "import { reconnectSession } from \"../src/session.ts\";\ntest(\"reconnect\", () => reconnectSession());\n");
});
afterEach(async () => rm(root, { recursive: true, force: true }));

const ctx = () => ({ process: spawnPort, root, worldId: "local", workspace: "gs-term", mounted: new Set(["structural-map"]) });

describe("search mechanisms", () => {
  test("rg --files is the file inventory (first-class reduction)", async () => {
    const files = await rgFiles(spawnPort, root);
    expect(files.some((f) => f.endsWith("session.ts"))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test("rg exact search finds an identifier with location", async () => {
    const matches = await rgSearch(spawnPort, root, "reconnectSession");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].path).toContain("session");
    expect(matches[0].line).toBeGreaterThan(0);
  });

  test("availability is honest: rg + structural-map ready, semantic mechanisms unavailable", async () => {
    const availability = await resolveAvailability(spawnPort, root, new Set(["structural-map"]));
    const byName = new Map(availability.map((a) => [a.name, a]));
    expect(byName.get("rg")?.status).toBe("ready");
    expect(byName.get("structural-map")?.status).toBe("ready");
    expect(byName.get("zvec-grep")?.status).toBe("unavailable");
    expect(byName.get("solidlsp")?.status).toBe("unavailable");
  });
});

describe("structural map", () => {
  test("builds deterministic nodes and import/test edges", async () => {
    const map = await buildStructuralMap(spawnPort, root, "local", "gs-term");
    expect(map.status).toBe("ready");
    expect(map.nodes.some((n) => n.kind === "workspace")).toBe(true);
    expect(map.nodes.some((n) => n.kind === "module")).toBe(true);
    expect(map.nodes.some((n) => n.kind === "test")).toBe(true);
    expect(map.edges.some((e) => e.kind === "imports" && e.to.endsWith("session.ts"))).toBe(true);
    expect(map.edges.some((e) => e.kind === "tests")).toBe(true);
  });
});

describe("Syntelligent Search", () => {
  test("deterministic intent detection", () => {
    expect(detectIntent("who calls reconnectSession")).toBe("who-calls-this");
    expect(detectIntent("why did this fail")).toBe("why-did-this-fail");
    expect(detectIntent("what is this")).toBe("what-is-this");
    expect(detectIntent("related tests")).toBe("related-tests");
  });

  test("exact identifier narrows via rg and stays bounded with a reduction receipt", async () => {
    const { results, receipt } = await syntelligentSearch({ query: "who calls reconnectSession" }, ctx());
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(receipt.provenance.crossWorld).toBe(false);
    expect(receipt.reduction.workspace).toBeGreaterThanOrEqual(receipt.reduction.structural);
    expect(receipt.reduction.verified).toBeLessThanOrEqual(5);
    expect(receipt.availability.some((a) => a.name === "zvec-grep" && a.status === "unavailable")).toBe(true);
    expect(receipt.stages.some((s) => s.mechanism === "rg")).toBe(true);
    expect(results[0].affordances.length).toBeGreaterThan(0);
  });

  test("why-did-this-fail inspects execution evidence before broad source search", async () => {
    const { receipt } = await syntelligentSearch(
      { query: "why did this fail" },
      { ...ctx(), execution: { executionId: "e1", command: "bun test", exitCode: 1, affected: ["src/session.ts"] } },
    );
    expect(receipt.intent).toBe("why-did-this-fail");
    expect(receipt.stages.some((s) => s.name === "execution-evidence")).toBe(true);
    expect(receipt.stages.find((s) => s.name === "execution-evidence")!.candidates).toBe(1);
  });

  test("search results are world-scoped (never cross worlds)", async () => {
    const { results } = await syntelligentSearch({ query: "reconnectSession" }, ctx());
    expect(results.every((r) => r.entity.worldId === "local")).toBe(true);
    expect(results.every((r) => r.entity.workspace === "gs-term")).toBe(true);
  });
});
