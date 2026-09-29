#!/usr/bin/env node
// claim.mjs <id> --project <dir> [--release]
// Shows the reader a "working on it" spinner under the comment, or removes it.
import { findProject, positional } from './lib/project.mjs'
import { createStore } from './lib/store.mjs'

const args = positional()
const release = args.includes('--release')
const id = args.find((arg) => arg !== '--release')
const project = findProject()
if (!id || !project) {
  console.error('usage: claim.mjs <id> --project <dir> [--release]')
  process.exit(2)
}

const store = createStore(project)
const comments = await store.readAll()
const comment = comments.find((entry) => entry.id === id)
if (!comment) {
  console.error(`no comment with id ${id}`)
  process.exit(1)
}
if (!release && (comment.status !== 'open' || comment.cancelledAt)) {
  console.error(
    `comment ${id} is ${comment.cancelledAt ? 'cancelled' : comment.status}; stop working on it`,
  )
  process.exit(1)
}
if (release) delete comment.claimedAt
else comment.claimedAt = new Date().toISOString()
await store.writeAll(comments)
console.log(`${release ? 'released' : 'claimed'} ${id} (${comment.route})`)
