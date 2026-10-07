// What resolve.mjs and ask.mjs share: Claude files a message under a comment.
import { parseArgs } from 'node:util'
import { findProject, positional } from './project.mjs'
import { MAX_OPTIONS, StoreRefusal, createStore } from './store.mjs'

const MAX_LABEL = 80
const MAX_DESCRIPTION = 300

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

/**
 * A question's arguments: its options, `--option "<label>: <description>"`
 * each (the description is optional), and `--multiple`.
 * @returns {{ args: string[], options: { label: string, description?: string }[], multiple: boolean } | undefined}
 */
function questionArgs() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        option: { type: 'string', multiple: true },
        multiple: { type: 'boolean' },
      },
    })
  } catch {
    return undefined
  }
  const { values, positionals } = parsed
  const options = (values.option ?? []).map((option) => {
    const split = option.indexOf(': ')
    const label = (split === -1 ? option : option.slice(0, split)).trim()
    const description = split === -1 ? '' : option.slice(split + 2).trim()
    return description
      ? {
          label: label.slice(0, MAX_LABEL),
          description: description.slice(0, MAX_DESCRIPTION),
        }
      : { label: label.slice(0, MAX_LABEL) }
  })
  const labels = new Set(options.map((option) => option.label))
  const valid =
    options.length === 0 ||
    (options.length >= 2 &&
      options.length <= MAX_OPTIONS &&
      labels.size === options.length &&
      !labels.has(''))
  if (!valid || (values.multiple && !options.length)) return undefined
  return { args: positionals, options, multiple: values.multiple ?? false }
}

/**
 * @param {string} script
 * @param {{ question: boolean }} options
 */
export async function reply(script, { question }) {
  const asked = question ? questionArgs() : undefined
  const [id, bodyArg] = question ? (asked?.args ?? []) : positional()
  const project = findProject()
  const body = (bodyArg ?? (process.stdin.isTTY ? '' : await readStdin())).trim()
  const what = question ? 'question' : 'answer'
  if (!id || !project || !body || (question && !asked)) {
    console.error(
      question
        ? `usage: ${script} <id> --project <dir> "<question>" (or the question on stdin)\n` +
            `  [--option "<label>: <description>"]... (2 to ${MAX_OPTIONS} distinct labels) [--multiple]`
        : `usage: ${script} <id> --project <dir> "<${what}>" (or the ${what} on stdin)`,
    )
    process.exit(2)
  }
  try {
    const comment = await createStore(project).answer(id, body, {
      question,
      options: asked?.options,
      multiple: asked?.multiple,
    })
    console.log(`${question ? 'asked' : 'resolved'} ${id} (${comment.route})`)
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(`${error.message}; not ${question ? 'asking' : 'resolving'}`)
    process.exit(1)
  }
}
