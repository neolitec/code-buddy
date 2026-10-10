// The debug panel's tool calls, read from Claude Code's transcripts.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { findToolCall } from '../skills/code-buddy/scripts/lib/transcripts.mjs'
import { tempDir } from './helpers.mjs'

const ID = 'toolu_01EYsupHGk3ov4ydNDsUL5XG'
const line = (content) => `${JSON.stringify({ message: { content } })}\n`

test('finds a call and its result in the agent transcript, not where it is quoted', async (t) => {
  const dir = await tempDir(t)
  const session = path.join(dir, '-repo', 'session')
  await mkdir(path.join(session, 'subagents'), { recursive: true })
  // The manager's transcript only mentions the id.
  await writeFile(`${session}.jsonl`, line([{ type: 'text', text: `see ${ID}` }]))
  const agent = path.join(session, 'subagents', 'agent-a1.jsonl')
  await writeFile(
    agent,
    line([
      { type: 'tool_use', id: ID, name: 'Bash', input: { command: 'node ask.mjs' } },
    ]) +
      line([
        {
          type: 'tool_result',
          tool_use_id: ID,
          content: [{ type: 'text', text: 'asked c1' }],
        },
      ]),
  )

  assert.deepEqual(await findToolCall(ID, { dir }), {
    transcript: agent,
    name: 'Bash',
    input: { command: 'node ask.mjs' },
    result: 'asked c1',
    error: false,
  })
})

test('reads nothing for an id that is not a tool call, or one too old', async (t) => {
  const dir = await tempDir(t)
  await writeFile(
    path.join(dir, 'old.jsonl'),
    line([{ type: 'tool_use', id: ID, name: 'Read', input: {} }]),
  )
  assert.equal(await findToolCall('../../etc/passwd', { dir }), undefined)
  const inAMonth = Date.now() + 30 * 24 * 60 * 60 * 1000
  assert.equal(await findToolCall(ID, { dir, now: inAMonth }), undefined)
  assert.equal((await findToolCall(ID, { dir }))?.name, 'Read')
})
