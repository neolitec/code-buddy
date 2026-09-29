#!/usr/bin/env node
// resolve.mjs <id> --project <dir> "<answer>"   (or the answer on stdin)
// Marks one comment resolved and adds the answer to its thread.
import { findProject, positional } from './lib/project.mjs'
import { createStore } from './lib/store.mjs'

const [id, answerArg] = positional()
const project = findProject()

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

const answer = (
  answerArg ?? (process.stdin.isTTY ? '' : await readStdin())
).trim()
if (!id || !project || !answer) {
  console.error(
    'usage: resolve.mjs <id> --project <dir> "<answer>" (or the answer on stdin)'
  )
  process.exit(2)
}

const store = createStore(project)
const comments = await store.readAll()
const comment = comments.find((entry) => entry.id === id)
if (!comment) {
  console.error(`no comment with id ${id}`)
  process.exit(1)
}
if (comment.status !== 'open' || comment.cancelledAt) {
  console.error(
    `comment ${id} is ${comment.cancelledAt ? 'cancelled' : comment.status}; not resolving it`
  )
  process.exit(1)
}
const now = new Date().toISOString()
comment.status = 'resolved'
comment.resolution = answer
comment.resolvedAt = now
if (comment.messages?.length) {
  comment.messages.push({ author: 'claude', body: answer, at: now })
}
delete comment.claimedAt
await store.writeAll(comments)
console.log(`resolved ${id} (${comment.route})`)
