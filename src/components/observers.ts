// The `world.snapshot` capability component: evidence-gathering as a Cognate capability so
// agents and the bridge consume it through policy-checked invocation. ONE capability for every
// execution world — `worldId` selects the world, never the semantics.
import type { Component, SemanticRef } from "@cognate/kernel-api";
import type { WorldSnapshot } from "../semantic/contracts.ts";

export const WORLD_SNAPSHOT_CAPABILITY = "world.snapshot";
export const WORLD_SNAPSHOT_VERSION = "1.0.0";

export interface WorldObserver {
  /** Evidence snapshot of one world (default: the session world). Fails closed on unknown worlds. */
  snapshot(worldId?: string): Promise<WorldSnapshot>;
}

export interface ObserversComponentOptions {
  readonly observer: WorldObserver;
  readonly semanticRef?: SemanticRef;
}

export function observersComponent(options: ObserversComponentOptions): Component {
  const contract = { id: WORLD_SNAPSHOT_CAPABILITY, version: WORLD_SNAPSHOT_VERSION, ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  return {
    id: "gsterm:observers",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (raw): Promise<WorldSnapshot> => {
        const input = (raw ?? {}) as { worldId?: string };
        return options.observer.snapshot(input.worldId);
      });
    },
  };
}

