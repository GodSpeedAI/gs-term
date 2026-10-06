// J9/J10/J14 acceptance proof (Phase 3.5): the REAL semantic substrate — the
// built Rust helper (zvec-grep + zvec concepts) and the SolidLSP bridge —
// running against the gs-term repository itself. Proves:
//   1. `/ who calls this?` answers with SolidLSP references (rg not primary);
//   2. a conceptual query whose wording appears nowhere in the source reduces
//      through concepts → structural scope → zvec-grep → verification into a
//      small bounded result set (with reduction measurements);
//   3. an architecture question stops at the concept layer.
// Skips honestly when the substrate is not built (GSTERM_SKIP_SEMANTIC=1 or a
// clean checkout without bootstrap); a skipped proof is an unmet gate for
// release — it must run in the phase validation.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import { discoverHelperBinary } from "../../src/mechanisms/semantic-helper.ts";
import { json } from "../../src/agents/shared.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const system: Caller = { tenant: "local", actor: { id: "system", kind: "service" } };

let app: GsTermRuntime | undefined;
let skipReason: string | undefined;

function config(): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root: REPO_ROOT },
    session: { id: "main", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
    worlds: {},
  };
}

interface StageRecord {
  readonly name: string;
  readonly mechanism?: string;
  readonly candidates: number;
}

interface OutcomeShape {
  readonly results: readonly { entity: { id: string; name?: string; location?: { path?: string; line?: number } }; reason: string; mechanisms: readonly string[] }[];
  readonly receipt: { stages: readonly StageRecord[]; availability: { name: string; status: string }[]; reduction: Record<string, number>; provenance: { method: string; crossWorld: boolean } };
}

async function search(query: string, options: { intent?: string; referent?: Record<string, unknown> } = {}): Promise<OutcomeShape> {
  const started = Date.now();
  const run = await app!.runtime.service.startRun(system, {
    agent: "agent.focus",
    input: json({
      intent: "search",
      query,
      sessionId: "main",
      worldId: "local",
      ...(options.intent ? { forcedIntent: options.intent } : {}),
      ...(options.referent ? { referent: options.referent } : {}),
    }),
    idempotencyKey: crypto.randomUUID(),
    correlationId: "focus:main",
  });
  // Long deadline: the first start provisions the TypeScript language server.
  const deadline = Date.now() + 420_000;
  for (;;) {
    await app!.runtime.idle(50).catch(() => undefined);
    const state = await app!.runtime.service.getRun(system, { runId: run.runId });
    if (state.status === "completed") {
      console.log(`query "${query}" settled in ${Date.now() - started}ms`);
      return state.output as unknown as OutcomeShape;
    }
    if (state.status === "failed" || state.status === "cancelled") {
      throw new Error(`search run failed: ${(state as { error?: string }).error ?? state.status}`);
    }
    if (Date.now() > deadline) throw new Error("search run timed out");
    await Bun.sleep(120);
  }
}

beforeAll(async () => {
  if (Bun.env.GSTERM_SKIP_SEMANTIC === "1") {
    skipReason = "GSTERM_SKIP_SEMANTIC=1";
    return;
  }
  if (!discoverHelperBinary("", REPO_ROOT)) {
    skipReason = "gsterm-semantic not built (run scripts/bootstrap.sh)";
    return;
  }
  if (!existsSync(resolve(REPO_ROOT, "solidlsp/.venv"))) {
    skipReason = "solidlsp/.venv missing (run scripts/bootstrap.sh)";
    return;
  }
  app = await createGsTermRuntime({ config: config(), store: ":memory:", domainRoot: REPO_ROOT });
});

afterAll(async () => {
  await app?.close();
});

describe("J9 — / who calls this? (SolidLSP primary)", () => {
  test("references of a real repo symbol come from the language mechanism", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    // `syntelligentSearch` is exported by src/focus/search.ts and invoked from src/app/runtime.ts.
    const outcome = await search("who calls syntelligentSearch?", {
      intent: "who-calls-this",
      referent: { worldId: "local", workspace: "gs-term", kind: "CodeSymbol", id: "src/focus/search.ts:77", name: "syntelligentSearch" },
    });
    expect(outcome.receipt.availability.find((a) => a.name === "solidlsp")?.status).toBe("ready");
    const semanticStage = outcome.receipt.stages.find((stage) => stage.mechanism === "solidlsp");
    expect(semanticStage?.candidates).toBeGreaterThan(0);
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.every((result) => result.mechanisms.includes("solidlsp"))).toBe(true);
    // The real caller is found: src/app/runtime.ts invokes syntelligentSearch.
    expect(outcome.results.some((result) => result.entity.location?.path?.startsWith("src/app/runtime.ts"))).toBe(true);
    expect(outcome.receipt.provenance.crossWorld).toBe(false);
  }, 480_000);
});

describe("J10 — conceptual query reduction (no literal overlap required)", () => {
  test("agent-focus-takeover question reduces to a bounded semantic slice", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    // Wording chosen to NOT appear in the implementation.
    const outcome = await search("where do we stop an agent from taking over what the human is looking at?");
    expect(outcome.receipt.availability.find((a) => a.name === "zvec")?.status).toBe("ready");
    expect(outcome.receipt.availability.find((a) => a.name === "zvec-grep")?.status).toBe("ready");
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.results.length).toBeLessThanOrEqual(5);
    // The concept layer must participate and the funnel is recorded.
    expect(outcome.receipt.stages.some((stage) => stage.name === "concept-retrieval")).toBe(true);
    expect(typeof outcome.receipt.reduction.workspace).toBe("number");
    console.log("reduction:", JSON.stringify(outcome.receipt.reduction));
    console.log("stages:", JSON.stringify(outcome.receipt.stages.map((stage) => `${stage.name}:${stage.candidates}`)));
  }, 480_000);

  test("architecture question stops at concepts without source retrieval", async () => {
    if (skipReason) return console.log(`SKIP: ${skipReason}`);
    const outcome = await search("give me an overview of the observation architecture", { intent: "architecture" });
    expect(outcome.receipt.stages.some((stage) => stage.name === "concept-retrieval")).toBe(true);
    expect(outcome.receipt.stages.some((stage) => stage.mechanism === "zvec-grep")).toBe(false);
    expect(outcome.results.length).toBeGreaterThan(0);
  }, 480_000);
});
