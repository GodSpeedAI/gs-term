// Filesystem observer: bounded recursive walk of a world's file port.
// Mechanism layer — works over ANY provider's file port (local, SFTP) with one evidence shape.
// Honesty: `truncated: true` when the cap is hit.

import type { FileObservation } from "../semantic/contracts.ts";
import type { FilePort } from "../semantic/contracts.ts";

export const DEFAULT_EXCLUDED = [".git", "node_modules", ".cognate"] as const;
const DEFAULT_MAX_ENTRIES = 5_000;

export interface WalkResult {
  readonly files: readonly FileObservation[];
  readonly truncated: boolean;
  readonly method: string;
}

export async function walkWorldFiles(
  fs: FilePort,
  root: string,
  options: { readonly excluded?: readonly string[]; readonly maxEntries?: number } = {},
): Promise<WalkResult> {
  const excluded = options.excluded ?? DEFAULT_EXCLUDED;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const files: FileObservation[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let entries: Awaited<ReturnType<FilePort["list"]>>;
    try {
      entries = await fs.list(dir);
    } catch {
      return; // unreadable directory: skipped, not claimed absent
    }
    for (const entry of entries) {
      if (files.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (excluded.includes(entry.name)) continue;
      const path = dir === root ? entry.name : `${dir.slice(root.length + 1)}/${entry.name}`;
      if (entry.kind === "directory") {
        files.push({ path, kind: "directory", size: 0, version: "dir" });
        await walk(`${dir}/${entry.name}`);
      } else {
        try {
          const stat = await fs.stat(`${dir}/${entry.name}`);
          if (stat) files.push({ path, kind: stat.kind, size: stat.size, version: stat.version });
        } catch {
          // vanished between list and stat: absence is not an effect claim by itself
        }
      }
    }
  }

  await walk(root);
  return { files, truncated, method: `fs-walk max=${maxEntries} exclude=${excluded.join(",")}` };
}
