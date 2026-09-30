#!/usr/bin/env node
// Claude Code hook (PreToolUse, PostToolUse, PostToolUseFailure, SubagentStop)
// registered by the skill. Inert for any agent that has not claimed a comment
// with claim.mjs. For one that has, it takes the file locks and records each
// step for the widget: tools as they start, end or fail, and the thinking and
// messages read from the agent's transcript.
import path from 'node:path'
import {
  appendProgress,
  bind,
  bindingOf,
  dropProgress,
  pruneBindings,
  touchBinding,
  unbind,
} from './lib/agents.mjs'
import { createLocks } from './lib/locks.mjs'
import { project as loadProject } from './lib/project.mjs'
import {
  followTranscript,
  forgetTranscript,
  newTranscriptSteps,
} from './lib/transcript.mjs'

const LOCK_TIMEOUT_S = Number(process.env.CODE_BUDDY_LOCK_TIMEOUT_S ?? 45)
const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
// A word ends at a shell separator as well as at a space: agents chain
// `claim.mjs <id> --project <dir>; …`, and a `;` kept in the path bound the
// agent to a project that does not exist, so none of its steps were recorded.
const WORD = String.raw`[^\s;&|()<>]+`
const CLAIM = new RegExp(String.raw`scripts/claim\.mjs\s+(${WORD})`)
// A question ends the run as an answer does: ask.mjs files the steps itself.
const RESOLVE = new RegExp(String.raw`scripts/(?:resolve|ask)\.mjs\s+(${WORD})`)
const PROJECT = new RegExp(String.raw`--project\s+("[^"]+"|'[^']+'|${WORD})`)

async function readInput() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return JSON.parse(raw)
}

const short = (text, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function writeTarget(tool, input) {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    return input.file_path
  }
  if (tool === 'NotebookEdit') return input.notebook_path
  if (tool === 'Bash' && BUILD.test(input.command ?? '')) return '@build'
  return undefined
}

function describe(root, tool, input) {
  const repoPath = (file) => {
    const relative = path.relative(root, path.resolve(root, file ?? ''))
    return relative.startsWith('..') ? path.basename(file ?? '') : relative
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
      return { kind: tool.toLowerCase(), label: repoPath(input.file_path) }
    case 'NotebookEdit':
      return { kind: 'edit', label: repoPath(input.notebook_path) }
    case 'Bash':
      return CLAIM.test(input.command ?? '')
        ? { kind: 'start', label: 'Started' }
        : { kind: 'bash', label: short(input.description || input.command || '') }
    case 'Grep':
    case 'Glob':
      return { kind: 'search', label: short(input.pattern ?? '') }
    case 'WebFetch':
      return {
        kind: 'web',
        label: URL.canParse(input.url) ? new URL(input.url).host : 'web',
      }
    case 'WebSearch':
      return { kind: 'web', label: short(input.query ?? '') }
    case 'Skill':
      return { kind: 'skill', label: input.skill }
    default:
      return { kind: 'tool', label: tool }
  }
}

const unquote = (value) => value.replace(/^["']|["']$/g, '')

// Claude Code's own plumbing, not the agent's work.
const INTERNAL_TOOLS = new Set(['SubagentHandback'])

/**
 * The agent's own transcript. In a subagent, tool events carry no
 * agent_transcript_path, only the session's transcript_path: the subagent's
 * transcript sits next to it, in <session>/subagents/agent-<id>.jsonl.
 */
function transcriptOf(input) {
  if (input.agent_transcript_path) return input.agent_transcript_path
  const session = input.transcript_path
  if (input.agent_id && typeof session === 'string' && session.endsWith('.jsonl')) {
    return path.join(
      session.slice(0, -'.jsonl'.length),
      'subagents',
      `agent-${input.agent_id}.jsonl`,
    )
  }
  return session
}

/**
 * Records what the transcript shows since the last step, then `step`. Nothing
 * for a comment the reader cancelled, resolved or deleted, or that waits on
 * their answer: an agent keeps calling tools until it is stopped, and those
 * steps would recreate the progress file and end up under the next run.
 */
async function record(agent, project, comment, step) {
  const active = await createLocks(project).activeCommentIds()
  if (active && !active.has(comment)) return
  await touchBinding(agent)
  await appendProgress(project, comment, ...(await newTranscriptSteps(agent)), step)
}

async function preToolUse(agent, tool, input, toolUseId) {
  const binding = await bindingOf(agent)
  if (!binding) return
  const project = loadProject(binding.root)
  const step = { at: Date.now(), id: toolUseId, ...describe(project.root, tool, input) }
  const target = writeTarget(tool, input)
  if (target) await lockTarget(agent, project, binding, target, step)
  await record(agent, project, binding.comment, { ...step, state: 'running' })
}

async function lockTarget(agent, project, binding, target, step) {
  const locks = createLocks(project)
  const active = await locks.activeCommentIds()
  if (active && !active.has(binding.comment)) {
    process.stderr.write(
      `Comment ${binding.comment} was cancelled, resolved or deleted by the reader. Stop now: make no further changes and reply "CANCELLED".\n`,
    )
    process.exit(2)
  }
  let relative
  try {
    relative = locks.relativeTarget(target)
  } catch {
    return
  }
  const result = await locks.acquire(binding.comment, [relative], LOCK_TIMEOUT_S)
  if (result.ok) return
  await record(agent, project, binding.comment, {
    ...step,
    state: 'failed',
    error: `${result.target} is being changed by another comment's agent`,
  })
  process.stderr.write(
    `${result.target} is being changed by the agent of comment ${result.holder}. ` +
      `Your ${result.released.length} lock(s) were released to avoid a deadlock: ` +
      're-read the files you are changing, then retry this step.\n',
  )
  process.exit(2)
}

async function finish(agent, root, comment) {
  const project = loadProject(root)
  await unbind(agent)
  await forgetTranscript(agent)
  await createLocks(project).releaseAll(comment)
  await dropProgress(project, comment)
}

/**
 * Follows the agent's own scripts. claim.mjs binds the agent to its comment;
 * resolve.mjs and ask.mjs end its run. They run in Bash commands that may
 * chain other commands, so a failed command can still have run one of them:
 * the comment's state tells whether it did.
 * @returns {Promise<boolean>} true when the run ended, and there is nothing to record
 */
async function followScripts(agent, command, transcript) {
  const root = command.match(PROJECT)?.[1]
  if (!root) return false
  const projectRoot = path.resolve(unquote(root))
  const claim = command.match(CLAIM)
  const ended = command.match(RESOLVE)
  if (ended) {
    const project = loadProject(projectRoot)
    const active = await createLocks(project).activeCommentIds()
    if (!active?.has(ended[1])) {
      await finish(agent, projectRoot, ended[1])
      return true
    }
  }
  if (claim) {
    await pruneBindings()
    await bind(agent, projectRoot, claim[1])
    await followTranscript(agent, transcript)
  }
  return false
}

async function postToolUse(agent, tool, input, toolUseId, transcript) {
  const command = tool === 'Bash' ? (input.command ?? '') : ''
  if (await followScripts(agent, command, transcript)) return
  const binding = await bindingOf(agent)
  if (!binding) return
  const project = loadProject(binding.root)
  if (BUILD.test(command)) {
    await createLocks(project).unlock(binding.comment, '@build')
  }
  await record(agent, project, binding.comment, {
    at: Date.now(),
    id: toolUseId,
    ...describe(project.root, tool, input),
    state: 'done',
  })
}

async function postToolUseFailure(agent, tool, input, toolUseId, error, transcript) {
  const command = tool === 'Bash' ? (input.command ?? '') : ''
  if (await followScripts(agent, command, transcript)) return
  const binding = await bindingOf(agent)
  if (!binding) return
  const project = loadProject(binding.root)
  // A failed build must free the build lock as a successful one does.
  if (tool === 'Bash' && BUILD.test(input.command ?? '')) {
    await createLocks(project).unlock(binding.comment, '@build')
  }
  await record(agent, project, binding.comment, {
    at: Date.now(),
    id: toolUseId,
    ...describe(project.root, tool, input),
    state: 'failed',
    error: short(
      String(error ?? '')
        .trim()
        .split('\n')[0] ?? '',
      160,
    ),
  })
}

const input = await readInput()
const agent = input.agent_id ?? `session-${input.session_id}`
const transcript = transcriptOf(input)
const tool = input.tool_name
const toolInput = input.tool_input ?? {}
try {
  if (INTERNAL_TOOLS.has(tool)) {
    // Nothing to lock or show.
  } else if (input.hook_event_name === 'PreToolUse') {
    await preToolUse(agent, tool, toolInput, input.tool_use_id)
  } else if (input.hook_event_name === 'PostToolUse') {
    await postToolUse(agent, tool, toolInput, input.tool_use_id, transcript)
  } else if (input.hook_event_name === 'PostToolUseFailure') {
    await postToolUseFailure(
      agent,
      tool,
      toolInput,
      input.tool_use_id,
      input.error,
      transcript,
    )
  } else if (input.hook_event_name === 'SubagentStop' && input.agent_id) {
    // A stopped agent holds nothing: an agent resumed for a follow-up claims
    // its comment again. An unbound agent also lets hook.sh skip Node.
    const binding = await bindingOf(input.agent_id)
    if (binding) {
      await createLocks(loadProject(binding.root)).releaseAll(binding.comment)
    }
    await unbind(input.agent_id)
    await forgetTranscript(input.agent_id)
  }
} catch (error) {
  process.stderr.write(
    `code-buddy hook: ${error instanceof Error ? error.message : String(error)}\n`,
  )
}
