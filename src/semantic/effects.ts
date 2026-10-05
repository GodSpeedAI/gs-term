// Pure, deterministic effect derivation from two world snapshots (pre → post).
// No I/O, no clock: given the same snapshots it always yields the same effects.
// Evidence discipline: every effect carries provenance; "no observed change" is itself evidence.
import type { Effect, Evidence, FileObservation, PortObservation, ProcessObservation, Scoped, WorldSnapshot } from "./contracts.ts";
import { isScoped } from "./contracts.ts";

const METHOD = "snapshot-diff";

function fileMap(snapshot: WorldSnapshot): Map<string, FileObservation> {
  return new Map(snapshot.files.map((file) => [file.path, file]));
}

function fileEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const before = fileMap(pre);
  const after = fileMap(post);
  const effects: Effect[] = [];
  const evidence = (what: string, refs: string[]): Evidence => ({ what, how: METHOD, confidence: "derived", refs });

  for (const [path, file] of after) {
    const previous = before.get(path);
    if (!previous) {
      effects.push({ kind: "file.created", target: path, after: file, evidence: [evidence(`file created: ${path}`, [`${pre.observedAt}`, `${post.observedAt}`])] });
    } else if (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
      effects.push({ kind: "file.modified", target: path, before: previous, after: file, evidence: [evidence(`file modified: ${path}`, [`${pre.observedAt}`, `${post.observedAt}`])] });
    }
  }
  for (const [path, file] of before) {
    if (!after.has(path)) {
      effects.push({ kind: "file.deleted", target: path, before: file, evidence: [evidence(`file deleted: ${path}`, [`${pre.observedAt}`, `${post.observedAt}`])] });
    }
  }
  return effects;
}

function gitEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const from = pre.git;
  const to = post.git;
  const evidence = (what: string): Evidence => ({ what, how: "git-status", confidence: "observed", refs: [from.observedAt, to.observedAt] });
  if (from.status === "observed" && to.status === "observed") {
    if (from.dirty === false && to.dirty === true) {
      return [{ kind: "git.dirty", target: to.root ?? ".", after: { branch: to.branch, changedFiles: to.changedFiles }, evidence: [evidence(`working tree became dirty in ${to.root ?? "."}`)] }];
    }
    if (from.dirty === true && to.dirty === false) {
      return [{ kind: "git.clean", target: to.root ?? ".", before: { branch: from.branch, changedFiles: from.changedFiles }, evidence: [evidence(`working tree became clean in ${to.root ?? "."}`)] }];
    }
  }
  return [];
}

function scopedDiff<T>(
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
  const evidence = (what: string): Evidence => ({ what, how, confidence: "observed", refs: [pre.observedAt, post.observedAt] });
  for (const [key, entry] of after) {
    if (!before.has(key)) effects.push({ kind: kindStarted, target: target(entry), after: entry, evidence: [evidence(`${kindStarted}: ${target(entry)}`)] });
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) effects.push({ kind: kindStopped, target: target(entry), before: entry, evidence: [evidence(`${kindStopped}: ${target(entry)}`)] });
  }
  return effects;
}

/**
 * Derive the effect set from a pre-execution and a post-execution snapshot.
 * Processes and ports are compared only when both snapshots observed them (unknown never
 * masquerades as "no change"). An empty result still yields a `none` effect with evidence.
 */
export function deriveEffects(pre: WorldSnapshot, post: WorldSnapshot): Effect[] {
  const effects: Effect[] = [
    ...fileEffects(pre, post),
    ...gitEffects(pre, post),
    ...scopedDiff<ProcessObservation>(
      pre.processes,
      post.processes,
      (entry) => `${entry.pid}`,
      "process.started",
      "process.stopped",
      (entry) => `${entry.pid} ${entry.command}`,
      "process-tree-diff",
    ),
    ...scopedDiff<PortObservation>(
      pre.ports,
      post.ports,
      (entry) => `${entry.protocol}/${entry.port}/${entry.pid ?? "unattributed"}`,
      "port.opened",
      "port.closed",
      (entry) => `${entry.protocol}/${entry.port}${entry.process ? ` ${entry.process}` : ""}`,
      "listening-ports-diff",
    ),
  ];
  if (effects.length === 0) {
    return [
      {
        kind: "none",
        target: post.root,
        evidence: [
          {
            what: "no observed change in scoped world state",
            how: METHOD,
            confidence: "derived",
            refs: [`${pre.observedAt}`, `${post.observedAt}`, post.walk.method],
          },
        ],
      },
    ];
  }
  return effects;
}
