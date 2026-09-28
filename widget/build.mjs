import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.tsx'],
  outfile: 'dist/widget.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: '/* code-buddy widget: served by the code-buddy skill in dev only */' },
})
