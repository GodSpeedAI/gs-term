// WebMCP projection (J2-W) + the D2 consumption seam. The fake ModelContext proves the
// adapter maps descriptors onto the CURRENT standard API; the runtime round-trip proves
// external capabilities can become Cognate offers (interface only — no tab control).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Caller } from "@cognate/runtime-api";
import { createGsTermRuntime, type GsTermRuntime } from "../../src/app/runtime.ts";
import type { GsTermConfig } from "../../src/config.ts";
import type { ModelContextLike, WebMCPToolSpec } from "../../src/webmcp/project.ts";
import { pageModelContext, projectCapabilitiesToWebMCP } from "../../src/webmcp/project.ts";
import { offerRequestFromExternalTool } from "../../src/webmcp/consumption.ts";
import type { ToolInvoker } from "../../src/webmcp/descriptors.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const webmcpCaller: Caller = { tenant: "local", actor: { id: "webmcp", kind: "agent" } };

let workspace = "";
let app: GsTermRuntime | undefined;

function config(root: string): GsTermConfig {
  return {
    server: { hostname: "127.0.0.1", port: 0 },
    world: { id: "local", root },
    session: { id: "main", shell: "bash", cols: 80, rows: 24, scrollbackBytes: 65_536 },
    execution: { timeoutMs: 10_000 },
  };
}

function fakeContext(): { context: ModelContextLike; tools: WebMCPToolSpec[] } {
  const tools: WebMCPToolSpec[] = [];
  const context: ModelContextLike = {
    registerTool(tool) {
      tools.push(tool);
    },
    getTools: () => tools,
    // Mirrors the Chromium-matching shape: JSON-text in, JSON-string out.
    async executeTool(tool, inputArgsJson) {
      const args = JSON.parse(inputArgsJson) as Record<string, unknown>;
      return JSON.stringify(await (tool as WebMCPToolSpec).execute(args));
    },
  };
  return { context, tools };
}

function fakeInvoker(): ToolInvoker & { calls: { argv: readonly string[]; source: string }[] } {
  const calls: { argv: readonly string[]; source: string }[] = [];
  return {
    calls,
    async executeCommand(args, source) {
      calls.push({ argv: args.argv, source });
      return { executionId: "exec_test", exitCode: 0, source };
    },
    async worldState() {
      return { cwd: "/world" };
    },
  };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gsterm-webmcp-"));
  app = await createGsTermRuntime({ config: config(workspace), store: ":memory:", domainRoot: REPO_ROOT });
});

afterAll(async () => {
  await app?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("WebMCP projection (J2-W)", () => {
  test("descriptors register as standard document.modelContext tools and execute via the shared invoker", async () => {
    const { context, tools } = fakeContext();
    const invoker = fakeInvoker();
    const result = await projectCapabilitiesToWebMCP(context, invoker);
    expect([...result.registered].sort()).toEqual(["execute_command", "get_world_state"]);
    expect(result.failed).toEqual([]);
    expect(tools.length).toBe(2);

    const executed = JSON.parse((await context.executeTool!(tools[0]!, JSON.stringify({ argv: ["touch", "x.txt"] }))) as string) as { content: { text: string }[] };
    expect(executed.content[0]!.text).toContain("exec_test");
    // The invoker sees source "webmcp" — same run path as the UI, metadata only.
    expect(invoker.calls[0]!.source).toBe("webmcp");

    const world = JSON.parse((await context.executeTool!(tools[1]!, "{}")) as string) as { content: { text: string }[] };
    expect(world.content[0]!.text).toContain("/world");
  });

  test("invalid tool input is rejected without side effects", async () => {
    const { context, tools } = fakeContext();
    const invoker = fakeInvoker();
    await projectCapabilitiesToWebMCP(context, invoker);
    const executed = JSON.parse((await context.executeTool!(tools[0]!, JSON.stringify({ argv: "not-an-array" }))) as string) as { content: { text: string }[] };
    expect(executed.content[0]!.text).toContain("error");
    expect(invoker.calls.length).toBe(0);
  });

  test("pageModelContext only speaks the current standard surface", () => {
    expect(pageModelContext(undefined)).toBeUndefined();
    expect(pageModelContext({})).toBeUndefined();
    const context = fakeContext().context;
    expect(pageModelContext({ modelContext: context })).toBe(context);
  });
});

describe("D2 consumption seam (interface only)", () => {
  test("an external WebMCP capability maps to a lease-bound Cognate remote offer", async () => {
    const request = offerRequestFromExternalTool(
      { name: "page_title", description: "Read the page title", inputSchema: { type: "object", properties: {} }, sourceUrl: "https://example.test" },
      { leaseId: "lease-1", agent: "agent.execute", ttlMs: 60_000 },
    );
    expect(request.contract.id).toBe("external.page_title");
    expect(request.leaseId).toBe("lease-1");

    // The boundary exists and is exercised against the REAL runtime: publish + list.
    const published = await app!.runtime.service.publishRemoteOffer(webmcpCaller, {
      leaseId: request.leaseId,
      agent: request.agent,
      contract: request.contract,
      description: request.description,
      inputSchema: request.inputSchema as never,
      ttlMs: request.ttlMs,
    });
    const offers = await app!.runtime.service.listRemoteOffers(webmcpCaller, { agent: "agent.execute" });
    expect(offers.some((offer) => offer.id === published.id && offer.contract.id === "external.page_title")).toBe(true);
    await app!.runtime.service.revokeRemoteOffer(webmcpCaller, { offerId: published.id });
    const after = await app!.runtime.service.listRemoteOffers(webmcpCaller, { agent: "agent.execute" });
    expect(after.some((offer) => offer.id === published.id)).toBe(false);
  });
});
