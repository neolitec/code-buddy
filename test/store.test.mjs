import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { tempDir, tempProject } from './helpers.mjs'

/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects
/** @type {typeof import('../skills/code-buddy/scripts/lib/agents.mjs')} */
let agents

before(async (t) => {
  process.env.CODE_BUDDY_STATE_DIR = await tempDir(t)
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
  agents = await import('../skills/code-buddy/scripts/lib/agents.mjs')
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
  await agents.appendProgress(project, comment.id, {
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
  await agents.appendProgress(project, comment.id, {
    at: 1,
    id: 't1',
    kind: 'read',
    label: 'a.ts',
    state: 'running',
  })
  assert.equal((await comments.list('/'))[0].progress, undefined)
  await claim(comments, comment.id)
  await agents.appendProgress(project, comment.id, {
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
  await agents.appendProgress(
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

test('prunes the bindings of agents silent for too long, keeps the others', async (t) => {
  await mkdir(path.dirname(path.join(projects.AGENTS_DIR, 'x')), { recursive: true })
  await agents.bind('fresh', '/p', 'c1')
  await agents.bind('stale', '/p', 'c2')
  const old = new Date(Date.now() - agents.BINDING_TTL_MS - 60_000)
  await utimes(path.join(projects.AGENTS_DIR, 'stale'), old, old)
  await writeFile(path.join(projects.AGENTS_DIR, 'stale.transcript'), '{}')
  await utimes(path.join(projects.AGENTS_DIR, 'stale.transcript'), old, old)
  await agents.pruneBindings()
  assert.deepEqual(await agents.bindingOf('fresh'), { root: '/p', comment: 'c1' })
  assert.equal(await agents.bindingOf('stale'), undefined)
  assert.equal(existsSync(path.join(projects.AGENTS_DIR, 'stale.transcript')), false)
  t.after(() => agents.unbind('fresh'))
})
