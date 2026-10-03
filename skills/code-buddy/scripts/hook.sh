#!/bin/sh
# Entry point of the plugin's hooks. Plugin hooks run for every tool call of
# every session, and in subagents too, where the skill's own hooks never fire.
# So this stays out of the way (no Node start) unless an agent is claiming a
# comment or has claimed one.
input=$(cat)
state="${CODE_BUDDY_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/code-buddy}"
agents="$state/agents"
# Debugging: `touch <state>/debug` logs every call to <state>/hook.log.
log() {
  [ -f "$state/debug" ] || return 0
  event=$(printf '%s' "$input" | grep -o '"hook_event_name":"[A-Za-z]*"' | head -n 1 | cut -d'"' -f4)
  tool=$(printf '%s' "$input" | grep -o '"tool_name":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  agent=$(printf '%s' "$input" | grep -o '"agent_id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  printf '%s sh  %s %s agent=%s pid=%s: %s\n' "$(date -u +%FT%TZ)" "$event" "$tool" "${agent:-main}" "$$" "$1" >>"$state/hook.log"
}
# Only bindings touched in the last two hours count (BINDING_TTL_MS in
# lib/agents.mjs): one left by a killed agent must not slow every session.
# A claim is a Bash command; an Agent prompt that only quotes it is not one.
case "$input" in
  *'"tool_name":"Bash"'*scripts/claim.mjs*) ;;
  *) [ -n "$(find "$agents" -maxdepth 1 -type f -mmin -120 2>/dev/null | head -n 1)" ] || { log skip; exit 0; } ;;
esac
log node
printf '%s' "$input" | node "$(dirname "$0")/hook.mjs"
