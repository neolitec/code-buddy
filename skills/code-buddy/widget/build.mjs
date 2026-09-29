import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

// The widget shows the plugin's version: plugin.json is its only source.
const { version } = JSON.parse(
  readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8'),
)

await build({
  entryPoints: ['src/main.tsx'],
  outfile: 'dist/widget.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  // Small images are inlined: the widget stays a single file.
  loader: { '.webp': 'dataurl' },
  minify: true,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
    CODE_BUDDY_VERSION: JSON.stringify(version),
  },
  banner: { js: '/* code-buddy widget: served by the code-buddy skill in dev only */' },
})
