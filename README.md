<p align="center">
  <img src=".github/assets/buddy.png" alt="Code Buddy's mascot, a small blue caterpillar" height="180">
</p>

<h1 align="center">Code Buddy</h1>

<p align="center">
  <strong>Comment on your running app. Claude makes the change.</strong><br>
  A <a href="https://claude.com/claude-code">Claude Code</a> plugin that turns feedback on a
  running frontend app into code changes.
</p>

<p align="center">
  <a href="https://github.com/neolitec/code-buddy/actions/workflows/ci.yml"><img src="https://github.com/neolitec/code-buddy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/neolitec/code-buddy/actions/workflows/codeql.yml"><img src="https://github.com/neolitec/code-buddy/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/neolitec/code-buddy"><img src="https://api.scorecard.dev/projects/github.com/neolitec/code-buddy/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#in-the-widget">The widget</a> ·
  <a href="#security">Security</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

You comment directly on your dev app in the browser: select text, point at an
element, or write about the page or the whole app. For each comment, Claude
starts a background agent that makes the change, shows you its progress live
under your comment, and answers in the same thread. Reply to follow up; cancel
to stop it.

## How it works

- **The widget** is served by a small local server that the skill starts while
  you run `/code-buddy:code-buddy`. No server, no widget: nothing runs when Claude is not
  watching.
- **Your project** only gets a few lines: a dev-only loader snippet, a
  `.code-buddy.json` config, and a `.code-buddy/` folder for the comments
  (git-ignored by default). The widget's code never enters your project or
  your production builds; `init` proves it by scanning a production build.
- **The widget is framework-agnostic.** It ships its own React inside a shadow
  root, so it works on Next.js, Vite, CRA or anything served by a dev server,
  without touching your styles or dependencies.
- **Agents work in parallel safely.** One background agent per comment; the
  plugin's hooks take a per-file lock before every write, so two agents never
  edit the same file at once, and refuse an agent a Bash command that writes
  files, which no lock could cover. What each agent does (files read and
  edited, commands, MCP calls, its messages and thinking) shows up live under
  the comment. The hooks are a Claude Code
  [mod](https://claude.dev/blog/getting-started-with-claude-code-mods/), loaded
  once per session: they start no process per tool call, and act only for an
  agent working on a comment.

## Install

Install it as a Claude Code plugin, straight from GitHub (no clone needed):

```sh
claude plugin marketplace add neolitec/code-buddy#stable
claude plugin install code-buddy@code-buddy
```

Or, inside a session: `/plugin marketplace add neolitec/code-buddy#stable`,
then `/plugin install code-buddy@code-buddy`. The `stable` branch holds the
released versions; `main` is where development happens and does not work
without a build. Get new versions with `claude plugin marketplace update
code-buddy`, or turn on auto-update for the marketplace in `/plugin`; the
[changelog](CHANGELOG.md) lists what each brings.

Requires Claude Code 2.1.287 or later (`claude update`), for its mods, and
Node.js 22 or later. On an older Claude Code, `/code-buddy:code-buddy` says so
and does not start.

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
- While Claude works: what the agent is doing now ("Reading `App.tsx`…",
  "Thinking…"), its latest steps (files read and edited, commands, searches,
  MCP calls, failed tools in red, its messages and its thinking), and
  **Cancel**. Claude Code often hides the thinking itself; its summary shows
  when available, for instance with `"showThinkingSummaries": true` in your
  Claude Code settings.
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

To report a vulnerability, see the [security policy](SECURITY.md).

## Development

Load the plugin from your clone instead of the installed copy. Build the
widget once, then start Claude Code in a frontend project with `--plugin-dir`
and run the skill as usual.

```sh
cd ~/dev/code-buddy && npm ci && npm run build
cd ~/dev/my-frontend-app
claude --plugin-dir ~/dev/code-buddy
```

If the plugin is also installed from the marketplace, disable it first
(`claude plugin disable code-buddy@code-buddy`) so the skill is not loaded
twice.

What to do after a change:

| You changed | To see it |
|---|---|
| `SKILL.md`, `hooks/*` | `/reload-plugins` in the session, or a new session |
| `scripts/*.mjs` except the server | Nothing: each call runs the script again |
| `scripts/server.mjs`, `scripts/lib/*` | Restart the server: run `/code-buddy:code-buddy` again |
| `widget/src/*` | Rebuild the widget, then reload the app page |

The server reads `dist/widget.js` on every page load, so a rebuild and a page
reload are enough for the widget. From the repository root:

```sh
npm ci          # once; install scripts are disabled
npm run build   # type-checks, then rebuilds dist/widget.js
npm run check   # everything CI checks: format, lint, types, build, tests
```

`dist/` (`widget.js` and `THIRD_PARTY_LICENSES.txt`, the licenses of the
packages it bundles) is never committed on `main`: the Release workflow builds
it and publishes it on the `stable` branch. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the rest of the rules.

Paths below are relative to `skills/code-buddy/`.

| Path | What |
|---|---|
| `SKILL.md` | The skill: watch, init, update, uninstall; agent prompts |
| `scripts/server.mjs` | Local server: widget, API, events for the managing session |
| `scripts/claim.mjs`, `resolve.mjs`, `ask.mjs` | Used by the agents |
| `scripts/detect.mjs`, `verify-prod.mjs`, `migrate.mjs` | Used by `init` / `update` |
| `widget/src` | The widget (React, TypeScript) |

At the repository root, `hooks/register.ts` is the plugin's hooks module (a
Claude Code mod, declared in `hooks/hooks.json`): file locks and live progress.
The values it keeps for the session are typed in `types/index.d.ts`, and
`test/hooks.test.ts` tests it against Claude Code itself:

```sh
npm run test:hooks   # claude plugin validate, then claude plugin test
```

`.claude-plugin/` holds the plugin and marketplace manifests. Run
`claude plugin validate .` from the repository root after editing them.

## Contributing

Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) first, and
follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Kevin Manson

Code Buddy is an independent open source project. It is not affiliated with,
endorsed by or supported by Anthropic. Claude and Claude Code are trademarks
of Anthropic, PBC.
