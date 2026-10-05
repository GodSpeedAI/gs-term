// Capability descriptors: the AUTHORITATIVE semantic definitions of what surfaces may do.
// WebMCP tools and cockpit buttons are projections of these descriptors — never separate
// implementations. The invoker is injected (same client path everywhere; catalog J2/J2-W).
import type { Json } from "@cognate/events";

export interface ExecuteCommandArgs {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface ToolInvoker {
  /** Start and settle a structured execution (agent.execute); returns the agent's output. */
  executeCommand(args: ExecuteCommandArgs, source: "ui" | "webmcp"): Promise<Json>;
  /** Read the durable world state for the session thread. */
  worldState(): Promise<Json>;
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
        cwd: { type: "string", description: "Working directory inside the workspace root (default: workspace root)" },
        timeoutMs: { type: "number", description: "Execution timeout in milliseconds" },
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
];
