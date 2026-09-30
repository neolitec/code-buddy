# Code Buddy

A Claude Code plugin: the user comments on their running dev app in the
browser, and one background agent per comment makes the change. See the
[README](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

- `.claude-plugin/`: plugin and marketplace manifests.
- `hooks/hooks.json`: the plugin's hooks, which run in every session and
  subagent (a skill's own hooks never fire in subagents). They go through
  `scripts/hook.sh`, which skips Node unless an agent works on a comment.
- `skills/code-buddy/SKILL.md`: the skill itself, a prompt. Keep it short:
  every line is read in every user's session.
- `skills/code-buddy/scripts/`: Node.js ES modules with JSDoc types, no
  dependencies.
- `skills/code-buddy/widget/src/`: the widget (React, TypeScript), bundled into
  `widget/dist/`, which is git-ignored: the Release workflow publishes it on
  the `stable` branch users install from.

## Commands

- `npm ci`: install (install scripts are disabled).
- `npm run check`: format check, lint, type-check, build and tests; must pass.
- `npm test`: the `node:test` suites in `test/` (they need the widget built).
- `npm run format`: apply Prettier.
- `npm run build`: rebuild `widget/dist/` (the bundle and its third-party
  licenses).

## Rules

- Never commit `widget/dist/`. Build it (`npm run build`) only to try a widget
  change locally.
- Fix a bug with a test that fails without the fix.
- Type the scripts with JSDoc instead of silencing the checker. Disable a lint
  rule only for one line, with `-- <reason>`.
- No new dependency, runtime or dev, without an issue approving it.
- Pull request titles follow `<type>: <summary>` (`feature`, `fix`, `docs`,
  `chore`, `refactor`, `perf`, `test`, `ci`); they become the squashed commit.
