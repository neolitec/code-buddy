import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'

// --dev: the build /playground uses, with the debug panel. --outdir: somewhere else than dist/.
const { values: options } = parseArgs({
  options: {
    dev: { type: 'boolean', default: false },
    outdir: { type: 'string', default: 'dist' },
  },
})

// The widget shows the plugin's version: plugin.json is its only source.
const { version } = JSON.parse(
  readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8'),
)

const result = await build({
  entryPoints: ['src/main.tsx'],
  outfile: path.join(options.outdir, 'widget.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  // Small images and the font are inlined: the widget stays a single file.
  loader: { '.webp': 'dataurl', '.woff2': 'dataurl' },
  minify: true,
  // Keep the bundled dependencies' license notices (React is MIT): at the end of the file.
  legalComments: 'eof',
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    CODE_BUDDY_VERSION: JSON.stringify(version),
    // false drops the debug panel from the bundle: the released one never has it.
    CODE_BUDDY_DEBUG: JSON.stringify(options.dev),
  },
  banner: {
    js: options.dev
      ? '/* code-buddy widget (dev build, with the debug panel): served by the code-buddy skill in dev only */'
      : '/* code-buddy widget: served by the code-buddy skill in dev only */',
  },
})

// Their licenses ask for their full text to ship with them: collect it from every
// package the bundle actually contains.
const packageDirs = new Set()
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)
  if (match?.[1]) packageDirs.add(match[1])
}
const notices = [...packageDirs]
  .toSorted((a, b) => a.localeCompare(b))
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const licenseFile = readdirSync(dir).find((file) => /^licen[cs]e(\.|$)/i.test(file))
    if (!licenseFile) {
      throw new Error(`${pkg.name} is bundled but ships no license file`)
    }
    const text = readFileSync(path.join(dir, licenseFile), 'utf8').trim()
    return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}\n`
  })
// The font is vendored, not a package: its license sits next to it.
const ofl = readFileSync('src/assets/fonts/OFL.txt', 'utf8').trim()
notices.push(`Figtree (OFL-1.1)\n\n${ofl}\n`)
writeFileSync(
  path.join(options.outdir, 'THIRD_PARTY_LICENSES.txt'),
  `The Code Buddy widget (widget.js) bundles the following packages and font.\n\n${notices.join(
    `\n${'-'.repeat(80)}\n\n`,
  )}`,
)
