// What resolve.mjs and ask.mjs share: Claude files a message under a comment.
import { findProject, positional } from './project.mjs'
import { StoreRefusal, createStore } from './store.mjs'

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

/**
 * @param {string} script
 * @param {{ question: boolean }} options
 */
export async function reply(script, { question }) {
  const [id, bodyArg] = positional()
  const project = findProject()
  const body = (bodyArg ?? (process.stdin.isTTY ? '' : await readStdin())).trim()
  const what = question ? 'question' : 'answer'
  if (!id || !project || !body) {
    console.error(
      `usage: ${script} <id> --project <dir> "<${what}>" (or the ${what} on stdin)`,
    )
    process.exit(2)
  }
  try {
    const comment = await createStore(project).answer(id, body, { question })
    console.log(`${question ? 'asked' : 'resolved'} ${id} (${comment.route})`)
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(`${error.message}; not ${question ? 'asking' : 'resolving'}`)
    process.exit(1)
  }
}
