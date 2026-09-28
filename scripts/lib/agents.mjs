import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AGENTS_DIR } from './project.mjs'

const bindingFile = (agent) => path.join(AGENTS_DIR, encodeURIComponent(agent))

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

export async function appendProgress(project, comment, entry) {
  await mkdir(project.progressDir, { recursive: true })
  await appendFile(
    path.join(project.progressDir, `${comment}.jsonl`),
    `${JSON.stringify(entry)}\n`
  )
}

export async function dropProgress(project, comment) {
  await rm(path.join(project.progressDir, `${comment}.jsonl`), { force: true })
}
