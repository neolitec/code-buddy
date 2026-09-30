import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'

export const APP_ROUTE = '*'
const PROGRESS_SHOWN = 10
const WRITE_KINDS = new Set(['edit', 'write', 'multiedit'])

export const isActive = (comment) => comment.status === 'open' && !comment.cancelledAt

/** The thread as a list, including the question and a legacy `resolution`. */
export function threadOf(comment) {
  const question = { author: 'reader', body: comment.body, at: comment.createdAt }
  if (comment.messages?.length) return [question, ...comment.messages]
  return comment.resolution
    ? [
        question,
        {
          author: 'claude',
          body: comment.resolution,
          at: comment.resolvedAt ?? comment.createdAt,
        },
      ]
    : [question]
}

export const normaliseQuote = (text) => text.replace(/\s+/g, ' ').trim()

export function createStore(project) {
  const file = project.commentsFile
  const progressFile = (id) => path.join(project.progressDir, `${id}.jsonl`)
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()

  /**
   * Runs `task` after the previous one, so reads and writes never interleave.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const serialise = (task) => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  async function readAll() {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
  }

  // Written to a temp file first: the watcher and the agents' scripts read it concurrently.
  async function writeAll(comments) {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(comments, null, 2)}\n`)
    await rename(temp, file)
  }

  /**
   * The comment's steps, oldest first. A tool writes one line when it starts and
   * one when it ends or fails, both with its tool_use_id: they merge into one
   * step, in the place where it started.
   */
  async function readProgress(id, limit) {
    let lines
    try {
      lines = (await readFile(progressFile(id), 'utf8')).trim().split('\n')
    } catch {
      return []
    }
    const steps = []
    const byTool = new Map()
    for (const line of lines) {
      let step
      try {
        step = JSON.parse(line)
      } catch {
        continue
      }
      const started = step.id ? byTool.get(step.id) : undefined
      if (started) {
        Object.assign(started, step, { at: started.at })
      } else {
        steps.push(step)
        if (step.id) byTool.set(step.id, step)
      }
    }
    return limit ? steps.slice(-limit) : steps
  }

  async function cancellationOf(id) {
    const steps = await readProgress(id)
    await rm(progressFile(id), { force: true })
    return {
      at: new Date().toISOString(),
      changed: [
        ...new Set(
          steps
            // A failed write changed nothing; one cut short by the stop may have.
            .filter((s) => WRITE_KINDS.has(s.kind) && s.state !== 'failed')
            .map((s) => s.label),
        ),
      ],
      steps: steps.length,
    }
  }

  return {
    readAll,
    writeAll,

    list(route) {
      return serialise(async () => {
        const comments = (await readAll()).filter(
          (c) => route === undefined || c.route === route || c.route === APP_ROUTE,
        )
        return Promise.all(
          comments.map(async (c) =>
            isActive(c) && c.claimedAt
              ? { ...c, progress: await readProgress(c.id, PROGRESS_SHOWN) }
              : c,
          ),
        )
      })
    },

    create(input) {
      return serialise(async () => {
        const comments = await readAll()
        const comment = {
          id: randomUUID(),
          ...input,
          status: 'open',
          createdAt: new Date().toISOString(),
        }
        await writeAll([...comments, comment])
        return comment
      })
    },

    update(id, patch) {
      return serialise(async () => {
        const comments = await readAll()
        const index = comments.findIndex((c) => c.id === id)
        if (index === -1) return undefined
        const current = comments[index]
        const { cancelled, followUp, text, ...fields } = patch
        const now = new Date().toISOString()
        if (followUp) {
          fields.status = 'open'
          fields.messages = [
            ...threadOf(current).slice(1),
            { author: 'reader', body: followUp, at: now },
          ]
        }
        if (text && cancelled === false) {
          const last = current.messages?.at(-1)
          if (last?.author === 'reader') {
            fields.messages = [...current.messages.slice(0, -1), { ...last, body: text }]
          } else {
            fields.body = text
          }
        }
        const cancelling = cancelled === true && isActive(current)
        const updated = {
          ...current,
          ...fields,
          cancelledAt: cancelling
            ? now
            : cancelled === false || fields.status
              ? undefined
              : current.cancelledAt,
          cancellation: cancelling ? await cancellationOf(id) : current.cancellation,
          claimedAt:
            fields.status || cancelled !== undefined ? undefined : current.claimedAt,
          resolvedAt:
            fields.status === 'resolved' && current.status !== 'resolved'
              ? now
              : fields.status === 'open'
                ? undefined
                : current.resolvedAt,
        }
        comments[index] = updated
        await writeAll(comments)
        return updated
      })
    },

    remove(id) {
      return serialise(async () => {
        const comments = await readAll()
        const remaining = comments.filter((c) => c.id !== id)
        if (remaining.length === comments.length) return false
        await writeAll(remaining)
        await rm(progressFile(id), { force: true })
        return true
      })
    },
  }
}
