// Cockpit boot: one Cognate client for every surface. UI buttons and WebMCP tools share the
// same invoker (J2/J2-W) — the semantic world has one door per journey, not per surface.
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { connectTransport } from "@cognate/protocol-connect-bun";
import { createRemoteRuntimeService } from "@cognate/protocol-connect";
import { createClient } from "@cognate/client";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import "./styles.css";
import { TerminalPanel, type ConnectionStatus } from "./terminal.tsx";
import { WorldPanel } from "./world.tsx";
import { ExecutionsPanel, type ExecutionEntryView } from "./executions.tsx";
import { Inspector, type RunEventView } from "./inspector.tsx";
import { TimelinePanel, type TimelineEvent } from "./timeline.tsx";
import { createUiInvoker, type CognateClientLike } from "./invoker.ts";
import { pageModelContext, projectCapabilitiesToWebMCP } from "../webmcp/project.ts";
import { isMarkerKey } from "../projections/executions.ts";
import type { WorldStateView } from "../semantic/contracts.ts";

interface WorldDescriptorView {
  readonly worldId: string;
  readonly kind: string;
  readonly metadata: Readonly<Record<string, string>>;
}

interface Meta {
  readonly sessionId: string;
  readonly threadId: string;
  readonly defaultWorldId: string;
  readonly worlds: readonly WorldDescriptorView[];
  readonly worldId: string;
  readonly root: string;
  readonly tools: readonly { readonly name: string }[];
}

const HUMAN = { tenant: "local", actor: { id: "human", kind: "user" as const } };
const MAX_EVENTS = 2_000;

function splitArgv(command: string): string[] {
  // Minimal shell-words split: whitespace + double quotes. Advanced quoting belongs to the PTY.
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of command) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === " " && !quoted) {
      if (current !== "") parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") parts.push(current);
  return parts;
}

function App({ meta, client }: { readonly meta: Meta; readonly client: ReturnType<typeof createClient> }): JSX.Element {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [termStatus, setTermStatus] = useState<ConnectionStatus>("connecting");
  const [worldId, setWorldId] = useState(meta.defaultWorldId);
  const [worldProbe, setWorldProbe] = useState<{ readonly status: "checking" | "available" | "unavailable"; readonly detail: string }>({ status: "checking", detail: "" });

  const projection = useMemo(() => client.projection("executions"), [client]);
  const world = useMemo(() => client.threadSharedState(meta.threadId), [client, meta.threadId]);
  const [projectionRows, setProjectionRows] = useState<readonly { key: string; value: unknown }[] | undefined>(undefined);
  const [worldState, setWorldState] = useState<WorldStateView | undefined>(undefined);

  useEffect(() => projection.subscribe((value) => setProjectionRows(value)), [projection]);
  useEffect(() => world.subscribe((value) => setWorldState((value.state ?? undefined) as WorldStateView | undefined)), [world]);

  useEffect(() => {
    const stop = client.subscribe({}, (event) => {
      setEvents((previous) => {
        const next = [
          ...previous,
          { position: Number(event.position), eventType: event.eventType, payload: event.payload, runId: event.runId, occurredAt: event.occurredAt } satisfies TimelineEvent,
        ];
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
      });
    });
    return stop;
  }, [client]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Availability of the selected world = an on-demand `world.snapshot` (existing capability):
  // available means "facts were just observed there", unavailable carries the real reason.
  useEffect(() => {
    let cancelled = false;
    setWorldProbe({ status: "checking", detail: "" });
    void client
      .invoke("world.snapshot", { worldId })
      .then(() => {
        if (!cancelled) setWorldProbe({ status: "available", detail: `observed ${new Date().toLocaleTimeString()}` });
      })
      .catch((error: unknown) => {
        if (!cancelled) setWorldProbe({ status: "unavailable", detail: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, worldId]);

  const entries = useMemo<ExecutionEntryView[]>(() => {
    if (!projectionRows) return [];
    return projectionRows
      .filter((row) => !isMarkerKey(row.key))
      .map((row) => row.value as unknown as ExecutionEntryView)
      .filter((entry) => entry.executionId !== undefined)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }, [projectionRows]);

  const selected = entries.find((entry) => entry.executionId === selectedId);
  const selectedEvents = useMemo<RunEventView[]>(
    () => (selected ? events.filter((event) => event.runId === selected.runId).map((event) => ({ position: event.position, eventType: event.eventType, payload: event.payload })) : []),
    [events, selected],
  );
  const selectedOutput = useMemo(() => {
    if (!selected) return undefined;
    const runEvent = events.find((event) => event.runId === selected.runId && event.eventType === "run.completed");
    const output = runEvent ? (runEvent.payload as { output?: { output?: unknown } }).output?.output : undefined;
    return output as { stdout?: string; stderr?: string } | "unknown" | undefined;
  }, [events, selected]);

  const invoker = useMemo(
    () =>
      createUiInvoker(client as unknown as CognateClientLike, {
        sessionId: meta.sessionId,
        worldId: meta.worldId,
        threadId: meta.threadId,
        surfaceFor: (source) => (source === "webmcp" ? "webmcp" : "cockpit"),
      }),
    [client, meta],
  );

  const onRun = useCallback(
    (command: string, targetWorld: string) => {
      setRunning(true);
      void invoker
        .executeCommand({ argv: splitArgv(command), worldId: targetWorld }, "ui")
        .catch((error) => console.error("structured run failed:", error))
        .finally(() => setRunning(false));
    },
    [invoker],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-name">gs-term</span>
          <span className="brand-tag">semantic control plane</span>
        </div>
        <span className="chip" data-testid="header-terminal-status">
          <span className={`dot ${termStatus === "live" ? "ok" : termStatus === "ended" ? "off" : "warn"}`} />
          terminal {termStatus}
        </span>
        <span className="chip">
          session <strong className="mono">{meta.sessionId}</strong>
        </span>
        <span className="chip" title="workspace containment root">
          root <strong className="mono">{meta.root}</strong>
        </span>
        <span className="chip" data-testid="header-webmcp">
          webmcp <strong>{meta.tools.length} tools</strong>
        </span>
        <span className="spacer" />
        <span className="chip" title="every surface operates the same semantic world">
          state → affordances → action → effects → evidence
        </span>
      </header>

      <div className="main">
        <TerminalPanel sessionId={meta.sessionId} onStatus={setTermStatus} />
        <aside className="sidebar">
          {selected ? (
            <Inspector entry={selected} events={selectedEvents} output={selectedOutput} worlds={meta.worlds} onBack={() => setSelectedId(undefined)} />
          ) : (
            <ExecutionsPanel
              entries={entries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRun={onRun}
              running={running}
              now={Date.now()}
              worlds={meta.worlds}
              selectedWorld={worldId}
              onWorldChange={setWorldId}
              worldProbe={worldProbe}
            />
          )}
          <WorldPanel state={worldState} root={meta.root} now={Date.now()} />
          <TimelinePanel events={events} />
        </aside>
      </div>
    </div>
  );
}

async function boot(): Promise<void> {
  const meta = (await (await fetch("/api/meta")).json()) as Meta;
  const transport = connectTransport(window.location.origin);
  const token = `${HUMAN.tenant}:${HUMAN.actor.id}:${HUMAN.actor.kind}`;
  const service = createRemoteRuntimeService(transport, () => token);
  const client = createClient({ service, caller: HUMAN });

  // WebMCP projection: install the standard API if absent, then register capability tools
  // whose `execute` runs through this very client (projection, not a parallel implementation).
  try {
    // v5 API (verified against the installed dist, not the README's newer-revision names):
    // `initializeWebMCPPolyfill` installs the standard `document.modelContext` surface and
    // preserves any native implementation. We never touch the deprecated navigator alias.
    initializeWebMCPPolyfill();
    const context = pageModelContext(document as unknown as { modelContext?: Parameters<typeof projectCapabilitiesToWebMCP>[0] });
    if (context) {
      const invoker = createUiInvoker(client as unknown as CognateClientLike, {
        sessionId: meta.sessionId,
        worldId: meta.worldId,
        threadId: meta.threadId,
        surfaceFor: (source) => (source === "webmcp" ? "webmcp" : "cockpit"),
      });
      const result = await projectCapabilitiesToWebMCP(context, invoker);
      console.info(`[webmcp] registered tools: ${result.registered.join(", ")}`, result.failed);
    }
  } catch (error) {
    console.warn("[webmcp] tool projection unavailable:", error);
  }

  const root = document.getElementById("root");
  if (root) createRoot(root).render(<App meta={meta} client={client} />);
}

void boot();


