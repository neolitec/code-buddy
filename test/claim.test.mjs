import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
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

test('prints the project it found, for the hooks, which cannot see the shell directory', async (t) => {
  const root = await tempProject(t)
  const comment = await store.createStore(projects.project(root)).create({
    route: '/',
    url: 'http://localhost/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  const claimed = await run(
    process.execPath,
    [path.join(SCRIPTS, 'claim.mjs'), comment.id, '--project', '.'],
    { cwd: root },
  )
  assert.equal(claimed.code, 0)
  // The shell's directory, as the operating system names it (/private/var on macOS).
  const found = await realpath(root)
  assert.equal(claimed.stdout, `claimed ${comment.id} (/) project=${found} run=r1\n`)
})

test('refuses a comment that waits on the reader, and says to stop', async (t) => {
  const root = await tempProject(t)
  const comments = store.createStore(projects.project(root))
  const comment = await comments.create({
    route: '/',
    anchor: { section: '', quote: '', occurrence: 0 },
    body: 'Make it blue',
  })
  await comments.answer(comment.id, 'Which blue?', { question: true })
  const claimed = await run(process.execPath, [
    path.join(SCRIPTS, 'claim.mjs'),
    comment.id,
    '--project',
    root,
  ])
  assert.equal(claimed.code, 1)
  assert.equal(
    claimed.stderr,
    `comment ${comment.id} is waiting on the reader's answer; stop working on it\n`,
  )
})
