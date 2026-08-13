import react from '@vitejs/plugin-react'
import { rm, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']+)\\1`, 'i').exec(tag)
  return match?.[2] ?? null
}

function bundlePath(reference: string | null): string | null {
  if (!reference || /^[a-z][a-z\d+.-]*:/i.test(reference)) return null
  return reference.replace(/^\.?\//, '').split(/[?#]/, 1)[0] ?? null
}

function text(source: string | Uint8Array): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source)
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function selfContainedPlugin(): Plugin {
  const consumed = new Set<string>()
  let entryTags: string[] = []
  return {
    name: 'tree-complete-self-contained-plugin',
    apply: 'build',
    enforce: 'post',
    buildStart() {
      consumed.clear()
      entryTags = []
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) throw new Error('Plugin build output is unavailable')

        html = html.replace(/<link\b[^>]*>/gi, (tag) => {
          if (attribute(tag, 'rel')?.toLowerCase() !== 'stylesheet') return tag
          const fileName = bundlePath(attribute(tag, 'href'))
          const output = fileName ? bundle[fileName] : undefined
          if (!fileName || output?.type !== 'asset' || !fileName.endsWith('.css')) return tag
          consumed.add(fileName)
          return `<style>${text(output.source).replace(/<\/style/gi, '<\\/style')}</style>`
        })
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
          const fileName = bundlePath(attribute(tag, 'src'))
          const output = fileName ? bundle[fileName] : undefined
          if (!fileName || output?.type !== 'chunk') return tag
          consumed.add(fileName)
          return `<script type="module">${output.code.replace(/<\/script/gi, '<\\/script')}</script>`
        })
        entryTags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map(([tag]) => tag)
        return html
      },
    },
    generateBundle(_options, bundle) {
      const external = Object.keys(bundle).filter(
        (fileName) => !fileName.endsWith('.html') && !consumed.has(fileName),
      )
      if (external.length > 0) {
        throw new Error(
          `Plugin build emitted uninlined assets: ${external.join(', ')}; entry tags: ${entryTags.join(' ')}`,
        )
      }
    },
    async writeBundle(options) {
      if (!options.dir) throw new Error('Plugin output directory is unavailable')
      const output = resolve(options.dir)
      const directories = new Set<string>()
      for (const fileName of consumed) {
        const file = resolve(output, fileName)
        if (!within(output, file)) throw new Error(`Plugin output escaped build root: ${fileName}`)
        await rm(file)
        for (let directory = dirname(file); directory !== output; directory = dirname(directory)) {
          if (!within(output, directory)) break
          directories.add(directory)
        }
      }
      for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
        if (directory !== output) await rmdir(directory)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const plugin = mode === 'plugin'
  return {
    base: plugin ? './' : '/',
    define: {
      __TREE_COMPLETE_PLUGIN__: JSON.stringify(plugin),
    },
    plugins: [react(), ...(plugin ? [selfContainedPlugin()] : [])],
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
