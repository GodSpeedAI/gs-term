// The semantic substrate: ONE lazy helper process + ONE SolidLSP bridge shared
// process-wide, world-gated. The substrate is mounted for the LOCAL world
// only — remote worlds always receive undefined and report their mechanisms
// honestly unavailable (never silently substituted with local results; J14).
import type { GsTermConfig } from "../config.ts";
import { mechanismDataDir, mechanismsOf } from "../config.ts";
import { resolve } from "node:path";
import type { MechanismReadiness } from "./readiness.ts";
import { discoverHelperBinary, SemanticHelper } from "./semantic-helper.ts";
import { SolidLspBridge } from "./solidlsp.ts";

export interface SemanticSubstrate {
  readonly enabled: boolean;
  readonly dataDir: string;
  readonly helper: SemanticHelper;
  readonly solidlsp: SolidLspBridge;
  /** The helper for a world — local world only; remote worlds get undefined. */
  helperFor(worldId: string): SemanticHelper | undefined;
  /** The bridge for a world+workspace — local world only; undefined otherwise. */
  solidlspFor(worldId: string, workspaceRoot: string): SolidLspBridge | undefined;
  readiness(): Promise<MechanismReadiness[]>;
  dispose(): Promise<void>;
}

export function createSemanticSubstrate(options: { config: GsTermConfig; root: string }): SemanticSubstrate {
  const mechanisms = mechanismsOf(options.config);
  const dataDir = mechanismDataDir(options.config);
  const binary = discoverHelperBinary(mechanisms.helperBinary, options.root);
  const enabled = mechanisms.enabled && binary !== undefined;
  // Local world id: the config's world id IS the local world (worlds.* are remote).
  const localWorldId = options.config.world.id;

  const helper = new SemanticHelper({
    binary: binary ?? "(disabled)",
    // Product-owned model cache: the potion model lives under the gs-term
    // data dir (one-time download), not a machine-global path.
    modelCache: resolve(dataDir, "models"),
  });
  const solidlsp = new SolidLspBridge({
    repoRoot: options.root,
    projectDir: mechanisms.solidlspProject,
  });

  return {
    enabled,
    dataDir,
    helper,
    solidlsp,
    helperFor(worldId: string): SemanticHelper | undefined {
      return enabled && worldId === localWorldId ? helper : undefined;
    },
    solidlspFor(worldId: string, workspaceRoot: string): SolidLspBridge | undefined {
      if (!enabled || worldId !== localWorldId) return undefined;
      void workspaceRoot;
      return solidlsp;
    },
    async readiness(): Promise<MechanismReadiness[]> {
      const { collectReadiness } = await import("./readiness.ts");
      return collectReadiness({ config: options.config, root: options.root, startProbes: false });
    },
    async dispose(): Promise<void> {
      await Promise.allSettled([helper.dispose(), solidlsp.dispose()]);
    },
  };
}
