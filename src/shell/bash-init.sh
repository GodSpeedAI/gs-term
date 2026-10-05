# gsterm shell integration for bash — deterministic command-boundary observation.
# Injected via `bash --init-file <this file>`; the user's ~/.bashrc is sourced first so the
# environment stays theirs. Emits OSC 7311 markers (see src/shell/markers.ts):
#   A = command start (DEBUG-trap preexec), D = command done (PROMPT_COMMAND precmd), R = ready.
# Markers are parsed server-side and stripped before any viewer sees the stream.

# Environment-inherited PROMPT_COMMAND/PS0 come from ANOTHER shell integration (e.g. an IDE
# terminal exporting hooks whose functions do not exist here) — discard them before sourcing
# the user's rc, which is the only place legitimate prompt hooks come from.
unset PROMPT_COMMAND
PS0=""

if [ -f "$HOME/.bashrc" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.bashrc"
fi

__gst_json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

__gst_mark() {
  local code=$1 payload=$2 b64
  b64=$(printf '%s' "$payload" | base64 | tr -d '\n')
  printf '\033]7311;%s;%s\007' "$code" "$b64"
}

__gst_now_ms() {
  printf '%s' $(( $(date +%s%N) / 1000000 ))
}

# Absorb whatever prompt hooks the user's ~/.bashrc installed; they run INSIDE our guarded
# prompt function so their commands can never masquerade as user commands (preexec capture).
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
  __gst_user_pc=$(IFS=';'; printf '%s' "${PROMPT_COMMAND[*]}")
else
  __gst_user_pc="${PROMPT_COMMAND:-}"
fi

# Preexec: fires on every simple command via the DEBUG trap. Two guards:
#   __gst_pending   — only the first command of a prompt cycle is captured;
#   __gst_in_prompt — prompt machinery (including the user's hooks) is never a "command".
__gst_preexec() {
  if [ -z "${__gst_pending+x}" ] && [ -z "${__gst_in_prompt+x}" ]; then
    __gst_pending=1
    __gst_mark A "$(printf '{"command":"%s","cwd":"%s","startedAtMs":%s}' \
      "$(__gst_json_escape "$BASH_COMMAND")" \
      "$(__gst_json_escape "$PWD")" \
      "$(__gst_now_ms)")"
  fi
  if [ -n "${__gst_saved_debug:-}" ]; then
    eval "$__gst_saved_debug"
  fi
}

# Precmd: runs first so `$?` is the finished command's exit code; then the user's hooks.
__gst_prompt() {
  local exit=$?
  __gst_in_prompt=1
  __gst_mark D "$(printf '{"exitCode":%s,"cwd":"%s","endedAtMs":%s}' \
    "$exit" \
    "$(__gst_json_escape "$PWD")" \
    "$(__gst_now_ms)")"
  unset __gst_pending
  if [ -n "${__gst_user_pc:-}" ]; then
    eval "$__gst_user_pc"
  fi
  unset __gst_in_prompt
}

# Integration is live BEFORE the DEBUG trap exists: the guard blocks every command executed by
# this init file itself; only the first prompt's `unset` re-enables preexec capture.
__gst_pending=1

# Preserve an existing DEBUG trap (user rc may install one).
__gst_saved_debug=$(trap -p DEBUG)
__gst_saved_debug=${__gst_saved_debug#trap -- \'}
__gst_saved_debug=${__gst_saved_debug%\' DEBUG}
trap '__gst_preexec' DEBUG

PROMPT_COMMAND="__gst_prompt"

# Ready signal for the bridge; A-marker capture stays blocked until the first prompt's unset.
__gst_mark R "$(printf '{"shell":"bash","cwd":"%s","pid":%s}' "$(__gst_json_escape "$PWD")" "$$")"
