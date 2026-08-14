import react from '@vitejs/plugin-react'
import { selfContainedPlugin } from '@in-progress/protocol/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const plugin = mode === 'plugin'
  return {
    base: plugin ? './' : '/',
    define: {
      __TREE_COMPLETE_PLUGIN__: JSON.stringify(plugin),
    },
    plugins: [
      react(),
      ...(plugin ? [selfContainedPlugin({ name: 'tree-complete-self-contained-plugin' })] : []),
    ],
    build: {
      outDir: plugin ? 'dist/plugin' : 'dist/client',
      emptyOutDir: true,
      assetsInlineLimit: plugin ? () => true : undefined,
      cssCodeSplit: !plugin,
      rollupOptions: {
        input: resolve(process.cwd(), plugin ? 'plugin.html' : 'index.html'),
        output: plugin ? { codeSplitting: false } : undefined,
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
