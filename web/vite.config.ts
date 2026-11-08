/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The metrics engine lives in supabase/functions/_shared so the exact same code runs
// in the Deno Edge Function (server-side scoring) and in the browser.
const shared = fileURLToPath(new URL('../supabase/functions/_shared', import.meta.url))

export default defineConfig({
  // GitHub Pages serves the app from a sub-path (e.g. /FitCheck-In/); locally it is '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': shared,
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // Local phone testing: `npm run dev:lan` exposes the dev server on the LAN and proxies the
    // local Supabase stack under /sb (REST, auth, functions and the realtime websocket).
    proxy: {
      '/sb': { target: 'http://127.0.0.1:54321', changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/sb/, '') },
    },
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|es-toolkit|immer|redux|react-redux|reselect)/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase/ },
            { name: 'motion', test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/integration/**', 'node_modules/**'],
  },
})
