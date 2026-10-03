import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

/**
 * Runs hook.sh with a fake `node` first on PATH, which only leaves a mark:
 * whether Node would have started is the whole point of hook.sh.
 */
async function setUp(t) {
  const dir = await tempDir(t)
  const bin = path.join(dir, 'bin')
  const mark = path.join(dir, 'node-started')
  const state = path.join(dir, 'state')
  await mkdir(bin)
  await mkdir(path.join(state, 'agents'), { recursive: true })
  await writeFile(path.join(bin, 'node'), `#!/bin/sh\ncat > /dev/null\ntouch "${mark}"\n`)
  await chmod(path.join(bin, 'node'), 0o755)
  const hookSh = (input) =>
    run('sh', [path.join(SCRIPTS, 'hook.sh')], {
      input: JSON.stringify(input),
      env: { PATH: `${bin}:${process.env.PATH}`, CODE_BUDDY_STATE_DIR: state },
    })
  return { hookSh, mark, state, agents: path.join(state, 'agents') }
}

const readEvent = {
  hook_event_name: 'PostToolUse',
  tool_name: 'Read',
  tool_input: { file_path: '/p/a.ts' },
}

test('does not start Node when no agent works on a comment', async (t) => {
  const { hookSh, mark } = await setUp(t)
  assert.equal((await hookSh(readEvent)).code, 0)
  assert.equal(existsSync(mark), false)
})

test('starts Node for the command that claims a comment', async (t) => {
  const { hookSh, mark } = await setUp(t)
  await hookSh({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'node /x/scripts/claim.mjs abc --project /p' },
  })
  assert.equal(existsSync(mark), true)
})

test('starts Node while an agent works on a comment', async (t) => {
  const { hookSh, mark, agents } = await setUp(t)
  await writeFile(path.join(agents, 'agent-1'), '{"root":"/p","comment":"c"}')
  await hookSh(readEvent)
  assert.equal(existsSync(mark), true)
})

test('ignores a binding left by an agent killed hours ago', async (t) => {
  const { hookSh, mark, agents } = await setUp(t)
  const file = path.join(agents, 'agent-1')
  await writeFile(file, '{"root":"/p","comment":"c"}')
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
  await utimes(file, old, old)
  await hookSh(readEvent)
  assert.equal(existsSync(mark), false)
})

test('does not start Node for a prompt that only mentions the claim script', async (t) => {
  const { hookSh, mark } = await setUp(t)
  await hookSh({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { prompt: 'Claim it: `node /x/scripts/claim.mjs abc --project /p`.' },
  })
  assert.equal(existsSync(mark), false)
})

test('logs each call when debugging is on, and only then', async (t) => {
  const { hookSh, state } = await setUp(t)
  await hookSh(readEvent)
  assert.equal(existsSync(path.join(state, 'hook.log')), false)
  await writeFile(path.join(state, 'debug'), '')
  await hookSh({ ...readEvent, agent_id: 'agent-9' })
  const log = await readFile(path.join(state, 'hook.log'), 'utf8')
  assert.match(log, /^\S+ sh {2}PostToolUse Read agent=agent-9 pid=\d+: skip\n$/)
})
