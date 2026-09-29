#!/usr/bin/env node
// lock.mjs status --project <dir>
// lock.mjs acquire <owner> <path|@build>... --project <dir> [--timeout <s>]
// lock.mjs release <owner> [<path|@build>...] --project <dir>
import { findProject, positional } from './lib/project.mjs'
import { createLocks } from './lib/locks.mjs'

const args = positional()
const timeoutAt = args.indexOf('--timeout')
const timeoutS = timeoutAt === -1 ? 60 : Number(args.splice(timeoutAt, 2)[1])
const [command, owner, ...targets] = args
const project = findProject()
if (!project) {
  console.error('no .code-buddy.json found; pass --project <dir>')
  process.exit(2)
}
const locks = createLocks(project)

if (command === 'status') {
  const held = await locks.status()
  if (!held.length) console.log('no locks')
  for (const lock of held) {
    console.log(`${lock.path}  ${lock.owner}  ${lock.ageS ?? '?'}s`)
  }
} else if (command === 'acquire' && owner && targets.length) {
  const result = await locks.acquire(owner, targets, timeoutS)
  if (!result.ok) {
    console.error(
      `busy: ${result.target} is locked by ${result.holder}; released ${result.released.length} lock(s) held by ${owner}`,
    )
    process.exit(3)
  }
  console.log(`locked ${targets.length} for ${owner}`)
} else if (command === 'release' && owner) {
  if (targets.length) {
    for (const target of targets) {
      await locks.unlock(owner, locks.relativeTarget(target))
    }
    console.log(`released ${targets.length} for ${owner}`)
  } else {
    console.log(`released ${(await locks.releaseAll(owner)).length} for ${owner}`)
  }
} else {
  console.error('usage: lock.mjs status|acquire|release … --project <dir>')
  process.exit(2)
}
