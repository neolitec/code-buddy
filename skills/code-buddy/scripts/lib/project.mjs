import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONFIG_FILE = '.code-buddy.json'
export const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
export const WIDGET_VERSION = 1

// Not os.tmpdir(): hooks, sandboxed shells and the server may each see a different TMPDIR.
const STATE_ROOT =
  process.env.CODE_BUDDY_STATE_DIR ??
  path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'code-buddy')

/** Global, project-independent state: which agent works on which comment. */
export const AGENTS_DIR = path.join(STATE_ROOT, 'agents')

/**
 * The project a script acts on: `--project <dir>`, else CODE_BUDDY_PROJECT, else the
 * nearest ancestor of the working directory holding `.code-buddy.json`.
 */
export function findProject(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  const start =
    flag === -1 ? (process.env.CODE_BUDDY_PROJECT ?? process.cwd()) : argv[flag + 1]
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return project(dir)
    if (path.dirname(dir) === dir) return undefined
  }
}

export function project(root) {
  const config = JSON.parse(readFileSync(path.join(root, CONFIG_FILE), 'utf8'))
  const state = path.join(
    STATE_ROOT,
    createHash('sha1').update(root).digest('hex').slice(0, 12),
  )
  return {
    root,
    config,
    commentsFile: path.resolve(
      root,
      process.env.CODE_BUDDY_COMMENTS_FILE ??
        config.commentsFile ??
        '.code-buddy/comments.json',
    ),
    locksDir: path.join(state, 'locks'),
    progressDir: path.join(state, 'progress'),
  }
}

/** Removes `--project <dir>` so the remaining arguments are positional. */
export function positional(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--project')
  return flag === -1 ? argv : argv.filter((_, i) => i !== flag && i !== flag + 1)
}
