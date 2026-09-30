import assert from 'node:assert/strict'
import { appendFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { tempDir } from './helpers.mjs'

/** @type {typeof import('../skills/code-buddy/scripts/lib/transcript.mjs')} */
let transcript

before(async (t) => {
  // The state folder is read once, when the modules load.
  process.env.CODE_BUDDY_STATE_DIR = await tempDir(t)
  transcript = await import('../skills/code-buddy/scripts/lib/transcript.mjs')
})

const assistant = (...content) =>
  `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-30T10:00:00.000Z', message: { content } })}\n`

test('starts from the end: what came before the claim is not shown', async (t) => {
  const file = path.join(await tempDir(t), 'agent.jsonl')
  await writeFile(file, assistant({ type: 'text', text: 'before the claim' }))
  await transcript.followTranscript('agent-a', file)
  assert.deepEqual(await transcript.newTranscriptSteps('agent-a'), [])
  await appendFile(file, assistant({ type: 'text', text: 'after the claim' }))
  const steps = await transcript.newTranscriptSteps('agent-a')
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label]),
    [['message', 'after the claim']],
  )
})

test('shows thinking, redacted or summarised, and skips tool calls', async (t) => {
  const file = path.join(await tempDir(t), 'agent.jsonl')
  await writeFile(file, '')
  await transcript.followTranscript('agent-b', file)
  await appendFile(
    file,
    assistant(
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'thinking', thinking: 'Check the header first.', signature: 'y' },
      { type: 'tool_use', name: 'Read', input: {} },
    ),
  )
  const steps = await transcript.newTranscriptSteps('agent-b')
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label]),
    [
      ['thinking', ''],
      ['thinking', 'Check the header first.'],
    ],
  )
})

test('waits for a line still being written', async (t) => {
  const file = path.join(await tempDir(t), 'agent.jsonl')
  await writeFile(file, '')
  await transcript.followTranscript('agent-c', file)
  const line = assistant({ type: 'text', text: 'whole' })
  await appendFile(file, line.slice(0, 20))
  assert.deepEqual(await transcript.newTranscriptSteps('agent-c'), [])
  await appendFile(file, line.slice(20))
  assert.equal((await transcript.newTranscriptSteps('agent-c')).length, 1)
})

test('gives each block to one caller only when hooks run in parallel', async (t) => {
  const file = path.join(await tempDir(t), 'agent.jsonl')
  await writeFile(file, '')
  await transcript.followTranscript('agent-d', file)
  await appendFile(
    file,
    assistant({ type: 'thinking', thinking: 'once', signature: 'x' }) +
      assistant({ type: 'text', text: 'once too' }),
  )
  const results = await Promise.all(
    Array.from({ length: 5 }, () => transcript.newTranscriptSteps('agent-d')),
  )
  assert.equal(results.flat().length, 2)
})

test('returns nothing for an agent it does not follow', async () => {
  assert.deepEqual(await transcript.newTranscriptSteps('nobody'), [])
})
