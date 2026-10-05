// Capability descriptors: the AUTHORITATIVE semantic definitions of what surfaces may do.
// WebMCP tools and cockpit buttons are projections of these descriptors — never separate
// implementations. The invoker is injected (same client path everywhere; catalog J2/J2-W).
import type { Json } from "@cognate/events";

export interface ExecuteCommandArgs {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Execution world id (an input property of the SAME operation; not provider-specific). */
  readonly worldId?: string;
}

export interface ToolInvoker {
  /** Start and settle a structured execution (agent.execute); returns the agent's output. */
  executeCommand(args: ExecuteCommandArgs, source: "ui" | "webmcp"): Promise<Json>;
  /** Read the durable world state for the session thread. */
  worldState(): Promise<Json>;
  /** Syntelligent Search via the SAME focus.search capability (bounded results + receipt). */
  focusSearch(args: { readonly query: string; readonly worldId?: string; readonly referent?: Record<string, unknown> }, source: "ui" | "webmcp"): Promise<Json>;
  /** Inspect the current SharedFocus + affordances (read-only). */
  focusInspect(source: "ui" | "webmcp"): Promise<Json>;
  /** Propose a FocusCandidate (SharedFocus unchanged until a human accepts/pins). */
  focusProposeCandidate(args: { readonly proposedEntity: Record<string, unknown>; readonly reason: string; readonly evidence?: unknown[]; readonly sourceAgent: string }, source: "ui" | "webmcp"): Promise<Json>;
}

export interface ToolDescriptor {
  /** WebMCP tool name (snake_case, stable). */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Json;
  readonly invoke: (invoker: ToolInvoker, args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[] }>;
}

function toContent(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export const CAPABILITY_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    name: "execute_command",
    description:
      "Execute a command as a structured semantic execution in the workspace execution world (argv boundaries, durable identity, effects and evidence). Prefer this over typing into the terminal.",
    inputSchema: {
      type: "object",
      properties: {
        argv: { type: "array", items: { type: "string" }, description: "Program and arguments, e.g. [\"touch\", \"demo.txt\"]" },
        cwd: { type: "string", description: "Working directory inside the world's workspace root (default: world root)" },
        timeoutMs: { type: "number", description: "Execution timeout in milliseconds" },
        worldId: { type: "string", description: "Execution world to run in (default: the configured default world)" },
      },
      required: ["argv"],
    },
    invoke: async (invoker, args) => {
      const argv = args.argv;
      if (!Array.isArray(argv) || argv.length === 0 || !argv.every((part) => typeof part === "string")) {
        return toContent({ error: "argv must be a non-empty array of strings" });
      }
      const result = await invoker.executeCommand(
        {
          argv: argv as string[],
          ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
          ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
          ...(typeof args.worldId === "string" ? { worldId: args.worldId } : {}),
        },
        "webmcp",
      );
      return toContent(result);
    },
  },
  {
    name: "get_world_state",
    description: "Read the current semantic world state: cwd, repository (branch/dirty), session processes, listening ports, and the last settled execution.",
    inputSchema: { type: "object", properties: {} },
    invoke: async (invoker) => toContent(await invoker.worldState()),
  },
  {
    name: "focus_search",
    description:
      "Syntelligent Search: deterministic narrowing over the current world's available mechanisms (exact rg, structural map, semantic where available). Returns BOUNDED semantic entities + an inspectable reduction receipt. Use FIRST when the location of an answer is uncertain; call a precise capability directly when it is already known.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to find, e.g. \"who calls reconnectSession\", \"why did this fail\"" },
        worldId: { type: "string", description: "Execution world to search (default: the active world). Never silently crosses worlds." },
        referent: { type: "object", description: "Optional focused EntityRef the query refers to (this/that)" },
      },
      required: ["query"],
    },
    invoke: async (invoker, args) => {
      if (typeof args.query !== "string" || !args.query) return toContent({ error: "query must be a non-empty string" });
      return toContent(await invoker.focusSearch({ query: args.query, ...(typeof args.worldId === "string" ? { worldId: args.worldId } : {}), ...(args.referent ? { referent: args.referent as Record<string, unknown> } : {}) }, "webmcp"));
    },
  },
  {
    name: "focus_inspect",
    description: "Inspect the shared collaborative focus: goal, primary focus, pinned entities, working set, unresolved questions, and current affordances. Bounded — no source dump.",
    inputSchema: { type: "object", properties: {} },
    invoke: async (invoker) => toContent(await invoker.focusInspect("webmcp")),
  },
  {
    name: "focus_propose_candidate",
    description:
      "Propose a FocusCandidate: an evidence-backed suggestion to shift the shared focus. The agent CANNOT accept/pin/reject — SharedFocus changes only with human authority. This makes the proposal visible for a human to resolve.",
    inputSchema: {
      type: "object",
      properties: {
        proposedEntity: { type: "object", description: "EntityRef {worldId, workspace, kind, id, name?, location?}" },
        reason: { type: "string", description: "Why this is likely relevant" },
        evidence: { type: "array", description: "Supporting evidence [{what, how, confidence, refs}]" },
        sourceAgent: { type: "string", description: "Agent proposing (e.g. agent.focus)" },
      },
      required: ["proposedEntity", "reason", "sourceAgent"],
    },
    invoke: async (invoker, args) => {
      const proposedEntity = args.proposedEntity as Record<string, unknown> | undefined;
      if (!proposedEntity || typeof proposedEntity.id !== "string") return toContent({ error: "proposedEntity must be an EntityRef" });
      return toContent(await invoker.focusProposeCandidate({ proposedEntity, reason: String(args.reason ?? ""), evidence: (args.evidence as unknown[]) ?? [], sourceAgent: String(args.sourceAgent ?? "agent.focus") }, "webmcp"));
    },
  },
];
