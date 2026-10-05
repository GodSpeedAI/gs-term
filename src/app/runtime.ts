// Runtime composition: the single place where the mechanism layer is handed to Cognate.
// Hand-composed `createRuntime` (documented alternative to profiles — see README).
// ONE registry of execution worlds behind ONE `process.exec` — worldId selects the provider.
import { createRuntime, type Runtime } from "@cognate/runtime-bun";
import { executionWorldsComponent } from "@cognate/execution";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeAgent } from "../agents/execute.ts";
import { observeAgent } from "../agents/observe.ts";
import { observersComponent } from "../components/observers.ts";
import { executionsProjection } from "../projections/executions.ts";
import type { GsTermConfig } from "../config.ts";
import { workspaceRoot } from "../config.ts";
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

  const runtime = await createRuntime({
    store: options.store,
    policy: gstermPolicy(),
    actions: gstermActions(),
    agents: [
      executeAgent({ worldRoots: worlds.roots, defaultWorldId: options.config.world.id, defaultTimeoutMs: options.config.execution.timeoutMs }),
      observeAgent({ sessionWorldId: options.config.world.id }),
    ],
    components: [
      executionWorldsComponent(worlds.registry, model.executionSemanticRef ? { semanticRef: model.executionSemanticRef } : {}),
      observersComponent({ observer: worlds.observer, ...(model.evidenceSemanticRef ? { semanticRef: model.evidenceSemanticRef } : {}) }),
    ],
    projections: [{ projection: executionsProjection, public: true }],
  });

  return {
    runtime,
    worlds,
    model,
    root,
    async close() {
      await runtime.close();
      await worlds.registry.dispose();
    },
  };
}
