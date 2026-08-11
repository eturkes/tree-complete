const server = await import(new URL('../dist/server/server/embedded.js', import.meta.url))
if (typeof server.createEmbeddedService !== 'function') {
  throw new Error('Built server does not export createEmbeddedService')
}

process.stdout.write('Tree Complete server: createEmbeddedService export ready\n')
