// Execution inspector: full provenance for one execution — effects with evidence,
// timing, structured output, and the run's semantic events. Evidence discipline made visible.
import type { JSX } from "react";
import type { Effect } from "../semantic/contracts.ts";
import { formatDuration, shortId } from "./hooks.ts";
import type { ExecutionEntryView } from "./executions.tsx";

export interface RunEventView {
  readonly position: number;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface InspectorProps {
  readonly entry: ExecutionEntryView;
  readonly events: readonly RunEventView[];
  readonly output: { readonly stdout?: string; readonly stderr?: string } | "unknown" | undefined;
  readonly onBack: () => void;
}

function EffectCard({ effect }: { readonly effect: Effect }): JSX.Element {
  return (
    <div className="effect-card" data-testid={`effect-${effect.kind}`}>
      <div className="effect-head">
        <span className={`state-chip ${effect.kind === "none" ? "neutral" : effect.kind.includes("deleted") || effect.kind.includes("stopped") || effect.kind.includes("closed") ? "warn" : "ok"}`}>
          {effect.kind}
        </span>
        <span className="effect-target">{effect.target}</span>
      </div>
      {effect.evidence.map((evidence, index) => (
        <div className="evidence-line" key={index}>
          <span className={`state-chip ${evidence.confidence === "observed" ? "ok" : evidence.confidence === "derived" ? "neutral" : "unknown"}`}>
            {evidence.confidence}
          </span>
          <span className="evidence-what">{evidence.what}</span>
          <span className="evidence-how" title={evidence.refs.join(", ")}>
            {evidence.how}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Inspector({ entry, events, output, onBack }: InspectorProps): JSX.Element {
  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify({ entry, events, output }, null, 2));
  };

  return (
    <section className="panel panel-executions" data-testid="execution-inspector">
      <div className="panel-head">
        <button className="icon-btn" onClick={onBack} title="Back to executions (Esc)" data-testid="inspector-back">
          ←
        </button>
        <span className="panel-title">Execution</span>
        <span className={`badge ${entry.source ?? "run"}`}>{entry.source ?? "run"}</span>
        <span className={`state-chip ${entry.status === "settled" ? (entry.exitCode === 0 ? "ok" : "danger") : entry.status === "failed" ? "danger" : "warn"}`}>
          {entry.status}
        </span>
        <span className="spacer" />
        <button className="btn ghost" onClick={copy} data-testid="inspector-copy">
          Copy JSON
        </button>
      </div>

      <div className="panel-body">
        <div className="inspector-command" data-testid="inspector-command">
          {entry.command ?? entry.executionId}
        </div>

        <div className="inspector-grid">
          <div className="stat-cell">
            <div className="stat-label">Exit code</div>
            <div className="stat-value">{entry.exitCode === undefined ? "—" : String(entry.exitCode)}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Duration</div>
            <div className="stat-value">{formatDuration(entry.durationMs)}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Started</div>
            <div className="stat-value">{entry.startedAt ? new Date(entry.startedAt).toLocaleTimeString() : "—"}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Ended</div>
            <div className="stat-value">{entry.endedAt ? new Date(entry.endedAt).toLocaleTimeString() : "—"}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Cwd</div>
            <div className="stat-value">{entry.cwd ?? "—"}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Run</div>
            <div className="stat-value" title={entry.runId}>
              {shortId(entry.runId)}
            </div>
          </div>
        </div>

        {entry.reason && (
          <div className="effect-card">
            <div className="effect-head">
              <span className="state-chip danger">reason</span>
              <span className="effect-target">{entry.reason}</span>
            </div>
          </div>
        )}

        <div className="section-title">Effects · {entry.effectsCount}</div>
        {entry.effects.length === 0 ? (
          <div className="empty">No effects recorded for this execution.</div>
        ) : (
          entry.effects.map((effect, index) => <EffectCard key={index} effect={effect} />)
        )}

        {output !== undefined && output !== "unknown" && (
          <>
            <div className="section-title">Output</div>
            {output.stdout ? <pre className="payload">{output.stdout}</pre> : null}
            {output.stderr ? <pre className="payload">{output.stderr}</pre> : null}
          </>
        )}
        {output === "unknown" && (
          <>
            <div className="section-title">Output</div>
            <div className="empty">PTY-observed executions do not capture output — it lives in the terminal stream.</div>
          </>
        )}

        <div className="section-title">Events · {events.length}</div>
        {events.length === 0 ? (
          <div className="empty">Events stream in as the run executes.</div>
        ) : (
          events.map((event) => (
            <div key={event.position} className="tl-row" style={{ cursor: "default" }}>
              <span className="tl-pos">{event.position}</span>
              <span
                className={`tl-type ${event.eventType.startsWith("execution") ? "execution" : event.eventType.startsWith("effect") ? "effect" : event.eventType.startsWith("run") ? "run" : "other"}`}
              >
                {event.eventType}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

