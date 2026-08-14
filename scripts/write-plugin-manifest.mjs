import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const output = resolve(process.cwd(), 'dist/plugin')
const entry = 'plugin.html'
const manifestName = 'in-progress.plugin.json'

async function files(directory) {
  const found = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name)
    if (item.isDirectory()) found.push(...(await files(path)))
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
const markup = html
  .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>')
  .replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/gi, '$1</style>')
const references = [...markup.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map(
  (match) => match[1],
)
if (assets.length > 0 || references.length > 0) {
  throw new Error(
    `Plugin entry must be self-contained; emitted ${assets.length} external assets and ${references.length} asset references`,
  )
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
