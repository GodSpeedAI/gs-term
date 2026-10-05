// Pure, deterministic effect derivation from two world snapshots (pre → post).
// Effects carry world identity: the semantic resource is the pair (worldId, path) —
// equal paths in different worlds are different resources (DEBT D-005).
import type { Effect, Evidence, FileObservation, PortObservation, ProcessObservation, Scoped, WorldSnapshot } from "./contracts.ts";
import { isScoped } from "./contracts.ts";

const METHOD = "snapshot-diff";

function fileMap(snapshot: WorldSnapshot): Map<string, FileObservation> {
  return new Map(snapshot.files.map((file) => [file.path, file]));
}

function fileEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const worldId = post.world.worldId;
  const before = fileMap(pre);
  const after = fileMap(post);
  const effects: Effect[] = [];
  const refs = [`${pre.world.worldId}:${pre.root}@${pre.observedAt}`, `${post.world.worldId}:${post.root}@${post.observedAt}`];
  const evidence = (what: string): Evidence => ({ what, how: METHOD, confidence: "derived", refs });

  for (const [path, file] of after) {
    const previous = before.get(path);
    if (!previous) {
      effects.push({ kind: "file.created", worldId, target: path, after: file, evidence: [evidence(`file created in ${worldId}: ${path}`)] });
    } else if (previous.version !== file.version || previous.size !== file.size) {
      effects.push({ kind: "file.modified", worldId, target: path, before: previous, after: file, evidence: [evidence(`file modified in ${worldId}: ${path}`)] });
    }
  }
  for (const [path, file] of before) {
    if (!after.has(path)) {
      effects.push({ kind: "file.deleted", worldId, target: path, before: file, evidence: [evidence(`file deleted in ${worldId}: ${path}`)] });
    }
  }
  return effects;
}

function gitEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const worldId = post.world.worldId;
  const from = pre.git;
  const to = post.git;
  const evidence = (what: string): Evidence => ({ what, how: `git-status world=${worldId}`, confidence: "observed", refs: [from.observedAt, to.observedAt] });
  if (from.status === "observed" && to.status === "observed") {
    if (from.dirty === false && to.dirty === true) {
      return [{ kind: "git.dirty", worldId, target: to.root ?? ".", after: { branch: to.branch, changedFiles: to.changedFiles }, evidence: [evidence(`working tree became dirty in ${worldId} (${to.root ?? "."})`)] }];
    }
    if (from.dirty === true && to.dirty === false) {
      return [{ kind: "git.clean", worldId, target: to.root ?? ".", before: { branch: from.branch, changedFiles: from.changedFiles }, evidence: [evidence(`working tree became clean in ${worldId} (${to.root ?? "."})`)] }];
    }
  }
  return [];
}

function scopedDiff<T>(
  worldId: string,
  pre: Scoped<T>,
  post: Scoped<T>,
  key: (entry: T) => string,
  kindStarted: Effect["kind"],
  kindStopped: Effect["kind"],
  target: (entry: T) => string,
  how: string,
): Effect[] {
  if (!isScoped(pre) || !isScoped(post)) return [];
  const before = new Map(pre.entries.map((entry) => [key(entry), entry]));
  const after = new Map(post.entries.map((entry) => [key(entry), entry]));
  const effects: Effect[] = [];
  const evidence = (what: string): Evidence => ({ what, how: `${how} world=${worldId}`, confidence: "observed", refs: [pre.observedAt, post.observedAt] });
  for (const [key, entry] of after) {
    if (!before.has(key)) effects.push({ kind: kindStarted, worldId, target: target(entry), after: entry, evidence: [evidence(`${kindStarted}: ${target(entry)}`)] });
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) effects.push({ kind: kindStopped, worldId, target: target(entry), before: entry, evidence: [evidence(`${kindStopped}: ${target(entry)}`)] });
  }
  return effects;
}

/**
 * Derive the effect set from a pre-execution and a post-execution snapshot of ONE world.
 * Processes and ports are compared only when both snapshots observed them (unknown never
 * masquerades as "no change"). An empty result still yields a `none` effect with evidence.
 */
export function deriveEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const worldId = post.world.worldId;
  const effects: Effect[] = [
    ...fileEffects(pre, post),
    ...gitEffects(pre, post),
    ...scopedDiff<ProcessObservation>(worldId, pre.processes, post.processes, (entry) => `${entry.pid}`, "process.started", "process.stopped", (entry) => `${entry.pid} ${entry.command}`, "process-tree-diff"),
    ...scopedDiff<PortObservation>(worldId, pre.ports, post.ports, (entry) => `${entry.protocol}/${entry.port}/${entry.pid ?? "unattributed"}`, "port.opened", "port.closed", (entry) => `${entry.protocol}/${entry.port}${entry.process ? ` ${entry.process}` : ""}`, "listening-ports-diff"),
  ];
  if (effects.length === 0) {
    return [
      {
        kind: "none",
        worldId,
        target: post.root,
        evidence: [
          {
            what: `no observed change in scoped world state of ${worldId}`,
            how: METHOD,
            confidence: "derived",
            refs: [`${pre.world.worldId}:${pre.root}@${pre.observedAt}`, `${post.world.worldId}:${post.root}@${post.observedAt}`, post.walk.method],
          },
        ],
      },
    ];
  }
  return effects;
}
