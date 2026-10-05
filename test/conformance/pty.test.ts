// Real-PTY conformance (donor lesson from compoundingtech/pty: hold implementations to shared
// assertions). Real Bun.Terminal + real bash + the real shell-integration init file.
// Covers the J4 substrate: output flow, markers, resize, exit codes, bounded scrollback,
// disconnect/reconnect replay, and deterministic cleanup.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TerminalSession } from "../../src/terminal/session.ts";
import type { Marker } from "../../src/shell/markers.ts";
import { Scrollback } from "../../src/terminal/scrollback.ts";

const INIT_FILE = resolve(import.meta.dir, "../../src/shell/bash-init.sh");

let workDir = "";
let homeDir = "";
let session: TerminalSession | undefined;
const output: string[] = [];
const markers: Marker[] = [];

function waitFor(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; output=${output.join("").slice(-800)}`);
      await Bun.sleep(20);
    }
  })();
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "gsterm-pty-"));
  homeDir = await mkdtemp(join(tmpdir(), "gsterm-home-"));
  session = new TerminalSession({
    id: "test-session",
    shell: "bash",
    initFile: INIT_FILE,
    cwd: workDir,
    cols: 80,
    rows: 24,
    scrollbackBytes: 64 * 1024,
    env: { HOME: homeDir },
  });
  session.attach({
    output: (data) => output.push(Buffer.from(data).toString("utf8")),
    marker: (marker) => markers.push(marker),
  });
  await session.start();
  await waitFor(() => markers.some((marker) => marker.code === "R"), "integration ready marker");
});

afterAll(async () => {
  await session?.close();
  if (workDir) await rm(workDir, { recursive: true, force: true });
  if (homeDir) await rm(homeDir, { recursive: true, force: true });
});

describe("real PTY substrate", () => {
  test("echo flows to viewers and command boundaries are observed (A/D markers)", async () => {
    session!.write("echo hello-gsterm\n");
    await waitFor(() => output.join("").includes("hello-gsterm"), "echo output");
    await waitFor(
      () => {
        const start = markers.findIndex((marker) => marker.code === "A" && marker.command.includes("echo hello-gsterm"));
        return start >= 0 && markers.slice(start).some((marker) => marker.code === "D");
      },
      "A/D pairing for echo",
    );
    const start = markers.find((marker) => marker.code === "A" && marker.command.includes("echo hello-gsterm")) as { command: string };
    expect(start.command).toContain("echo hello-gsterm");
  });

  test("non-zero exit codes are observed, not assumed", async () => {
    session!.write("false\n");
    await waitFor(
      () => {
        const start = markers.findIndex((marker) => marker.code === "A" && marker.command === "false");
        return start >= 0 && markers.slice(start).some((marker) => marker.code === "D");
      },
      "A/D pairing for false",
    );
    const start = markers.findIndex((marker) => marker.code === "A" && marker.command === "false");
    const done = markers.slice(start).find((marker) => marker.code === "D") as { exitCode: number };
    expect(done.exitCode).toBe(1);
  });

  test("resize reaches the real shell (stty size)", async () => {
    session!.resize(100, 40);
    session!.write("stty size\n");
    await waitFor(() => output.join("").includes("40 100"), "stty size reflects resize");
  });

  test("markers never leak into viewer output", () => {
    const joined = output.join("");
    expect(joined).not.toContain("]7311;");
    expect(joined).not.toContain("\u001b]7311");
  });

  test("bounded scrollback replays for a reconnecting viewer", async () => {
    const replays: string[] = [];
    const detach = session!.attach({ output: (data) => replays.push(Buffer.from(data).toString("utf8")) });
    await Bun.sleep(50);
    detach();
    const replayed = replays.join("");
    expect(replayed).toContain("hello-gsterm");
    expect(session!.alive).toBe(true); // reconnecting viewers never disturb the session
  });

  test("interrupt passes through: Ctrl-C kills the foreground command (exit 130 observed)", async () => {
    session!.write("sleep 30\n");
    await Bun.sleep(150);
    session!.write("\u0003"); // raw Ctrl-C byte — exactly what xterm sends
    await waitFor(
      () => {
        const start = markers.findIndex((marker) => marker.code === "A" && marker.command === "sleep 30");
        return start >= 0 && markers.slice(start).some((marker) => marker.code === "D");
      },
      "A/D pairing for interrupted sleep",
      15_000,
    );
    const start = markers.findIndex((marker) => marker.code === "A" && marker.command === "sleep 30");
    const done = markers.slice(start).find((marker) => marker.code === "D") as { exitCode: number };
    expect(done.exitCode).toBe(130);
    expect(session!.alive).toBe(true); // the SHELL survives the interrupt
  });

  test("session exit is observable and cleanup is deterministic", async () => {
    const exited: { exitCode: number }[] = [];
    session!.attach({ exit: (info) => exited.push(info) });
    session!.write("exit 0\n");
    await waitFor(() => exited.length > 0, "exit notification", 15_000);
    expect(exited[0]!.exitCode).toBe(0);
    expect(session!.alive).toBe(false);
    await session!.close(); // idempotent
  });
});

describe("scrollback ring", () => {
  test("is bounded and drops oldest bytes first", () => {
    const ring = new Scrollback(10);
    ring.push(Buffer.from("12345"));
    ring.push(Buffer.from("67890"));
    expect(ring.byteLength).toBe(10);
    ring.push(Buffer.from("ABCDE"));
    expect(ring.byteLength).toBe(10);
    expect(Buffer.from(ring.replay()).toString()).toBe("67890ABCDE");
    ring.push(Buffer.from("XYZ"));
    expect(Buffer.from(ring.replay()).toString()).toBe("90ABCDEXYZ");
  });
});
