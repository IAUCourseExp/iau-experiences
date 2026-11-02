import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/iau-experiences/',
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
})
