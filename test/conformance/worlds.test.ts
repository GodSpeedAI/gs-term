// Provider conformance: the SAME executable contract (Cognate's `executionWorldConformance`)
// holds for both registered worlds — that is how "replaceable provider" is proven, not asserted.
import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { utils } from "ssh2";
import { localExecutionWorld } from "@cognate/execution";
import { executionWorldConformance, type ExecutionConformanceHarness } from "@cognate/execution/conformance";
import { sshExecutionWorld } from "@cognate/execution-ssh";
import { loadSshFixture, type SshFixture } from "../support/ssh-fixture.ts";

let fixture: SshFixture | undefined;
let remoteRoot = "";
let keyDir = "";
let keyPath = "";
let localRoot = "";

function sh(marker: string): { argv: readonly string[]; cwd: string } {
  return { argv: ["sh", "-lc", `printf %s ${marker}`], cwd: "" };
}

beforeAll(async () => {
  localRoot = await mkdtemp(join(tmpdir(), "gsterm-conf-local-"));
  remoteRoot = await mkdtemp(join(tmpdir(), "gsterm-conf-remote-"));
  keyDir = await mkdtemp(join(tmpdir(), "gsterm-conf-key-"));
  const keys = utils.generateKeyPairSync("ed25519");
  keyPath = join(keyDir, "id_ed25519");
  await writeFile(keyPath, keys.private);
  const fixtureModule = await loadSshFixture();
  fixture = await fixtureModule.startSshFixture({ users: { tester: { publicKeys: [keys.public] } } });
});

afterAll(async () => {
  await fixture?.close();
  for (const dir of [localRoot, remoteRoot, keyDir]) if (dir) await rm(dir, { recursive: true, force: true });
});

executionWorldConformance("local world (registered provider)", async (): Promise<ExecutionConformanceHarness> => ({
  provider: localExecutionWorld({ worldId: "local", metadata: { root: localRoot } }),
  root: localRoot,
  commands: {
    echo: (marker) => ({ ...sh(marker), cwd: localRoot }),
    fail: (marker, code) => ({ argv: ["sh", "-lc", `printf %s ${marker} >&2; exit ${code}`], cwd: localRoot }),
    slow: () => ({ argv: ["sleep", "30"], cwd: localRoot }),
  },
}));

executionWorldConformance("ssh world (registered provider)", async (): Promise<ExecutionConformanceHarness> => ({
  provider: sshExecutionWorld({
    worldId: "ssh-test",
    host: "127.0.0.1",
    port: fixture!.port,
    username: "tester",
    auth: { kind: "key", privateKeyPath: keyPath },
    hostKeys: { fingerprints: [fixture!.fingerprint] },
    defaultTimeoutMs: 10_000,
  }),
  root: remoteRoot,
  commands: {
    echo: (marker) => ({ ...sh(marker), cwd: remoteRoot }),
    fail: (marker, code) => ({ argv: ["sh", "-lc", `printf %s ${marker} >&2; exit ${code}`], cwd: remoteRoot }),
    slow: () => ({ argv: ["sleep", "30"], cwd: remoteRoot }),
  },
}));

describe("provider identity", () => {
  test("the two providers describe themselves without leaking credentials", async () => {
    const local = localExecutionWorld({ worldId: "local", metadata: { root: localRoot } });
    const ssh = sshExecutionWorld({
      worldId: "ssh-test",
      host: "127.0.0.1",
      port: fixture!.port,
      username: "tester",
      auth: { kind: "key", privateKeyPath: keyPath },
      hostKeys: { fingerprints: [fixture!.fingerprint] },
    });
    try {
      expect(local.kind).toBe("local");
      expect(ssh.kind).toBe("ssh");
      const meta = JSON.stringify(ssh.metadata);
      expect(meta).toContain("tester");
      expect(meta).toContain("key"); // auth KIND only, never material
      expect(meta).not.toContain("PRIVATE KEY");
    } finally {
      await local.dispose();
      await ssh.dispose();
    }
  });
});
