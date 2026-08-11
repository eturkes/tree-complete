import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const output = resolve(process.cwd(), 'dist/plugin')
const entry = 'plugin.html'
const manifestName = 'in-progress.plugin.json'

async function files(directory) {
  const found = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name)
    if (item.isDirectory()) found.push(...await files(path))
    else if (item.isFile()) found.push(relative(output, path).split(sep).join('/'))
    else throw new Error(`Plugin build contains a non-file asset: ${item.name}`)
  }
  return found
}

const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
const emitted = (await files(output)).sort()
if (!emitted.includes(entry)) throw new Error(`Plugin entry is missing: ${entry}`)
const assets = emitted.filter((path) => path !== entry && path !== manifestName)
const html = await readFile(resolve(output, entry), 'utf8')
const references = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1])
for (const reference of references) {
  if (!reference.startsWith('./')) {
    throw new Error(`Plugin entry contains a non-relative asset reference: ${reference}`)
  }
  const asset = reference.slice(2).split(/[?#]/, 1)[0]
  if (!assets.includes(asset)) {
    throw new Error(`Plugin entry references an asset outside the allowlist: ${reference}`)
  }
}
const manifest = {
  apiVersion: '1.0',
  id: 'tree-complete',
  name: 'Tree Complete',
  version: packageJson.version,
  description: 'Explorable program lineage from explicit design decisions',
  entry,
  assets,
  icon: 'git-branch',
  capabilities: ['tree-complete.workspace', 'tree-complete.createFork'],
}
await writeFile(resolve(output, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
process.stdout.write(`Tree Complete plugin: ${assets.length} allowlisted assets\n`)
