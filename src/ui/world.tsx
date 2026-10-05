// World panel (J5): durable world shared state, rendered honestly — unknown is styled,
// never flattened to false; every row carries its observation age.
import type { JSX } from "react";
import type { Scoped, WorldStateView } from "../semantic/contracts.ts";
import { relativeTime } from "./hooks.ts";

export interface WorldPanelProps {
  readonly state: WorldStateView | undefined;
  readonly root: string;
  readonly now: number;
}

function RepoChip({ state }: { readonly state: WorldStateView["repository"] }): JSX.Element {
  if (state.status === "unknown") {
    return (
      <span className="state-chip unknown" title={state.reason ?? "not observed"}>
        unknown
      </span>
    );
  }
  if (state.status === "no-repo") {
    return <span className="state-chip neutral">no repository</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span className="state-chip neutral mono">{state.branch ?? "detached"}</span>
      {state.dirty ? (
        <span className="state-chip danger">
          dirty {state.changedFiles?.length ? `· ${state.changedFiles.length}` : ""}
        </span>
      ) : (
        <span className="state-chip ok">clean</span>
      )}
    </span>
  );
}

interface ScopeEntryLike {
  readonly pid?: number | null;
  readonly port?: number;
  readonly protocol?: string;
  readonly command?: string;
  readonly process?: string | null;
}

function ScopedTable<T extends ScopeEntryLike>({ scope, empty }: { readonly scope: Scoped<T>; readonly empty: string }): JSX.Element {
  if (scope.status === "unknown") {
    return (
      <span className="state-chip unknown" title={scope.reason}>
        unknown
      </span>
    );
  }
  if (scope.entries.length === 0) return <span className="world-value">{empty}</span>;
  const visible = scope.entries.slice(0, 4);
  return (
    <div>
      <table className="mini-table">
        <tbody>
          {visible.map((entry, index) => (
            <tr key={`${entry.pid ?? entry.port ?? index}`}>
              {entry.port !== undefined ? <td>{entry.protocol}/{entry.port}</td> : <td>{entry.pid ?? "—"}</td>}
              <td>{entry.process ?? entry.command ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scope.entries.length > visible.length && <div className="world-value">+{scope.entries.length - visible.length} more</div>}
    </div>
  );
}

export function WorldPanel({ state, root, now }: WorldPanelProps): JSX.Element {
  return (
    <section className="panel panel-world" data-testid="world-panel">
      <div className="panel-head">
        <span className="panel-title">World</span>
        <span className="spacer" />
        <span className="world-value" title="time of the latest observation">
          {relativeTime(state?.observedAt, now)}
        </span>
      </div>
      <div className="panel-body">
        {state === undefined ? (
          <div className="empty">Waiting for the first world observation…</div>
        ) : (
          <div className="world-grid">
            <div className="world-label">Cwd</div>
            <div className="world-value mono" data-testid="world-cwd">
              {state.cwd}
            </div>

            <div className="world-label">Shell</div>
            <div className="world-value">
              <span className="mono">{state.shell}</span> · {state.terminal.alive ? <span className="state-chip ok">alive</span> : <span className="state-chip danger">exited</span>}
              {state.terminal.pid !== null && <span className="world-value"> pid {state.terminal.pid}</span>}
            </div>

            <div className="world-label">Repository</div>
            <div className="world-value" data-testid="world-repo">
              <RepoChip state={state.repository} />
              {state.repository.status === "observed" && state.repository.changedFiles?.length ? (
                <div className="world-value mono" title={state.repository.changedFiles.join("\n")}>
                  {state.repository.changedFiles.slice(0, 3).join(", ")}
                  {state.repository.changedFiles.length > 3 ? ` +${state.repository.changedFiles.length - 3}` : ""}
                </div>
              ) : null}
            </div>

            <div className="world-label">Processes</div>
            <div className="world-value" data-testid="world-processes">
              <ScopedTable scope={state.processes} empty="none in the session tree" />
            </div>

            <div className="world-label">Ports</div>
            <div className="world-value" data-testid="world-ports">
              <ScopedTable scope={state.ports} empty="no session listeners" />
            </div>

            <div className="world-label">Last run</div>
            <div className="world-value mono" data-testid="world-last-execution">
              {state.lastExecution ? (
                <span title={state.lastExecution.endedAt}>
                  {state.lastExecution.command}{" "}
                  <span className={state.lastExecution.exitCode === 0 ? "state-chip ok" : "state-chip danger"}>exit {String(state.lastExecution.exitCode)}</span>
                </span>
              ) : (
                "—"
              )}
            </div>

            <div className="world-label">Scope</div>
            <div className="world-value mono">{root}</div>
          </div>
        )}
      </div>
    </section>
  );
}
