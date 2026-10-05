// Model-first gate: the canonical domain model parses, binds explicitly, and configuration
// loads (skill rule: implementation never drifts from the .sea source).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadGsTermModel, SEMANTIC_ID_EVIDENCE, SEMANTIC_ID_EXECUTION } from "../src/app/bindings.ts";
import { loadConfig, workspaceRoot } from "../src/config.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

describe("interaction domain model", () => {
  test("domain/interaction-model.sea parses into semantic objects with expected ids", () => {
    const source = readFileSync(resolve(REPO_ROOT, "domain/interaction-model.sea"), "utf8");
    const model = loadGsTermModel(source, "domain/interaction-model.sea");
    expect(model.projection.objects.length).toBeGreaterThan(0);
    const ids = model.projection.objects.map((object) => object.ref.id);
    expect(ids).toContain(SEMANTIC_ID_EXECUTION);
    expect(ids).toContain(SEMANTIC_ID_EVIDENCE);
    expect(model.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("capability bindings are explicit and carry semantic refs (no implicit capabilities)", () => {
    const source = readFileSync(resolve(REPO_ROOT, "domain/interaction-model.sea"), "utf8");
    const model = loadGsTermModel(source, "domain/interaction-model.sea");
    expect(model.bindings.map((contract) => contract.id).sort()).toEqual(["process.exec", "world.snapshot"]);
    expect(model.executionSemanticRef?.id).toBe(SEMANTIC_ID_EXECUTION);
    expect(model.evidenceSemanticRef?.id).toBe(SEMANTIC_ID_EVIDENCE);
  });
});

describe("configuration", () => {
  test("gsterm.toml loads with environment override support", async () => {
    const config = await loadConfig(REPO_ROOT);
    expect(config.server.port).toBeGreaterThan(0);
    expect(config.session.shell).toBe("bash");
    expect(config.session.scrollbackBytes).toBeGreaterThan(0);
    expect(workspaceRoot(config)).toBe(REPO_ROOT);
  });
});
