# How to debug a common failure

**Goal:** diagnose one of the failures that actually occur, using evidence rather than guesses.

The general method is the same for all of them:

1. **Is the mechanism available?** `bun run doctor --probe` — the substrate fails honestly, so start
   there rather than in the code.
2. **What did the receipt say?** A search that returns little usually has a `SearchReceipt` naming
   which stages ran and what was unavailable.
3. **What do the events say?** `/health` and the `executions` projection, plus
   `client.events({follow:true})`, show the run's real status.
4. **What does the bridge report?** Bridge errors go to `console.error` with a `[bridge]` prefix and a
   context (`bridge-chain`, `followRuns`, `world-state <trigger>`, `record-fact`).

---

## Symptom: `code.*` / "who calls this?" says the mechanism is unavailable

**Evidence to gather**

```bash
bun run doctor --probe
```

Look at the `Language intelligence` section: `SolidLSP` and `TypeScript server`.

**Likely causes and fixes**

| Cause | Fix |
| --- | --- |
| `solidlsp` unavailable: bridge project not found | the `solidlsp/` directory is missing or `mechanisms.solidlsp_project` points elsewhere |
| `solidlsp` unavailable: bridge start failed | run `cd solidlsp && uv run python selftest.py` for the real error |
| `typescript-server` degraded: resources not provisioned | first start provisions (~1 min); run `doctor --probe` twice |
| The query targets a **remote** world | expected — the substrate is local-world-only. Mechanisms report `unavailable` for that world by design. Never substitute local results. |
| `mechanisms.enabled = false` in `gsterm.toml` | the substrate is not mounted at all |

**Why rg still answers**

For `who-calls-this` with no SolidLSP, the planner falls back to rg and states in the result that
semantic verification was unavailable. That is correct behaviour, not a bug.

---

## Symptom: a typed command never appears in the execution list

**Evidence**

1. `bun run doctor` — is PTY `degraded` (no `setsid`)? Then job control is broken and markers may not
   flow.
2. Does the terminal render output at all? If yes, the PTY is alive.
3. Did the shell die? Look for an `exit` control frame; the session does not respawn.

**Likely causes**

| Cause | Detail |
| --- | --- |
| Markers lost on abnormal PTY death | debt D-018: the command never settles; nothing is invented |
| Non-bash shell | bash-only integration (D-012). The adapter emits no `A`/`D` markers. |
| Compound line | `a && b` records `a` only (D-014) |
| Policy denial | the `system` actor invoking `world.snapshot` was denied — check for `[bridge]` errors |
| World unknown | `WorldUnavailableError`; the session world's root is misconfigured |

---

## Symptom: `unknown` in the world view

**This is usually correct.** It means an observer could not establish the fact and said so.

| Field | Typical reason |
| --- | --- |
| `processes.status` | no live session root pid yet (startup race), or `/proc` unavailable |
| `ports.status` | follows processes: no pids to attribute to |
| `git.status = no-repo` | the workspace root is not a work tree — a *verified* answer, not a failure |
| `git.status = unknown` | `git status` failed; the reason is in the observation |
| remote world | session-tree attribution is a local-PTY concept (D-010) |

Reconcile happens at boot, at attach and after each settlement. Run a command and re-attach to force a
fresh observation.

---

## Symptom: repeated `[bridge] world-state …` errors

**Cause**: five optimistic-concurrency retries exhausted, or the store rejected the update.

**Evidence**

```bash
bun run doctor                        # storage/mechanism health
curl -s http://127.0.0.1:7317/health  # session, semantic digest, capabilities
```

**Likely causes**

| Cause | Detail |
| --- | --- |
| Two writers on the same store | the session world thread is being updated by another process |
| Store unwritable or locked | permissions; SQLite contention |
| Snapshot failing before the write | fix the snapshot error first — the write error is a symptom |

---

## Symptom: `doctor` exits 1

`unavailable` mechanisms exist while `mechanisms.enabled` is true. The list is printed. Common on an
unbootstrapped checkout: build the Rust helper, `uv sync` SolidLSP.

Under `--require-semantic`, exit code **2** means mechanisms are disabled by configuration, or one of
the required set (bun, rg, zvec-grep Rust, zvec, Potion model, SolidLSP, Python/uv, TypeScript server)
is not `ready`.

---

## Symptom: `--node-free` fails with `node resolves to <path>`

An environment leak. The gate scrubs `node`, `nvm`, `.nub`, `mise`, `volta`, `fnm`, `pnpm`, `npm`,
`yarn` and `/mnt/c/...`, then installs **only its own Bun shim** at `.devbin/shims/node`. If `node`
resolves anywhere else, the product path would reach a real Node binary.

Inspect `command -v node` inside your devbox shell and in your interactive shell — they should
differ. The invariant is a build gate on purpose (D-042).

---

## Symptom: a test fails only in `--release`

A semantic skip became a failure. Run with `GSTERM_REQUIRE_SEMANTIC=1` locally to reproduce:

```bash
GSTERM_REQUIRE_SEMANTIC=1 bun run test
```

Then fix the real cause — do not set a `GSTERM_SKIP_*` variable.

---

## Symptom: a search returns results but the wrong ones

Inspect the receipt:

- `stages` — which stages ran, and with how many candidates each;
- `availability` — which mechanisms were ready *for that world*;
- `reduction` — where the funnel actually narrowed;
- `provenance.crossWorld` — always `false`; a world switch is a deliberate user act.

If the referent was ambiguous, the attention precedence chose a different entity than you expected.
Select explicitly; see [attention precedence](../subsystems/focus-engine.md).

---

## When you are genuinely stuck

Record what you gathered, not what you assume:

1. `bun run doctor --probe` output;
2. the `SearchReceipt` or the run's error;
3. the relevant events;
4. the failing test name and message.

Then check `.agents/DEBT.md` — most non-obvious behaviours are already recorded there with an owner
and status, and "this is known debt" is a real answer.