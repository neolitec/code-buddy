// Follows a subagent's transcript to show what hooks cannot: its thinking and
// the messages it writes between tool calls. Claude Code writes the transcript
// asynchronously, so a step may show one tool call late.
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AGENTS_DIR } from './project.mjs'

const MAX_TEXT = 400

/** @typedef {{ at: number, kind: 'thinking' | 'message', label: string }} TranscriptStep */

/** @param {string} agent */
const cursorFile = (agent) =>
  path.join(AGENTS_DIR, `${encodeURIComponent(agent)}.transcript`)

/** @param {string} text */
const clip = (text) => {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat
}

/**
 * Starts following `file` from its current end: what the agent did before it
 * claimed its comment is not the comment's work.
 * @param {string} agent
 * @param {string | undefined} file
 */
export async function followTranscript(agent, file) {
  if (!file) return
  let offset = 0
  try {
    offset = (await stat(file)).size
  } catch {}
  await mkdir(AGENTS_DIR, { recursive: true })
  await writeFile(cursorFile(agent), JSON.stringify({ file, offset }))
}

/** @param {string} agent */
export async function forgetTranscript(agent) {
  await rm(cursorFile(agent), { force: true })
}

/**
 * The thinking and messages the agent wrote since the last call, oldest first.
 * The API often redacts thinking: such a step has an empty label.
 * @param {string} agent
 * @returns {Promise<TranscriptStep[]>}
 */
export async function newTranscriptSteps(agent) {
  /** @type {{ file: string, offset: number }} */
  let cursor
  try {
    cursor = JSON.parse(await readFile(cursorFile(agent), 'utf8'))
  } catch {
    return []
  }
  let handle
  try {
    handle = await open(cursor.file, 'r')
  } catch {
    return []
  }
  try {
    const { size } = await handle.stat()
    if (size <= cursor.offset) return []
    const buffer = Buffer.alloc(size - cursor.offset)
    await handle.read(buffer, 0, buffer.length, cursor.offset)
    // Whole lines only: a line still being written waits for the next call.
    const end = buffer.lastIndexOf(0x0a)
    if (end === -1) return []
    await writeFile(
      cursorFile(agent),
      JSON.stringify({ ...cursor, offset: cursor.offset + end + 1 }),
    )
    return buffer.subarray(0, end).toString('utf8').split('\n').flatMap(stepsOf)
  } finally {
    await handle.close()
  }
}

/**
 * @param {string} line
 * @returns {TranscriptStep[]}
 */
function stepsOf(line) {
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return []
  }
  const content = entry?.type === 'assistant' ? entry.message?.content : undefined
  if (!Array.isArray(content)) return []
  const at = Date.parse(entry.timestamp) || Date.now()
  /** @type {TranscriptStep[]} */
  const steps = []
  for (const block of content) {
    if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
      steps.push({ at, kind: 'thinking', label: clip(block.thinking ?? '') })
    } else if (
      block?.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.trim()
    ) {
      steps.push({ at, kind: 'message', label: clip(block.text) })
    }
  }
  return steps
}
