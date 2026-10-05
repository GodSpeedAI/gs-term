// The WebMCP projection: capability descriptors → `document.modelContext` tools.
// This is the ONLY WebMCP-specific code in the app. It speaks the CURRENT W3C Community Group
// draft API (`document.modelContext`) — never the deprecated `navigator` alias from older donors.
// Tool `execute` delegates to the injected invoker — the same client path the cockpit uses.
import { CAPABILITY_DESCRIPTORS, type ToolDescriptor, type ToolInvoker } from "./descriptors.ts";

/** Structural typing of the current WebMCP standard surface (verify against the spec when upgrading). */
export interface WebMCPToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  /** Receives the PARSED input object/array (the polyfill parses the JSON args string). */
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(tool: WebMCPToolSpec, options?: { readonly signal?: AbortSignal }): Promise<unknown> | unknown;
  getTools(): readonly unknown[];
  /** Chromium-matching shape: input is a JSON TEXT payload; the result is a JSON string. */
  executeTool?(tool: unknown, inputArgsJson: string): Promise<unknown>;
}

/** `document.modelContext` if the page provides one (native or polyfill-installed). */
export function pageModelContext(documentLike: { modelContext?: ModelContextLike } | undefined): ModelContextLike | undefined {
  return documentLike?.modelContext;
}

/**
 * Project every capability descriptor as a WebMCP tool. Returns the registered tool names.
 * Registration failure of one tool does not silently drop the others — it is reported.
 */
export async function projectCapabilitiesToWebMCP(
  context: ModelContextLike,
  invoker: ToolInvoker,
  descriptors: readonly ToolDescriptor[] = CAPABILITY_DESCRIPTORS,
): Promise<{ registered: readonly string[]; failed: readonly { readonly name: string; readonly reason: string }[] }> {
  const registered: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const descriptor of descriptors) {
    try {
      await context.registerTool({
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        execute: (args) => descriptor.invoke(invoker, args),
      });
      registered.push(descriptor.name);
    } catch (error) {
      failed.push({ name: descriptor.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { registered, failed };
}
