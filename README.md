# Code Buddy

A [Claude Code](https://claude.com/claude-code) skill that turns feedback on a
running frontend app into code changes.

You comment directly on your dev app in the browser: select text, point at an
element, or write about the page or the whole app. For each comment, Claude
starts a background agent that makes the change, shows you its progress live
under your comment, and answers in the same thread. Reply to follow up; cancel
to stop it.

## How it works

- **The widget** is served by a small local server that the skill starts while
  you run `/code-buddy`. No server, no widget: nothing runs when Claude is not
  watching.
- **Your project** only gets a few lines: a dev-only loader snippet, a
  `.code-buddy.json` config, and a `.code-buddy/` folder for the comments
  (git-ignored by default). The widget's code never enters your project or
  your production builds; `init` proves it by scanning a production build.
- **The widget is framework-agnostic.** It ships its own React inside a shadow
  root, so it works on Next.js, Vite, CRA or anything served by a dev server,
  without touching your styles or dependencies.
- **Agents work in parallel safely.** One background agent per comment; a hook
  takes a per-file lock before every write, so two agents never edit the same
  file at once. Their tool calls (files read and edited, commands, MCP calls)
  show up live under the comment.

## Install

Install it as a Claude Code plugin, straight from GitHub (no clone needed):

```sh
claude plugin marketplace add neolitec/code-buddy
claude plugin install code-buddy@code-buddy
```

Or, inside a session: `/plugin marketplace add neolitec/code-buddy`, then
`/plugin install code-buddy@code-buddy`. Get updates with
`claude plugin marketplace update code-buddy`.

Requires Claude Code and Node.js 20 or later.

Then, in your frontend project:

```
/code-buddy:code-buddy init    install in this project (asks only what it cannot detect)
/code-buddy:code-buddy         start a session; open your dev app and comment
/code-buddy:code-buddy update  migrate an older install
/code-buddy:code-buddy uninstall
```

Plugin skills are prefixed with the plugin name, hence `/code-buddy:code-buddy`.

When the frontend lives in a folder of the repository, name it after the
command: `/code-buddy:code-buddy init web` installs Code Buddy in `web/`, and
`/code-buddy:code-buddy web` starts a session there. The folder is resolved
from the current directory, else from the repository root.

## In the widget

- **Comment** opens a new comment for the page, or the whole app.
- **Select text**, then *Comment*, to anchor a comment to that text.
- **Point at element** to anchor it to an element; hovering the element chip
  later outlines it on the page, clicking it scrolls to it (navigating first
  if it lives on another page).
- **All comments** lists every discussion, newest first, filtered by status.
- While Claude works: a spinner, the agent's latest steps, and **Cancel**.
  Cancelling stops the agent and lists the files it had already changed; edit
  the comment and send it again to hand it to a new agent.
- Once answered: reply in the thread to follow up, reusing the same agent and
  its context when it is still around.

## Security

- The server listens on `127.0.0.1` only and accepts cross-origin requests
  from `localhost` origins only.
- The loader is guarded by the bundler's compile-time dev flag
  (`process.env.NODE_ENV` or `import.meta.env.DEV`), so it is removed from
  production builds; `scripts/verify-prod.mjs` checks the build output.
- Comments hold page text and HTML excerpts; they stay in your project folder.

## Development

```sh
cd skills/code-buddy/widget
npm ci --ignore-scripts
npm run build   # type-checks, then rebuilds dist/widget.js
```

`dist/widget.js` is committed so the skill works without a build step. Rebuild
it after every change to `widget/src`. The build dependencies are pinned;
review them before changing a version.

Paths below are relative to `skills/code-buddy/`.

| Path | What |
|---|---|
| `SKILL.md` | The skill: watch, init, update, uninstall; agent prompts |
| `scripts/server.mjs` | Local server: widget, API, events for the managing session |
| `scripts/hook.mjs` | Claude Code hook: file locks and live progress |
| `scripts/claim.mjs`, `resolve.mjs`, `lock.mjs` | Used by the agents |
| `scripts/detect.mjs`, `verify-prod.mjs`, `migrate.mjs` | Used by `init` / `update` |
| `widget/src` | The widget (React, TypeScript) |

`.claude-plugin/` holds the plugin and marketplace manifests. To try local
changes, run `claude --plugin-dir .` from the repository root.
