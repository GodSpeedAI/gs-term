// Terminal panel (J4 surface): xterm.js over the WS byte stream, bounded scrollback replay,
// auto-reconnect, real resize. The panel renders bytes; semantics never come from here.
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "lost" | "ended";

export interface TerminalPanelProps {
  readonly sessionId: string;
  readonly onStatus?: (status: ConnectionStatus, detail: { cols: number; rows: number }) => void;
}

const THEME = {
  background: "#11151d",
  foreground: "#e6edf6",
  cursor: "#4f8cff",
  cursorAccent: "#0b0e14",
  selectionBackground: "#4f8cff40",
  black: "#0b0e14",
  red: "#f0616d",
  green: "#3fb970",
  yellow: "#d29922",
  blue: "#4f8cff",
  magenta: "#a371f7",
  cyan: "#2ea8a0",
  white: "#e6edf6",
  brightBlack: "#617085",
  brightRed: "#ff7b86",
  brightGreen: "#56d38a",
  brightYellow: "#e3b341",
  brightBlue: "#79a8ff",
  brightMagenta: "#c9a2ff",
  brightCyan: "#56c8c0",
  brightWhite: "#f0f6fc",
};

export function TerminalPanel({ sessionId, onStatus }: TerminalPanelProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [size, setSize] = useState({ cols: 0, rows: 0 });
  const [exitCode, setExitCode] = useState<number | null>(null);

  const report = useCallback(
    (next: ConnectionStatus, detail: { cols: number; rows: number }) => {
      setStatus(next);
      onStatus?.(next, detail);
    },
    [onStatus],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: THEME,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      letterSpacing: 0.2,
      cursorBlink: true,
      scrollback: 5_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // container not measurable yet
    }

    let disposed = false;
    let retryDelay = 800;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const syncSize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      setSize({ cols: term.cols, rows: term.rows });
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    const observer = new ResizeObserver(syncSize);
    observer.observe(host);

    const connect = () => {
      if (disposed) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${window.location.host}/ws`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      report("connecting", { cols: term.cols, rows: term.rows });

      ws.onopen = () => {
        retryDelay = 800;
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        report("live", { cols: term.cols, rows: term.rows });
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const control = JSON.parse(event.data) as { type: string; exitCode?: number };
            if (control.type === "exit") {
              setExitCode(control.exitCode ?? 0);
              report("ended", { cols: term.cols, rows: term.rows });
            }
          } catch {
            // unknown control: ignore rather than guess
          }
          return;
        }
        term.write(new Uint8Array(event.data as ArrayBuffer));
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        report("reconnecting", { cols: term.cols, rows: term.rows });
        reconnectTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10_000);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    const dataSubscription = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data));
    });
    const resizeSubscription = term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const focusOnPress = () => term.focus();
    host.addEventListener("mousedown", focusOnPress);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      host.removeEventListener("mousedown", focusOnPress);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
    };
    // The terminal lifetime is owned by this effect; sessionId is stable per server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="terminal-pane">
      <div className="terminal-surface" data-testid="terminal-surface">
        <div className="terminal-host" ref={hostRef} data-testid="terminal-host" />
        {status === "ended" && (
          <div className="terminal-overlay" data-testid="terminal-ended">
            <div className="overlay-card">
              <h3>Session ended{exitCode === null ? "" : ` (exit code ${exitCode})`}</h3>
              <p>The shell exited. Semantic history, effects, and world state are preserved. Restart the server for a fresh shell.</p>
            </div>
          </div>
        )}
      </div>
      <div className="status-strip">
        <span className="chip" data-testid="terminal-status">
          <span className={`dot ${status === "live" ? "ok" : status === "ended" ? "off" : "warn"}`} />
          {status}
        </span>
        <span className="mono">
          {size.cols}×{size.rows}
        </span>
        <span>click anywhere in the terminal to focus</span>
        <span className="spacer" />
        <span className="mono">session {sessionId}</span>
      </div>
    </div>
  );
}

