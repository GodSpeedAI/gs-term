# src/projections

Derived read models folded from durable events: `executions` (public, tenant-partitioned keys,
versioned checkpoint, rebuildable from the log).

Consumers must skip `run:`-prefixed keys — they are identity markers, not executions; use
`isMarkerKey`.

World state is shared thread state (see `src/bridge/`), not a projection.

Canonical documentation:
[docs/subsystems/state-and-projections.md](../../docs/subsystems/state-and-projections.md).