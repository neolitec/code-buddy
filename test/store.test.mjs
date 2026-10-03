import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
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
    body: 'Make it blue',
  })
  return { project, comments, comment }
}

const claim = (comments, id) =>
  comments.transact((all) => {
    all.find((c) => c.id === id).claimedAt = new Date().toISOString()
  })

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
  assert.equal(saved.status, 'resolved')
  assert.equal(saved.claimedAt, undefined)
  assert.deepEqual(
    saved.messages.map((m) => [m.author, m.body]),
    [['claude', 'Done: it is blue now.']],
  )
  assert.doesNotMatch(await readFile(project.commentsFile, 'utf8'), /secret plan/)
  assert.equal(existsSync(path.join(project.progressDir, `${comment.id}.jsonl`)), false)
})

test('a question leaves the comment open, waiting on the reader', async (t) => {
  const { comments, comment } = await setUp(t)
  const asked = await comments.answer(comment.id, 'Which blue?', { question: true })
  assert.equal(asked.status, 'open')
  assert.ok(asked.askedAt)
  assert.equal(store.isActive(asked), false)
  assert.equal(store.isAsking(asked), true)
  await assert.rejects(comments.answer(comment.id, 'Guessed'), store.StoreRefusal)
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
  const cancelled = await comments.update(comment.id, { cancelled: true })
  assert.deepEqual(cancelled.cancellation.changed, ['src/a.ts'])
  assert.equal(cancelled.cancellation.steps, 3)
})
