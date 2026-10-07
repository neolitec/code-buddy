import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'

export const APP_ROUTE = '*'
/** The most options a question may offer the reader. */
export const MAX_OPTIONS = 6
const PROGRESS_SHOWN = 10
const WRITE_KINDS = new Set(['edit', 'write', 'multiedit'])
// What the agent says and thinks accompanies its steps; it is not one.
const NARRATION_KINDS = new Set(['thinking', 'message'])

/** Open, not stopped by the reader, and not waiting on the reader's answer. */
export const isActive = (comment) =>
  comment.status === 'open' && !comment.cancelledAt && !comment.askedAt

/** Claude asked the reader a question in the thread: nothing to do until they answer. */
export const isAsking = (comment) =>
  comment.status === 'open' && !comment.cancelledAt && !!comment.askedAt

/** A refusal a script reports to the agent and exits on, with nothing written. */
export class StoreRefusal extends Error {}

/** Why an agent may not work on `comment`, in the words the scripts print. */
export const stateOf = (comment) =>
  comment.cancelledAt
    ? 'cancelled'
    : comment.status !== 'open'
      ? comment.status
      : comment.askedAt
        ? "waiting on the reader's answer"
        : 'open'

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

/**
 * The comment's steps, oldest first. A tool writes one line when it starts and
 * one when it ends or fails, both with its tool_use_id: they merge into one
 * step, in the place where it started.
 * @param {{ progressDir: string }} project
 * @param {string} id
 * @param {number} [limit]
 */
export async function readProgress(project, id, limit) {
  let lines
  try {
    lines = (await readFile(progressPath(project, id), 'utf8')).trim().split('\n')
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

const progressPath = (project, id) => path.join(project.progressDir, `${id}.jsonl`)

/**
 * The reader's answer to Claude's question: the options they chose, from the
 * ones it offered, then their own words. Undefined when it says nothing.
 * @param {any} comment
 * @param {string | undefined} text
 * @param {string[] | undefined} choices
 * @returns {{ body: string, choices?: string[] } | undefined}
 */
function readerReply(comment, text, choices) {
  const asked = isAsking(comment) ? comment.messages?.at(-1) : undefined
  /** @type {string[]} */
  const offered = asked?.options?.map((option) => option.label) ?? []
  const valid = offered.filter((label) => choices?.includes(label))
  const chosen = asked?.multiple ? valid : valid.slice(0, 1)
  const body = [chosen.join(', '), text ?? ''].filter(Boolean).join('\n\n')
  if (!body) return undefined
  return chosen.length ? { body, choices: chosen } : { body }
}

export const normaliseQuote = (text) => text.replace(/\s+/g, ' ').trim()

export function createStore(project) {
  const file = project.commentsFile
  const progressFile = (id) => progressPath(project, id)
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

  /**
   * A read-modify-write: in order within this process, and under the file lock
   * against the others.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const exclusive = (task) => serialise(() => withFileLock(file, task))

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

  async function cancellationOf(id) {
    const steps = await readProgress(project, id)
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
      steps: steps.filter((s) => !NARRATION_KINDS.has(s.kind)).length,
    }
  }

  return {
    readAll,

    /**
     * Runs `change` on every comment, under the lock, and writes the result.
     * Throwing a StoreRefusal from it writes nothing.
     * @template T
     * @param {(comments: any[]) => Promise<T> | T} change
     * @returns {Promise<T>}
     */
    transact(change) {
      return exclusive(async () => {
        const comments = await readAll()
        const result = await change(comments)
        await writeAll(comments)
        return result
      })
    },

    /**
     * Files Claude's answer under the comment. A question leaves the comment
     * open and waiting on the reader: asked only in the manager's chat, it used
     * to leave a thread open with no answer and no agent, showing "Waiting for
     * Claude" to a reader who was the one being waited on. The run's steps are
     * dropped: comments.json holds the discussion, not the agent's log.
     * A question may offer `options`, the reader picking one, or several when
     * `multiple`; they can always answer in their own words instead.
     * @param {string} id
     * @param {string} body
     * @param {{ question?: boolean, options?: { label: string, description?: string }[], multiple?: boolean }} [options]
     */
    answer(id, body, { question = false, options, multiple = false } = {}) {
      return exclusive(async () => {
        const comments = await readAll()
        const comment = comments.find((entry) => entry.id === id)
        if (!comment) throw new StoreRefusal(`no comment with id ${id}`)
        if (!isActive(comment)) {
          throw new StoreRefusal(`comment ${id} is ${stateOf(comment)}`)
        }
        const now = new Date().toISOString()
        comment.messages = [
          ...threadOf(comment).slice(1),
          {
            author: 'claude',
            body,
            at: now,
            ...(question ? { question: true } : {}),
            ...(question && options?.length ? { options } : {}),
            ...(question && options?.length && multiple ? { multiple: true } : {}),
          },
        ]
        if (question) {
          comment.askedAt = now
        } else {
          comment.status = 'resolved'
          comment.resolution = body
          comment.resolvedAt = now
        }
        delete comment.claimedAt
        await writeAll(comments)
        await rm(progressFile(id), { force: true })
        return comment
      })
    },

    list(route) {
      return serialise(async () => {
        const comments = (await readAll()).filter(
          (c) => route === undefined || c.route === route || c.route === APP_ROUTE,
        )
        return Promise.all(
          // Only a run in progress has steps to show.
          comments.map(async (c) => {
            if (!isActive(c) || !c.claimedAt) return c
            const progress = await readProgress(project, c.id, PROGRESS_SHOWN)
            return progress.length ? { ...c, progress } : c
          }),
        )
      })
    },

    create(input) {
      return exclusive(async () => {
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
      return exclusive(async () => {
        const comments = await readAll()
        const index = comments.findIndex((c) => c.id === id)
        if (index === -1) return undefined
        const current = comments[index]
        const { cancelled, followUp, choices, text, ...fields } = patch
        const now = new Date().toISOString()
        const reply = readerReply(current, followUp, choices)
        if (reply) {
          fields.status = 'open'
          fields.messages = [
            ...threadOf(current).slice(1),
            { author: 'reader', ...reply, at: now },
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
          // The reader's answer, or resolving it themselves, ends the wait.
          askedAt: fields.status ? undefined : current.askedAt,
          resolvedAt:
            fields.status === 'resolved' && current.status !== 'resolved'
              ? now
              : fields.status === 'open'
                ? undefined
                : current.resolvedAt,
        }
        comments[index] = updated
        await writeAll(comments)
        // Resolved by the reader: no answer to file the steps under.
        if (fields.status === 'resolved') await rm(progressFile(id), { force: true })
        return updated
      })
    },

    remove(id) {
      return exclusive(async () => {
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
