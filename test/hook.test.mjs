import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir, tempProject } from './helpers.mjs'

let stateDir = ''
/** @type {typeof import('../skills/code-buddy/scripts/lib/store.mjs')} */
let store
/** @type {typeof import('../skills/code-buddy/scripts/lib/project.mjs')} */
let projects
/** @type {typeof import('../skills/code-buddy/scripts/lib/agents.mjs')} */
let agents
/** @type {typeof import('../skills/code-buddy/scripts/lib/locks.mjs')} */
let locks

before(async (t) => {
  stateDir = await tempDir(t)
  process.env.CODE_BUDDY_STATE_DIR = stateDir
  store = await import('../skills/code-buddy/scripts/lib/store.mjs')
  projects = await import('../skills/code-buddy/scripts/lib/project.mjs')
  agents = await import('../skills/code-buddy/scripts/lib/agents.mjs')
  locks = await import('../skills/code-buddy/scripts/lib/locks.mjs')
})

let calls = 0

/** Sends one event to hook.mjs, as Claude Code does. */
function hook(event, env = {}) {
  return run(process.execPath, [path.join(SCRIPTS, 'hook.mjs')], {
    input: JSON.stringify({ session_id: 'session', ...event }),
    env: { CODE_BUDDY_STATE_DIR: stateDir, ...env },
  })
}

const bash = (agent, event, command, extra = {}) =>
  hook({
    hook_event_name: event,
    agent_id: agent,
    tool_name: 'Bash',
    tool_use_id: `t${++calls}`,
    tool_input: { command },
    ...extra,
  })

const tool = (agent, event, name, input, extra = {}) =>
  hook({
    hook_event_name: event,
    agent_id: agent,
    tool_name: name,
    tool_use_id: extra.tool_use_id ?? `t${++calls}`,
    tool_input: input,
    ...extra,
  })

async function setUp(t) {
  const root = await tempProject(t)
  const project = projects.project(root)
  const comments = store.createStore(project)
  const comment = await comments.create({
    route: '/',
    url: 'http://localhost/',
    body: 'Make it blue',
  })
  await comments.transact((all) => {
    all[0].claimedAt = new Date().toISOString()
  })
  const claimCommand = `node ${SCRIPTS}claim.mjs ${comment.id} --project ${root}`
  return { root, project, comments, comment, claimCommand }
}

const progressFile = (project, id) => path.join(project.progressDir, `${id}.jsonl`)

test('records a claimed agent tools, and forgets it when it stops', async (t) => {
  const { root, project, comment, claimCommand } = await setUp(t)
  await bash('agent-1', 'PostToolUse', claimCommand)
  assert.deepEqual(await agents.bindingOf('agent-1'), { root, comment: comment.id })
  await tool(
    'agent-1',
    'PreToolUse',
    'Read',
    { file_path: `${root}/src/a.ts` },
    { tool_use_id: 'r1' },
  )
  await tool(
    'agent-1',
    'PostToolUse',
    'Read',
    { file_path: `${root}/src/a.ts` },
    { tool_use_id: 'r1' },
  )
  await tool('agent-1', 'PostToolUse', 'SubagentHandback', {})
  const steps = await store.readProgress(project, comment.id)
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label, s.state]),
    [
      ['start', 'Started', 'done'],
      ['read', 'src/a.ts', 'done'],
    ],
  )
  await hook({ hook_event_name: 'SubagentStop', agent_id: 'agent-1' })
  assert.equal(await agents.bindingOf('agent-1'), undefined)
})

test('records nothing once the reader cancelled the comment', async (t) => {
  const { root, project, comments, comment, claimCommand } = await setUp(t)
  await bash('agent-2', 'PostToolUse', claimCommand)
  await comments.update(comment.id, { cancelled: true })
  assert.equal(existsSync(progressFile(project, comment.id)), false)
  // The agent keeps working until TaskStop reaches it.
  await tool('agent-2', 'PreToolUse', 'Grep', { pattern: 'header' })
  await tool('agent-2', 'PostToolUse', 'Grep', { pattern: 'header' })
  assert.equal(existsSync(progressFile(project, comment.id)), false)
  assert.ok(root)
})

test('binds an agent whose chained claim command failed further on', async (t) => {
  const { root, comment, claimCommand } = await setUp(t)
  await bash('agent-3', 'PostToolUseFailure', `${claimCommand}; npm test`, {
    error: 'Exit code 1',
  })
  assert.deepEqual(await agents.bindingOf('agent-3'), { root, comment: comment.id })
})

test('ends the run when a chained resolve ran before the command failed', async (t) => {
  const { root, project, comments, comment, claimCommand } = await setUp(t)
  await bash('agent-4', 'PostToolUse', claimCommand)
  await tool('agent-4', 'PostToolUse', 'Read', { file_path: `${root}/src/a.ts` })
  await comments.answer(comment.id, 'Done')
  await bash(
    'agent-4',
    'PostToolUseFailure',
    `node ${SCRIPTS}resolve.mjs ${comment.id} --project ${root} "Done" && false`,
    { error: 'Exit code 1' },
  )
  assert.equal(await agents.bindingOf('agent-4'), undefined)
  assert.equal(existsSync(progressFile(project, comment.id)), false)
})

test('keeps the run going when the command failed before its resolve', async (t) => {
  const { root, comment, claimCommand } = await setUp(t)
  await bash('agent-5', 'PostToolUse', claimCommand)
  // resolve.mjs never ran: the comment is still open and claimed.
  await bash(
    'agent-5',
    'PostToolUseFailure',
    `npm test && node ${SCRIPTS}resolve.mjs ${comment.id} --project ${root} "Done"`,
    { error: 'Exit code 1' },
  )
  assert.deepEqual(await agents.bindingOf('agent-5'), { root, comment: comment.id })
})

test('frees the build lock when the build fails', async (t) => {
  const { project, comment, claimCommand } = await setUp(t)
  await bash('agent-6', 'PostToolUse', claimCommand)
  await bash('agent-6', 'PreToolUse', 'npm run build', { tool_use_id: 'b1' })
  assert.ok((await locks.createLocks(project).status()).some((l) => l.path === '@build'))
  await bash('agent-6', 'PostToolUseFailure', 'npm run build', {
    tool_use_id: 'b1',
    error: 'Exit code 1\nType error',
  })
  assert.equal((await locks.createLocks(project).status()).length, 0)
  const steps = await store.readProgress(project, comment.id)
  assert.deepEqual(steps.at(-1), {
    ...steps.at(-1),
    kind: 'bash',
    state: 'failed',
    error: 'Exit code 1',
  })
})

test("blocks an agent editing a file another comment's agent holds, then lets it through", async (t) => {
  const first = await setUp(t)
  const { root, comments } = first
  const second = await comments.create({
    route: '/',
    url: 'http://localhost/',
    body: 'Make it red',
  })
  await comments.transact((all) => {
    for (const c of all) c.claimedAt = new Date().toISOString()
  })
  await bash('agent-7', 'PostToolUse', first.claimCommand)
  await bash(
    'agent-8',
    'PostToolUse',
    `node ${SCRIPTS}claim.mjs ${second.id} --project ${root}`,
  )
  const edit = { file_path: `${root}/src/header.ts`, old_string: 'a', new_string: 'b' }
  assert.equal((await tool('agent-7', 'PreToolUse', 'Edit', edit)).code, 0)
  const blocked = await hook(
    {
      hook_event_name: 'PreToolUse',
      agent_id: 'agent-8',
      tool_name: 'Edit',
      tool_use_id: 'e2',
      tool_input: edit,
    },
    { CODE_BUDDY_LOCK_TIMEOUT_S: '1' },
  )
  assert.equal(blocked.code, 2)
  assert.match(blocked.stderr, /being changed by the agent of comment/)
  await hook({ hook_event_name: 'SubagentStop', agent_id: 'agent-7' })
  const after = await hook(
    {
      hook_event_name: 'PreToolUse',
      agent_id: 'agent-8',
      tool_name: 'Edit',
      tool_use_id: 'e3',
      tool_input: edit,
    },
    { CODE_BUDDY_LOCK_TIMEOUT_S: '1' },
  )
  assert.equal(after.code, 0)
})

test("reads a subagent's messages from its own transcript", async (t) => {
  const { project, comment, claimCommand } = await setUp(t)
  const dir = await tempDir(t)
  const session = path.join(dir, 'session.jsonl')
  const own = path.join(dir, 'session', 'subagents', 'agent-agent-9.jsonl')
  await mkdir(path.dirname(own), { recursive: true })
  await writeFile(own, '')
  // Tool events in a subagent carry the session's transcript_path only.
  await bash('agent-9', 'PostToolUse', claimCommand, { transcript_path: session })
  await writeFile(
    own,
    `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-30T10:00:00.000Z', message: { content: [{ type: 'text', text: 'Looking at the header.' }] } })}\n`,
  )
  await tool(
    'agent-9',
    'PreToolUse',
    'Grep',
    { pattern: 'h1' },
    { transcript_path: session },
  )
  const steps = await store.readProgress(project, comment.id)
  assert.deepEqual(
    steps.slice(-2).map((s) => [s.kind, s.label]),
    [
      ['message', 'Looking at the header.'],
      ['search', 'h1'],
    ],
  )
})

test('refuses a claimed agent a Bash command that writes files, which no lock covers', async (t) => {
  const { root, claimCommand } = await setUp(t)
  await bash('agent-w', 'PostToolUse', claimCommand)
  const writes = [
    `python3 - <<'EOF'\np='src/a.ts'\ns=open(p).read()\nopen(p, 'w').write(s.replace('a', 'b'))\nEOF`,
    `python3 -c "import pathlib; pathlib.Path('src/a.ts').write_text('x')"`,
    `node -e "require('fs').writeFileSync('src/a.ts', 'x')"`,
    `sed -i '' 's/a/b/' ${root}/src/a.ts`,
    `perl -pi -e 's/a/b/' src/a.ts`,
    `cat > src/a.ts <<'EOF'\nx\nEOF`,
    `echo x | tee src/a.ts`,
  ]
  for (const command of writes) {
    const result = await bash('agent-w', 'PreToolUse', command)
    assert.equal(result.code, 2, command)
    assert.match(result.stderr, /Edit or Write tool/, command)
  }
  const reads = [
    'npm test 2>&1 | tail -20',
    `grep -n "open(" ${root}/src/a.ts > /dev/null`,
    `sed -n '1,20p' src/a.ts`,
  ]
  for (const command of reads) {
    assert.equal((await bash('agent-w', 'PreToolUse', command)).code, 0, command)
  }
})

test("lets an agent's answer through, whatever its text says", async (t) => {
  const { root, comment, claimCommand } = await setUp(t)
  await bash('agent-r', 'PostToolUse', claimCommand)
  const answer = `node ${SCRIPTS}resolve.mjs ${comment.id} --project ${root} <<'EOF'\nReplaced open(p, 'w') and sed -i with Edit.\nEOF`
  assert.equal((await bash('agent-r', 'PreToolUse', answer)).code, 0)
})

test('leaves Bash alone for an agent that claimed no comment', async () => {
  assert.equal(
    (await bash('agent-free', 'PreToolUse', `sed -i '' 's/a/b/' a.ts`)).code,
    0,
  )
})

test('logs its decisions when debugging is on', async (t) => {
  const state = await tempDir(t)
  await writeFile(path.join(state, 'debug'), '')
  await hook(
    {
      hook_event_name: 'PreToolUse',
      agent_id: 'agent-d',
      tool_name: 'Read',
      tool_input: {},
    },
    { CODE_BUDDY_STATE_DIR: state },
  )
  const log = await readFile(path.join(state, 'hook.log'), 'utf8')
  assert.match(log, / mjs PreToolUse Read agent=agent-d: not bound: nothing to do\n$/)
})
