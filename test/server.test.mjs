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
/** What the server printed for the manager so far. */
let output = ''
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
        CODE_BUDDY_HOOKS: '1',
        CODE_BUDDY_POLL_MS: '50',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  server = child
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('READY')) resolve(undefined)
    })
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  base = `http://127.0.0.1:${port}`
})

after(() => server?.kill())

/**
 * The first line starting with `prefix` the server printed after `from`.
 * @param {string} prefix
 * @param {number} from A length of `output`, taken before the request.
 * @returns {Promise<string>}
 */
async function nextLine(prefix, from) {
  for (let waited = 0; waited < 3000; waited += 25) {
    const line = output
      .slice(from)
      .split('\n')
      .find((entry) => entry.startsWith(prefix))
    if (line) return line
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`no line starting with ${prefix}`)
}

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

test("takes the reader's choice among the options Claude asked with", async () => {
  const created = await json(
    await post(JSON.stringify({ route: '/cards', body: 'Rework the cards' })),
  )
  const asked = await run(process.execPath, [
    path.join(SCRIPTS, 'ask.mjs'),
    created.id,
    '--project',
    root,
    'Which layout?',
    '--option',
    'Grid: Cards in a grid',
    '--option',
    'List',
  ])
  assert.equal(asked.code, 0, asked.stderr)
  const printed = output.length
  const answered = await json(
    await fetch(`${base}/api/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: ['List', 42], followUp: 'Denser' }),
    }),
  )
  // One line for the manager, the line breaks escaped, the choices apart.
  const event = await nextLine(`FOLLOWUP ${created.id} `, printed)
  assert.match(event, / followup="List\\n\\nDenser" choices=\["List"\] messages=3$/)
  assert.deepEqual(answered.messages.at(-1), {
    author: 'reader',
    body: 'List\n\nDenser',
    choices: ['List'],
    at: answered.messages.at(-1).at,
  })
  assert.equal(answered.askedAt, undefined)
})

test('rejects malformed JSON with 400, and never echoes an exception', async () => {
  const response = await post('{not json')
  assert.equal(response.status, 400)
  assert.deepEqual(await json(response), { error: 'invalid JSON' })
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('rejects an oversized body with 413, closing the connection', async () => {
  const response = await post(JSON.stringify({ body: 'x'.repeat(200_000) }))
  assert.equal(response.status, 413)
  assert.deepEqual(await json(response), { error: 'body too large' })
  // Its body is left unread: a request reusing the connection would hang.
  assert.equal(response.headers.get('connection'), 'close')
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
      env: { CODE_BUDDY_PORT: String(port), CODE_BUDDY_HOOKS: '1' },
    },
  )
  assert.equal(second.code, 3)
  assert.match(second.stdout, /PORT_BUSY .* another .* session for this project/)
})

test("refuses to start when Claude Code did not load the plugin's hooks", async () => {
  const started = await run(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--project', root],
    { env: { CODE_BUDDY_PORT: String(await freePort()), CODE_BUDDY_HOOKS: '' } },
  )
  assert.equal(started.code, 2)
  assert.match(started.stdout, /^HOOKS_MISSING .*Claude Code 2\.1\.287 or later/m)
})
