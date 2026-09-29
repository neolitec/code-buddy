#!/usr/bin/env node
// release-check.mjs <version> <notes-file>
// Checks that the repository is ready to release <version>, then writes that
// version's changelog section to <notes-file>. Run from the repository root,
// with the tags fetched. Exits non-zero, with every problem found, otherwise.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const [requested, notesFile] = process.argv.slice(2)
if (!requested || !notesFile) {
  console.error('usage: release-check.mjs <version> <notes-file>')
  process.exit(2)
}

/** @type {string[]} */
const problems = []

/**
 * @param {string} version
 * @returns {number[]}
 */
const parts = (version) => version.split('.').map(Number)

/**
 * Negative when `a` comes before `b`.
 * @param {string} a
 * @param {string} b
 */
function compare(a, b) {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** @param {string} file */
const readJson = (file) => /** @type {unknown} */ (JSON.parse(readFileSync(file, 'utf8')))

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
const field = (value, key) =>
  typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined

// The version: semver, the one requested, and the only place it is declared.
const version = field(readJson('.claude-plugin/plugin.json'), 'version')
if (typeof version !== 'string' || !SEMVER.test(version)) {
  problems.push(`plugin.json: "version" must be x.y.z, found ${JSON.stringify(version)}`)
} else if (version !== requested) {
  problems.push(`plugin.json declares ${version}, but the release asks for ${requested}`)
}
const entries = field(readJson('.claude-plugin/marketplace.json'), 'plugins')
if (
  Array.isArray(entries) &&
  entries.some((entry) => field(entry, 'version') !== undefined)
) {
  problems.push('marketplace.json: remove "version"; plugin.json alone declares it')
}

// The tag: new, and after every released version.
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
  .split('\n')
  .map((tag) => tag.trim().slice(1))
  .filter((tag) => SEMVER.test(tag))
if (tags.includes(requested)) problems.push(`tag v${requested} already exists`)
const latest = tags.toSorted(compare).at(-1)
if (latest && SEMVER.test(requested) && compare(requested, latest) <= 0) {
  problems.push(`${requested} must be greater than the latest release, ${latest}`)
}

// The changelog: an empty Unreleased section, then this version's, dated and filled.
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const sections = changelog.split(/^## /m).slice(1)
const unreleased = sections.find((section) => section.startsWith('Unreleased'))
if (unreleased === undefined) {
  problems.push('CHANGELOG.md: keep an "## Unreleased" section, empty after a release')
} else if (unreleased.replace(/^Unreleased.*$/m, '').trim()) {
  problems.push('CHANGELOG.md: move the "Unreleased" entries under the version released')
}
const escaped = requested.replaceAll('.', '\\.')
const section = sections.find((s) =>
  new RegExp(`^${escaped} - \\d{4}-\\d{2}-\\d{2}\\s`).test(s),
)
const notes = section?.replace(/^.*\n/, '').trim()
if (!notes) {
  problems.push(`CHANGELOG.md: add a filled "## ${requested} - YYYY-MM-DD" section`)
} else {
  writeFileSync(notesFile, `${notes}\n`)
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${problem}`)
  process.exit(1)
}
console.log(`ready to release ${requested}`)
