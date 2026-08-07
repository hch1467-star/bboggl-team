import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// base: GitHub Pages serves the project at /<repo>/game/ when deployed from a
// subfolder, so the base path is injected at build time by the CI workflow.
export default defineConfig({
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // 게임과 레벨 에디터, 두 개의 진입점을 빌드합니다.
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
})
