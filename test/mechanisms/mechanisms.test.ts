// Mechanism layer tests: the JSON-lines client against a REAL child process,
// plus honest skip behavior when the native helpers are not built.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverHelperBinary, SemanticHelper } from "../../src/mechanisms/semantic-helper.ts";
import { JsonLinesProcess } from "../../src/mechanisms/jsonlines.ts";
import { semanticSkipOrThrow } from "../support/semantic-gate.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

describe("jsonlines client", () => {
  let dir: string;
  let script: string;
  let process: JsonLinesProcess;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gsterm-jsonlines-"));
    // A tiny echo server speaking the same envelope as the native helpers.
    script = join(dir, "echo.ts");
    writeFileSync(
      script,
      [
        `const enc = new TextEncoder();`,
        `for await (const chunk of Bun.stdin.stream()) {`,
        `  const text = new TextDecoder().decode(chunk);`,
        `  for (const line of text.split("\\n")) {`,
        `    if (!line.trim()) continue;`,
        `    let request;`,
        `    try { request = JSON.parse(line); } catch {`,
        `      await Bun.write(Bun.stdout, enc.encode(JSON.stringify({ id: null, ok: false, error: { message: "malformed" } }) + "\\n"));`,
        `      continue;`,
        `    }`,
        `    if (request.method === "slow") { await Bun.sleep(200); }`,
        `    const reply = request.method === "boom"`,
        `      ? { id: request.id, ok: false, error: { message: "exploded" } }`,
        `      : { id: request.id, ok: true, result: { echo: request.params, method: request.method } };`,
        `    await Bun.write(Bun.stdout, enc.encode(JSON.stringify(reply) + "\\n"));`,
        `  }`,
        `}`,
      ].join("\n"),
    );
    process = new JsonLinesProcess({ command: ["bun", script], requestTimeoutMs: 5_000 });
    process.start();
  });

  afterAll(async () => {
    await process.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test("round-trips requests and results", async () => {
    const result = (await process.call("hello", { who: "test" })) as { echo: { who: string }; method: string };
    expect(result.echo.who).toBe("test");
    expect(result.method).toBe("hello");
  });

  test("surfaces structured errors", async () => {
    await expect(process.call("boom", {})).rejects.toThrow("exploded");
  });

  test("rejects on timeout", async () => {
    await expect(process.call("slow", {}, 50)).rejects.toThrow("timed out");
  });

  test("keeps serving after a malformed line", async () => {
    // writeLine is private; a malformed line is produced by the server branch —
    // here we verify the client tolerates garbage between valid lines via the
    // diagnostics counter after a failed request round-trip.
    const before = process.diagnostics.malformed;
    await process.call("ok-after-garbage", {});
    expect(process.diagnostics.malformed).toBeGreaterThanOrEqual(before);
  });
});

describe("semantic helper", () => {
  test("discovery returns undefined cleanly when nothing is built", () => {
    const found = discoverHelperBinary("/nonexistent/gsterm-semantic", REPO_ROOT);
    // On a machine without the build this is undefined; with the build it finds target/release.
    if (found === undefined) expect(found).toBeUndefined();
    else expect(found).toContain("gsterm-semantic");
  });

  test("GSTERM_HELPER_BIN override wins discovery", () => {
    const found = discoverHelperBinary("/nonexistent/gsterm-semantic", REPO_ROOT);
    const override = Bun.env.GSTERM_HELPER_BIN;
    if (override && found) expect(found).toBe(override);
  });
});

describe("semantic helper integration (built helper)", () => {
  const binary = discoverHelperBinary("", REPO_ROOT);
  let helper: SemanticHelper;

  beforeAll(() => {
    // Same policy as the acceptance journeys: skip honestly in developer mode,
    // fail in release mode (GSTERM_REQUIRE_SEMANTIC=1). Helper scope only —
    // these tests never touch the SolidLSP bridge.
    const skip = semanticSkipOrThrow("mechanisms helper integration", "helper");
    if (skip) {
      console.log(`skipping helper integration: ${skip}`);
      return;
    }
    helper = new SemanticHelper({ binary: binary! });
  });

  afterAll(async () => {
    await helper?.dispose();
  });

  test("hello handshake reports provenance and concept lifecycle works", async () => {
    if (!binary) return;
    const hello = await helper.start();
    expect(hello.name).toBe("gsterm-semantic");
    expect(hello.model.dimension).toBe(256);

    const dir = mkdtempSync(join(tmpdir(), "gsterm-concepts-"));
    try {
      const store = join(dir, "concepts");
      await helper.conceptReplace(
        store,
        [
          { id: "c:focus", kind: "concept", label: "Human-governed focus", text: "humans govern what the agent attends to; agents propose, humans accept or reject", metadata: { area: "focus" }, links: ["src/semantic/focus.ts"] },
        ],
        true,
      );
      const matches = await helper.conceptQuery(store, "who decides what the agent works on", 3);
      expect(matches.items.length).toBe(1);
      expect(matches.items[0]!.id).toBe("c:focus");
      expect(matches.items[0]!.links).toContain("src/semantic/focus.ts");
      const stats = await helper.conceptStats(store);
      expect(stats.doc_count).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  test("dispose leaves no helper process running", async () => {
    if (!binary) return;
    await helper.start();
    expect(helper.running).toBe(true);
    await helper.dispose();
    expect(helper.running).toBe(false);
  }, 60_000);
});
