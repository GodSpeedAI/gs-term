// Shared agent helpers. Deterministic: no clock/randomness outside recorded steps.
import type { Json } from "@cognate/events";
import type { GitObservation, WorldSnapshot } from "../semantic/contracts.ts";

/** Single cast point for event payloads: shapes are JSON-safe; the runtime serializes with `toJson`. */
export function json(payload: unknown): Json {
  return payload as Json;
}

export function renderCommand(argv: readonly string[]): string {
  return argv.map((part) => (/[\s"'$`\\]/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

const OUTPUT_LIMIT = 64 * 1024;

export function truncateOutput(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `${text.slice(0, OUTPUT_LIMIT)}\n...[truncated ${text.length - OUTPUT_LIMIT} chars]`;
}

export function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  const snapshot = value as WorldSnapshot | null;
  return (
    typeof snapshot === "object" &&
    snapshot !== null &&
    typeof snapshot.observedAt === "string" &&
    typeof snapshot.root === "string" &&
    Array.isArray(snapshot.files) &&
    typeof snapshot.git === "object" &&
    snapshot.git !== null &&
    typeof (snapshot.git as GitObservation).status === "string" &&
    typeof snapshot.processes === "object" &&
    snapshot.processes !== null &&
    typeof snapshot.ports === "object" &&
    snapshot.ports !== null &&
    Array.isArray((snapshot.walk as { excluded: unknown }).excluded)
  );
}

/** Guard agent input early; failures are deterministic and must not depend on ambient state. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`invalid input: ${field} must be a non-empty string`);
  return value;
}

export function requireArgv(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((part) => typeof part === "string" && part.length > 0 && !part.includes("\0"))) {
    throw new Error("invalid input: argv must be a non-empty array of strings without NUL");
  }
  return value as readonly string[];
}
