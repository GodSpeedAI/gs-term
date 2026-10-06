# Troubleshooting

Start here for symptoms. For a goal-oriented debugging procedure see
[how-to/debug-a-common-failure.md](how-to/debug-a-common-failure.md).

## First move, always

```bash
bun run doctor --probe
```

The substrate fails honestly. Knowing which mechanism is unavailable usually turns a long
investigation into a short one. `doctor` groups rows into Runtime, Native semantic search, Language
intelligence, Search, and Remote, and prints `Node: not required`.

---

## Setup and environment

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `bun: command not found` | Bun not bootstrapped or not on `PATH` | `bash scripts/bootstrap.sh`, then use the devbox shell or add `.devbin/bin` |
| `cargo not found` | rustup missing | run bootstrap (installs rustup); the toolchain is pinned to 1.98.0 |
| Port 7317 in use | another process | `GSTERM_PORT=7400 bun run dev` or set `server.port` |
| `WorldUnavailableError` on start | `world.root` misconfigured or unreadable | check `GSTERM_ROOT` and `gsterm.toml` |
| `failed to bundle cockpit UI` | a UI import error | the thrown message includes the bundler log |
| `failed to parse domain model` | `domain/interaction-model.sea` invalid | check `.sea/interaction/validation/` |
| `missing required semantic object <id>` | a required semantic id was removed from the model | restore it, or change `SEMANTIC_ID_*` deliberately |

---

## Terminal and shell

| Symptom | Likely cause | Detail |
| --- | --- | --- |
| "no job control", Ctrl-C ignored | `setsid` not on `PATH` | Bun 1.4.0 does not session-lead the child; `doctor` reports PTY `degraded`. Debt D-016. |
| Command never settles in the execution list | markers lost on abnormal PTY death | debt D-018; nothing is invented to compensate |
| Compound line records only the first command | bash `DEBUG`-trap semantics | debt D-014 |
| `output` shows `unknown` | correct for PTY-observed runs | stdout is never reconstructed (debt D-015) |
| Resize appears ignored | out-of-range values | must be integers, `cols` 1–512, `rows` 1–256 |
| No markers at all | not bash | integration is bash-only (debt D-012) |
| Shell dies and does not come back | no respawn by design | an `exit` control frame is sent; the dead state is visible on purpose |

---

## World view honesty

These are usually correct behaviour, not bugs:

| Field | Meaning |
| --- | --- |
| `processes.status: unknown` | no live session root pid yet, `/proc` unavailable, or the root is gone |
| `ports.status: unknown` | follows processes: no pids to attribute to |
| `git.status: no-repo` | verified outside a work tree |
| `git.status: unknown` | `git status` failed; the reason is in the observation |
| missing ports on a remote world | session-tree attribution is a local-PTY concept (debt D-010) |

Reconciliation runs at boot, at attach, and after each settlement. Run a command and re-attach to
force a fresh observation.

---

## Search

| Symptom | Likely cause | Detail |
| --- | --- | --- |
| `code.*` says unavailable | remote world, or mechanisms disabled | the substrate is local-world-only; no local substitution is correct |
| `who calls this?` is very slow the first time | cold tsserver | observed up to ~40 s; ~1 s once warm. The planner warms and retries. |
| Semantic query returns nothing | concept store missing, or zvec-grep unavailable | degrades to rg, bounded; the receipt says which stages ran |
| Results look wrong | ambiguous referent | the attention precedence chose a different entity; select explicitly (debt D-036) |
| `SolidLSP not mounted` in a receipt | mechanisms disabled or wrong world | check `doctor` and `gsterm.toml` `[mechanisms]` |

The `SearchReceipt` is the diagnostic. Its `availability`, `stages` and `reduction` fields say exactly
what ran and what did not.

---

## Bridge and reconciliation

| Symptom | Likely cause | Detail |
| --- | --- | --- |
| Repeated `[bridge] world-state …` | 5 optimistic-concurrency retries exhausted, or a store error | fix the underlying snapshot/store failure first |
| `[bridge] bridge-chain` errors | a capability threw (policy denial, unknown world) | reported; the chain continues |
| `[bridge] record-fact` errors | observation ingestion rejected a record | reported, not retried in a loop |
| `[bridge] followRuns` error | the event stream broke | reconciliation still happens on boot and attach |
| World view never appears | `reconcile("boot")` failed | check the bridge errors above |

---

## Worlds and SSH

| Symptom | Likely cause | Detail |
| --- | --- | --- |
| `host-key pinning is required` | no fingerprints and no known_hosts file | mandatory; pin the host key |
| `password-env reference <VAR> is not set` | variable missing | export it before `bun run dev` |
| `unsupported kind <k>` | v0 supports `ssh` only | extend the parser |
| Connection hangs | unreachable host | bounded by `ready_timeout_ms` |
| `~/.ssh/config` alias not found | aliases are not resolved | debt D-009; use an explicit host |
| Grandchildren survive a timeout | local exec kills the process, not its group | debt D-031 (the SSH supervisor kills the group) |

---

## Validation

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Architecture suite red | a boundary was crossed | the assertion names the file; usually a Cognate import in mechanism code, a provider name in semantic code, or a second `bindCapabilities` |
| Semantic tests skipped | the substrate is not ready | `bun run doctor --probe`; `GSTERM_REQUIRE_SEMANTIC=1` turns skips into failures |
| `doctor` exits 1 | at least one mechanism `unavailable` while enabled | build the Rust helper; `uv sync` SolidLSP |
| `doctor` exits 2 under `--require-semantic` | mechanisms disabled, or a required mechanism is not ready | required set: bun, rg, zvec-grep Rust, zvec, Potion model, SolidLSP, Python/uv, TypeScript server |
| `node resolves to <path>` | environment leak | the `--node-free` invariant; inspect `command -v node` inside and outside devbox |
| Playwright browsers missing | e2e provisioning | install chromium inside the bootstrapped environment |
| Rust build fails on inherited `CC`/`CXX` | host variables leak | `devbox shell` unsets them; unset manually outside devbox |
| Semantic reduction tests slow | cold tsserver | expected on first run; compare against the recorded latencies in `journey-j9` |

---

## Known limitations

The authoritative, owner-bearing list is [`.agents/DEBT.md`](../.agents/DEBT.md). The most
user-visible items:

| Area | Limitation |
| --- | --- |
| Shell | bash-only integration; compound lines record the first simple command; PTY output is `unknown` |
| Sessions | one durable PTY session per server; markers lost on abnormal death |
| Observation | settlement-time snapshots, not watchers; walk cap of 5 000 entries; remote processes/ports `unknown` |
| Execution | local timeout does not kill the process group; no `~/.ssh/config` alias resolution |
| Authority | no per-world policy; dev-token authenticator; unrestricted human PTY |
| Search | minimal structural map; ambient referent limits |
| Infrastructure | devbox nix toolchain cannot build the Rust helper on some hosts (D-040); tsserver navto needs loaded projects (D-041); the node→bun shim boundary must stay explicit (D-042) |

---

## Escalating

When the honest answer is "this is known debt", `.agents/DEBT.md` is where that lives — with an id, a
current behaviour, why it is debt, a workaround, evidence, an owner and a status. Searching it first
saves time and avoids re-deriving a limitation.

When it is not in the ledger, gather: `doctor --probe` output, the receipt or run error, the relevant
events, and the failing test name — not assumptions.