// Explicit semantic bindings: the ONLY path from `.sea` semantic objects to capability
// contracts is `bindCapabilities` — nothing is inferred (spec §19 / idm-to-cognate).
import { bindCapabilities, loadSemanticProjection, type CapabilityBinding, type SemanticProjection } from "@cognate/domainforge";
import type { CapabilityContract, SemanticRef } from "@cognate/kernel-api";
import { EXECUTION_CAPABILITY_VERSION, PROCESS_CAPABILITY } from "@cognate/execution";
import { WORLD_SNAPSHOT_CAPABILITY, WORLD_SNAPSHOT_VERSION } from "../components/observers.ts";

export interface SemanticModel {
  readonly projection: SemanticProjection;
  readonly digest: string;
  readonly bindings: readonly CapabilityContract[];
  readonly executionSemanticRef: SemanticRef | undefined;
  readonly evidenceSemanticRef: SemanticRef | undefined;
}

/** Semantic ids verified against the projection round-trip (see .sea/interaction/handoff.md). */
export const SEMANTIC_ID_EXECUTION = "controlplane::Execution";
export const SEMANTIC_ID_EVIDENCE = "controlplane::Evidence";

export function loadGsTermModel(source: string, uri: string): SemanticModel {
  const result = loadSemanticProjection(source, { uri });
  if (!result.ok) throw new Error(`failed to parse domain model ${uri}: ${JSON.stringify(result.error)}`);
  const projection = result.projection;

  const required = new Set([SEMANTIC_ID_EXECUTION, SEMANTIC_ID_EVIDENCE]);
  const present = new Set(projection.objects.map((object) => object.ref.id));
  for (const id of required) {
    if (!present.has(id)) throw new Error(`domain model ${uri} is missing required semantic object ${id}`);
  }

  const bindings: readonly CapabilityBinding[] = [
    { semanticId: SEMANTIC_ID_EXECUTION, capability: { id: PROCESS_CAPABILITY, version: EXECUTION_CAPABILITY_VERSION } },
    { semanticId: SEMANTIC_ID_EVIDENCE, capability: { id: WORLD_SNAPSHOT_CAPABILITY, version: WORLD_SNAPSHOT_VERSION } },
  ];
  const contracts = bindCapabilities(projection, bindings);
  const byCapability = new Map(contracts.map((contract) => [contract.id, contract]));

  return {
    projection,
    digest: projection.source.digest,
    bindings: contracts,
    executionSemanticRef: byCapability.get(PROCESS_CAPABILITY)?.semanticRef,
    evidenceSemanticRef: byCapability.get(WORLD_SNAPSHOT_CAPABILITY)?.semanticRef,
  };
}
