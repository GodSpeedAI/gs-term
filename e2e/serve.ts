// E2E server: prepares a clean git workspace, then boots the real gs-term server against it.
// Playwright's webServer starts this; every acceptance run gets fresh world, fresh store.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const WORKSPACE = process.env.GSTERM_E2E_WORKSPACE ?? "/tmp/gsterm-e2e-workspace";
const STORE = process.env.GSTERM_E2E_STORE ?? "/tmp/gsterm-e2e.sqlite";
const REPO_ROOT = resolve(import.meta.dir, "..");

await rm(WORKSPACE, { recursive: true, force: true });
await rm(`${STORE}`, { force: true });
await rm(`${STORE}-wal`, { force: true });
await rm(`${STORE}-shm`, { force: true });
await mkdir(WORKSPACE, { recursive: true });
await writeFile(`${WORKSPACE}/tracked.txt`, "line-1\n");
const runGit = async (args: string[]) => {
  const proc = Bun.spawn(["git", "-C", WORKSPACE, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
};
await runGit(["init"]);
await runGit(["add", "tracked.txt"]);
await runGit(["-c", "user.email=e2e@gsterm.test", "-c", "user.name=gsterm-e2e", "commit", "-m", "initial"]);

process.env.GSTERM_ROOT = WORKSPACE;
process.env.GSTERM_PORT = process.env.GSTERM_PORT ?? "7327";

const { startServer } = await import("../src/server/index.ts");
const handle = await startServer({ domainRoot: REPO_ROOT, store: STORE });
console.log(`e2e server ready on ${handle.url} (workspace ${WORKSPACE})`);
const shutdown = async () => {
  await handle.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
