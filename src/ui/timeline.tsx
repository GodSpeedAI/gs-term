// Timeline panel (J5): the live durable event stream — semantic events only.
// PTY bytes never appear here by construction (instrumentation rule).
import { useState, type JSX } from "react";

export interface TimelineEvent {
  readonly position: number;
  readonly eventType: string;
  readonly payload: unknown;
  readonly runId?: string | null;
  readonly occurredAt: string;
}

export interface TimelinePanelProps {
  readonly events: readonly TimelineEvent[];
  readonly onSelectRun?: (runId: string) => void;
}

function typeClass(eventType: string): string {
  if (eventType.startsWith("execution")) return "execution";
  if (eventType.startsWith("effect")) return "effect";
  if (eventType.startsWith("run.")) return "run";
  if (eventType === "state.changed") return "state";
  return "other";
}

function summarize(event: TimelineEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.eventType === "execution.started") return String(payload.command ?? "");
  if (event.eventType === "execution.completed") return `exit ${String(payload.exitCode)} · ${String(payload.effectsCount ?? 0)} effects`;
  if (event.eventType === "effect.observed") return `${Array.isArray(payload.effects) ? payload.effects.length : 0} effect(s)`;
  if (event.eventType === "run.completed" || event.eventType === "run.failed") return String(payload.error ?? "settled");
  return "";
}

export function TimelinePanel({ events, onSelectRun }: TimelinePanelProps): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);
  const visible = events.slice(-300);

  return (
    <section className="panel panel-timeline" data-testid="timeline-panel">
      <div className="panel-head">
        <span className="panel-title">Timeline</span>
        <span className="state-chip neutral">{events.length}</span>
        <span className="spacer" />
        <span className="world-value">semantic events · newest last</span>
      </div>
      <div className="panel-body" data-testid="timeline-events">
        {visible.length === 0 ? (
          <div className="empty">Durable events will stream in here.</div>
        ) : (
          visible.map((event) => (
            <div key={event.position}>
              <button
                className="tl-row"
                onClick={() => {
                  setExpanded(expanded === event.position ? null : event.position);
                  if (event.runId && onSelectRun) onSelectRun(event.runId);
                }}
                data-testid={`tl-${event.eventType}`}
              >
                <span className="tl-pos">{event.position}</span>
                <span className={`tl-type ${typeClass(event.eventType)}`}>{event.eventType}</span>
                <span className="tl-summary">{summarize(event)}</span>
              </button>
              {expanded === event.position && <pre className="payload">{JSON.stringify(event.payload, null, 2)}</pre>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
