// A tool call as Claude Code recorded it in its transcripts, for the dev
// widget's debug panel: what the agent sent and what it got back.
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** A Claude Code tool_use_id: nothing else reaches the file system. */
export const TOOL_ID = /^toolu_[A-Za-z0-9]{8,64}$/

// Only recent transcripts are read: a comment's runs are hours old, not months.
const RECENT_MS = 7 * 24 * 60 * 60 * 1000
// A result can be a whole file: the panel shows its start.
const MAX_RESULT = 20_000

/** Where Claude Code keeps its transcripts: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function transcriptsDir() {
  const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
  return path.join(config, 'projects')
}

/**
 * The transcripts under `dir` modified since `since`, newest first.
 * @param {string} dir
 * @param {number} since
 * @returns {Promise<{ file: string, mtime: number }[]>}
 */
async function recentTranscripts(dir, since) {
  /** @type {{ file: string, mtime: number }[]} */
  const found = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await recentTranscripts(full, since)))
    } else if (entry.name.endsWith('.jsonl')) {
      const { mtimeMs } = await stat(full)
      if (mtimeMs >= since) found.push({ file: full, mtime: mtimeMs })
    }
  }
  return found
}

/**
 * A tool result's text: a string, or text blocks.
 * @param {unknown} content
 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block?.type === 'text' ? String(block.text) : `[${block?.type}]`))
    .join('\n')
}

/**
 * The call `id` and its result, from the newest transcript that has it.
 * @param {string} id
 * @param {{ dir?: string, now?: number }} [options]
 * @returns {Promise<{ transcript: string, name: string, input: unknown, result?: string, error?: boolean } | undefined>}
 */
export async function findToolCall(
  id,
  { dir = transcriptsDir(), now = Date.now() } = {},
) {
  if (!TOOL_ID.test(id)) return undefined
  const transcripts = (await recentTranscripts(dir, now - RECENT_MS)).toSorted(
    (a, b) => b.mtime - a.mtime,
  )
  for (const { file } of transcripts) {
    const text = await readFile(file, 'utf8').catch(() => '')
    if (!text.includes(id)) continue
    /** @type {{ name: string, input: unknown } | undefined} */
    let call
    /** @type {{ result: string, error: boolean } | undefined} */
    let outcome
    for (const line of text.split('\n')) {
      if (!line.includes(id)) continue
      let content
      try {
        content = JSON.parse(line).message?.content
      } catch {
        continue
      }
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'tool_use' && block.id === id) {
          call = { name: String(block.name), input: block.input }
        } else if (block?.type === 'tool_result' && block.tool_use_id === id) {
          const result = textOf(block.content)
          outcome = {
            result:
              result.length > MAX_RESULT ? `${result.slice(0, MAX_RESULT)}\n…` : result,
            error: block.is_error === true,
          }
        }
      }
    }
    // A transcript that only quotes the id (the manager's) is not the call's.
    if (call) return { transcript: file, ...call, ...outcome }
  }
  return undefined
}
