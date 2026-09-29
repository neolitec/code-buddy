# Code Buddy

A Claude Code plugin: the user comments on their running dev app in the
browser, and one background agent per comment makes the change. See the
[README](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

- `.claude-plugin/`: plugin and marketplace manifests.
- `skills/code-buddy/SKILL.md`: the skill itself, a prompt. Keep it short:
  every line is read in every user's session.
- `skills/code-buddy/scripts/`: Node.js ES modules with JSDoc types, no
  dependencies.
- `skills/code-buddy/widget/src/`: the widget (React, TypeScript), bundled into
  `widget/dist/`, which is git-ignored: the Release workflow publishes it on
  the `stable` branch users install from.

## Commands

- `npm ci`: install (install scripts are disabled).
- `npm run check`: format check, lint, type-check and build; must pass.
- `npm run format`: apply Prettier.
- `npm run build`: rebuild `widget/dist/` (the bundle and its third-party
  licenses).

## Rules

- Never commit `widget/dist/`. Build it (`npm run build`) only to try a widget
  change locally.
- Type the scripts with JSDoc instead of silencing the checker. Disable a lint
  rule only for one line, with `-- <reason>`.
- No new dependency, runtime or dev, without an issue approving it.
- Pull request titles follow `<type>: <summary>` (`feature`, `fix`, `docs`,
  `chore`, `refactor`, `perf`, `test`, `ci`); they become the squashed commit.
