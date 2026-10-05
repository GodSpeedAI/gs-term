// Git observer: cheap deterministic repository facts via the git CLI THROUGH a world's process
// port — identical evidence for local and remote worlds. `unknown`/`no-repo` are distinct and
// never conflated; a world without git yields `unknown` with the reason.
import type { GitObservation, ProcessPort } from "../semantic/contracts.ts";

const METHOD = "git-cli rev-parse+branch+status";

async function run(process: ProcessPort, dir: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await process.exec({ argv: ["git", "-C", dir, ...args], cwd: dir, timeoutMs: 10_000 });
  // stdout kept RAW: `status --porcelain` lines carry a significant leading space.
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr.trim() };
}

export async function observeGit(process: ProcessPort, dir: string): Promise<GitObservation> {
  const observedAt = new Date().toISOString();
  try {
    const top = await run(process, dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) {
      return { status: "no-repo", observedAt, method: METHOD, reason: "not inside a git work tree" };
    }
    const branch = await run(process, dir, ["branch", "--show-current"]);
    const status = await run(process, dir, ["status", "--porcelain"]);
    if (status.code !== 0) {
      return { status: "unknown", observedAt, method: METHOD, reason: `git status failed: ${status.stderr}` };
    }
    // Porcelain v1 line = `XY <path>`: exactly 3 chars of prefix before the path.
    const changedFiles = status.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.slice(3));
    return {
      status: "observed",
      observedAt,
      method: METHOD,
      root: top.stdout.trim(),
      branch: branch.stdout.trim() === "" ? null : branch.stdout.trim(),
      dirty: changedFiles.length > 0,
      changedFiles,
    };
  } catch (error) {
    return { status: "unknown", observedAt, method: METHOD, reason: error instanceof Error ? error.message : String(error) };
  }
}
