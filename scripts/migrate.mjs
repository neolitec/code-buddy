#!/usr/bin/env node
// migrate.mjs --project <dir>
// Moves a project installed under the skill's former name (live-feedback) to
// code-buddy: config file, comments folder, loader marker and .gitignore entry.
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE } from './lib/project.mjs'

const LEGACY = { name: 'live-feedback', loader: 'liveFeedbackLoader' }

const argv = process.argv.slice(2)
const flag = argv.indexOf('--project')
const root = path.resolve(flag === -1 ? process.cwd() : argv[flag + 1])
const at = (file) => path.join(root, file)
const legacyConfig = at(`.${LEGACY.name}.json`)

if (existsSync(at(CONFIG_FILE))) {
  console.log(`nothing to migrate: ${CONFIG_FILE} already exists`)
  process.exit(0)
}
if (!existsSync(legacyConfig)) {
  console.log(`nothing to migrate: no .${LEGACY.name}.json in ${root}`)
  process.exit(0)
}

const config = JSON.parse(await readFile(legacyConfig, 'utf8'))
const port = config.port ?? 4599
try {
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
  if (health.project === root) {
    console.error(
      `a ${LEGACY.name} session still serves this project on port ${port}: close it, then migrate again`
    )
    process.exit(3)
  }
} catch {}

const done = []
const oldDir = `.${LEGACY.name}`
const newDir = '.code-buddy'
if (!config.commentsFile || config.commentsFile.startsWith(`${oldDir}/`)) {
  config.commentsFile = `${newDir}/comments.json`
  if (existsSync(at(oldDir))) {
    if (existsSync(at(newDir))) {
      console.error(`both ${oldDir}/ and ${newDir}/ exist: merge them by hand`)
      process.exit(1)
    }
    await rename(at(oldDir), at(newDir))
    done.push(`moved ${oldDir}/ to ${newDir}/`)
  }
}

for (const file of config.loader ?? []) {
  const source = await readFile(at(file), 'utf8').catch(() => undefined)
  if (source?.includes(LEGACY.loader)) {
    await writeFile(at(file), source.replaceAll(LEGACY.loader, 'codeBuddyLoader'))
    done.push(`updated the loader in ${file}`)
  }
}

const gitignore = await readFile(at('.gitignore'), 'utf8').catch(() => undefined)
if (gitignore?.includes(`/${oldDir}/`)) {
  await writeFile(
    at('.gitignore'),
    gitignore
      .replaceAll(`/${oldDir}/`, `/${newDir}/`)
      .replaceAll(`# ${LEGACY.name} skill`, '# code-buddy skill')
  )
  done.push('updated .gitignore')
}

await writeFile(at(CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`)
await rm(legacyConfig)
done.push(`renamed .${LEGACY.name}.json to ${CONFIG_FILE}`)
console.log(done.map((line) => `- ${line}`).join('\n'))
