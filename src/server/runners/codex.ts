import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { safeSlug } from '../git.js'
import {
  PROJECT_MANIFEST_PATH,
  assertWorktreeManifestMatches,
  manifestToDesignDecisions,
  readWorktreeManifest,
  writeWorktreeManifestSelection,
} from '../manifest.js'
import { execFileChecked, ProcessExitError, spawnCaptured } from '../process.js'
import type { AgentRunner, RunnerContext, RunnerResult } from './types.js'

export interface CodexRunnerOptions {
  repository: string
  dataDir: string
  timeoutMs?: number
  codexExecutable?: string
}

export class CodexRunner implements AgentRunner {
  readonly mode = 'codex' as const
  private readonly timeoutMs: number
  private readonly codexExecutable: string

  constructor(private readonly options: CodexRunnerOptions) {
    this.timeoutMs = options.timeoutMs ?? 30 * 60_000
    this.codexExecutable = options.codexExecutable ?? 'codex'
  }

  async run(context: RunnerContext): Promise<RunnerResult> {
    await context.transition({
      phase: 'preparing',
      progress: 12,
      message: `Creating an isolated worktree at ${shortCommit(context.baseVersion.commit)}.`,
    })
    await this.assertCommit(context.baseVersion.commit)

    const worktreeRoot = join(this.options.dataDir, 'worktrees')
    const worktree = join(worktreeRoot, safeSlug(context.run.id, 'run'))
    await mkdir(worktreeRoot, { recursive: true, mode: 0o700 })
    await safeGit(
      this.options.repository,
      [
        'worktree',
        'add',
        '-b',
        context.version.branch,
        worktree,
        context.baseVersion.commit,
      ],
      60_000,
    )
    await context.setWorktree(worktree)
    const expectedIdentity = await worktreeIdentity(worktree)
    if (
      expectedIdentity.topLevel !== (await realpath(worktree)) ||
      expectedIdentity.branch !== `refs/heads/${context.version.branch}`
    ) {
      throw new Error('Git created an unexpected worktree identity.')
    }
    const baseManifest = await readWorktreeManifest(worktree)
    if (!isDeepStrictEqual(manifestToDesignDecisions(baseManifest), context.baseVersion.decisions)) {
      throw new Error('The pinned manifest does not match the selected version design state.')
    }
    const expectedManifest = await writeWorktreeManifestSelection(
      worktree,
      baseManifest,
      context.decision.id,
      context.toAlternative.id,
    )

    await context.transition({
      phase: 'generating',
      progress: 35,
      message: `Codex is implementing “${context.toAlternative.label}”.`,
    })

    try {
      await spawnCaptured(
        this.codexExecutable,
        [
          '--ask-for-approval',
          'never',
          'exec',
          '--ignore-user-config',
          '-c',
          'shell_environment_policy.inherit="none"',
          '--ephemeral',
          '--sandbox',
          'workspace-write',
          '-C',
          worktree,
          '-',
        ],
        {
          cwd: worktree,
          input: focusedPrompt(context),
          maxCaptureBytes: 64 * 1024,
          timeoutMs: this.timeoutMs,
          env: codexEnvironment(),
        },
      )
    } catch (error) {
      if (error instanceof ProcessExitError) {
        context.diagnostic('Codex process failed', {
          message: error.message,
          stdoutTail: error.result.stdout,
          stderrTail: error.result.stderr,
          stdoutTruncated: error.result.stdoutTruncated,
          stderrTruncated: error.result.stderrTruncated,
        })
      }
      throw new Error('Codex did not complete the requested implementation.', { cause: error })
    }

    await context.transition({
      phase: 'verifying',
      progress: 82,
      message: 'Inspecting the generated diff before creating its commit.',
    })

    const actualIdentity = await worktreeIdentity(worktree)
    assertSameIdentity(expectedIdentity, actualIdentity)
    await assertWorktreeManifestMatches(worktree, expectedManifest)
    const generatedHead = (
      await safeGit(worktree, ['rev-parse', '--verify', 'HEAD^{commit}'])
    ).stdout.trim()
    if (generatedHead !== context.baseVersion.commit) {
      try {
        await safeGit(worktree, [
          'merge-base',
          '--is-ancestor',
          context.baseVersion.commit,
          generatedHead,
        ])
      } catch {
        throw new Error('Codex changed Git history outside the pinned base lineage.')
      }
      await safeGit(worktree, ['reset', '--soft', context.baseVersion.commit])
    }

    const status = (
      await safeGit(worktree, ['status', '--porcelain=v1', '--untracked-files=all'])
    ).stdout
    if (!status.trim()) {
      throw new Error('Codex produced no file changes for the selected alternative.')
    }

    await safeGit(worktree, ['add', '--all'])
    await safeGit(worktree, ['diff', '--cached', '--check'])
    const changedNames = (
      await safeGit(worktree, ['diff', '--cached', '--name-only', '-z', '--'])
    ).stdout
      .split('\0')
      .filter(Boolean)
    if (!changedNames.some((name) => name !== PROJECT_MANIFEST_PATH)) {
      throw new Error('Codex changed the design manifest but produced no implementation changes.')
    }

    const choiceLabel = context.toAlternative.label.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 72)
    const commitMessage = `feat(${safeSlug(context.decision.id)}): choose ${choiceLabel}`
    await safeGit(worktree, ['commit', '--no-verify', '--message', commitMessage], 60_000)
    const commit = (
      await safeGit(worktree, ['rev-parse', '--verify', 'HEAD^{commit}'])
    ).stdout.trim()
    const committedNames = (
      await safeGit(worktree, [
        'diff',
        '--name-only',
        '-z',
        `${context.baseVersion.commit}..${commit}`,
        '--',
      ])
    ).stdout
      .split('\0')
      .filter(Boolean)
    const committedIdentity = await worktreeIdentity(worktree)
    assertSameIdentity(expectedIdentity, committedIdentity)
    await assertWorktreeManifestMatches(worktree, expectedManifest)
    const branchCommit = (
      await safeGit(worktree, [
        'rev-parse',
        '--verify',
        `refs/heads/${context.version.branch}^{commit}`,
      ])
    ).stdout.trim()
    if (branchCommit !== commit) {
      throw new Error('The fork branch does not resolve to the generated commit.')
    }
    const parentCommit = (
      await safeGit(worktree, ['rev-parse', '--verify', `${commit}^`])
    ).stdout.trim()
    if (parentCommit !== context.baseVersion.commit) {
      throw new Error('The generated commit is not a direct child of the pinned base.')
    }
    if ((await safeGit(worktree, ['status', '--porcelain=v1'])).stdout.trim()) {
      throw new Error('The host-created fork commit left uncommitted changes.')
    }

    return {
      commit,
      changedFiles: committedNames.length,
      summary: `${context.decision.title}: ${context.toAlternative.label}`,
    }
  }

  private async assertCommit(commit: string): Promise<void> {
    if (!/^[0-9a-f]{40,64}$/i.test(commit)) {
      throw new Error('The selected base version is not pinned to a full Git commit.')
    }
    await safeGit(this.options.repository, ['cat-file', '-e', `${commit}^{commit}`], 15_000)
  }
}

interface WorktreeIdentity {
  gitDir: string
  commonDir: string
  topLevel: string
  branch: string
}

const HOST_GIT_CONFIG = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'user.name=Tree Complete',
  '-c',
  'user.email=tree-complete@localhost',
] as const

async function safeGit(
  worktree: string,
  args: readonly string[],
  timeoutMs = 30_000,
) {
  return await execFileChecked('git', [...HOST_GIT_CONFIG, '-C', worktree, ...args], {
    env: safeGitEnvironment(),
    timeoutMs,
  })
}

async function worktreeIdentity(worktree: string): Promise<WorktreeIdentity> {
  const gitDir = (
    await safeGit(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'])
  ).stdout.trim()
  const commonDir = (
    await safeGit(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).stdout.trim()
  const topLevel = (await safeGit(worktree, ['rev-parse', '--show-toplevel'])).stdout.trim()
  const branch = (await safeGit(worktree, ['symbolic-ref', '--quiet', 'HEAD'])).stdout.trim()
  return {
    gitDir: await realpath(gitDir),
    commonDir: await realpath(commonDir),
    topLevel: await realpath(topLevel),
    branch,
  }
}

function assertSameIdentity(expected: WorktreeIdentity, actual: WorktreeIdentity): void {
  for (const key of ['gitDir', 'commonDir', 'topLevel', 'branch'] as const) {
    if (expected[key] !== actual[key]) {
      throw new Error(`The generated worktree changed its Git ${key} identity.`)
    }
  }
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  return selectedEnvironment([
    'PATH',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ], {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  })
}

function codexEnvironment(): NodeJS.ProcessEnv {
  return selectedEnvironment([
    'PATH',
    'HOME',
    'CODEX_HOME',
    'OPENAI_API_KEY',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ], { NO_COLOR: '1' })
}

function selectedEnvironment(
  names: readonly string[],
  additions: Record<string, string>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...additions }
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function focusedPrompt(context: RunnerContext): string {
  return `You are creating one focused program fork from an explicit design decision.

Project version: ${context.baseVersion.name}
Pinned base commit: ${context.baseVersion.commit}
Decision: ${context.decision.title}
Question: ${context.decision.question}
Current choice: ${context.fromAlternative.label} — ${context.fromAlternative.description}
Target choice: ${context.toAlternative.label} — ${context.toAlternative.description}
Expected impact: ${context.toAlternative.impact}

Implementation brief:
${context.toAlternative.agentBrief}

Work method:
- Read the repository instructions and inspect the existing implementation before editing.
- Implement the target choice as a minimal, complete, coherent change; preserve unrelated behavior.
- Update or add focused tests and documentation when the design change requires them.
- Run the repository's relevant validation commands and resolve failures caused by the change.
- Preserve the host-owned .tree-complete/project.json file byte-for-byte.
- Finish with verified working-tree changes. Orchestration owns Git staging and the commit.
- Return a concise implementation and validation summary.
`
}

function shortCommit(commit: string): string {
  return commit.slice(0, 10)
}
