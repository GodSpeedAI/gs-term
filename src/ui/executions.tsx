// Executions panel (J5): the durable execution history (projection read model) with
// filter/search, plus the structured runner — the cockpit's J2 door into the same world.
import { useMemo, useState, type JSX } from "react";
import type { Effect, ExecutionSource } from "../semantic/contracts.ts";
import { formatDuration, relativeTime, shortId } from "./hooks.ts";

export interface ExecutionEntryView {
  readonly executionId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly status: "started" | "settled" | "failed" | "cancelled";
  readonly worldId?: string;
  readonly source?: ExecutionSource | string;
  readonly surface?: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly actor?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly effects: readonly Effect[];
  readonly effectsCount: number;
  readonly reason?: string;
}

export interface WorldView {
  readonly worldId: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ExecutionsPanelProps {
  readonly entries: readonly ExecutionEntryView[];
  readonly selectedId: string | undefined;
  readonly onSelect: (executionId: string) => void;
  readonly onRun: (command: string, worldId: string) => void;
  readonly running: boolean;
  readonly now: number;
  readonly worlds: readonly WorldView[];
  readonly selectedWorld: string;
  readonly onWorldChange: (worldId: string) => void;
  readonly worldProbe: { readonly status: "checking" | "available" | "unavailable"; readonly detail: string };
}

const FILTERS: readonly { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pty", label: "PTY" },
  { id: "ui", label: "UI" },
  { id: "webmcp", label: "WebMCP" },
];

export function statusDot(entry: ExecutionEntryView): string {
  if (entry.status === "settled") return entry.exitCode === 0 ? "settled-ok" : "settled-fail";
  return entry.status;
}

export function ExecutionsPanel({ entries, selectedId, onSelect, onRun, running, now, worlds, selectedWorld, onWorldChange, worldProbe }: ExecutionsPanelProps): JSX.Element {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");

  const visible = useMemo(() => {
    const byFilter = filter === "all" ? entries : entries.filter((entry) => entry.source === filter);
    const needle = query.trim().toLowerCase();
    return needle === "" ? byFilter : byFilter.filter((entry) => entry.command?.toLowerCase().includes(needle) ?? false);
  }, [entries, filter, query]);

  return (
    <section className="panel panel-executions" data-testid="executions-panel">
      <div className="panel-head">
        <span className="panel-title">Executions</span>
        <span className="state-chip neutral">{entries.length}</span>
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="filter by source">
          {FILTERS.map((option) => (
            <button key={option.id} className={filter === option.id ? "active" : ""} onClick={() => setFilter(option.id)} data-testid={`filter-${option.id}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="runner">
        <select
          className="world-select"
          data-testid="world-select"
          value={selectedWorld}
          onChange={(event) => onWorldChange(event.target.value)}
          title="Execution world: the same semantic capability, a different provider"
        >
          {worlds.map((world) => (
            <option key={world.worldId} value={world.worldId}>
              {world.worldId} · {world.kind}
              {world.metadata.host ? ` · ${world.metadata.host}` : ""}
            </option>
          ))}
        </select>
        <span
          className={`state-chip ${worldProbe.status === "available" ? "ok" : worldProbe.status === "unavailable" ? "danger" : "neutral"}`}
          data-testid="world-probe"
          title={worldProbe.detail}
        >
          {worldProbe.status}
        </span>
        <input
          data-testid="structured-run-input"
          placeholder="structured run: touch demo.txt  (⌘⏎)"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && command.trim() !== "" && !running) {
              onRun(command.trim(), selectedWorld);
              setCommand("");
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="btn primary"
          data-testid="structured-run-button"
          disabled={running || command.trim() === ""}
          onClick={() => {
            onRun(command.trim(), selectedWorld);
            setCommand("");
          }}
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>

      <div style={{ padding: "8px 12px 0" }}>
        <input
          className="search"
          data-testid="execution-search"
          placeholder="filter by command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="panel-body" data-testid="executions-list">
        {visible.length === 0 ? (
          <div className="empty">
            {entries.length === 0
              ? "No executions yet — type in the terminal or run a structured command."
              : "No executions match this filter."}
          </div>
        ) : (
          visible.map((entry) => (
            <button
              key={entry.executionId}
              className={`exec-row ${selectedId === entry.executionId ? "selected" : ""}`}
              onClick={() => onSelect(entry.executionId)}
              data-testid={`exec-row-${entry.executionId}`}
            >
              <span className={`exec-dot ${statusDot(entry)}`} />
              <span className="exec-main">
                <span className="exec-command">{entry.command ?? shortId(entry.executionId)}</span>
                <span className="exec-sub">
                  <span className={`badge ${entry.source ?? "run"}`}>{entry.source ?? "run"}</span>
                  <span>{relativeTime(entry.endedAt ?? entry.startedAt, now)}</span>
                  <span>·</span>
                  <span>{formatDuration(entry.durationMs)}</span>
                  <span>·</span>
                  <span>{entry.effectsCount} effect{entry.effectsCount === 1 ? "" : "s"}</span>
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
