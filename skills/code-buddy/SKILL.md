---
name: code-buddy
description:
  Code Buddy turns feedback on a running frontend app into code changes.
  The user comments directly on the dev app in the browser (select text, point
  at an element, or write about the page or the whole app); one background
  agent per comment makes the change and answers in the same thread.
  "/code-buddy:code-buddy [dir]" starts the session (the widget only exists
  while it runs); "/code-buddy:code-buddy init [dir]" installs it in the
  current project or in its folder `dir` (e.g. `web`), "update" and
  "uninstall" maintain it. Use when the user wants to give feedback on the app
  in the browser, to follow or answer that feedback, to install or remove the
  feedback widget, or says "/code-buddy" or "/code-buddy:code-buddy".
hooks:
  PreToolUse:
    - matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash'
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/code-buddy/scripts/hook.mjs"'
          timeout: 60
  PostToolUse:
    - matcher: '*'
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/code-buddy/scripts/hook.mjs"'
          timeout: 10
  SubagentStop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/code-buddy/scripts/hook.mjs"'
          timeout: 10
---

# Code Buddy

- **SKILL** is this skill's base directory (printed above as "Base directory for
  this skill"). Every script below is `node SKILL/scripts/<name>.mjs`.
- **PROJECT** is the project root. When the arguments name a directory (see
  below), PROJECT is that directory, resolved from the working directory, else
  from the git toplevel (so `web` works from anywhere in the repository);
  stop and say so if neither exists. Otherwise PROJECT is the nearest ancestor
  of the working directory that holds `.code-buddy.json`. A git worktree does
  not have it when the file is untracked; then use the main checkout (`git
  worktree list`), and ask if that is ambiguous. Always pass `--project PROJECT` to the scripts.

A project installed under this skill's former name has `.live-feedback.json`
instead: run `node SKILL/scripts/migrate.mjs --project PROJECT` before anything
else. It refuses while a `/live-feedback` session still serves the project;
then ask the user to close that session and run it again.

Read the arguments as `[mode] [dir]`, in any order: the mode is `init`,
`update` or `uninstall`, or none for the watch; any other argument is the
directory (`/code-buddy:code-buddy web`, `/code-buddy:code-buddy init web`).
Without a mode and no `.code-buddy.json` in PROJECT (or above it when no
directory was given), offer `init` first, for that directory if one was named.

Everything lives in the skill: the widget is served by the skill's local server
and its code never enters the project. A project only holds a dev-only loader
snippet, `.code-buddy.json`, and (usually git-ignored) the comments file.

## Watch: you are the manager

This session only dispatches; one background subagent per comment does the
work. The server runs only while this session watches: closing the session
stops it, and the widget disappears on the next page load. Tell the user, in
one line, that `/code-buddy:code-buddy` (with the same directory, if one was
given) resumes it and nothing is lost.

1. Start the server through the Monitor tool with the maximum timeout, and
   re-arm it whenever it expires (state lives in files, restarting is safe):

   ```
   node SKILL/scripts/server.mjs --project PROJECT
   ```

   It first prints `READY <url>`. On `PORT_BUSY`, report who holds the port
   and stop: another session may already be watching this project.
2. Tell the user to open or reload `devUrl` from `.code-buddy.json`.
3. React to each line:

| Line | Action |
|---|---|
| `OPEN` / `NEW <id> …` | Start a subagent, unless one already runs for `<id>`. |
| `FOLLOWUP <id> …` | The reader answered a resolved or stopped comment. If subagent `cb-<first 8 chars of id>` exists in this session (running or finished), SendMessage it the follow-up message below; otherwise start a new subagent. |
| `EDIT <id> …` | SendMessage the new text to that comment's subagent; start one if none runs. |
| `RESOLVED` / `CANCELLED` / `DELETED <id>` | TaskStop that comment's subagent if it still runs; drop it from the queue. |

Start subagents with the Agent tool: `run_in_background: true`, `name:
"cb-<first 8 chars of id>"`, and the prompt below with SKILL, PROJECT, the
config values and the server line filled in. Run at most three at once and
queue the rest. `CANCELLED` means the reader stopped the run: the discussion
stays open and comes back as `FOLLOWUP` or `NEW` when they send it again.

When a subagent returns, tell the user its one line (nothing for
`CANCELLED`). If it returned `QUESTION: …`, relay the question in the chat;
when the user answers, SendMessage the answer to the same subagent.

### Subagent prompt

> Handle the code-buddy comment `<id>` of the project PROJECT. Server line: `<line>`.
>
> 1. Claim it: `node SKILL/scripts/claim.mjs <id> --project PROJECT`. This
>    shows the reader a spinner and your progress, and ties your edits to the
>    comment's file locks. If the claim fails because the comment was
>    cancelled or resolved, stop and reply `CANCELLED`.
> 2. Read the entry in `<commentsFile>` if the line is not enough: `route`,
>    `url`, `section`, and a text `quote` or a pointed `element` (selector from
>    `body`, tag, text, HTML excerpt). `route` `*` means the whole app.
>    `messages` holds the thread after the question: your earlier answers
>    (`claude`) were applied; act on the reader's last message. A
>    `cancellation` field lists files an earlier, stopped agent left changed:
>    keep, finish or revert them to match the current text. When the element
>    is unclear, screenshot it with Playwright on `<devUrl>`.
> 3. Make the change, only under `<editable>`. Other agents may edit the
>    project at the same time: a hook locks every file you write and blocks an
>    edit, with an explanation, when another comment's agent holds the file.
>    Then re-read the files you are changing and retry. If the hook says the
>    reader cancelled the comment, stop at once and reply `CANCELLED`.
> 4. Run `<checks>`, and `<build>` when a component or a dependency changed.
>    Errors only in files you did not touch belong to another agent's work in
>    progress: re-run once, then ignore them.
> 5. Resolve it with one or two sentences the reader will see:
>    `node SKILL/scripts/resolve.mjs <id> --project PROJECT "<answer>"` (pipe
>    the answer on stdin when it is long).
> 6. Reply with one line saying what changed. If the comment is unclear or
>    needs a product decision, do not guess: release it with
>    `node SKILL/scripts/claim.mjs <id> --project PROJECT --release` and reply
>    `QUESTION: <your question>`.

### Follow-up message (to an existing subagent)

> The reader followed up on comment `<id>`: "<followup text>". Claim it again,
> act on the follow-up, run the checks, then resolve it with your answer, as
> before.

## Init: install in a project

1. Run `node SKILL/scripts/detect.mjs --project <candidate>` on the directory
   named in the arguments, else on the git toplevel of the working directory.
   It reads files only.
2. Stop, and say why, when `isPackage` is false or `webFrontend` is false: the
   widget needs a web app served in a browser by a dev server. The framework
   does not matter otherwise (the widget carries its own React inside a shadow
   root). On a monorepo root without a framework, ask which of
   `monorepo.apps` to use and detect again there. When `installed` is set,
   offer `update` instead.
3. Settle with the user, in one question round, only what detection left open:
   the dev URL (`devUrl`), the loader's file (from the table below), the
   check commands (`scripts.typecheck`, `scripts.lint`), the folders agents may
   edit (`srcDirs`), and whether to git-ignore the comments (recommended: they
   hold page HTML excerpts).
4. Write `PROJECT/.code-buddy.json`:

   ```json
   {
     "version": 1,
     "name": "<name>",
     "port": <suggestedServerPort>,
     "devUrl": "<devUrl>",
     "commentsFile": ".code-buddy/comments.json",
     "framework": "<next-app | next-pages | vite | cra | …>",
     "loader": ["<file holding the snippet>"],
     "checks": ["<typecheck>", "<lint>"],
     "build": "<scripts.build>",
     "buildOutput": "<.next | dist | build>",
     "editable": ["src"]
   }
   ```

5. Add the loader, and nothing else, to the client entry:

   | Project | File | Dev guard |
   |---|---|---|
   | Next ≥ 15.3 | `instrumentation-client.ts` next to `app/` (create it, or append) | `process.env.NODE_ENV === 'development'` |
   | Next, older App Router | a `'use client'` component rendered by the root layout, running the snippet in `useEffect` | same |
   | Next Pages Router | `pages/_app` in a `useEffect` | same |
   | Vite (React, Vue, Svelte, plain) | the `index.html` entry (`vite.entry`), top level | `import.meta.env.DEV` |
   | CRA / webpack | `src/index` | `process.env.NODE_ENV === 'development'` |
   | Anything else | the client entry; if there is no obvious one, ask | the bundler's dev flag |

   ```js
   if (process.env.NODE_ENV === 'development') {
     const script = document.createElement('script')
     script.type = 'module'
     script.src = 'http://127.0.0.1:<port>/widget.js'
     script.dataset.codeBuddyLoader = ''
     document.head.append(script)
   }
   ```

   The guard must be the bundler's own compile-time constant so the branch
   is removed from production builds. When the server is not running, the
   browser logs one failed request per page load; that is expected.
6. When `cspFiles` is not empty, check the dev policy allows
   `script-src` and `connect-src` `http://127.0.0.1:<port>`. Propose a
   dev-only change; never loosen the production policy.
7. Add `.code-buddy/` to `.gitignore` if the user agreed.
8. Prove the widget stays out of production: run `build`, then
   `node SKILL/scripts/verify-prod.mjs --project PROJECT`. On `FAIL`, fix the
   guard before finishing. If the build fails for unrelated reasons, say so
   and leave the check to the user.
9. List the files changed and tell the user to run `/code-buddy:code-buddy`,
   followed by PROJECT relative to the git toplevel when it is not the
   toplevel itself (e.g. `/code-buddy:code-buddy web`).

## Update

The widget and scripts are served from the skill, so they are always current.
Run `detect.mjs`; when `installed.version` is lower than `installed.current`,
migrate `.code-buddy.json` and the loader to the current shape above and
re-run step 8 of init.

## Uninstall

Remove the snippet from every file in `loader` (delete a file init created
only for it), `.code-buddy.json`, and the `.gitignore` entry. Ask before
deleting `.code-buddy/`: it holds the reader's comments.

## Rules

- Never delete comments or reset the comments file; the reader owns it.
  Automated checks point the server at another file with
  `CODE_BUDDY_COMMENTS_FILE`.
- `node SKILL/scripts/lock.mjs status --project PROJECT` lists held locks.
- The widget source is `SKILL/widget/src`; `npm run build` in `SKILL/widget`
  rebuilds `dist/widget.js`. Its dependencies are pinned and were security
  scanned; scan again before changing any version.
