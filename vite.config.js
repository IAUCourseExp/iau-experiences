import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Node's own ESM loader strips POSIX shebangs, but Vite's transform pipeline
// does not for `.mjs` files, so `tools/write-release-time.mjs` (which starts
// with `#!/usr/bin/env node`) reached Node's parser as `#!...` and threw
// "SyntaxError: Invalid or unexpected token" under Vitest. Rewrite the two
// bytes to a line comment — same length (sourcemap-safe), same semantics.
const stripShebang = () => ({
  name: 'strip-shebang',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('.mjs') && code.startsWith('#!')) {
      return { code: '//' + code.slice(2), map: null }
    }
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [stripShebang(), react()],
  base: '/iau-experiences/',
  test: {
    include: ['tests/unit/**/*.test.js'],
    // Local diagnostic scratch tests (test-imports*.test.js etc.) are kept on
    // disk but are not part of the maintained unit suite.
    exclude: ['**/node_modules/**', 'tests/unit/test-*.test.js'],
    environment: 'node',
  },
})
