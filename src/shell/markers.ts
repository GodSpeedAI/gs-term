// Shell-integration marker protocol: deterministic command-boundary observation from bash.
// Markers are OSC-style sequences injected by src/shell/bash-init.sh (preexec/precmd hooks)
// and parsed — then STRIPPED — from the PTY byte stream before it reaches any viewer.
// The PTY byte stream is never the semantic source of truth; these markers are the facts.
//
// Wire form:  ESC ] 7311 ; <code> ; <base64(JSON)> BEL
// Codes:      A = command start   D = command done   R = integration ready
// Why base64: command text may contain any byte except BEL/ESC sequences; JSON stays lossless.

export const MARKER_PREFIX = "\u001b]7311;";
export const MARKER_BEL = "\u0007";

export type MarkerCode = "A" | "D" | "R";

export interface CommandStartMarker {
  readonly code: "A";
  readonly command: string;
  readonly cwd: string;
  readonly startedAtMs: number;
}

export interface CommandDoneMarker {
  readonly code: "D";
  readonly exitCode: number;
  readonly cwd: string;
  readonly endedAtMs: number;
}

export interface ReadyMarker {
  readonly code: "R";
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number;
}

export type Marker = CommandStartMarker | CommandDoneMarker | ReadyMarker;

export interface PushResult {
  /** The input with every complete marker removed (what viewers should render). */
  readonly clean: Buffer;
  readonly markers: readonly Marker[];
}

function decodePayload(code: string, payload: string): Marker | undefined {
  let parsed: Record<string, unknown>;
  try {
    const json = Buffer.from(payload, "base64").toString("utf8");
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined; // malformed marker: stripped as data, never guessed
  }
  if (code === "A" && typeof parsed.command === "string" && typeof parsed.cwd === "string" && typeof parsed.startedAtMs === "number") {
    return { code: "A", command: parsed.command, cwd: parsed.cwd, startedAtMs: parsed.startedAtMs };
  }
  if (code === "D" && typeof parsed.exitCode === "number" && typeof parsed.cwd === "string" && typeof parsed.endedAtMs === "number") {
    return { code: "D", exitCode: parsed.exitCode, cwd: parsed.cwd, endedAtMs: parsed.endedAtMs };
  }
  if (code === "R" && typeof parsed.pid === "number" && typeof parsed.cwd === "string" && typeof parsed.shell === "string") {
    return { code: "R", shell: parsed.shell, cwd: parsed.cwd, pid: parsed.pid };
  }
  return undefined;
}

/**
 * Incremental parser over the raw PTY byte stream. Handles markers split across chunks and
 * interleaved with output. A prefix without BEL is held until the next chunk; a pathological
 * unterminated prefix (> MAX_PENDING bytes) is flushed as ordinary data (bounded memory).
 */
export class MarkerParser {
  private pending = Buffer.alloc(0);
  private static readonly MAX_PENDING = 8 * 1024;

  push(chunk: Uint8Array): PushResult {
    const input = this.pending.length > 0 ? Buffer.concat([this.pending, Buffer.from(chunk)]) : Buffer.from(chunk);
    this.pending = Buffer.alloc(0);

    const cleanParts: Buffer[] = [];
    const markers: Marker[] = [];
    let cursor = 0;

    for (;;) {
      const start = input.indexOf(MARKER_PREFIX, cursor);
      if (start < 0) {
        // No marker start in the remainder — but a trailing partial prefix (e.g. the bytes
        // `ESC ] 731`) must be HELD for the next chunk, not flushed as data.
        const rest = input.subarray(cursor);
        let hold = 0;
        const maxHold = Math.min(MARKER_PREFIX.length - 1, rest.length);
        for (let k = maxHold; k > 0; k--) {
          if (rest.toString("latin1", rest.length - k) === MARKER_PREFIX.slice(0, k)) {
            hold = k;
            break;
          }
        }
        if (rest.length > hold) cleanParts.push(Buffer.from(rest.subarray(0, rest.length - hold)));
        if (hold > 0) this.pending = Buffer.from(rest.subarray(rest.length - hold));
        cursor = input.length;
        break;
      }
      const end = input.indexOf(MARKER_BEL, start + MARKER_PREFIX.length);
      if (end < 0) {
        // Marker start found but no BEL yet: hold from the marker start; data before it is clean.
        if (start > cursor) cleanParts.push(Buffer.from(input.subarray(cursor, start)));
        const rest = input.subarray(start);
        if (rest.length <= MarkerParser.MAX_PENDING) {
          this.pending = Buffer.from(rest);
        } else {
          cleanParts.push(Buffer.from(rest)); // pathological unterminated marker: bounded memory
        }
        cursor = input.length;
        break;
      }
      if (start > cursor) cleanParts.push(Buffer.from(input.subarray(cursor, start)));
      const body = input.toString("latin1", start + MARKER_PREFIX.length, end);
      const separator = body.indexOf(";");
      const code = separator < 0 ? body : body.slice(0, separator);
      const payload = separator < 0 ? "" : body.slice(separator + 1);
      const marker = decodePayload(code, payload);
      if (marker) markers.push(marker);
      cursor = end + 1;
    }
    if (cursor < input.length) cleanParts.push(Buffer.from(input.subarray(cursor)));

    return { clean: cleanParts.length === 1 ? cleanParts[0]! : Buffer.concat(cleanParts), markers };
  }

  /** Flush any held unterminated data (session end). */
  flush(): Buffer {
    const held = this.pending;
    this.pending = Buffer.alloc(0);
    return held;
  }
}
