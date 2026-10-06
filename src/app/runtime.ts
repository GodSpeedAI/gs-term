// Runtime composition: the single place where the mechanism layer is handed to Cognate.
// Hand-composed `createRuntime` (documented alternative to profiles — see README).
// ONE registry of execution worlds behind ONE `process.exec` — worldId selects the provider.
// The semantic substrate (zvec-grep/zvec helper + SolidLSP bridge) mounts here for the
// local world and is world-gated inside; remote worlds degrade honestly.
import { createRuntime, type Runtime } from "@cognate/runtime-bun";
import { executionWorldsComponent } from "@cognate/execution";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { executeAgent } from "../agents/execute.ts";
import { observeAgent } from "../agents/observe.ts";
import { focusAgent } from "../agents/focus.ts";
import { observersComponent } from "../components/observers.ts";
import { focusComponent, type FocusSearchInput } from "../components/focus.ts";
import { codeComponent } from "../components/code.ts";
import { syntelligentSearch } from "../focus/search.ts";
import { ensureConceptIndex } from "../focus/concept-index.ts";
import { createSemanticSubstrate, type SemanticSubstrate } from "../mechanisms/substrate.ts";
import { executionsProjection } from "../projections/executions.ts";
import type { GsTermConfig } from "../config.ts";
import { mechanismDataDir, workspaceRoot } from "../config.ts";
import { loadGsTermModel, type SemanticModel } from "./bindings.ts";
import { gstermActions, gstermPolicy } from "./policy.ts";
import { createExecutionWorlds, type ExecutionWorlds } from "./worlds.ts";

export interface GsTermRuntimeOptions {
  readonly config: GsTermConfig;
  /** SQLite path (`:memory:` allowed for tests). */
  readonly store: string;
  /** Repository root containing `domain/interaction-model.sea` (defaults to process cwd). */
  readonly domainRoot?: string;
  /** Live session root pid provider (PTY); undefined until a session exists. */
  readonly sessionPid?: () => number | undefined;
}

export interface GsTermRuntime {
  readonly runtime: Runtime;
  /** The execution worlds: registry (providers + roots) and the world-scoped observer. */
  readonly worlds: ExecutionWorlds;
  readonly model: SemanticModel;
  readonly root: string;
  /** The native semantic substrate (helper + SolidLSP bridge), local-world-gated. */
  readonly substrate: SemanticSubstrate;
  close(): Promise<void>;
}

export async function createGsTermRuntime(options: GsTermRuntimeOptions): Promise<GsTermRuntime> {
  const root = workspaceRoot(options.config);
  const domainPath = resolve(options.domainRoot ?? process.cwd(), "domain/interaction-model.sea");
  const model = loadGsTermModel(readFileSync(domainPath, "utf8"), "domain/interaction-model.sea");

  const sessionPid = options.sessionPid ?? (() => undefined);
  const worlds = createExecutionWorlds({
    config: options.config,
    localRoot: root,
    sessionWorldId: options.config.world.id,
    sessionPid,
  });

  const substrate = createSemanticSubstrate({ config: options.config, root });
  const dataDir = mechanismDataDir(options.config);
  const conceptStorePath = resolve(dataDir, "concepts");
  // Concept index freshness is checked once per runtime; rebuilds only when the
  // registry digest changes. A failed substrate never fails the search path.
  let conceptsPromise: Promise<void> | undefined;
  const ensureConcepts = (): Promise<void> => {
    if (conceptsPromise) return conceptsPromise;
    const helper = substrate.helperFor(options.config.world.id);
    conceptsPromise = helper
      ? ensureConceptIndex(helper, conceptStorePath)
          .then(() => undefined)
          .catch(() => undefined)
      : Promise.resolve();
    return conceptsPromise;
  };

  const runtime = await createRuntime({
    store: options.store,
    policy: gstermPolicy(),
    actions: gstermActions(),
    agents: [
      executeAgent({ worldRoots: worlds.roots, defaultWorldId: options.config.world.id, defaultTimeoutMs: options.config.execution.timeoutMs }),
      observeAgent({ sessionWorldId: options.config.world.id }),
      focusAgent({ sessionWorldId: options.config.world.id, workspace: basename(root) }),
    ],
    components: [
      executionWorldsComponent(worlds.registry, model.executionSemanticRef ? { semanticRef: model.executionSemanticRef } : {}),
      observersComponent({ observer: worlds.observer, ...(model.evidenceSemanticRef ? { semanticRef: model.evidenceSemanticRef } : {}) }),
      focusComponent({
        async search(input: FocusSearchInput) {
          const provider = worlds.registry.get(input.worldId);
          const worldRoot = worlds.roots[input.worldId];
          if (!worldRoot) throw new Error(`no workspace root for world ${input.worldId}`);
          await ensureConcepts();
          return syntelligentSearch(
            { query: input.query, intent: input.intent, snapshot: input.snapshot, focus: input.focus, referent: input.referent },
            {
              process: provider.process,
              root: worldRoot,
              worldId: provider.worldId,
              workspace: basename(worldRoot),
              mounted: new Set(["structural-map"]),
              execution: input.execution,
              substrate,
              conceptStorePath,
              solidlspDataDir: resolve(dataDir, "solidlsp-data"),
            },
          );
        },
      }),
      codeComponent({
        async code(input) {
          const bridge = substrate.solidlspFor(options.config.world.id, root);
          if (!bridge) throw new Error(`code capabilities unavailable for world ${input.worldId} (SolidLSP not mounted)`);
          await bridge.startWorkspace(root, resolve(dataDir, "solidlsp-data"));
          return { bridge, dataDir };
        },
      }),
    ],
    projections: [{ projection: executionsProjection, public: true }],
  });

  return {
    runtime,
    worlds,
    model,
    root,
    substrate,
    async close() {
      await runtime.close();
      await worlds.registry.dispose();
      await substrate.dispose();
    },
  };
}
