import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { tempDir, tempProject } from './helpers.mjs'

/** Writes steps as the hooks module does, one JSON line each. */
async function appendProgress(project, comment, ...steps) {
  await mkdir(project.progressDir, { recursive: true })
  await appendFile(
    path.join(project.progressDir, `${comment}.jsonl`),
    steps.map((step) => `${JSON.stringify(step)}\n`).join(''),
  )
}

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
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    url: 'http://localhost/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  return { project, comments, comment }
}

const claim = (comments, id) => comments.claim(id)

/**
 * The reader's move, on a comment the test knows exists.
 * @param {ReturnType<typeof store.createStore>} comments
 * @param {string} id
 * @param {Parameters<ReturnType<typeof store.createStore>['update']>[1]} patch
 */
async function update(comments, id, patch) {
  const updated = await comments.update(id, patch)
  assert.ok(updated)
  return updated
}

/** @template T @param {T[]} list @returns {T} */
const lastOf = (list) => list[list.length - 1]

/** The states the comment went through, oldest first. */
const statesOf = (comment) => comment.events.map((event) => event.state)

test('an answer resolves the comment, without the run log in comments.json', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 1,
    kind: 'thinking',
    label: 'secret plan',
  })
  await comments.answer(comment.id, 'Done: it is blue now.')
  const [saved] = await comments.readAll()
  assert.equal(saved.state, 'resolved')
  assert.deepEqual(statesOf(saved), ['open', 'working', 'resolved'])
  // The whole thread, the reader's comment first; the answer names its run.
  assert.deepEqual(
    saved.messages.map((m) => [m.id, m.author, m.body, m.run]),
    [
      ['m1', 'reader', 'Make it blue', undefined],
      ['m2', 'claude', 'Done: it is blue now.', 'r1'],
    ],
  )
  const file = JSON.parse(await readFile(project.commentsFile, 'utf8'))
  assert.equal(file.version, 2)
  assert.doesNotMatch(await readFile(project.commentsFile, 'utf8'), /secret plan/)
  assert.equal(existsSync(path.join(project.progressDir, `${comment.id}.jsonl`)), false)
})

test('a question leaves the comment open, waiting on the reader', async (t) => {
  const { comments, comment } = await setUp(t)
  const asked = await comments.answer(comment.id, 'Which blue?', { question: true })
  assert.equal(asked.state, 'asking')
  assert.equal(store.isActive(asked), false)
  assert.equal(store.isAsking(asked), true)
  await assert.rejects(comments.answer(comment.id, 'Guessed'), store.StoreRefusal)
})

const LAYOUTS = [
  { label: 'Grid', description: 'Cards in a grid' },
  { label: 'List' },
  { label: 'Table' },
]

test("the reader's choice answers a question with options", async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layout?', { question: true, options: LAYOUTS })
  const answered = await update(comments, comment.id, {
    choices: ['List', 'Grid', 'Carousel'],
    followUp: 'With bigger gaps',
  })
  assert.equal(store.isActive(answered), true)
  const [, asked, reply] = answered.messages
  assert.deepEqual(asked.options, LAYOUTS)
  assert.equal(asked.multiple, undefined)
  // One option only, among those offered, then the reader's own words.
  assert.deepEqual(reply.choices, ['Grid'])
  assert.equal(reply.body, 'Grid\n\nWith bigger gaps')
})

test('a multiple-choice question takes several options, in their order', async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layouts?', {
    question: true,
    options: LAYOUTS,
    multiple: true,
  })
  const answered = await update(comments, comment.id, { choices: ['Table', 'Grid'] })
  assert.deepEqual(lastOf(answered.messages).choices, ['Grid', 'Table'])
  assert.equal(lastOf(answered.messages).body, 'Grid, Table')
})

test("the reader's new words, sent again, drop the options they had chosen", async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which layout?', { question: true, options: LAYOUTS })
  await update(comments, comment.id, { choices: ['Grid'] })
  await update(comments, comment.id, { cancelled: true })
  const resent = await update(comments, comment.id, {
    text: 'List please',
    cancelled: false,
  })
  const last = lastOf(resent.messages)
  assert.equal(last.body, 'List please')
  assert.equal(last.choices, undefined)
})

test('choices outside a question with options are ignored', async (t) => {
  const { comments, comment } = await setUp(t)
  await comments.answer(comment.id, 'Which blue?', { question: true })
  const unchanged = await update(comments, comment.id, { choices: ['Grid'] })
  assert.ok(store.isAsking(unchanged))
  assert.equal(unchanged.messages.length, 2)
})

test('only a claimed comment shows progress, a tool merged from start to end', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await appendProgress(project, comment.id, {
    at: 1,
    id: 't1',
    kind: 'read',
    label: 'a.ts',
    state: 'running',
  })
  assert.equal((await comments.list('/'))[0].progress, undefined)
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 2,
    id: 't1',
    kind: 'read',
    label: 'a.ts',
    state: 'done',
  })
  const [listed] = await comments.list('/')
  assert.deepEqual(listed.progress, [
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'done' },
  ])
})

test('a cancellation lists the files written and counts tools, not narration', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, kind: 'thinking', label: '' },
    { at: 2, kind: 'message', label: 'Editing the header' },
    { at: 3, id: 'a', kind: 'edit', label: 'src/a.ts', state: 'done' },
    { at: 4, id: 'b', kind: 'edit', label: 'src/b.ts', state: 'failed' },
    { at: 5, id: 'c', kind: 'read', label: 'src/c.ts', state: 'done' },
  )
  const cancelled = await update(comments, comment.id, { cancelled: true })
  assert.equal(cancelled.state, 'stopped')
  assert.ok(cancelled.cancellation)
  assert.deepEqual(cancelled.cancellation.changed, ['src/a.ts'])
  assert.equal(cancelled.cancellation.steps, 3)
  assert.equal(cancelled.cancellation.run, 'r1')
  assert.deepEqual(cancelled.events.at(-1), {
    at: lastOf(cancelled.events).at,
    state: 'stopped',
    by: 'reader',
    run: 'r1',
  })
})

test('with a dev widget, the debug history keeps every run, and goes with the comment', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: true })
  const history = path.join(project.progressDir, `${comment.id}.history.jsonl`)
  await claim(comments, comment.id)
  await appendProgress(
    project,
    comment.id,
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'running' },
    { at: 2, id: 't1', kind: 'read', label: 'a.ts', state: 'done' },
  )
  await comments.answer(comment.id, 'Which colour?', { question: true })
  // The reader answers: a second run, still going.
  await update(comments, comment.id, { followUp: 'Blue' })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, {
    at: 3,
    id: 't2',
    kind: 'edit',
    label: 'b.ts',
    state: 'running',
  })

  assert.equal((await comments.list('/'))[0].history, undefined)
  const [listed] = await comments.list('/', { history: true })
  // Each step tagged with its run, the hooks having left them untagged.
  assert.deepEqual(listed.history, [
    { at: 1, id: 't1', kind: 'read', label: 'a.ts', state: 'done', run: 'r1' },
    { at: 3, id: 't2', kind: 'edit', label: 'b.ts', state: 'running', run: 'r2' },
  ])

  await comments.remove(comment.id)
  assert.equal(existsSync(history), false)
})

test('with a released widget, a run leaves no history', async (t) => {
  const { project, comment } = await setUp(t)
  const comments = store.createStore(project, { history: false })
  await claim(comments, comment.id)
  await appendProgress(project, comment.id, { at: 1, kind: 'thinking', label: 'plan' })
  await comments.answer(comment.id, 'Done.')
  assert.equal(
    existsSync(path.join(project.progressDir, `${comment.id}.history.jsonl`)),
    false,
  )
})

test('a move outside the graph is refused, and writes nothing', async (t) => {
  const { project, comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  // Working: no follow-up from the reader.
  await assert.rejects(
    comments.update(comment.id, { followUp: 'And red' }),
    /is being worked on/,
  )
  await comments.answer(comment.id, 'Done.')
  const resolved = await readFile(project.commentsFile, 'utf8')
  await assert.rejects(comments.update(comment.id, { cancelled: true }), /is resolved/)
  await assert.rejects(comments.claim(comment.id), /is resolved/)
  await assert.rejects(comments.answer(comment.id, 'Again'), store.StoreRefusal)
  assert.equal(await readFile(project.commentsFile, 'utf8'), resolved)
  const [saved] = await comments.readAll()
  assert.deepEqual(statesOf(saved), ['open', 'working', 'resolved'])
})

test('the same move twice, as a double click sends it, changes nothing', async (t) => {
  const { comments, comment } = await setUp(t)
  // Stopped before any agent claimed it.
  await update(comments, comment.id, { cancelled: true })
  const again = await update(comments, comment.id, { cancelled: true })
  assert.deepEqual(statesOf(again), ['open', 'stopped'])
  await update(comments, comment.id, { status: 'resolved' })
  const resolved = await update(comments, comment.id, { status: 'resolved' })
  assert.deepEqual(statesOf(resolved), ['open', 'stopped', 'resolved'])
})

test('two questions give two asking events, each run its own', async (t) => {
  const { comments, comment } = await setUp(t)
  await claim(comments, comment.id)
  await comments.answer(comment.id, 'Which blue?', { question: true })
  await update(comments, comment.id, { followUp: 'Navy' })
  const { run } = await claim(comments, comment.id)
  assert.equal(run, 'r2')
  // Claimed again while working: the same run.
  assert.equal((await claim(comments, comment.id)).run, 'r2')
  const asked = await comments.answer(comment.id, 'Darker?', { question: true })
  assert.deepEqual(
    asked.events.map((event) => [event.state, event.by, event.run]),
    [
      ['open', 'reader', undefined],
      ['working', 'agent', 'r1'],
      ['asking', 'agent', 'r1'],
      ['open', 'reader', undefined],
      ['working', 'agent', 'r2'],
      ['asking', 'agent', 'r2'],
    ],
  )
  assert.deepEqual(
    asked.messages.map((message) => [message.id, message.author, message.run]),
    [
      ['m1', 'reader', undefined],
      ['m2', 'claude', 'r1'],
      ['m3', 'reader', undefined],
      ['m4', 'claude', 'r2'],
    ],
  )
})

test('refuses a file in the old format, and leaves it untouched', async (t) => {
  const project = projects.project(await tempProject(t))
  const comments = store.createStore(project)
  const old = JSON.stringify([{ id: 'c1', status: 'open', body: 'Make it blue' }])
  await mkdir(path.dirname(project.commentsFile), { recursive: true })
  await writeFile(project.commentsFile, old)
  await assert.rejects(comments.readAll(), {
    message: `old comments format: delete ${project.commentsFile}`,
  })
  await assert.rejects(
    comments.create({
      route: '/',
      anchor: { section: '', quote: '', occurrence: 0 },
      body: 'More',
    }),
    store.StoreRefusal,
  )
  assert.equal(await readFile(project.commentsFile, 'utf8'), old)
})

test('only a dev build of the widget counts as one', async (t) => {
  const dir = await tempDir(t)
  const dev = path.join(dir, 'dev.js')
  const release = path.join(dir, 'release.js')
  await writeFile(dev, '/* code-buddy widget (dev build, with the debug panel): x */')
  await writeFile(release, '/* code-buddy widget: served by the code-buddy skill */')
  assert.equal(projects.isDevWidget(dev), true)
  assert.equal(projects.isDevWidget(release), false)
  assert.equal(projects.isDevWidget(path.join(dir, 'missing.js')), false)
})
