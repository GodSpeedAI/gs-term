# src/ui

The cockpit (React + xterm.js): terminal, world view, executions/inspector, timeline, focus panel, and
the WebMCP boot. UI state projects durable Cognate state; it is never authoritative. Cockpit buttons
and WebMCP tools share one invoker (`invoker.ts`).

Canonical documentation: [docs/subsystems/cockpit.md](../../docs/subsystems/cockpit.md).