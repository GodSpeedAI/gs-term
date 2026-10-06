// `gs-term doctor`: deterministic diagnostic surface. Reports the honest
// readiness of every mechanism the architecture relies on; "Node: not
// required" is an architectural statement — the required stack is Bun, Rust,
// Python/uv, and native tools. Exit 1 when enabled-but-unready mechanisms
// exist (a mounted substrate that cannot start must be visible, never silent).
import { collectReadiness, type MechanismReadiness } from "./mechanisms/readiness.ts";
import { loadConfig, mechanismsOf } from "./config.ts";
import { resolve } from "node:path";

const SECTION_ORDER = ["Runtime", "Native semantic search", "Language intelligence", "Search", "Remote"] as const;
type Section = (typeof SECTION_ORDER)[number];

const SECTION_OF: Record<MechanismReadiness["name"], Section> = {
  bun: "Runtime",
  pty: "Runtime",
  "zvec-grep-rust": "Native semantic search",
  "zvec-rust": "Native semantic search",
  "potion-model": "Native semantic search",
  solidlsp: "Language intelligence",
  "python-uv": "Language intelligence",
  "typescript-server": "Language intelligence",
  rg: "Search",
  ssh: "Remote",
};

const DISPLAY: Record<MechanismReadiness["name"], string> = {
  bun: "Bun",
  pty: "PTY",
  "zvec-grep-rust": "zvec-grep Rust",
  "zvec-rust": "zvec-rust",
  "potion-model": "Potion model",
  solidlsp: "SolidLSP",
  "python-uv": "Python/uv",
  "typescript-server": "TypeScript server",
  rg: "rg",
  ssh: "SSH",
};

function statusGlyph(status: MechanismReadiness["status"]): string {
  return status === "ready" ? "ready" : status === "degraded" ? "degraded" : "unavailable";
}

function row(name: MechanismReadiness["name"], mechanism: MechanismReadiness, width: number): string {
  const label = DISPLAY[name].padEnd(width);
  const version = mechanism.version ? `  ${mechanism.version}` : "";
  const detail = mechanism.detail ? `  (${mechanism.detail})` : "";
  const reason = mechanism.reason ? `  — ${mechanism.reason}` : "";
  return `  ${label}  ${statusGlyph(mechanism.status)}${version}${detail}${reason}`;
}

/** Mechanisms the semantic substrate REQUIRES (checked by --require-semantic). */
const SEMANTIC_REQUIRED: readonly MechanismReadiness["name"][] = [
  "bun",
  "rg",
  "zvec-grep-rust",
  "zvec-rust",
  "potion-model",
  "solidlsp",
  "python-uv",
  "typescript-server",
];

export async function doctor(argv: readonly string[]): Promise<number> {
  const deep = argv.includes("--probe") || argv.includes("--require-semantic");
  const requireSemantic = argv.includes("--require-semantic");
  const root = resolve(import.meta.dir, "..");
  const config = await loadConfig(root);
  const mechanisms = mechanismsOf(config);
  const rows = await collectReadiness({ config, root, startProbes: deep });

  console.log("gs-term doctor");
  console.log("");
  for (const section of SECTION_ORDER) {
    const sectionRows = rows.filter((mechanism) => SECTION_OF[mechanism.name] === section);
    if (sectionRows.length === 0) continue;
    console.log(section);
    const width = Math.max(...sectionRows.map((mechanism) => DISPLAY[mechanism.name].length));
    for (const mechanism of sectionRows) console.log(row(mechanism.name, mechanism, width));
    console.log("");
  }
  console.log("Node");
  console.log("  not required   (JS runs on Bun; native search in Rust; SolidLSP under Python/uv)");
  console.log("");

  const readyCount = rows.filter((mechanism) => mechanism.status === "ready").length;
  console.log(`${readyCount}/${rows.length} mechanisms ready${deep ? "" : " (light mode — pass --probe to start managed processes)"}`);

  // Expectation profiles: normal doctor reports the host truthfully; the
  // require-semantic profile additionally FAILS unless the semantic substrate
  // is fully ready and enabled (release/CI oracle — never green by skipping).
  if (requireSemantic) {
    if (!mechanisms.enabled) {
      console.log("require-semantic: NOT satisfied — mechanisms disabled by configuration");
      return 2;
    }
    const missing = SEMANTIC_REQUIRED
      .map((name) => rows.find((mechanism) => mechanism.name === name))
      .filter((mechanism) => mechanism === undefined || mechanism.status !== "ready");
    if (missing.length > 0) {
      console.log(`require-semantic: NOT satisfied — ${missing.map((mechanism) => `${DISPLAY[mechanism!.name]}(${mechanism!.status}${mechanism!.reason ? `: ${mechanism!.reason}` : ""})`).join(", ")}`);
      return 2;
    }
    console.log("require-semantic: satisfied (all required semantic mechanisms ready)");
    return 0;
  }
  if (!mechanisms.enabled) {
    console.log("mechanisms disabled by configuration — semantic substrate not mounted");
    return 0;
  }
  const blocking = rows.filter((mechanism) => mechanism.status === "unavailable");
  if (blocking.length > 0) {
    console.log(`unavailable (blocking): ${blocking.map((mechanism) => DISPLAY[mechanism.name]).join(", ")}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await doctor(process.argv.slice(2)));
}
