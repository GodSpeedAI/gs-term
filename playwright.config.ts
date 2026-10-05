import { defineConfig } from "@playwright/test";

// Acceptance suite (start.md sequence A–G). One worker: the PTY session is shared on purpose
// (multiple viewers, one world) — parallel typing would race the same shell.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:7327",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run e2e/serve.ts",
    url: "http://127.0.0.1:7327/health",
    timeout: 60_000,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
