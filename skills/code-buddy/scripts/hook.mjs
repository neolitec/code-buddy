#!/usr/bin/env node
// Claude Code hook (PreToolUse, PostToolUse, SubagentStop) registered by the
// skill. Inert for any agent that has not claimed a comment with claim.mjs.
import path from 'node:path'
import { appendProgress, bind, bindingOf, dropProgress, unbind } from './lib/agents.mjs'
import { createLocks } from './lib/locks.mjs'
import { project as loadProject } from './lib/project.mjs'

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

async function preToolUse(agent, tool, input) {
  const binding = await bindingOf(agent)
  const target = binding && writeTarget(tool, input)
  if (!target) return
  const project = loadProject(binding.root)
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
  await createLocks(project).releaseAll(comment)
  await dropProgress(project, comment)
}

async function postToolUse(agent, tool, input) {
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
  await appendProgress(project, binding.comment, {
    at: Date.now(),
    ...describe(project.root, tool, input),
  })
}

const input = await readInput()
const agent = input.agent_id ?? `session-${input.session_id}`
try {
  if (input.hook_event_name === 'PreToolUse') {
    await preToolUse(agent, input.tool_name, input.tool_input ?? {})
  } else if (input.hook_event_name === 'PostToolUse') {
    await postToolUse(agent, input.tool_name, input.tool_input ?? {})
  } else if (input.hook_event_name === 'SubagentStop' && input.agent_id) {
    const binding = await bindingOf(input.agent_id)
    if (binding) {
      await createLocks(loadProject(binding.root)).releaseAll(binding.comment)
    }
  }
} catch (error) {
  process.stderr.write(`code-buddy hook: ${error.message}\n`)
}
