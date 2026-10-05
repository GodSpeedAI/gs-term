// D2 consumption seam (deliberately NOT implemented beyond the interface):
// the inverse direction — an external page's WebMCP capability imported as a Cognate external
// capability offer — maps onto Cognate's `RemoteCapabilityOffer` (lease-bound, TTL, never
// authority-granting). This module is the preserved seam; the architecture test proves the
// mapping round-trips through the real runtime. No tab control, no extension, no overbuild.
import type { RemoteCapabilityOffer } from "@cognate/runtime-api";

export interface ExternalWebMCPTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly sourceUrl?: string;
}

export interface ExternalOfferRequest {
  readonly leaseId: string;
  readonly agent: string;
  readonly contract: RemoteCapabilityOffer["contract"];
  readonly description: string;
  readonly inputSchema: unknown;
  readonly ttlMs: number;
}

/** External WebMCP tool → Cognate remote-offer publish request (identity never grants authority). */
export function offerRequestFromExternalTool(
  tool: ExternalWebMCPTool,
  options: { readonly leaseId: string; readonly agent: string; readonly ttlMs: number },
): ExternalOfferRequest {
  return {
    leaseId: options.leaseId,
    agent: options.agent,
    contract: { id: `external.${tool.name}`, version: "1.0.0", ...(tool.sourceUrl ? { attributes: { source: tool.sourceUrl } } : {}) },
    description: tool.description,
    inputSchema: tool.inputSchema,
    ttlMs: options.ttlMs,
  };
}
