// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The package boundary from `lat.md/architecture#Architecture#Package Boundary`:
 * `core` never imports `vscode`. Enforced here and, independently, by the
 * source-scanning test in `packages/core/test/package-boundary.test.ts`.
 */
const coreBoundary = {
  files: ['packages/core/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'vscode',
            message:
              'core must never import vscode — see lat.md/architecture#Architecture#Package Boundary',
          },
        ],
        patterns: [
          {
            group: ['vscode', 'vscode/*', '@types/vscode', '@types/vscode/*'],
            message:
              'core must never import vscode — see lat.md/architecture#Architecture#Package Boundary',
          },
        ],
      },
    ],
  },
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'lpg-modeler/**', '**/fixtures/w3c/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  coreBoundary,
)
