import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FORMAT_VERSION,
  FormatError,
  STATES,
  TRANSITIONS,
  canMove,
  currentRun,
  nextMessageId,
  nextRunId,
  parseFile,
  wasResolved,
} from '../skills/code-buddy/scripts/lib/format.mjs'

/** @type {[import('../skills/code-buddy/scripts/lib/format.mjs').State, import('../skills/code-buddy/scripts/lib/format.mjs').State][]} */
const ALLOWED = [
  ['open', 'working'],
  ['open', 'stopped'],
  ['open', 'resolved'],
  ['working', 'asking'],
  ['working', 'resolved'],
  ['working', 'stopped'],
  ['working', 'answered'],
  ['asking', 'open'],
  ['asking', 'resolved'],
  ['answered', 'open'],
  ['answered', 'resolved'],
  ['stopped', 'open'],
  ['stopped', 'resolved'],
  ['resolved', 'open'],
]

test('allows every move of the graph, and no other', () => {
  for (const [from, to] of ALLOWED) assert.ok(canMove(from, to), `${from} → ${to}`)
  for (const from of STATES) {
    for (const to of STATES) {
      const allowed = ALLOWED.some(([a, b]) => a === from && b === to)
      assert.equal(canMove(from, to), allowed, `${from} → ${to}`)
    }
  }
  // One forbidden move per state, as the agents and the reader could try them.
  assert.equal(canMove('open', 'asking'), false)
  assert.equal(canMove('working', 'open'), false)
  assert.equal(canMove('asking', 'working'), false)
  assert.equal(canMove('stopped', 'working'), false)
  assert.equal(canMove('resolved', 'working'), false)
  assert.equal(canMove('answered', 'working'), false)
  assert.deepEqual(Object.keys(TRANSITIONS), [...STATES])
})

test('numbers messages and runs in sequence, per comment', () => {
  assert.equal(nextMessageId({ messages: [] }), 'm1')
  const messages = [
    { id: 'm1', author: /** @type {const} */ ('reader'), body: 'a', at: '' },
    { id: 'm2', author: /** @type {const} */ ('claude'), body: 'b', at: '' },
  ]
  assert.equal(nextMessageId({ messages }), 'm3')
  assert.equal(nextRunId({ events: [{ at: '', state: 'open', by: 'reader' }] }), 'r1')
  const events = /** @type {const} */ ([
    { at: '', state: 'open', by: 'reader' },
    { at: '', state: 'working', by: 'agent', run: 'r1' },
    { at: '', state: 'asking', by: 'agent', run: 'r1' },
    { at: '', state: 'open', by: 'reader' },
  ])
  assert.equal(nextRunId({ events: [...events] }), 'r2')
  assert.equal(currentRun({ state: 'asking', events: [...events] }), undefined)
  assert.equal(
    currentRun({
      state: 'working',
      events: [...events, { at: '', state: 'working', by: 'agent', run: 'r2' }],
    }),
    'r2',
  )
})

test('reads an envelope of its version', () => {
  const file = parseFile(JSON.stringify({ version: FORMAT_VERSION, comments: [] }))
  assert.deepEqual(file, { version: 2, comments: [] })
})

test('refuses a bare array, the old format, saying what to delete', () => {
  assert.throws(
    () => parseFile('[]', '/app/.code-buddy/comments.json'),
    (error) =>
      error instanceof FormatError &&
      error.message === 'old comments format: delete /app/.code-buddy/comments.json',
  )
})

test('refuses another version', () => {
  assert.throws(
    () => parseFile(JSON.stringify({ version: 3, comments: [] })),
    /unknown comments format \(version 3\)/,
  )
})

test('knows a comment resolved once, even open again', () => {
  const open = {
    at: '',
    state: /** @type {const} */ ('open'),
    by: /** @type {const} */ ('reader'),
  }
  assert.equal(wasResolved({ events: [open] }), false)
  assert.equal(
    wasResolved({
      events: [open, { at: '', state: 'resolved', by: 'reader' }, open],
    }),
    true,
  )
})
