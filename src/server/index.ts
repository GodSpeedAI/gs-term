// gs-term server: the composition root where mechanism meets semantics.
// One process: Cognate runtime (Connect) + PTY session + observation bridge + cockpit + WebMCP.
// Startup order matters: model → runtime → session → bridge → transports. Teardown reverses it.
import { serveRuntime } from "@cognate/protocol-connect-bun";
import type { Caller } from "@cognate/runtime-api";
import { resolve } from "node:path";
import { loadConfig, workspaceRoot, type GsTermConfig } from "../config.ts";
import { createGsTermRuntime, type GsTermRuntime } from "../app/runtime.ts";
import { ObservationBridge } from "../bridge/observation.ts";
import { TerminalSession } from "../terminal/session.ts";
import { decodeClientControl, encodeControl } from "../terminal/protocol.ts";
import { CAPABILITY_DESCRIPTORS } from "../webmcp/descriptors.ts";

const INIT_FILE = resolve(import.meta.dir, "../shell/bash-init.sh");
const UI_ENTRY = resolve(import.meta.dir, "../ui/main.tsx");

export interface StartServerOptions {
  readonly config?: GsTermConfig;
  readonly domainRoot?: string;
  readonly store?: string;
}

export interface GsTermServerHandle {
  readonly url: string;
  readonly config: GsTermConfig;
  readonly app: GsTermRuntime;
  readonly session: TerminalSession;
  readonly bridge: ObservationBridge;
  stop(): Promise<void>;
}

/** Dev authenticator: `Bearer <tenant>:<actorId>[:<kind>]`. Boundary is transport identity (spec §32). */
export function bearerAuthenticator(headers: Headers): Caller | undefined {
  const match = /^Bearer ([^:\s]+):([^:\s]+)(?::(\w+))?$/.exec(headers.get("authorization") ?? "");
  if (!match) return undefined;
  const kind = (match[3] ?? "user") as Caller["actor"]["kind"];
  return { tenant: match[1]!, actor: { id: match[2]!, kind: ["user", "agent", "service", "system"].includes(kind) ? kind : "user" } };
}

export function bearerToken(caller: Caller): string {
  return `${caller.tenant}:${caller.actor.id}:${caller.actor.kind}`;
}

export async function startServer(options: StartServerOptions = {}): Promise<GsTermServerHandle> {
  const config = options.config ?? (await loadConfig());
  const root = workspaceRoot(config);
  const store = options.store ?? process.env.GSTERM_STORE ?? resolve(options.domainRoot ?? process.cwd(), ".cognate/app.sqlite");

  const app = await createGsTermRuntime({
    config,
    store,
    ...(options.domainRoot ? { domainRoot: options.domainRoot } : {}),
    sessionPid: () => session?.shellPid,
  });

  const session = new TerminalSession({
    id: config.session.id,
    shell: config.session.shell,
    initFile: INIT_FILE,
    cwd: root,
    cols: config.session.cols,
    rows: config.session.rows,
    scrollbackBytes: config.session.scrollbackBytes,
  });

  const bridge = new ObservationBridge({
    service: app.runtime.service,
    sessionId: config.session.id,
    sessionWorldId: config.world.id,
    root,
    shell: config.session.shell,
    sessionPid: () => session.shellPid,
    terminalInfo: () => ({ alive: session.alive, cols: session.cols, rows: session.rows, pid: session.shellPid ?? null }),
    onError: (context, error) => console.error(`[bridge] ${context}:`, error instanceof Error ? error.message : error),
  });

  session.attach({ marker: (marker) => bridge.handleMarker(marker) });
  bridge.startFollower();

  const internal = serveRuntime({ service: app.runtime.service, authenticate: bearerAuthenticator, port: 0, hostname: "127.0.0.1" });

  const build = await Bun.build({ entrypoints: [UI_ENTRY], target: "browser", format: "esm" });
  if (!build.success) throw new Error(`failed to bundle cockpit UI: ${build.logs.map((log) => String(log)).join("; ")}`);
  const appJs = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
  const appCss = await build.outputs.find((output) => output.path.endsWith(".css"))?.text();

  const health = () => ({
    ok: true,
    session: { id: session.id, alive: session.alive, cols: session.cols, rows: session.rows, exitCode: session.exitCode },
    semantic: { objects: app.model.projection.objects.length, digest: app.model.digest },
    capabilities: CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.name),
    root,
  });

  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.hostname,
    async fetch(request, srv) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return Response.json(health());
      if (url.pathname === "/api/meta") {
        return Response.json({
          sessionId: session.id,
          threadId: bridge.threadId(),
          tenant: "local",
          worldId: config.world.id,
          defaultWorldId: config.world.id,
          worlds: app.worlds.registry.list(),
          root,
          tools: CAPABILITY_DESCRIPTORS.map((descriptor) => ({ name: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema })),
        });
      }
      if (url.pathname === "/ws") {
        if (srv.upgrade(request, { data: { session, bridge } })) return undefined as unknown as Response;
        return new Response("websocket upgrade required", { status: 400 });
      }
      if (url.pathname.startsWith("/cognate.v1.RuntimeService/")) {
        const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers, body: request.body };
        if (request.body) init.duplex = "half";
        return fetch(new Request(internal.url + url.pathname + url.search, init));
      }
      if (url.pathname === "/app.js") return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (url.pathname === "/app.css") return new Response(appCss ?? "", { headers: { "content-type": "text/css; charset=utf-8" } });
      if (url.pathname === "/") return new Response(indexHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response("not found", { status: 404 });
    },
    websocket: websocketHandlers(),
  });

  await session.start();
  bridge.reconcile("boot");

  return {
    url: `http://${config.server.hostname}:${server.port}`,
    config,
    app,
    session,
    bridge,
    async stop() {
      await bridge.close();
      await session.close();
      server.stop(true);
      await internal.stop();
      await app.close();
    },
  };
}

function indexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>gs-term</title>
<link rel="stylesheet" href="/app.css" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

interface ViewerData {
  readonly session: TerminalSession;
  readonly bridge: ObservationBridge;
  detach?: () => void;
}

function websocketHandlers() {
  return {
    open(ws: Bun.ServerWebSocket<ViewerData>) {
      const { session, bridge } = ws.data;
      const safeSend = (payload: string | Buffer) => {
        try {
          if (typeof payload === "string") ws.send(payload);
          else ws.sendBinary(payload);
        } catch {
          // viewer gone; detach happens in close()
        }
      };
      safeSend(encodeControl({ type: "session", id: session.id, cols: session.cols, rows: session.rows, alive: session.alive, exitCode: session.exitCode }));
      ws.data.detach = session.attach({
        output: (data) => safeSend(Buffer.from(data)),
        exit: (info) => safeSend(encodeControl({ type: "exit", exitCode: info.exitCode })),
      });
      // J4 → J3: every attach re-derives the world view from observed facts.
      bridge.reconcile("attach");
    },
    message(ws: Bun.ServerWebSocket<ViewerData>, message: string | Buffer) {
      const { session } = ws.data;
      if (typeof message === "string") {
        const control = decodeClientControl(message);
        if (control?.type === "resize") session.resize(control.cols, control.rows);
        if (control?.type === "ping") ws.send(encodeControl({ type: "pong" }));
        return;
      }
      session.write(Buffer.from(message));
    },
    close(ws: Bun.ServerWebSocket<ViewerData>) {
      ws.data.detach?.();
      ws.data.detach = undefined;
    },
  };
}

if (import.meta.main) {
  const handle = await startServer({ domainRoot: process.cwd() });
  console.log(`gs-term listening on ${handle.url} (workspace: ${handle.config.world.root === "" ? process.cwd() : handle.config.world.root})`);
  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}


