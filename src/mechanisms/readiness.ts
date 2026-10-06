// Mechanism readiness model: the honest per-mechanism truth that doctor, the
// Focus planner, and the UI consume. Checks are real probes; "unknown" is
// never reported as "ready". Machine ops go through structured processes,
// never the PTY.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GsTermConfig } from "../config.ts";
import { mechanismsOf } from "../config.ts";
import { discoverHelperBinary, SemanticHelper } from "./semantic-helper.ts";
import { SolidLspBridge } from "./solidlsp.ts";

export type MechanismId = "bun" | "rg" | "pty" | "zvec-grep-rust" | "zvec-rust" | "potion-model" | "solidlsp" | "python-uv" | "typescript-server" | "ssh";
export type MechanismStatus = "ready" | "unavailable" | "degraded";

export interface MechanismReadiness {
  readonly name: MechanismId;
  readonly status: MechanismStatus;
  readonly implementation?: "bun" | "rust" | "python" | "native";
  readonly version?: string;
  /** Required when status !== "ready". */
  readonly reason?: string;
  readonly detail?: string;
}

export interface ReadinessOptions {
  readonly config: GsTermConfig;
  /** Repo root used for binary/artifact discovery. */
  readonly root: string;
  /** When true, START managed processes for deep probes (helper handshake, SolidLSP hello). */
  readonly startProbes?: boolean;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

async function versionOf(command: readonly string[], pattern?: RegExp): Promise<string | undefined> {
  try {
    const proc = Bun.spawnSync({ cmd: [...command] });
    if (proc.exitCode !== 0) return undefined;
    const text = `${new TextDecoder().decode(proc.stdout)}${new TextDecoder().decode(proc.stderr)}`;
    const line = firstLine(text);
    const match = pattern?.exec(line) ?? /(\d+\.\d+(\.\d+)?)/.exec(line);
    return match?.[1] ?? line;
  } catch {
    return undefined;
  }
}

interface HelperProbe {
  readonly helper: SemanticHelper | undefined;
  readonly rows: readonly [MechanismReadiness, MechanismReadiness, MechanismReadiness];
}

async function probeHelper(config: GsTermConfig, root: string, deep: boolean): Promise<HelperProbe> {
  const binary = discoverHelperBinary(mechanismsOf(config).helperBinary, root);
  const unavailable = (reason: string): HelperProbe => ({
    helper: undefined,
    rows: [
      { name: "zvec-grep-rust", status: "unavailable", implementation: "rust", reason },
      { name: "zvec-rust", status: "unavailable", implementation: "rust", reason },
      { name: "potion-model", status: "unavailable", implementation: "native", reason },
    ],
  });
  if (!binary) return unavailable("helper binary not found (build with: cargo build --release -p gsterm-semantic)");

  const helper = new SemanticHelper({ binary });
  if (!deep) {
    // Light mode: binary discovery is the readiness signal; no process starts.
    return {
      helper,
      rows: [
        { name: "zvec-grep-rust", status: "ready", implementation: "rust", detail: binary },
        { name: "zvec-rust", status: "ready", implementation: "rust", detail: binary },
        { name: "potion-model", status: "degraded", implementation: "native", reason: "not probed (light mode)", detail: binary },
      ],
    };
  }
  try {
    const hello = await helper.start();
    const model = await helper.modelStatus();
    return {
      helper,
      rows: [
        { name: "zvec-grep-rust", status: "ready", implementation: "rust", version: hello.version, detail: `zg-engine ${hello.zg_engine_revision.slice(0, 7)}` },
        { name: "zvec-rust", status: "ready", implementation: "rust", version: hello.zvec_version, detail: binary },
        model.ready
          ? { name: "potion-model", status: "ready", implementation: "native", version: model.revision.slice(0, 7), detail: model.path }
          : { name: "potion-model", status: "unavailable", implementation: "native", reason: "model artifacts absent (download on first index)", detail: model.path },
      ],
    };
  } catch (error) {
    await helper.dispose();
    return unavailable(`helper start failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Collect readiness for every mechanism. Light mode starts no processes. */
export async function collectReadiness(options: ReadinessOptions): Promise<MechanismReadiness[]> {
  const deep = options.startProbes === true;
  const mechanisms = mechanismsOf(options.config);
  const [bunVersion, rgVersion, uvVersion, sshVersion] = await Promise.all([
    versionOf(["bun", "--version"]),
    versionOf(["rg", "--version"], /ripgrep (\d+\.\d+\.\d+)/),
    versionOf(["uv", "--version"]),
    versionOf(["ssh", "-V"], /OpenSSH_\S+/),
  ]);

  const setsidPresent = Bun.which("setsid") !== null;
  const pty: MechanismReadiness = setsidPresent
    ? { name: "pty", status: "ready", implementation: "bun", detail: "setsid + Bun.spawn terminal" }
    : { name: "pty", status: "degraded", implementation: "bun", reason: "setsid not on PATH: job control fallback loses interrupt semantics" };

  const helperProbe = await probeHelper(options.config, options.root, deep);

  const solidlspProjectDir = resolve(options.root, mechanisms.solidlspProject);
  const projectPresent = existsSync(resolve(solidlspProjectDir, "pyproject.toml"));
  let solidlsp: MechanismReadiness;
  let typescriptServer: MechanismReadiness;
  if (!projectPresent) {
    solidlsp = { name: "solidlsp", status: "unavailable", implementation: "python", reason: `bridge project not found at ${mechanisms.solidlspProject}` };
    typescriptServer = { name: "typescript-server", status: "unavailable", implementation: "bun", reason: "SolidLSP bridge unavailable" };
  } else if (!deep) {
    solidlsp = { name: "solidlsp", status: "degraded", implementation: "python", reason: "not probed (light mode)", detail: solidlspProjectDir };
    typescriptServer = { name: "typescript-server", status: "degraded", implementation: "bun", reason: "not probed (light mode)" };
  } else {
    const bridge = new SolidLspBridge({ repoRoot: options.root, projectDir: mechanisms.solidlspProject });
    try {
      const hello = await bridge.start();
      solidlsp = { name: "solidlsp", status: "ready", implementation: "python", version: hello.solidlsp, detail: solidlspProjectDir };
      typescriptServer = {
        name: "typescript-server",
        status: hello.ts_server.installed ? "ready" : "degraded",
        implementation: "bun",
        version: hello.ts_server.language_server,
        ...(hello.ts_server.installed ? {} : { reason: "language-server resources not provisioned yet (first start provisions)" }),
        detail: `runtime: bun ${hello.ts_server.runtime_version ?? ""}`.trim(),
      };
    } catch (error) {
      solidlsp = { name: "solidlsp", status: "unavailable", implementation: "python", reason: `bridge start failed: ${error instanceof Error ? error.message : String(error)}` };
      typescriptServer = { name: "typescript-server", status: "unavailable", implementation: "bun", reason: "SolidLSP bridge unavailable" };
    } finally {
      await bridge.dispose();
    }
  }

  try {
    return [
      bunVersion
        ? { name: "bun", status: "ready", implementation: "bun", version: bunVersion }
        : { name: "bun", status: "unavailable", implementation: "bun", reason: "bun not found on PATH" },
      pty,
      rgVersion ? { name: "rg", status: "ready", implementation: "native", version: rgVersion } : { name: "rg", status: "unavailable", implementation: "native", reason: "ripgrep not found on PATH" },
      ...helperProbe.rows,
      solidlsp,
      uvVersion ? { name: "python-uv", status: "ready", implementation: "python", version: uvVersion } : { name: "python-uv", status: "unavailable", implementation: "python", reason: "uv not found on PATH" },
      typescriptServer,
      sshVersion ? { name: "ssh", status: "ready", implementation: "native", version: sshVersion } : { name: "ssh", status: "unavailable", implementation: "native", reason: "ssh not found on PATH" },
    ];
  } finally {
    await helperProbe.helper?.dispose();
  }
}
