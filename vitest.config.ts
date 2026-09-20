import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    alias: {
      // `vscode` is provided by the editor at runtime and cannot be imported in
      // plain Node, which is why `extension.ts` had no test. The stub covers the
      // diagnostics surface only; see packages/vscode/test/vscode-stub.ts.
      vscode: fileURLToPath(new URL('./packages/vscode/test/vscode-stub.ts', import.meta.url)),
    },
  },
})
