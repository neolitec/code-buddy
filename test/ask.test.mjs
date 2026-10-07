import assert from 'node:assert/strict'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects

before(async (t) => {
  process.env.CODE_BUDDY_STATE_DIR = await tempDir(t)
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
})

async function setUp(t) {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    url: 'http://localhost/',
    body: 'Rework the cards',
  })
  /** @param {string[]} args */
  const ask = (...args) =>
    run(process.execPath, [
      path.join(SCRIPTS, 'ask.mjs'),
      comment.id,
      '--project',
      root,
      ...args,
    ])
  return { comments, comment, ask }
}

test('asks a question with options, the reader picking several', async (t) => {
  const { comments, ask } = await setUp(t)
  const asked = await ask(
    'Which layouts?',
    '--option',
    'Grid: Cards in a grid: three per row',
    '--option',
    'List',
    '--multiple',
  )
  assert.equal(asked.code, 0, asked.stderr)
  const [saved] = await comments.readAll()
  assert.ok(store.isAsking(saved))
  assert.deepEqual(saved.messages.at(-1), {
    author: 'claude',
    body: 'Which layouts?',
    at: saved.askedAt,
    question: true,
    options: [
      { label: 'Grid', description: 'Cards in a grid: three per row' },
      { label: 'List' },
    ],
    multiple: true,
  })
})

test('refuses one option, or the same label twice, and asks nothing', async (t) => {
  const { comments, ask } = await setUp(t)
  for (const options of [
    ['--option', 'Grid'],
    ['--option', 'Grid', '--option', 'Grid: again'],
    ['--multiple'],
  ]) {
    const asked = await ask('Which layout?', ...options)
    assert.equal(asked.code, 2)
    assert.match(asked.stderr, /--option "<label>: <description>"/)
  }
  const [saved] = await comments.readAll()
  assert.ok(store.isActive(saved))
})
