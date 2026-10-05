// Shell-integration marker parser: tested from recorded byte streams (the same bytes the PTY
// emits), including split chunks, interleaving, and malformed input. No PTY needed here —
// the parser is the deterministic half of J4's observation surface.
import { describe, expect, test } from "bun:test";
import { MarkerParser, type CommandDoneMarker, type CommandStartMarker, type ReadyMarker } from "../../src/shell/markers.ts";

const ESC = "\u001b";
const BEL = "\u0007";

function markerBytes(code: string, payload: unknown): Buffer {
  return Buffer.from(`${ESC}]7311;${code};${Buffer.from(JSON.stringify(payload)).toString("base64")}${BEL}`, "latin1");
}

const START = markerBytes("A", { command: 'echo "hi there"', cwd: "/work", startedAtMs: 1_700_000_000_000 });
const DONE = markerBytes("D", { exitCode: 0, cwd: "/work", endedAtMs: 1_700_000_000_500 });
const READY = markerBytes("R", { shell: "bash", cwd: "/work", pid: 4242 });

describe("marker parser", () => {
  test("extracts markers from an interleaved stream and strips them from output", () => {
    const parser = new MarkerParser();
    const stream = Buffer.concat([Buffer.from("pre$ "), READY, Buffer.from("user types\n"), START, Buffer.from("hi there\r\n"), DONE, Buffer.from("post$ ")]);
    const { clean, markers } = parser.push(stream);
    expect(clean.toString("utf8")).toBe("pre$ user types\nhi there\r\npost$ ");
    expect(markers.map((marker) => marker.code)).toEqual(["R", "A", "D"]);
    const start = markers[1] as CommandStartMarker;
    expect(start.command).toBe('echo "hi there"');
    expect(start.startedAtMs).toBe(1_700_000_000_000);
    const done = markers[2] as CommandDoneMarker;
    expect(done.exitCode).toBe(0);
    expect((markers[0] as ReadyMarker).pid).toBe(4242);
  });

  test("handles markers split across arbitrary chunk boundaries", () => {
    const parser = new MarkerParser();
    const stream = Buffer.concat([Buffer.from("x"), START, Buffer.from("y"), DONE, Buffer.from("z")]);
    const collected: string[] = [];
    let clean = Buffer.alloc(0);
    for (let i = 0; i < stream.length; i++) {
      const result = parser.push(stream.subarray(i, i + 1));
      clean = Buffer.concat([clean, Buffer.from(result.clean)]);
      for (const marker of result.markers) collected.push(marker.code);
    }
    expect(clean.toString("utf8")).toBe("xyz");
    expect(collected).toEqual(["A", "D"]);
  });

  test("malformed payloads are stripped as marker noise and never guessed", () => {
    const parser = new MarkerParser();
    const bad = Buffer.from(`${ESC}]7311;A;not-base64-json${BEL}`, "latin1");
    const { clean, markers } = parser.push(Buffer.concat([Buffer.from("a"), bad, Buffer.from("b")]));
    expect(markers.length).toBe(0);
    expect(clean.toString("utf8")).toBe("ab");
  });

  test("unknown codes are dropped; unterminated markers are held then flushed", () => {
    const parser = new MarkerParser();
    const unknown = Buffer.from(`${ESC}]7311;Q;e30=${BEL}`, "latin1"); // payload {} — unknown code
    const partial = Buffer.from(`${ESC}]7311;D;{"exit`, "latin1");
    const first = parser.push(Buffer.concat([Buffer.from("s"), unknown, partial]));
    expect(first.markers.length).toBe(0);
    expect(first.clean.toString("utf8")).toBe("s");
    const flushed = parser.flush();
    expect(flushed.toString("latin1")).toContain("7311;D;");
  });

  test("output containing BEL/ESC without our prefix passes through untouched", () => {
    const parser = new MarkerParser();
    const noise = Buffer.from(`\u001b]0;title${BEL}\u001b[31mred\u001b[0m`, "latin1");
    const { clean, markers } = parser.push(noise);
    expect(markers.length).toBe(0);
    expect(Buffer.from(clean).equals(noise)).toBe(true);
  });
});
