// Architecture invariants (AGENTS.md completion checks) — these fail loudly when the
// boundary between mechanism and semantics erodes or Cognate primitives get duplicated.
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SRC = join(REPO_ROOT, "src");

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|css|sh)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function contentsOf(...dirs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of await sourceFiles(dir)) map.set(file, await readFile(file, "utf8"));
  }
  return map;
}

describe("architecture invariants", () => {
  test("the mechanism layer imports no Cognate packages (terminal/shell/observers)", async () => {
    const files = await contentsOf(join(SRC, "terminal"), join(SRC, "shell"), join(SRC, "observers"));
    expect(files.size).toBeGreaterThan(5);
    for (const [path, content] of files) {
      expect(content.includes('@cognate/'), `Cognate import leaked into mechanism file ${path}`).toBe(false);
    }
  });

  test("no local reimplementations of Cognate primitives (registry/policy/event-bus duplication)", async () => {
    const files = await contentsOf(SRC);
    const forbidden = ["class CapabilityRegistry", "class PolicyEngine", "class ToolRegistry", "class EventBus", "class SemanticEventLedger", "class AgentToolRegistry"];
    for (const [path, content] of files) {
      for (const name of forbidden) {
        expect(content.includes(name), `${name} duplicated in ${path} — use the Cognate primitive`).toBe(false);
      }
    }
  });

  test("WebMCP has exactly one projection path (project.ts is the only adapter)", async () => {
    const files = await contentsOf(SRC);
    for (const [path, content] of files) {
      if (path.endsWith("webmcp/project.ts") || path.endsWith("webmcp/descriptors.ts")) continue;
      if (path.endsWith("ui/main.tsx")) continue; // boot calls the adapter
      expect(content.includes("registerTool"), `direct WebMCP registration in ${path} — go through webmcp/project.ts`).toBe(false);
    }
  });

  test("the stale navigator.modelContext API is never referenced (current standard only)", async () => {
    const files = await contentsOf(SRC);
    for (const [path, content] of files) {
      expect(content.includes("navigator.modelContext"), `stale WebMCP API referenced in ${path}`).toBe(false);
    }
  });

  test("bindCapabilities is called in exactly one place (explicit binding, spec §19)", async () => {
    const files = await contentsOf(SRC);
    const callers = [...files.entries()].filter(([, content]) => content.includes("bindCapabilities("));
    expect(callers.map(([path]) => path.split("/").slice(-2).join("/"))).toEqual(["app/bindings.ts"]);
  });

  test("PTY bytes never reach durable storage or logs (instrumentation rule)", async () => {
    const files = await contentsOf(SRC);
    for (const [path, content] of files) {
      if (path.includes("scrollback")) continue;
      expect(content.includes("appendFile"), `file-writing of stream bytes in ${path} — scrollback is memory-only`).toBe(false);
    }
  });

  test("no provider-specific semantic leakage: the semantic layer never mentions ssh", async () => {
    // Provider mechanics live in app/worlds.ts + observers (mechanism); semantics stay world-agnostic.
    const semantic = await contentsOf(join(SRC, "agents"), join(SRC, "projections"), join(SRC, "webmcp"), join(SRC, "semantic"));
    for (const [path, content] of semantic) {
      expect(/\bssh/i.test(content), `provider-specific reference in ${path} — worlds are an input property`).toBe(false);
    }
  });
});
