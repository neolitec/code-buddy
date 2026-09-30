import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { SCRIPTS, json, run, tempDir, tempProject } from './helpers.mjs'

const WIDGET = path.join(SCRIPTS, '..', 'widget', 'dist', 'widget.js')

let base = ''
let root = ''
let port = 0
/** @type {import('node:child_process').ChildProcess | undefined} */
let server

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no TCP port'))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

before(async (t) => {
  if (!existsSync(WIDGET)) throw new Error('build the widget first: npm run build')
  root = await tempProject(t)
  port = await freePort()
  const child = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: {
        ...process.env,
        CODE_BUDDY_PORT: String(port),
        CODE_BUDDY_STATE_DIR: await tempDir(t),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  server = child
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('READY')) resolve(undefined)
    })
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  base = `http://127.0.0.1:${port}`
})

after(() => server?.kill())

const post = (body, headers = {}) =>
  fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })

test('answers the health check with the project it serves', async () => {
  const health = await json(await fetch(`${base}/api/health`))
  assert.equal(health.project, root)
})

test('serves the widget', async () => {
  const response = await fetch(`${base}/widget.js`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /javascript/)
})

test('lets localhost apps in, and no other origin', async () => {
  const local = await fetch(`${base}/api/health`, {
    headers: { origin: 'http://localhost:3000' },
  })
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  const other = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(other.headers.get('access-control-allow-origin'), null)
})

test('creates a comment and lists it for its page', async () => {
  const created = await post(
    JSON.stringify({
      route: '/about',
      url: 'http://localhost:3000/about',
      body: 'Typo here',
    }),
  )
  assert.equal(created.status, 201)
  const listed = await json(await fetch(`${base}/api/comments?route=%2Fabout`))
  assert.ok(listed.some((c) => c.body === 'Typo here' && c.status === 'open'))
})

test('rejects malformed JSON with 400, and never echoes an exception', async () => {
  const response = await post('{not json')
  assert.equal(response.status, 400)
  assert.deepEqual(await json(response), { error: 'invalid JSON' })
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('rejects an oversized body with 413', async () => {
  const response = await post(JSON.stringify({ body: 'x'.repeat(200_000) }))
  assert.equal(response.status, 413)
  assert.deepEqual(await json(response), { error: 'body too large' })
})

test('answers an internal error with a fixed message', async () => {
  await mkdir(path.join(root, '.code-buddy'), { recursive: true })
  await writeFile(path.join(root, '.code-buddy', 'comments.json'), '{corrupt')
  const response = await fetch(`${base}/api/comments?route=%2F`)
  assert.equal(response.status, 500)
  assert.deepEqual(await json(response), { error: 'internal error' })
  await writeFile(path.join(root, '.code-buddy', 'comments.json'), '[]')
})

test('a second server for the same project reports the port as busy', async () => {
  const second = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    {
      env: { CODE_BUDDY_PORT: String(port) },
    },
  )
  assert.equal(second.code, 3)
  assert.match(second.stdout, /PORT_BUSY .* another .* session for this project/)
})
