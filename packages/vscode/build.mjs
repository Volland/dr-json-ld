/**
 * Bundling the extension for distribution.
 *
 * `tsc` typechecks the workspace and emits ESM with a bare import of
 * `@jsonld-modeler/core`, which is neither loadable by the VS Code extension
 * host (it requires CommonJS) nor resolvable on a user's machine (core is a
 * workspace package and is not published to npm). So the shipped artifact is
 * produced here instead: one CommonJS file with core inlined, and one browser
 * bundle for the webview.
 *
 * See lat.md/architecture#Distribution.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const production = !process.argv.includes('--watch')

/**
 * The extension host. `vscode` is provided by the host at runtime and is the
 * one thing that must stay external; everything else is inlined so the
 * published extension depends on nothing it did not ship.
 */
await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
})

/**
 * The canvas. A webview is a sandboxed iframe with no module loader and no
 * network, so this has to be one self-contained IIFE.
 */
await build({
  entryPoints: ['webview/src/canvas.tsx'],
  outfile: 'dist/webview/canvas.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: !production,
  minify: production,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})

/**
 * React Flow ships its own stylesheet and does not lay out correctly without
 * it. Nothing imports it, so it is concatenated ahead of the canvas styles
 * rather than left to a `<link>` the webview's content security policy would
 * have to allow.
 */
await mkdir('dist/webview', { recursive: true })
const flow = await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8')
const canvas = await readFile('webview/src/canvas.css', 'utf8')
await writeFile('dist/webview/canvas.css', `${flow}\n${canvas}`)
console.log('  dist/webview/canvas.css')
