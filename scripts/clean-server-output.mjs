import { rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const output = resolve(projectRoot, 'dist/server')
if (relative(projectRoot, output) !== join('dist', 'server')) {
  throw new Error(`Refusing to clean unexpected server output: ${output}`)
}

await rm(output, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
