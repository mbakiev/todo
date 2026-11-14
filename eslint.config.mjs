import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*',
      '*.config.{ts,mjs,js}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*', 'fs', 'path', 'os', 'react', 'react-dom'],
              message: 'src/shared must stay pure TS (no electron/node/DOM).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'Renderer must only use window.api.' }],
          patterns: [{ group: ['node:*'], message: 'Renderer must only use window.api.' }],
        },
      ],
    },
  },
  {
    // shadcn-generated primitives export variants alongside components.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  prettier,
)
