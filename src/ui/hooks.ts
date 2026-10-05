// React glue over @cognate/client's Readable<T>: UI state PROJECTS durable state,
// it never becomes authoritative (AGENTS.md UI rule).
import { useSyncExternalStore } from "react";

export interface Readable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export function useReadable<T>(readable: Readable<T> | undefined): T | undefined {
  return useSyncExternalStore(
    (onStoreChange) => (readable ? readable.subscribe(() => onStoreChange()) : () => undefined),
    () => readable?.get(),
    () => readable?.get(),
  );
}

export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return "—";
  const delta = Math.max(0, now - Date.parse(iso));
  if (delta < 2_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}

export function shortId(id: string | undefined, length = 8): string {
  return id ? (id.length > length ? `${id.slice(0, length)}…` : id) : "—";
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
