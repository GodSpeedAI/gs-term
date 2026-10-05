// Execution-world composition: ONE registry of providers behind the SAME capabilities.
// Provider-specific mechanics (ssh2 auth, host keys, disposal) live here — below the semantic
// boundary. The semantic layer only ever sees `worldId` + `ExecutionWorldProvider` ports.
import { createExecutionWorldRegistry, localExecutionWorld, WorldUnavailableError, type ExecutionWorldRegistry } from "@cognate/execution";
import { sshExecutionWorld, type HostKeyPolicy, type SshAuth } from "@cognate/execution-ssh";
import type { GsTermConfig, SshWorldConfig } from "../config.ts";
import { worldRootsOf } from "../config.ts";
import type { WorldSnapshot } from "../semantic/contracts.ts";
import type { WorldObserver } from "../components/observers.ts";
import { takeWorldSnapshot } from "../observers/snapshot.ts";

export interface ExecutionWorlds {
  readonly registry: ExecutionWorldRegistry;
  readonly roots: Readonly<Record<string, string>>;
  readonly observer: WorldObserver;
}

/** Credential REFERENCES resolve to provider credentials here and never travel further. */
export function sshAuthOf(id: string, world: SshWorldConfig): SshAuth {
  if (world.auth === "agent") return { kind: "agent" };
  if (world.auth.startsWith("key:")) return { kind: "key", privateKeyPath: world.auth.slice("key:".length) };
  const variable = world.auth.slice("password-env:".length);
  const password = process.env[variable];
  if (!password) throw new Error(`world ${id}: password-env reference ${variable} is not set`);
  return { kind: "password", password };
}

export function hostKeyPolicyOf(world: SshWorldConfig): HostKeyPolicy {
  return {
    ...(world.hostKeyFingerprints.length > 0 ? { fingerprints: [...world.hostKeyFingerprints] } : {}),
    ...(world.hostKeysFile ? { knownHostsPath: world.hostKeysFile } : {}),
  };
}

export function createExecutionWorlds(options: {
  readonly config: GsTermConfig;
  readonly localRoot: string;
  readonly sessionWorldId: string;
  readonly sessionPid: () => number | undefined;
}): ExecutionWorlds {
  const { config } = options;
  const roots = worldRootsOf(config);
  const providers = [
    localExecutionWorld({
      worldId: config.world.id,
      metadata: { root: options.localRoot, host: "localhost" },
      timeoutMs: config.execution.timeoutMs,
    }),
    ...Object.entries(config.worlds).map(([id, world]) =>
      sshExecutionWorld({
        worldId: id,
        host: world.host,
        port: world.port,
        username: world.username,
        auth: sshAuthOf(id, world),
        hostKeys: hostKeyPolicyOf(world),
        defaultTimeoutMs: world.defaultTimeoutMs,
        readyTimeoutMs: world.readyTimeoutMs,
      }),
    ),
  ];
  const registry = createExecutionWorldRegistry(providers);

  const observer: WorldObserver = {
    async snapshot(worldId) {
      const id = worldId ?? options.sessionWorldId;
      const provider = registry.get(id); // unknown/disposed → WorldUnavailableError (fail closed)
      const root = roots[id];
      if (!root) throw new WorldUnavailableError(id, `no workspace root configured for world ${id}`);
      return takeWorldSnapshot({
        world: { worldId: provider.worldId, kind: provider.kind, metadata: provider.metadata },
        fileSystem: provider.fileSystem,
        process: provider.process,
        root,
        sessionPid: id === options.sessionWorldId ? options.sessionPid() : undefined,
      });
    },
  };

  return { registry, roots, observer };
}
