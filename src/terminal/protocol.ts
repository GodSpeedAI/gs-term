// WebSocket control protocol for the terminal surface (J4).
// Text frames = JSON control; binary frames = raw PTY bytes (output: server→client,
// input: client→server). The byte stream never carries semantics — only markers do.
export type ServerControl =
  | { readonly type: "session"; readonly id: string; readonly cols: number; readonly rows: number; readonly alive: boolean; readonly exitCode: number | null }
  | { readonly type: "exit"; readonly exitCode: number }
  | { readonly type: "pong" };

export type ClientControl =
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "ping" };

export function encodeControl(control: ServerControl): string {
  return JSON.stringify(control);
}

export function decodeClientControl(raw: string): ClientControl | undefined {
  try {
    const parsed = JSON.parse(raw) as ClientControl;
    if (parsed.type === "resize" && Number.isInteger(parsed.cols) && Number.isInteger(parsed.rows)) return parsed;
    if (parsed.type === "ping") return { type: "ping" };
    return undefined;
  } catch {
    return undefined;
  }
}
