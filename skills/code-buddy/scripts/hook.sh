#!/bin/sh
# Entry point of the plugin's hooks. Plugin hooks run for every tool call of
# every session, and in subagents too, where the skill's own hooks never fire.
# So this stays out of the way (no Node start) unless an agent is claiming a
# comment or has claimed one.
input=$(cat)
agents="${CODE_BUDDY_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/code-buddy}/agents"
case "$input" in
  *scripts/claim.mjs*) ;;
  *) [ -n "$(ls -A "$agents" 2>/dev/null)" ] || exit 0 ;;
esac
printf '%s' "$input" | node "$(dirname "$0")/hook.mjs"
