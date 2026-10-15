/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/  ·  test options: https://vitest.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // API client tests mock fetch and need no DOM. Component tests opt in to
    // a DOM with a `// @vitest-environment jsdom` comment at the top.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
