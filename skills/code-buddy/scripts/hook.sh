#!/bin/sh
# Entry point of the plugin's hooks. Plugin hooks run for every tool call of
# every session, and in subagents too, where the skill's own hooks never fire.
# So this stays out of the way (no Node start) unless an agent is claiming a
# comment or has claimed one.
input=$(cat)
agents="${CODE_BUDDY_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/code-buddy}/agents"
# Only bindings touched in the last two hours count (BINDING_TTL_MS in
# lib/agents.mjs): one left by a killed agent must not slow every session.
case "$input" in
  *scripts/claim.mjs*) ;;
  *) [ -n "$(find "$agents" -maxdepth 1 -type f -mmin -120 2>/dev/null | head -n 1)" ] || exit 0 ;;
esac
printf '%s' "$input" | node "$(dirname "$0")/hook.mjs"
