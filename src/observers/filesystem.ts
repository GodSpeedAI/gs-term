// Filesystem observer: bounded recursive walk of the workspace scope.
// Mechanism layer — no Cognate imports. Honesty: `truncated: true` when the cap is hit.
import type { FileObservation } from "../semantic/contracts.ts";

export const DEFAULT_EXCLUDED = [".git", "node_modules", ".cognate"] as const;
const DEFAULT_MAX_ENTRIES = 5_000;

export interface WalkResult {
  readonly files: readonly FileObservation[];
  readonly truncated: boolean;
  readonly method: string;
}

export async function walkWorkspace(root: string, options: { readonly excluded?: readonly string[]; readonly maxEntries?: number } = {}): Promise<WalkResult> {
  const excluded = options.excluded ?? DEFAULT_EXCLUDED;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const files: FileObservation[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await (await import("node:fs/promises")).readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skipped, not claimed absent
    }
    for (const dirent of dirents) {
      if (files.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (excluded.includes(dirent.name)) continue;
      const path = `${dir}/${dirent.name}`;
      const relative = path.slice(root.length + 1);
      if (dirent.isDirectory()) {
        files.push({ path: relative, kind: "directory", size: 0, mtimeMs: 0 });
        await walk(path);
      } else {
        try {
          const stats = await (await import("node:fs/promises")).stat(path);
          files.push({ path: relative, kind: dirent.isFile() ? "file" : "other", size: stats.size, mtimeMs: Math.trunc(stats.mtimeMs) });
        } catch {
          // vanished between readdir and stat: absence is not an effect claim by itself
        }
      }
    }
  }

  await walk(root);
  return { files, truncated, method: `fs-walk max=${maxEntries} exclude=${excluded.join(",")}` };
}
