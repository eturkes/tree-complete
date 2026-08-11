import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const plugin = mode === 'plugin'
  return {
    base: plugin ? './' : '/',
    define: {
      __TREE_COMPLETE_PLUGIN__: JSON.stringify(plugin),
    },
    plugins: [react()],
    build: {
      outDir: plugin ? 'dist/plugin' : 'dist/client',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(process.cwd(), plugin ? 'plugin.html' : 'index.html'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 4317,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:4318',
      },
    },
  }
})
