import { defineConfig } from 'vite'

// base: GitHub Pages serves the project at /<repo>/game/ when deployed from a
// subfolder, so the base path is injected at build time by the CI workflow.
export default defineConfig({
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
})
