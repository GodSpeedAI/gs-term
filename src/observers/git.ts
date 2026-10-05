// Git observer: cheap deterministic repository facts via the git CLI at observation time.
// Mechanism layer — no Cognate imports. `unknown`/`no-repo` are distinct and never conflated.
import type { GitObservation } from "../semantic/contracts.ts";

const METHOD = "git-cli rev-parse+branch+status";

async function run(dir: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  // stdout kept RAW: `status --porcelain` lines carry a significant leading space.
  return { code, stdout, stderr: stderr.trim() };
}

export async function observeGit(dir: string): Promise<GitObservation> {
  const observedAt = new Date().toISOString();
  try {
    const top = await run(dir, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) {
      return { status: "no-repo", observedAt, method: METHOD, reason: "not inside a git work tree" };
    }
    const branch = await run(dir, ["branch", "--show-current"]);
    const status = await run(dir, ["status", "--porcelain"]);
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
