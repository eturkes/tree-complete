const server = await import(new URL('../dist/server/server/embedded.js', import.meta.url))
if (typeof server.createEmbeddedService !== 'function') {
  throw new Error('Built server does not export createEmbeddedService')
}
if (typeof server.preflightProjectManifest !== 'function') {
  throw new Error('Built server does not export preflightProjectManifest')
}
if (server.TREE_COMPLETE_PUBLIC_RESPONSE_MAX_BYTES !== 4 * 1024 * 1024) {
  throw new Error('Built server does not export the 4 MiB public response contract')
}

process.stdout.write('Tree Complete server: embedded service + preflight exports ready\n')
