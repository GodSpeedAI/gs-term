// Runtime composition: the single place where the mechanism layer is handed to Cognate.
// Hand-composed `createRuntime` (documented alternative to profiles — see README).
import { createExecutionWorldRegistry, executionWorldsComponent, localExecutionWorld, type ExecutionWorldRegistry } from "@cognate/execution";
import { createRuntime, type Runtime } from "@cognate/runtime-bun";
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
  readonly registry: ExecutionWorldRegistry;
  readonly model: SemanticModel;
  readonly root: string;
  close(): Promise<void>;
}

export async function createGsTermRuntime(options: GsTermRuntimeOptions): Promise<GsTermRuntime> {
  const root = workspaceRoot(options.config);
  const domainPath = resolve(options.domainRoot ?? process.cwd(), "domain/interaction-model.sea");
  const model = loadGsTermModel(readFileSync(domainPath, "utf8"), "domain/interaction-model.sea");

  const registry = createExecutionWorldRegistry([
    localExecutionWorld({
      worldId: options.config.world.id,
      metadata: { root, host: "localhost" },
      timeoutMs: options.config.execution.timeoutMs,
    }),
  ]);

  const sessionPid = options.sessionPid ?? (() => undefined);

  const runtime = await createRuntime({
    store: options.store,
    policy: gstermPolicy(),
    actions: gstermActions(),
    agents: [executeAgent({ root, defaultWorldId: options.config.world.id, defaultTimeoutMs: options.config.execution.timeoutMs }), observeAgent()],
    components: [
      executionWorldsComponent(registry, model.executionSemanticRef ? { semanticRef: model.executionSemanticRef } : {}),
      observersComponent({ root, sessionPid, ...(model.evidenceSemanticRef ? { semanticRef: model.evidenceSemanticRef } : {}) }),
    ],
    projections: [{ projection: executionsProjection, public: true }],
  });

  return {
    runtime,
    registry,
    model,
    root,
    async close() {
      await runtime.close();
      await registry.dispose();
    },
  };
}
