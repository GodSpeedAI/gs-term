// E2E server: prepares a clean git workspace AND a real SSH execution world (an in-process
// ssh2 fixture server with a genuine provider client), then boots the real gs-term server.
// Every acceptance run gets fresh worlds, fresh store; the SSH world uses an ephemeral
// keypair (no credentials in the repository).
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { utils } from "ssh2";
import { loadSshFixture } from "../test/support/ssh-fixture.ts";

const WORKSPACE = process.env.GSTERM_E2E_WORKSPACE ?? "/tmp/gsterm-e2e-workspace";
const REMOTE_WORKSPACE = process.env.GSTERM_E2E_REMOTE ?? "/tmp/gsterm-e2e-remote";
const STORE = process.env.GSTERM_E2E_STORE ?? "/tmp/gsterm-e2e.sqlite";
const KEY_DIR = process.env.GSTERM_E2E_KEYDIR ?? "/tmp/gsterm-e2e-keys";
const REPO_ROOT = resolve(import.meta.dir, "..");

for (const dir of [WORKSPACE, REMOTE_WORKSPACE, KEY_DIR]) await rm(dir, { recursive: true, force: true });
for (const suffix of ["", "-wal", "-shm"]) await rm(`${STORE}${suffix}`, { force: true });
for (const dir of [WORKSPACE, REMOTE_WORKSPACE, KEY_DIR]) await mkdir(dir, { recursive: true });
await writeFile(`${WORKSPACE}/tracked.txt`, "line-1\n");

const runGit = async (args: string[]) => {
  const proc = Bun.spawn(["git", "-C", WORKSPACE, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
};
await runGit(["init"]);
await runGit(["add", "tracked.txt"]);
await runGit(["-c", "user.email=e2e@gsterm.test", "-c", "user.name=gsterm-e2e", "commit", "-m", "initial"]);

// SSH world: ephemeral keypair + fixture server; host key pinned by fingerprint.
const keys = utils.generateKeyPairSync("ed25519");
const keyPath = resolve(KEY_DIR, "id_ed25519");
await writeFile(keyPath, keys.private);
const fixtureModule = await loadSshFixture();
const fixture = await fixtureModule.startSshFixture({ users: { tester: { publicKeys: [keys.public] } } });

const { loadConfig } = await import("../src/config.ts");
process.env.GSTERM_PORT = process.env.GSTERM_PORT ?? "7327"; // before loadConfig reads the env
const base = await loadConfig(REPO_ROOT);
const config = {
  ...base,
  world: { ...base.world, root: WORKSPACE },
  worlds: {
    "ssh-test": {
      kind: "ssh" as const,
      display: "SSH test box",
      host: "127.0.0.1",
      port: fixture.port,
      username: "tester",
      root: REMOTE_WORKSPACE,
      auth: `key:${keyPath}`,
      hostKeyFingerprints: [fixture.fingerprint],
      defaultTimeoutMs: 10_000,
      readyTimeoutMs: 5_000,
    },
  },
};

process.env.GSTERM_PORT = process.env.GSTERM_PORT ?? "7327";
const { startServer } = await import("../src/server/index.ts");
const handle = await startServer({ config, domainRoot: REPO_ROOT, store: STORE });
console.log(`e2e server ready on ${handle.url} (workspace ${WORKSPACE}, ssh world 127.0.0.1:${fixture.port})`);
const shutdown = async () => {
  await handle.stop();
  await fixture.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
