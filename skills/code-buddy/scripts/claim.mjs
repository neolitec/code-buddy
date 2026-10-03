#!/usr/bin/env node
// claim.mjs <id> --project <dir>
// Shows the reader a "working on it" spinner and the agent's progress under the
// comment. To stop working without resolving, an agent asks the reader a
// question with ask.mjs.
import { findProject, positional } from './lib/project.mjs'
import { StoreRefusal, createStore, isActive, stateOf } from './lib/store.mjs'

const [id] = positional()
const project = findProject()
if (!id || !project) {
  console.error('usage: claim.mjs <id> --project <dir>')
  process.exit(2)
}

try {
  const comment = await createStore(project).transact((comments) => {
    const found = comments.find((entry) => entry.id === id)
    if (!found) throw new StoreRefusal(`no comment with id ${id}`)
    if (!isActive(found)) {
      throw new StoreRefusal(`comment ${id} is ${stateOf(found)}; stop working on it`)
    }
    found.claimedAt = new Date().toISOString()
    return found
  })
  // The hooks bind the agent to this project: they cannot see the shell's
  // directory a relative --project was resolved from.
  console.log(`claimed ${id} (${comment.route}) project=${project.root}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.error(error.message)
  process.exit(1)
}
