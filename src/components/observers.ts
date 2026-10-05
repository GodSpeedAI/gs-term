// The `world.snapshot` capability component: publishes evidence-gathering as a Cognate
// capability so agents and the bridge consume it through policy-checked invocation.
// Semantic layer — wraps the mechanism observers behind one contract.
import type { Component } from "@cognate/kernel-api";
import type { WorldSnapshot } from "../semantic/contracts.ts";
import { takeWorldSnapshot } from "../observers/snapshot.ts";

export const WORLD_SNAPSHOT_CAPABILITY = "world.snapshot";
export const WORLD_SNAPSHOT_VERSION = "1.0.0";

export interface ObserversComponentOptions {
  readonly root: string;
  /** Live session root process id, when a PTY session exists (undefined → processes unknown). */
  readonly sessionPid: () => number | undefined;
  readonly semanticRef?: import("@cognate/kernel-api").SemanticRef;
}

export function observersComponent(options: ObserversComponentOptions): Component {
  const contract = { id: WORLD_SNAPSHOT_CAPABILITY, version: WORLD_SNAPSHOT_VERSION, ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  return {
    id: "gsterm:observers",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (): Promise<WorldSnapshot> =>
        takeWorldSnapshot({ root: options.root, sessionPid: options.sessionPid() }),
      );
    },
  };
}
