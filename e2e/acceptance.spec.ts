// Acceptance sequence A–G (start.md) through the real browser, real server, real PTY.
import { expect, test } from "@playwright/test";

const WORKSPACE = "/tmp/gsterm-e2e-workspace";
const REMOTE_WORKSPACE = "/tmp/gsterm-e2e-remote";

async function waitForTerminalLive(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByTestId("terminal-surface")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("terminal-status")).toContainText("live", { timeout: 20_000 });
}

async function typeCommand(page: import("@playwright/test").Page, command: string): Promise<void> {
  await page.getByTestId("terminal-host").click();
  await page.keyboard.type(command, { delay: 8 });
  await page.keyboard.press("Enter");
}

test("acceptance A + B: terminal renders; a typed command settles with effects and evidence in the UI", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  // A: real terminal into a real shell — prompt output reaches the screen.
  await page.getByTestId("terminal-host").click();
  await expect(page.getByTestId("terminal-host")).toBeVisible();

  // B: human door — typed `touch` settles as a semantic execution with file-created evidence.
  await typeCommand(page, "touch semantic-proof-human.txt");
  const row = page.locator(".exec-command", { hasText: "semantic-proof-human.txt" });
  await expect(row.first()).toBeVisible({ timeout: 25_000 });

  await row.first().click();
  await expect(page.getByTestId("execution-inspector")).toBeVisible();
  await expect(page.getByTestId("effect-file.created")).toBeVisible();
  await expect(page.locator(".evidence-line").first()).toBeVisible();
  await expect(page.getByTestId("inspector-command")).toContainText("semantic-proof-human.txt");
});

test("acceptance C: structured execution via the UI produces the same semantic kind", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  await page.getByTestId("structured-run-input").fill("touch semantic-proof-agent.txt");
  await page.getByTestId("structured-run-button").click();

  const row = page.locator(".exec-command", { hasText: "semantic-proof-agent.txt" });
  await expect(row.first()).toBeVisible({ timeout: 25_000 });
  await row.first().click();

  await expect(page.getByTestId("execution-inspector")).toBeVisible();
  await expect(page.getByTestId("effect-file.created")).toBeVisible();
  await expect(page.locator(".badge.ui").first()).toBeVisible();
  // Structured executions capture output; PTY ones say "unknown" — the UI renders both honestly.
  await expect(page.getByTestId("execution-inspector")).toContainText("Output");
});

test("acceptance D: WebMCP tools are discoverable and invocable in-page (same semantic path)", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  const result = await page.evaluate(async () => {
    try {
      const mc = (document as unknown as { modelContext?: { getTools(): Promise<unknown[]>; executeTool(tool: unknown, inputArgsJson: string): Promise<unknown> } }).modelContext;
      if (!mc) return { error: "document.modelContext missing", names: [], executed: "", world: "" };
      const tools = await mc.getTools();
      const names = tools.map((tool) => (tool as { name?: string }).name ?? String(tool));
      const execTool = tools.find((tool) => ((tool as { name?: string }).name ?? String(tool)) === "execute_command");
      const stateTool = tools.find((tool) => ((tool as { name?: string }).name ?? String(tool)) === "get_world_state");
      if (!execTool || !stateTool) return { error: `expected tools, got ${names.join(",")}`, names, executed: "", world: "" };
      // Current standard (Chromium-matching): input crosses executeTool as JSON TEXT.
      const executed = await mc.executeTool(execTool, JSON.stringify({ argv: ["touch", "semantic-proof-webmcp.txt"], cwd: "." }));
      const world = await mc.executeTool(stateTool, "{}");
      return { error: "", names, executed: JSON.stringify(executed), world: JSON.stringify(world) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), names: [], executed: "", world: "" };
    }
  });
  expect(result.error).toBe("");
  expect(result.names).toEqual(expect.arrayContaining(["execute_command", "get_world_state"]));
  expect(result.executed).toContain("executionId");
  expect(result.world).toContain(WORKSPACE);

  // The WebMCP run appears in the SAME execution UI as the human and UI runs.
  const row = page.locator(".exec-command", { hasText: "semantic-proof-webmcp.txt" });
  await expect(row.first()).toBeVisible({ timeout: 25_000 });
  await row.first().click();
  await expect(page.locator(".badge.webmcp").first()).toBeVisible();
});

test("acceptance E: the world view tracks repository state (branch, clean → dirty)", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  await expect(page.getByTestId("world-repo")).toContainText(/master|main/, { timeout: 25_000 });
  await expect(page.getByTestId("world-repo")).toContainText("dirty", { timeout: 25_000 }); // earlier commands created untracked files
  await expect(page.getByTestId("world-cwd")).toContainText(WORKSPACE);
});

test("acceptance F: a session-associated listening port is discovered and cleared", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  await typeCommand(page, `bun -e 'Bun.serve({ port: 7398, fetch: () => new Response("x") })' &`);
  await typeCommand(page, "sleep 0.6");
  await expect(page.getByTestId("world-ports")).toContainText("7398", { timeout: 25_000 });

  await typeCommand(page, "kill %1");
  await typeCommand(page, "sleep 0.4");
  await expect(page.getByTestId("world-ports")).not.toContainText("7398", { timeout: 25_000 });
});

test("acceptance G: reload reconnects the terminal and durable history persists", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);
  await expect(page.locator(".exec-command", { hasText: "semantic-proof-human.txt" }).first()).toBeVisible({ timeout: 25_000 });

  await page.reload();
  await waitForTerminalLive(page);
  // Durable semantic history survived the disconnect (it lives in the Cognate store, not the tab).
  await expect(page.locator(".exec-command", { hasText: "semantic-proof-human.txt" }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(".exec-command", { hasText: "semantic-proof-webmcp.txt" }).first()).toBeVisible();
  await expect(page.getByTestId("timeline-events")).toBeVisible();
});

test("Phase 2 E: world switching — same semantic operation, visible world provenance", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  // Target the SSH world (availability probed through the existing world.snapshot capability).
  await page.getByTestId("world-select").selectOption("ssh-test");
  await expect(page.getByTestId("world-probe")).toContainText("available", { timeout: 20_000 });

  await page.getByTestId("structured-run-input").fill("pwd");
  await page.getByTestId("structured-run-button").click();
  await expect(page.locator(".exec-command", { hasText: "pwd" }).first()).toBeVisible({ timeout: 25_000 });
  await page.locator(".exec-command", { hasText: "pwd" }).first().click();
  await expect(page.getByTestId("inspector-world")).toHaveText("ssh-test");
  await expect(page.getByTestId("inspector-provider")).toHaveText("ssh");
  await expect(page.getByTestId("execution-inspector")).toContainText(REMOTE_WORKSPACE);

  // The same operation on the local world — the inspector names where it actually ran.
  await page.getByTestId("inspector-back").click();
  await page.getByTestId("world-select").selectOption("local");
  await page.getByTestId("structured-run-input").fill("pwd");
  await page.getByTestId("structured-run-button").click();
  await new Promise((resolve) => setTimeout(resolve, 1_500)); // let the newer run settle (newest row first)
  await page.locator(".exec-command", { hasText: "pwd" }).first().click();
  await expect(page.getByTestId("inspector-world")).toHaveText("local");
  await expect(page.getByTestId("inspector-provider")).toHaveText("local");
});

test("Phase 2 F: WebMCP runs the SAME tool against an authorized world (no ssh tool)", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  const result = await page.evaluate(async () => {
    try {
      const mc = (document as unknown as { modelContext?: { getTools(): Promise<unknown[]>; executeTool(tool: unknown, inputArgsJson: string): Promise<unknown> } }).modelContext;
      if (!mc) return { error: "document.modelContext missing", names: [] as string[], executed: "" };
      const tools = await mc.getTools();
      const names = tools.map((tool) => (tool as { name?: string }).name ?? String(tool));
      const execTool = tools.find((tool) => ((tool as { name?: string }).name ?? String(tool)) === "execute_command");
      if (!execTool) return { error: `no execute_command tool in ${names.join(",")}`, names, executed: "" };
      const executed = await mc.executeTool(execTool, JSON.stringify({ argv: ["pwd"], worldId: "ssh-test" }));
      return { error: "", names, executed: JSON.stringify(executed) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), names: [] as string[], executed: "" };
    }
  });

  expect(result.error).toBe("");
  expect(result.names.some((name) => name.includes("ssh"))).toBe(false); // the tool set never mentions providers
  expect(result.executed).toContain(REMOTE_WORKSPACE);
});


test("Phase 3: `/` opens the contextual palette immediately and Syntelligent Search returns bounded results", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);

  // Seed findable content through the human door (the search matches file content).
  await typeCommand(page, "printf 'export function reconnectSession() { return 1; }\\n' > findable.txt");
  const row = page.locator(".exec-command", { hasText: "findable.txt" });
  await expect(row.first()).toBeVisible({ timeout: 25_000 });

  // `/` opens the overlay from the cockpit when not typing in the terminal (terminal keys are not stolen).
  await page.locator(".brand").click();
  await page.keyboard.press("/");
  await expect(page.locator(".palette")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".palette-context")).toBeVisible();
  await expect(page.locator(".palette-label", { hasText: "Context" })).toBeVisible();
  await expect(page.locator(".palette-suggested")).toBeVisible();

  // Type a query and search — results arrive through the shared focus.search capability.
  await page.locator(".palette-input").fill("reconnectSession");
  await page.keyboard.press("Enter");
  await expect(page.locator(".palette-result").first()).toBeVisible({ timeout: 15_000 });
  // Bounded + inspectable: the reduction funnel is surfaced.
  await expect(page.locator(".palette-why")).toContainText("Why these?", { timeout: 10_000 });
  const resultCount = await page.locator(".palette-result").count();
  expect(resultCount).toBeLessThanOrEqual(5);
});

test("Phase 3: the Focus panel renders the collaborative context", async ({ page }) => {
  await page.goto("/");
  await waitForTerminalLive(page);
  await expect(page.getByTestId("focus-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("focus-goal")).toContainText("Goal:");
});
