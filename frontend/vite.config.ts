/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/  ·  test options: https://vitest.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Tests need no DOM: API tests mock fetch, and screen tests render to
    // static HTML with react-dom/server.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
