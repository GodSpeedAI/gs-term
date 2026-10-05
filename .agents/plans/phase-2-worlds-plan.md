# Phase-2 plan — same capability, two worlds (local ⇄ SSH)

Objective: prove `semantic capability (process.exec) → world selection → provider → physical
execution` without provider-specific application semantics. Phase 1 stays untouched except where
world-awareness requires minimal extension. Debt tracked in `.agents/DEBT.md` (committed).

## Invariant under test

- ONE capability: `process.exec` (+ `world.snapshot` for evidence) — no `ssh.*` anywhere in
  semantics, WebMCP, or business logic.
- Worlds differ in: worldId, provider kind, host/resource identity, process identity, evidence
  provenance, timings — all represented, none normalized away.
- Resource identity = `(worldId, path)` (D-005).
- Remote effects are evidence-backed (before/after via world ports), never inferred from exit 0.

## Tranches

1. **Config + composition** — `gsterm.toml` `[worlds.<id>]` (host/port/user/root/auth refs/host
   keys); vendor `@cognate/execution-ssh` + `ssh2`; register providers in the ONE registry;
   agent `worldRoots` map; kernel policy unchanged (registration is the grant boundary, D-002).
2. **World-scoped evidence** — snapshot via provider ports (`FileSystemPort` walk, git through
   `ProcessPort`) for every world; snapshot carries `world` provenance; effects carry `worldId`;
   `FileObservation` uses provider `version` tokens; session process/port observation stays
   local-only (D-010, honest `unknown` elsewhere).
3. **Surfaces** — `worldId` through invoker/descriptors/WebMCP (input property of the SAME
   tool); cockpit world selector + availability probe via `world.snapshot`; inspector world/
   provider/host provenance; projection entries carry `worldId`.
4. **Proof tests** — provider selection; same command two worlds (same capability/events/effects
   vocabulary, different provenance); collision (`semantic-world-proof.txt` in both worlds stays
   distinct); remote evidence verified through provider ports; failures (unknown world,
   unreachable host, non-zero exit, invalid remote cwd) settle honestly; authority; WebMCP
   worldId; `executionWorldConformance` against the Cognate SSH fixture; Phase-1 regression.
5. **E2E + docs** — fixture SSH world in the E2E server; world-switching + WebMCP-world
   acceptance; catalog/handoff/README updates; final debt review (observation-ingest verdict).

## Rejected shapes (cheat guard)

- `ssh.exec` / `sshRun` tools, WebMCP `sshExecute`, business-logic branching on world kind,
  exit-code-as-proof, path-only resource identity, credential leakage, local permission registry.

## Commands

`bun run verify` (typecheck + test + e2e) · journey tests `test/journeys/journey-j2-worlds*.test.ts`
· conformance `test/conformance/ssh-world.test.ts`.
