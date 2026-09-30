#!/usr/bin/env node
// Claude Code hook (PreToolUse, PostToolUse, PostToolUseFailure, SubagentStop)
// registered by the skill. Inert for any agent that has not claimed a comment
// with claim.mjs. For one that has, it takes the file locks and records each
// step for the widget: tools as they start, end or fail, and the thinking and
// messages read from the agent's transcript.
import path from 'node:path'
import { appendProgress, bind, bindingOf, dropProgress, unbind } from './lib/agents.mjs'
import { createLocks } from './lib/locks.mjs'
import { project as loadProject } from './lib/project.mjs'
import {
  followTranscript,
  forgetTranscript,
  newTranscriptSteps,
} from './lib/transcript.mjs'

const LOCK_TIMEOUT_S = Number(process.env.CODE_BUDDY_LOCK_TIMEOUT_S ?? 45)
const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
const CLAIM = /scripts\/claim\.mjs\s+(\S+)/
const RESOLVE = /scripts\/resolve\.mjs\s+(\S+)/
const PROJECT = /--project\s+("[^"]+"|'[^']+'|\S+)/

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
        ? { kind: 'skill', label: 'Started' }
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

/** Records what the transcript shows since the last step, then `step`. */
async function record(agent, project, comment, step) {
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

async function postToolUse(agent, tool, input, toolUseId, transcript) {
  const command = tool === 'Bash' ? (input.command ?? '') : ''
  const claim = command.match(CLAIM)
  const resolve = command.match(RESOLVE)
  const root = command.match(PROJECT)?.[1]
  if (claim && root) {
    if (/\s--release\b/.test(command)) {
      await finish(agent, unquote(root), claim[1])
      return
    }
    await bind(agent, path.resolve(unquote(root)), claim[1])
    await followTranscript(agent, transcript)
  }
  if (resolve && root) {
    await finish(agent, path.resolve(unquote(root)), resolve[1])
    return
  }
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

async function postToolUseFailure(agent, tool, input, toolUseId, error) {
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
// A subagent's own transcript; the main session's when the hook runs there.
const transcript = input.agent_transcript_path ?? input.transcript_path
const tool = input.tool_name
const toolInput = input.tool_input ?? {}
try {
  if (input.hook_event_name === 'PreToolUse') {
    await preToolUse(agent, tool, toolInput, input.tool_use_id)
  } else if (input.hook_event_name === 'PostToolUse') {
    await postToolUse(agent, tool, toolInput, input.tool_use_id, transcript)
  } else if (input.hook_event_name === 'PostToolUseFailure') {
    await postToolUseFailure(agent, tool, toolInput, input.tool_use_id, input.error)
  } else if (input.hook_event_name === 'SubagentStop' && input.agent_id) {
    const binding = await bindingOf(input.agent_id)
    if (binding) {
      await createLocks(loadProject(binding.root)).releaseAll(binding.comment)
    }
    await forgetTranscript(input.agent_id)
  }
} catch (error) {
  process.stderr.write(
    `code-buddy hook: ${error instanceof Error ? error.message : String(error)}\n`,
  )
}
