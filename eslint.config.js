import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'audit-artifacts', 'test-results', 'playwright-report']),
  {
    files: ['src/**/*.{js,jsx}', '*.config.js'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Test tooling runs in Node (Playwright, Vitest config files)
    files: ['tests/**/*.js', '*.config.js', 'tools/**/*.mjs', 'tools/matrix/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { 
        varsIgnorePattern: '^(_|_t|[A-Z]).*$',
        argsIgnorePattern: '^(_|_t|[A-Z])$'
      }],
    },
  },
  {
    // Matrix validation tooling - development tools only
    files: ['tools/matrix/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
])
