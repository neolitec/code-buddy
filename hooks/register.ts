// Code Buddy's hooks, as a Claude Code mod (2.1.287 or later). They run in
// every session and every subagent, and act only for an agent that claimed a
// comment with claim.mjs: they lock the files it writes, so agents working on
// other comments never edit the same file at once, and record its steps for
// the widget in the progress file the server reads.
//
// Loaded once per session, they start no process per tool call. The bindings
// (agent to comment) and the locks live in $.state, so they survive a reload
// of the module and vanish with the session, like the agents themselves.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Binding, Lock } from '../types'

type $ = EngineInterface
/**
 * `lockRoot`: the git repository the project is in, else the project. Agents
 * may edit outside the project (`editable` folders such as `../api`), and
 * those files need locks too.
 */
type Project = {
  root: string
  lockRoot: string
  commentsFile: string
  progressDir: string
}
type Step = Record<string, unknown>

const noBindings: Record<string, Binding> = {}
const noLocks: Record<string, Lock> = {}
const bindings = atom({ plugin: 'code-buddy', key: 'bindings' } as const, noBindings)
const locks = atom({ plugin: 'code-buddy', key: 'locks' } as const, noLocks)

// A hook's own time is bounded (10 s, waits included).
const LOCK_WAIT_MS = 6_000
const LOCK_POLL_MS = 200
const STALE_MS = 20 * 60 * 1000
const MAX_TEXT = 400

const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
const WORD = String.raw`[^\s;&|()<>]+`
// The agent's scripts, called by any path (`$S/claim.mjs` too).
const CLAIM = new RegExp(String.raw`\bclaim\.mjs\s+(${WORD})`)
const RESOLVE = new RegExp(String.raw`\b(?:resolve|ask)\.mjs\s+(${WORD})`)
// What claim.mjs prints: the project it found from the shell's directory,
// which the hooks cannot see (`--project .` after a `cd`).
const CLAIMED = /^claimed (\S+) \(.*\) project=(\/.*)$/m
// A Bash command that writes files takes no lock: refused to an agent working
// on a comment, which must use Edit or Write. Best effort, on the usual forms.
// What an inline script writes cannot be told: always refused.
const SCRIPT_WRITES = [
  /\bopen\([^)]*,\s*['"][wax]b?\+?['"]/,
  /\.write_(?:text|bytes)\(/,
  /\b(?:writeFile|appendFile)(?:Sync)?\s*\(/,
]
// An in-place editor, cat or tee names its files: refused only when one may be
// in the repository (a relative path, after some `cd`, may be).
const IN_PLACE = /\b(?:sed|perl)\s+(?:-\S+\s+)*-[\w-]*i/
const CAT_INTO = /\bcat\s*>>?\s*(\S+)/
const TEE = /\btee\b((?:\s+[^\s|;&<>]+)*)/
// Claude Code's own plumbing, not the agent's work.
const INTERNAL_TOOLS = new Set(['SubagentHandback'])

// No node:path in a mod; the paths are the POSIX ones Claude Code hands over.
function normalize(file: string): string {
  const parts: string[] = []
  for (const part of file.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}
const resolve = (root: string, file: string) =>
  normalize(file.startsWith('/') ? file : `${root}/${file}`)
const relative = (root: string, file: string) =>
  file === root
    ? ''
    : file.startsWith(`${root}/`)
      ? file.slice(root.length + 1)
      : undefined
const unquote = (value: string) => value.replace(/^["']|["']$/g, '')
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1)
/** `file` as seen from `root`, `../` included. */
function relativeFrom(root: string, file: string) {
  const from = root.split('/').filter(Boolean)
  const to = file.split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}
const short = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const clip = (text: string) => short(text.trim().replace(/\s+/g, ' '), MAX_TEXT)

const projects = new Map<string, Promise<Project>>()

async function loadProjectOnce($: $, root: string): Promise<Project> {
  const config: { commentsFile?: string } = JSON.parse(
    await $.fs.read(`${root}/.code-buddy.json`),
  )
  const home = await $.env.get('HOME')
  const cache = (await $.env.get('XDG_CACHE_HOME')) ?? `${home}/.cache`
  const stateRoot = (await $.env.get('CODE_BUDDY_STATE_DIR')) ?? `${cache}/code-buddy`
  const commentsFile =
    (await $.env.get('CODE_BUDDY_COMMENTS_FILE')) ??
    config.commentsFile ??
    '.code-buddy/comments.json'
  // lib/project.mjs: the state folder is named after sha1(root).
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(root))
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
  const git = await $.process
    .run(['git', '-C', root, 'rev-parse', '--show-toplevel'])
    .catch(() => undefined)
  const top = git?.exitCode === 0 ? normalize(git.stdout.trim()) : ''
  return {
    root,
    lockRoot: top && relative(top, root) !== undefined ? top : root,
    commentsFile: resolve(root, commentsFile),
    progressDir: `${stateRoot}/${hash}/progress`,
  }
}

function loadProject($: $, root: string): Promise<Project> {
  let found = projects.get(root)
  if (!found) {
    found = loadProjectOnce($, root)
    found.catch(() => projects.delete(root))
    projects.set(root, found)
  }
  return found
}

/** Ids of the comments an agent may work on, as lib/store.mjs's isActive. */
async function activeCommentIds($: $, project: Project) {
  try {
    const comments: {
      id: string
      status: string
      cancelledAt?: string
      askedAt?: string
    }[] = JSON.parse(await $.fs.read(project.commentsFile))
    return new Set(
      comments
        .filter((c) => c.status === 'open' && !c.cancelledAt && !c.askedAt)
        .map((c) => c.id),
    )
  } catch {
    return undefined
  }
}

// $.fs has no append: one read-then-write at a time per file.
const writes = new Map<string, Promise<void>>()

function appendProgress($: $, project: Project, comment: string, steps: Step[]) {
  if (!steps.length) return Promise.resolve()
  const file = `${project.progressDir}/${comment}.jsonl`
  const lines = steps.map((step) => `${JSON.stringify(step)}\n`).join('')
  const done = (writes.get(file) ?? Promise.resolve())
    .then(async () => {
      let text = ''
      try {
        text = await $.fs.read(file)
      } catch {}
      return $.fs.write(file, text + lines)
    })
    .catch(() => undefined)
  writes.set(file, done)
  return done
}

/** Nothing for a comment the reader stopped: its agent may still call tools. */
async function record($: $, project: Project, comment: string, steps: Step[]) {
  const active = await activeCommentIds($, project)
  if (active && !active.has(comment)) return
  await appendProgress($, project, comment, steps)
}

function writeTarget(tool: string, args: Record<string, string | undefined>) {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return args.file_path
  if (tool === 'NotebookEdit') return args.notebook_path
  if (tool === 'Bash' && BUILD.test(args.command ?? '')) return '@build'
  return undefined
}

/** The agent's own scripts pass: an answer may quote anything. */
function writesFromBash(command: string, project: Project) {
  if (CLAIM.test(command) || RESOLVE.test(command)) return false
  if (SCRIPT_WRITES.some((pattern) => pattern.test(command))) return true
  const targets: string[] = []
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/)
    if (IN_PLACE.test(segment)) targets.push(words.at(-1) ?? '')
    const into = CAT_INTO.exec(segment)?.[1]
    if (into) targets.push(into)
    const teed = TEE.exec(segment)?.[1]
    if (teed)
      targets.push(
        ...teed
          .trim()
          .split(/\s+/)
          .filter((word) => !word.startsWith('-')),
      )
  }
  return targets.some((target) => {
    const file = unquote(target)
    return (
      !file.startsWith('/') || relative(project.lockRoot, normalize(file)) !== undefined
    )
  })
}

function describe(
  project: Project,
  tool: string,
  args: Record<string, string | undefined>,
) {
  // From the project, as the agent's prompt and the reader see paths.
  const repoPath = (file = '') => {
    const full = resolve(project.root, file)
    return relative(project.lockRoot, full) === undefined
      ? basename(file)
      : relativeFrom(project.root, full)
  }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return { kind: 'mcp', label: `${server} · ${name}` }
  }
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return { kind: tool.toLowerCase(), label: repoPath(args.file_path) }
    case 'NotebookEdit':
      return { kind: 'edit', label: repoPath(args.notebook_path) }
    case 'Bash':
      return CLAIM.test(args.command ?? '')
        ? { kind: 'start', label: 'Started' }
        : { kind: 'bash', label: short(args.description || args.command || '') }
    case 'Grep':
    case 'Glob':
      return { kind: 'search', label: short(args.pattern ?? '') }
    case 'WebFetch':
      return {
        kind: 'web',
        label: args.url && URL.canParse(args.url) ? new URL(args.url).host : 'web',
      }
    case 'WebSearch':
      return { kind: 'web', label: short(args.query ?? '') }
    case 'Skill':
      return { kind: 'skill', label: args.skill ?? '' }
    default:
      return { kind: 'tool', label: tool }
  }
}

const lockKey = (root: string, target: string) => `${root}\n${target}`

async function tryLock($: $, project: Project, owner: string, target: string) {
  const active = await activeCommentIds($, project)
  const key = lockKey(project.lockRoot, target)
  let holder: string | undefined
  await update($, locks, (all) => {
    const held = all[key]
    holder = undefined
    if (held && held.owner !== owner) {
      const stale =
        Date.now() - held.at > STALE_MS ||
        (active !== undefined && !active.has(held.owner))
      if (!stale) {
        holder = held.owner
        return all
      }
    }
    return { ...all, [key]: { owner, at: Date.now() } }
  })
  return holder
}

async function releaseAll($: $, { lockRoot: root }: Project, owner: string) {
  const released: string[] = []
  await update($, locks, (all) => {
    released.length = 0
    const kept: Record<string, Lock> = {}
    for (const [key, lock] of Object.entries(all)) {
      if (lock.owner === owner && key.startsWith(`${root}\n`)) {
        released.push(key.slice(root.length + 1))
      } else kept[key] = lock
    }
    return kept
  })
  return released
}

async function unlock($: $, project: Project, owner: string, target: string) {
  const key = lockKey(project.lockRoot, target)
  await update($, locks, (all) => {
    if (all[key]?.owner !== owner) return all
    const { [key]: _, ...rest } = all
    return rest
  })
}

/** The deny message, or undefined when the agent holds the lock. */
async function lockTarget(
  $: $,
  project: Project,
  binding: Binding,
  target: string,
  step: Step,
): Promise<string | undefined> {
  const active = await activeCommentIds($, project)
  if (active && !active.has(binding.comment)) {
    return `Comment ${binding.comment} was cancelled, resolved or deleted by the reader. Stop now: make no further changes and reply "CANCELLED".`
  }
  const relativeTarget =
    target === '@build'
      ? target
      : relative(project.lockRoot, resolve(project.root, target))
  if (relativeTarget === undefined) return undefined
  const deadline = (await $.clock.now()) + LOCK_WAIT_MS
  for (;;) {
    const holder = await tryLock($, project, binding.comment, relativeTarget)
    if (holder === undefined) return undefined
    if ((await $.clock.now()) >= deadline) {
      const released = await releaseAll($, project, binding.comment)
      await record($, project, binding.comment, [
        {
          ...step,
          state: 'failed',
          error: `${relativeTarget} is being changed by another comment's agent`,
        },
      ])
      return (
        `${relativeTarget} is being changed by the agent of comment ${holder}. ` +
        `Your ${released.length} lock(s) were released to avoid a deadlock: ` +
        're-read the files you are changing, then retry this step.'
      )
    }
    await $.clock.sleep(LOCK_POLL_MS)
  }
}

async function bindingOf($: $, agent: string) {
  return (await read($, bindings))[agent]
}

async function setBinding($: $, agent: string, binding: Binding | undefined) {
  const all = await update($, bindings, (current) => {
    const { [agent]: _, ...rest } = current
    return binding ? { ...rest, [agent]: binding } : rest
  })
  const count = Object.keys(all).length
  $.ui.status(count ? `code-buddy: ${count} agent(s) on comments` : undefined)
}

async function finish($: $, agent: string, project: Project, comment: string) {
  await setBinding($, agent, undefined)
  await releaseAll($, project, comment)
  const file = `${project.progressDir}/${comment}.jsonl`
  await writes.get(file)
  writes.delete(file)
  await $.process.run(['rm', '-f', file])
}

/**
 * claim.mjs binds the agent to its comment; resolve.mjs and ask.mjs end its
 * run. A failed chained command may still have run one: its output and the
 * comment's state tell. Returns true when the run ended.
 */
async function followScripts($: $, agent: string, command: string, output: string) {
  const ended = command.match(RESOLVE)?.[1]
  const binding = await bindingOf($, agent)
  if (ended && binding?.comment === ended) {
    const project = await projectOf($, agent, binding)
    const active = project && (await activeCommentIds($, project))
    if (project && !active?.has(ended)) {
      await finish($, agent, project, ended)
      return true
    }
  }
  const claimed = CLAIMED.exec(output)
  if (claimed?.[1] && claimed[2]) {
    await setBinding($, agent, {
      root: normalize(claimed[2].trim()),
      comment: claimed[1],
    })
  }
  return false
}

/** The bound project, or undefined, unbinding the agent, when it cannot be read. */
async function projectOf($: $, agent: string, binding: Binding) {
  try {
    return await loadProject($, binding.root)
  } catch {
    await setBinding($, agent, undefined)
    return undefined
  }
}

export const register: Register = (on) => {
  // Tells server.mjs, started from this session, that the hooks are loaded:
  // without them, agents would work with no locks and no progress.
  on('session.start', async ($, e, next) => {
    await $.env.set('CODE_BUDDY_HOOKS', '1')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (INTERNAL_TOOLS.has(e.tool)) return next(e)
    const agent = e.agentId ?? 'main'
    // The tool's string arguments, beside the envelope (`e.command` for Bash).
    const args: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(e)) {
      if (typeof value === 'string') args[key] = value
    }
    const binding = await bindingOf($, agent)
    const project = binding && (await projectOf($, agent, binding))
    if (binding && project) {
      const step = {
        at: Date.now(),
        id: e.tool_use_id,
        ...describe(project, e.tool, args),
      }
      if (e.tool === 'Bash' && writesFromBash(args.command ?? '', project)) {
        await record($, project, binding.comment, [
          {
            ...step,
            state: 'failed',
            error: 'writes files from Bash; use Edit or Write',
          },
        ])
        return {
          deny:
            'This command writes files from Bash, where Code Buddy cannot lock them against ' +
            "the other comments' agents. Make the change with the Edit or Write tool instead.",
        }
      }
      const target = writeTarget(e.tool, args)
      if (target) {
        const deny = await lockTarget($, project, binding, target, step)
        if (deny) return { deny }
      }
      await record($, project, binding.comment, [{ ...step, state: 'running' }])
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    const command = e.tool === 'Bash' ? (args.command ?? '') : ''
    if (await followScripts($, agent, command, ran.text ?? '')) return ran
    // Read again: claim.mjs may have just bound the agent.
    const bound = await bindingOf($, agent)
    const boundProject = bound && (await projectOf($, agent, bound))
    if (!bound || !boundProject) return ran
    // A failed build frees the build lock as a successful one does.
    if (BUILD.test(command)) await unlock($, boundProject, bound.comment, '@build')
    const step: Step = {
      at: Date.now(),
      id: e.tool_use_id,
      ...describe(boundProject, e.tool, args),
      state: ran.isError ? 'failed' : 'done',
    }
    if (ran.isError) step.error = short((ran.text ?? '').trim().split('\n')[0] ?? '', 160)
    await record($, boundProject, bound.comment, [step])
    return ran
  })

  // The agent's thinking (often redacted, then an empty label) and the
  // messages it writes between its tool calls.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (!e.agentId || e.message.type !== 'assistant') return stored
    const binding = await bindingOf($, e.agentId)
    const project = binding && (await projectOf($, e.agentId, binding))
    if (!binding || !project) return stored
    const content: { type?: string; thinking?: string; text?: string }[] = Array.isArray(
      e.message.content,
    )
      ? e.message.content
      : []
    const at = Date.now()
    const steps: Step[] = []
    for (const block of content) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        steps.push({ at, kind: 'thinking', label: clip(block.thinking ?? '') })
      } else if (block.type === 'text' && block.text?.trim()) {
        steps.push({ at, kind: 'message', label: clip(block.text) })
      }
    }
    await record($, project, binding.comment, steps)
    return stored
  })

  // SubagentStop: a stopped agent holds nothing; resumed for a follow-up, it
  // claims its comment again.
  on('turn.complete', async ($, e, next) => {
    const binding = e.agentId ? await bindingOf($, e.agentId) : undefined
    if (e.agentId && binding) {
      const project = await projectOf($, e.agentId, binding)
      if (project) await releaseAll($, project, binding.comment)
      await setBinding($, e.agentId, undefined)
    }
    return next(e)
  })
}
