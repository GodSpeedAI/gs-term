# Why shell integration instead of prompt scraping

## The question

To know when a command started and finished, you could scrape the rendered terminal output. Why
does gs-term refuse?

## What scraping actually gives you

A rendered terminal stream is a *picture* of what happened, and a lossy one:

- **Formatting is presentation.** Prompts, colours, cursor movement, line wrapping, and the user's
  PS1 all interleave with the thing you are trying to read.
- **Command and output are indistinguishable.** Without a delimiter, "what was typed" and "what was
  printed" are the same bytes.
- **Exit codes are absent.** A prompt does not carry `$?`. You can shell out afterwards, but then you
  are guessing which command you are asking about.
- **CWD is absent** for the same reason, and `cd` changes it without producing any file diff.
- **It breaks on the very shells users actually use.** Multi-line prompts, right prompts, zsh's
  `PROMPT_SP`, tmux/screen status lines, IDE shells that rewrite `PROMPT_COMMAND`.

Every one of those is a real, observed failure mode in a terminal product, not a hypothetical.

## What shell integration gives you

The shell *knows* when a command starts and when it ends, and knows the exit status and the working
directory. gs-term takes that knowledge directly.

`src/shell/bash-init.sh` installs:

- a `DEBUG` trap → **command start**: `{command, cwd, startedAtMs}`
- a `PROMPT_COMMAND` hook → **command done**: `{exitCode, cwd, endedAtMs}`

Each marker rides the byte stream as an OSC escape sequence:

```
ESC ] 7311 ; A ; <base64(JSON)> BEL
ESC ] 7311 ; D ; <base64(JSON)> BEL
```

`src/shell/markers.ts` parses and **strips** them before any viewer sees the bytes, so a user never
sees the control sequence and the terminal still looks like a terminal.

Base64 for the payload because command text may contain any byte except BEL/ESC; JSON stays lossless
through an escape sequence.

## The hard parts, and how they are handled

**Markers split across reads.** A PTY delivers arbitrary chunks. `MarkerParser` is incremental: it
finds the prefix, waits for BEL, and holds a partial prefix (`ESC ] 731`) for the next chunk rather
than flushing it as data.

**Malformed markers.** A payload that is not valid JSON is stripped as noise and dropped. It is never
guessed at — a guessed command boundary is worse than a missing one.

**Pathological input.** An unterminated marker larger than 8 KiB is flushed as ordinary data, so
memory stays bounded no matter what the shell emits.

**Inherited hooks.** If the user's environment already sets `PROMPT_COMMAND` (a parent IDE shell, a
frameworks's own integration), those hooks are discarded at init so their prompt machinery cannot
masquerade as a user command.

**Output that looks like a marker.** BEL or ESC without the `]7311;` prefix passes through untouched.

## What this buys

| Question | With scraping | With shell integration |
| --- | --- | --- |
| when did the command start | guess from position | recorded timestamp |
| what was the exact command | parse heuristics | the shell's own record |
| what was the exit code | not available | exact |
| what was the cwd afterwards | not available | exact — including builtin `cd` |
| how many commands | fragments | exact count |
| survives a custom prompt | no | yes |

The cwd case matters more than it looks. `cd` changes the world and produces **no** effect from a
snapshot diff — so if cwd came from a diff it would simply be wrong. The bridge takes
`lastCwd = marker.cwd` for exactly this reason.

## The `setsid` companion

A second fact from the same area: `Bun.spawn({terminal})` on Bun 1.4.0 does not make the child a
session leader. Without `setsid`, bash reports "no job control", the terminal's foreground process
group is wrong, and `Ctrl-C` never reaches the running command. `src/terminal/session.ts` therefore
spawns `setsid bash --init-file …` when `setsid` is available, and `doctor` reports PTY as
`degraded` when it is not.

## Limits

- **Bash only.** The adapter interface is ready for other shells; the parser depends only on the
  three codes (debt D-012).
- **Compound lines record the first simple command.** `a && b` is recorded as `a`, which is
  `DEBUG`-trap semantics (debt D-014).
- **Markers lost on abnormal PTY death** leave a command unsettled (debt D-018). Nothing is invented
  to compensate.

## Source trail

- `src/shell/bash-init.sh` — hook installation and inherited-hook discard
- `src/shell/markers.ts:69` `MarkerParser`, `:44` `decodePayload`
- `src/terminal/session.ts:82` `handleData` — split and dispatch
- `src/bridge/observation.ts:55` `handleMarker` — `lastCwd` from the marker
- `src/terminal/session.ts:59-70` — the `setsid` spawn
- `test/conformance/shell-markers.test.ts` — chunk splitting, malformed input, unterminated markers
- `test/conformance/pty.test.ts` — exit codes observed, resize reaches the shell, Ctrl-C
- `src/semantic/concepts.ts:226-233` — `concept:shell.integration-markers`