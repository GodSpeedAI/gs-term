// Focus surface (Phase 3): a compact Focus panel + the `/` contextual Syntelligent Search overlay.
// The terminal stays central; this reduces the world around the goal and attention. `/` shows context
// IMMEDIATELY (no expensive search on open); a query runs the shared focus.search capability.
// Human Accept/Pin/Reject is frictionless and the ONLY way SharedFocus changes.
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { Json } from "@cognate/events";
import type { ToolInvoker } from "../webmcp/descriptors.ts";

export interface EntityView { worldId: string; workspace: string; kind: string; id: string; name?: string }
export interface CandidateView { id: string; proposedEntity: EntityView; reason: string; status: string; suggestedNextActions?: { label: string; operation: string }[] }
export interface FocusView { goal?: string; primary?: EntityView; pinned: EntityView[]; workingSet: EntityView[]; unresolved: string[]; version: number; affordances: { label: string; operation: string }[] }

export interface FocusSurfaceProps {
  readonly invoker: ToolInvoker;
  readonly resolve: (intent: "accept" | "pin" | "reject", payload: Record<string, unknown>) => Promise<void>;
  readonly focus: FocusView;
  readonly candidate?: CandidateView;
  readonly worldId: string;
}

/** The `/` overlay: context-first, then deterministic Syntelligent Search. */
export function CommandPalette({ invoker, resolve, focus, candidate, worldId }: FocusSurfaceProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ entity: EntityView; reason: string; relevance: string }[]>([]);
  const [receipt, setReceipt] = useState<{ reduction?: { workspace: number; verified: number }; availability?: { name: string; status: string }[] } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` opens the overlay from anywhere except a text input (never steal normal typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setOpen(true);
        setQuery("");
        setResults([]);
        setReceipt(undefined);
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const outcome = (await invoker.focusSearch({ query, worldId }, "ui")) as unknown as { results?: { entity: EntityView; reason: string; relevance: string }[]; receipt?: { reduction?: { workspace: number; verified: number }; availability?: { name: string; status: string }[] } };
      setResults(outcome.results ?? []);
      setReceipt(outcome.receipt);
    } finally {
      setBusy(false);
    }
  }, [invoker, query, worldId]);

  if (!open) return <button className="focus-open" onClick={() => setOpen(true)} title="Open contextual search (/)">/ Focus</button>;

  return (
    <div className="palette-scrim" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-context">
          <div className="palette-label">Context</div>
          {focus.primary ? (
            <div className="palette-entity">● {focus.primary.name ?? focus.primary.id} <span className="muted">{focus.primary.kind} · {worldId}</span></div>
          ) : (
            <div className="palette-entity muted">No focus yet</div>
          )}
          {candidate && candidate.status === "proposed" && (
            <div className="palette-candidate">
              <div className="palette-label">Agent suggests</div>
              <div className="palette-entity">{candidate.proposedEntity.name ?? candidate.proposedEntity.id} — {candidate.reason}</div>
              <div className="palette-actions">
                <button onClick={() => resolve("accept", { candidate })}>Accept</button>
                <button onClick={() => resolve("pin", { entity: candidate.proposedEntity })}>Pin</button>
                <button onClick={() => resolve("reject", { candidate })}>Reject</button>
              </div>
            </div>
          )}
          <div className="palette-label">Suggested</div>
          <div className="palette-suggested">
            <button onClick={() => setQuery("what is this")}>Explain this</button>
            <button onClick={() => setQuery("who calls this")}>Trace references</button>
            <button onClick={() => setQuery("related tests")}>Related tests</button>
            <button onClick={() => setQuery("why did this fail")}>Explain failure</button>
          </div>
        </div>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Ask about this — / what is this?  / who calls this?"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
        />
        {busy && <div className="palette-status">Searching…</div>}
        <div className="palette-results">
          {results.map((result, index) => (
            <div key={index} className="palette-result">
              <div className="palette-result-name">{result.entity.name ?? result.entity.id} <span className="muted">{result.relevance}</span></div>
              <div className="palette-result-reason">{result.reason}</div>
            </div>
          ))}
          {results.length === 0 && !busy && query && <div className="palette-status muted">No matches in {worldId}.</div>}
        </div>
        {receipt?.reduction && (
          <div className="palette-why" title="Why these?">
            Why these? {receipt.reduction.verified} of {receipt.reduction.workspace} files
            {receipt.availability?.some((a) => a.status === "unavailable") && (
              <span className="muted"> · {receipt.availability.filter((a) => a.status === "unavailable").length} mechanisms unavailable in {worldId}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The persistent Focus panel (goal → primary → pinned → next → agent candidate). */
export function FocusPanel({ resolve, focus, candidate, worldId }: Omit<FocusSurfaceProps, "invoker">): JSX.Element {
  return (
    <div className="focus-panel" data-testid="focus-panel">
      <div className="focus-goal" data-testid="focus-goal">Goal: {focus.goal ?? "—"} <span className="muted">World: {worldId}</span></div>
      <div className="focus-section">
        <div className="palette-label">Focus</div>
        {focus.primary ? <div className="palette-entity" data-testid="focus-primary">{focus.primary.name ?? focus.primary.id}</div> : <div className="muted">none</div>}
      </div>
      {focus.pinned.length > 0 && (
        <div className="focus-section">
          <div className="palette-label">Pinned</div>
          {focus.pinned.map((entity) => <div key={entity.id} className="palette-entity" data-testid="focus-pinned">{entity.name ?? entity.id}</div>)}
        </div>
      )}
      {focus.affordances.length > 0 && (
        <div className="focus-section">
          <div className="palette-label">Next</div>
          {focus.affordances.map((affordance) => <div key={affordance.operation} className="palette-entity">{affordance.label}</div>)}
        </div>
      )}
      {candidate && candidate.status === "proposed" && (
        <div className="focus-section" data-testid="focus-candidate">
          <div className="palette-label">Agent candidate</div>
          <div className="palette-entity">{candidate.proposedEntity.name ?? candidate.proposedEntity.id} — {candidate.reason}</div>
          <div className="palette-actions">
            <button onClick={() => resolve("accept", { candidate })}>Accept</button>
            <button onClick={() => resolve("pin", { entity: candidate.proposedEntity })}>Pin</button>
            <button onClick={() => resolve("reject", { candidate })}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}
