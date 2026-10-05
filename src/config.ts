// Runtime configuration: gsterm.toml + environment overrides (never Markdown).
import { resolve } from "node:path";

export interface GsTermConfig {
  readonly server: { readonly hostname: string; readonly port: number };
  readonly world: { readonly id: string; readonly root: string };
  readonly session: { readonly id: string; readonly shell: string; readonly cols: number; readonly rows: number; readonly scrollbackBytes: number };
  readonly execution: { readonly timeoutMs: number };
}

interface RawConfig {
  server?: { hostname?: string; port?: number };
  world?: { id?: string; root?: string };
  session?: { id?: string; shell?: string; cols?: number; rows?: number; scrollback_bytes?: number };
  execution?: { timeout_ms?: number };
}

const DEFAULTS: GsTermConfig = {
  server: { hostname: "127.0.0.1", port: 7317 },
  world: { id: "local", root: "" },
  session: { id: "main", shell: "bash", cols: 120, rows: 32, scrollbackBytes: 262_144 },
  execution: { timeoutMs: 30_000 },
};

/** Load configuration from `gsterm.toml` (if present) under `cwd`, then apply environment overrides. */
export async function loadConfig(cwd: string = process.cwd()): Promise<GsTermConfig> {
  const path = resolve(cwd, "gsterm.toml");
  let raw: RawConfig = {};
  const file = Bun.file(path);
  if (await file.exists()) raw = Bun.TOML.parse(await file.text()) as RawConfig;

  const env = Bun.env;
  const root = env.GSTERM_ROOT ?? raw.world?.root ?? DEFAULTS.world.root;
  return {
    server: {
      hostname: env.GSTERM_HOSTNAME ?? raw.server?.hostname ?? DEFAULTS.server.hostname,
      port: env.GSTERM_PORT ? Number(env.GSTERM_PORT) : (raw.server?.port ?? DEFAULTS.server.port),
    },
    world: {
      id: raw.world?.id ?? DEFAULTS.world.id,
      // A non-empty root is resolved to an absolute path; empty stays empty (= process cwd).
      root: root === "" ? "" : resolve(root),
    },
    session: {
      // Stable across restarts on purpose: the world-state thread (`session:<id>`) is durable
      // semantic history; the PTY behind it is a fresh process on every boot.
      id: raw.session?.id ?? DEFAULTS.session.id,
      shell: raw.session?.shell ?? DEFAULTS.session.shell,
      cols: raw.session?.cols ?? DEFAULTS.session.cols,
      rows: raw.session?.rows ?? DEFAULTS.session.rows,
      scrollbackBytes: raw.session?.scrollback_bytes ?? DEFAULTS.session.scrollbackBytes,
    },
    execution: { timeoutMs: raw.execution?.timeout_ms ?? DEFAULTS.execution.timeoutMs },
  };
}

/** The effective workspace root (containment boundary + observation scope). */
export function workspaceRoot(config: GsTermConfig): string {
  return config.world.root === "" ? resolve(process.cwd()) : config.world.root;
}
