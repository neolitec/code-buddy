import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { AGENTS_DIR } from './project.mjs'

const bindingFile = (agent) => path.join(AGENTS_DIR, encodeURIComponent(agent))

/**
 * An agent records a step at least every few minutes while it works; one
 * silent for this long was killed without SubagentStop. hook.sh ignores older
 * files too, so they never slow down every other session.
 */
export const BINDING_TTL_MS = 2 * 60 * 60 * 1000

/** The comment an agent claimed, and the project it belongs to. */
export async function bindingOf(agent) {
  try {
    return JSON.parse(await readFile(bindingFile(agent), 'utf8'))
  } catch {
    return undefined
  }
}

export async function bind(agent, root, comment) {
  await mkdir(AGENTS_DIR, { recursive: true })
  await writeFile(bindingFile(agent), JSON.stringify({ root, comment }))
}

export async function unbind(agent) {
  await rm(bindingFile(agent), { force: true })
}

/** Marks the agent as still working, for pruneBindings and hook.sh. */
export async function touchBinding(agent) {
  const now = new Date()
  await utimes(bindingFile(agent), now, now).catch(() => undefined)
}

/** Removes what agents killed without SubagentStop left behind. */
export async function pruneBindings(now = Date.now()) {
  let names
  try {
    names = await readdir(AGENTS_DIR)
  } catch {
    return
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(AGENTS_DIR, name)
      try {
        if (now - (await stat(file)).mtimeMs > BINDING_TTL_MS) {
          await rm(file, { recursive: true, force: true })
        }
      } catch {}
    }),
  )
}

export async function appendProgress(project, comment, ...entries) {
  if (!entries.length) return
  await mkdir(project.progressDir, { recursive: true })
  await appendFile(
    path.join(project.progressDir, `${comment}.jsonl`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
  )
}

export async function dropProgress(project, comment) {
  await rm(path.join(project.progressDir, `${comment}.jsonl`), { force: true })
}
