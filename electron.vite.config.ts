import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'zustand', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities']
    },
    plugins: [react(), tailwindcss()]
  }
})
