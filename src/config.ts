// Runtime configuration: gsterm.toml + environment overrides (never Markdown).
import { resolve } from "node:path";

export interface GsTermConfig {
  readonly server: { readonly hostname: string; readonly port: number };
  readonly world: { readonly id: string; readonly root: string };
  readonly session: { readonly id: string; readonly shell: string; readonly cols: number; readonly rows: number; readonly scrollbackBytes: number };
  readonly execution: { readonly timeoutMs: number };
  /** Additional execution worlds (kind "ssh"). Same `process.exec` capability, different provider. */
  readonly worlds: Readonly<Record<string, SshWorldConfig>>;
}

/**
 * A configured SSH execution world. Credentials are REFERENCES, never raw values:
 * `auth` is one of `agent` (SSH_AUTH_SOCK), `key:<path>`, `password-env:<VAR>`.
 * Host identity must be pinned: fingerprints and/or a known_hosts file (the provider
 * refuses to connect without a host-key policy).
 */
export interface SshWorldConfig {
  readonly kind: "ssh";
  readonly display: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly root: string;
  readonly auth: string;
  readonly hostKeyFingerprints: readonly string[];
  readonly hostKeysFile?: string;
  readonly defaultTimeoutMs: number;
  /** Connection establishment bound (ms); failures settle promptly instead of hanging runs. */
  readonly readyTimeoutMs: number;
}

interface RawConfig {
  server?: { hostname?: string; port?: number };
  world?: { id?: string; root?: string };
  session?: { id?: string; shell?: string; cols?: number; rows?: number; scrollback_bytes?: number };
  execution?: { timeout_ms?: number };
  worlds?: Record<
    string,
    {
      kind?: string;
      display?: string;
      host?: string;
      port?: number;
      username?: string;
      root?: string;
      auth?: string;
      host_key_fingerprints?: readonly string[];
      host_keys_file?: string;
      default_timeout_ms?: number;
      ready_timeout_ms?: number;
    }
  >;
}

function parseSshWorld(id: string, raw: NonNullable<RawConfig["worlds"]>[string]): SshWorldConfig {
  if (raw.kind !== undefined && raw.kind !== "ssh") throw new Error(`world ${id}: unsupported kind ${raw.kind} (v0 supports "ssh")`);
  if (!raw.host) throw new Error(`world ${id}: host is required`);
  if (!raw.username) throw new Error(`world ${id}: username is required`);
  if (!raw.root) throw new Error(`world ${id}: root is required`);
  const auth = raw.auth ?? "agent";
  if (auth !== "agent" && !auth.startsWith("key:") && !auth.startsWith("password-env:")) {
    throw new Error(`world ${id}: auth must be "agent", "key:<path>", or "password-env:<VAR>"`);
  }
  const fingerprints = raw.host_key_fingerprints ?? [];
  if (fingerprints.length === 0 && !raw.host_keys_file) {
    throw new Error(`world ${id}: host-key pinning is required (host_key_fingerprints and/or host_keys_file)`);
  }
  return {
    kind: "ssh",
    display: raw.display ?? `${raw.username}@${raw.host}`,
    host: raw.host,
    port: raw.port ?? 22,
    username: raw.username,
    root: raw.root,
    auth,
    hostKeyFingerprints: [...fingerprints],
    ...(raw.host_keys_file ? { hostKeysFile: raw.host_keys_file } : {}),
    defaultTimeoutMs: raw.default_timeout_ms ?? 30_000,
    readyTimeoutMs: raw.ready_timeout_ms ?? 20_000,
  };
}


const DEFAULTS: GsTermConfig = {
  server: { hostname: "127.0.0.1", port: 7317 },
  world: { id: "local", root: "" },
  session: { id: "main", shell: "bash", cols: 120, rows: 32, scrollbackBytes: 262_144 },
  execution: { timeoutMs: 30_000 },
  worlds: {},
};

/** Load configuration from `gsterm.toml` (if present) under `cwd`, then apply environment overrides. */
export async function loadConfig(cwd: string = process.cwd()): Promise<GsTermConfig> {
  const path = resolve(cwd, "gsterm.toml");
  let raw: RawConfig = {};
  const file = Bun.file(path);
  if (await file.exists()) raw = Bun.TOML.parse(await file.text()) as RawConfig;

  const env = Bun.env;
  const root = env.GSTERM_ROOT ?? raw.world?.root ?? DEFAULTS.world.root;
  const worlds: Record<string, SshWorldConfig> = {};
  for (const [id, entry] of Object.entries(raw.worlds ?? {})) {
    if (id === (raw.world?.id ?? DEFAULTS.world.id)) throw new Error(`worlds.${id}: collides with the default local world id`);
    worlds[id] = parseSshWorld(id, entry);
  }
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
    worlds,
  };
}

/** The effective workspace root (containment boundary + observation scope). */
export function workspaceRoot(config: GsTermConfig): string {
  return config.world.root === "" ? resolve(process.cwd()) : config.world.root;
}

/** Root per world id: the app-level workspace root each world's paths resolve inside. */
export function worldRootsOf(config: GsTermConfig): Readonly<Record<string, string>> {
  const roots: Record<string, string> = { [config.world.id]: workspaceRoot(config) };
  for (const [id, world] of Object.entries(config.worlds)) roots[id] = world.root;
  return roots;
}
