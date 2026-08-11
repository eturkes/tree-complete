import { realpath, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { execFileChecked } from './process.js'

export interface GitRepositoryMetadata {
  root: string
  branch: string
  commit: string
  name: string
}

export async function inspectGitRepository(path: string): Promise<GitRepositoryMetadata> {
  const candidate = await realpath(resolve(path))
  if (!(await stat(candidate)).isDirectory()) {
    throw new Error(`TREE_COMPLETE_TARGET_REPO is not a directory: ${candidate}`)
  }
  const bare = (
    await execFileChecked('git', ['-C', candidate, 'rev-parse', '--is-bare-repository'], {
      env: isolatedGitEnvironment(),
      timeoutMs: 15_000,
    })
  ).stdout.trim()
  if (bare === 'true') {
    throw new Error('TREE_COMPLETE_TARGET_REPO must be a non-bare Git working tree')
  }
  const rootOutput = await execFileChecked(
    'git',
    ['-C', candidate, 'rev-parse', '--show-toplevel'],
    { env: isolatedGitEnvironment(), timeoutMs: 15_000 },
  )
  const root = await realpath(rootOutput.stdout.trim())
  const commit = (
    await execFileChecked('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}'], {
      env: isolatedGitEnvironment(),
      timeoutMs: 15_000,
    })
  ).stdout.trim()

  let branch = 'detached-head'
  try {
    branch = (
      await execFileChecked('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
        env: isolatedGitEnvironment(),
        timeoutMs: 15_000,
      })
    ).stdout.trim()
  } catch {
    // A detached target is valid; forks remain pinned to its full commit.
  }

  return { root, branch, commit, name: basename(root) }
}

export function isolatedGitEnvironment(
  additionalNames: readonly string[] = [],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'advice.graftFileDeprecated',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_GRAFT_FILE: '/dev/null',
    GIT_SHALLOW_FILE: '/dev/null',
  }
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', ...additionalNames]) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

export function safeSlug(input: string, fallback = 'choice'): string {
  const value = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
  return value || fallback
}
