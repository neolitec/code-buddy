// Per-file write locks for agents working in parallel. Locks mirror the project
// tree under a temp directory, one directory per file: mkdir is atomic, so two
// agents can never both take the same lock.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { isActive } from './store.mjs'

const STALE_MS = Number(process.env.CODE_BUDDY_LOCK_STALE_S ?? 20 * 60) * 1000
const POLL_MS = 200

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Code-unit order: every process locks files in the same order, so none deadlocks. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Every `*.lock` directory under `dir`, skipping the owners index. */
async function walk(dir, found = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === '.owners') continue
    const full = path.join(dir, entry.name)
    if (entry.name.endsWith('.lock')) found.push(full)
    else if (entry.isDirectory()) await walk(full, found)
  }
  return found
}

export function createLocks(project) {
  const root = project.locksDir
  const ownersDir = path.join(root, '.owners')
  const lockDir = (relative) => path.join(root, `${relative}.lock`)
  const indexEntry = (owner, relative) =>
    path.join(ownersDir, owner, encodeURIComponent(relative))

  function relativeTarget(target) {
    if (target === '@build') return target
    const relative = path.relative(project.root, path.resolve(project.root, target))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${target} is outside the project`)
    }
    return relative
  }

  async function readOwner(relative) {
    try {
      return JSON.parse(
        await readFile(path.join(lockDir(relative), 'owner.json'), 'utf8'),
      )
    } catch {
      return undefined
    }
  }

  /** Ids of the comments an agent may work on: open, not stopped, not waiting on the reader. */
  async function activeCommentIds() {
    try {
      const comments = JSON.parse(await readFile(project.commentsFile, 'utf8'))
      return new Set(comments.filter(isActive).map((c) => c.id))
    } catch {
      return undefined
    }
  }

  async function isStale(holder, relative) {
    if (!holder) {
      try {
        const { mtimeMs } = await stat(lockDir(relative))
        return Date.now() - mtimeMs > 5000
      } catch {
        return true
      }
    }
    if (Date.now() - holder.at > STALE_MS) return true
    const active = await activeCommentIds()
    return active !== undefined && !active.has(holder.owner)
  }

  async function tryLock(owner, relative) {
    const dir = lockDir(relative)
    await mkdir(path.dirname(dir), { recursive: true })
    try {
      await mkdir(dir)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const holder = await readOwner(relative)
      if (holder?.owner === owner) return { ok: true }
      if (await isStale(holder, relative)) {
        await rm(dir, { recursive: true, force: true })
        return tryLock(owner, relative)
      }
      return { ok: false, holder: holder?.owner ?? 'unknown' }
    }
    await writeFile(
      path.join(dir, 'owner.json'),
      JSON.stringify({ owner, at: Date.now() }),
    )
    await mkdir(path.join(ownersDir, owner), { recursive: true })
    await writeFile(indexEntry(owner, relative), '')
    return { ok: true }
  }

  async function unlock(owner, relative) {
    const holder = await readOwner(relative)
    if (holder?.owner === owner) {
      await rm(lockDir(relative), { recursive: true, force: true })
    }
    await rm(indexEntry(owner, relative), { force: true })
  }

  async function heldBy(owner) {
    try {
      return (await readdir(path.join(ownersDir, owner))).map(decodeURIComponent)
    } catch {
      return []
    }
  }

  async function releaseAll(owner) {
    const held = await heldBy(owner)
    await Promise.all(held.map((relative) => unlock(owner, relative)))
    await rm(path.join(ownersDir, owner), { recursive: true, force: true })
    return held
  }

  /** Takes every lock or none: on timeout releases all of the owner's locks. */
  /**
   * @returns {Promise<
   *   { ok: true } | { ok: false, target: string, holder: string, released: string[] }
   * >}
   */
  async function acquire(owner, targets, timeoutS) {
    const deadline = Date.now() + timeoutS * 1000
    const pending = [...new Set(targets.map(relativeTarget))].toSorted(byCodeUnit)
    while (pending.length) {
      const result = await tryLock(owner, pending[0])
      if (result.ok) {
        pending.shift()
        continue
      }
      if (Date.now() >= deadline) {
        const released = await releaseAll(owner)
        return { ok: false, target: pending[0], holder: result.holder, released }
      }
      await sleep(POLL_MS)
    }
    return { ok: true }
  }

  async function status() {
    const locks = []
    for (const dir of await walk(root)) {
      const relative = path.relative(root, dir).replace(/\.lock$/, '')
      const holder = await readOwner(relative)
      locks.push({
        path: relative,
        owner: holder?.owner ?? 'unknown',
        ageS: holder ? Math.round((Date.now() - holder.at) / 1000) : undefined,
      })
    }
    return locks
  }

  return {
    acquire,
    activeCommentIds,
    relativeTarget,
    releaseAll,
    status,
    unlock,
  }
}
