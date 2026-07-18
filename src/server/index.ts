import { pathToFileURL } from 'node:url'

import { createApp } from './app.js'

export async function startServer(): Promise<void> {
  const app = await createApp({ logger: true })
  const { host, port } = app.treeCompleteConfig

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down')
    await app.close()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host, port })
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startServer().catch((error: unknown) => {
    process.stderr.write(`tree-complete server failed: ${String(error)}\n`)
    process.exitCode = 1
  })
}
