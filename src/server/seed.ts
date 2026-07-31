import type {
  DesignDecision,
  ProjectDescriptor,
  RunnerDescriptor,
  Workspace,
} from '../shared/model.js'

export interface SeedWorkspaceOptions {
  runner: RunnerDescriptor
  project?: Partial<ProjectDescriptor>
  rootBranch?: string
  rootCommit?: string
  decisions?: DesignDecision[]
  now?: () => Date
}

const SEED_TIME = '2026-01-12T09:30:00.000Z'

export function seedDecisions(): DesignDecision[] {
  return [
    {
      id: 'data-boundary',
      title: 'Data boundary',
      question: 'Where does canonical project state live?',
      rationale:
        'The source of truth controls offline behavior, collaboration cost, and how safely a fork can be reproduced.',
      chosenAlternativeId: 'local-json',
      alternatives: [
        {
          id: 'local-json',
          label: 'Local JSON ledger',
          description: 'Keep a compact, inspectable state document beside the project.',
          impact: 'Fast startup and simple recovery with single-writer semantics.',
          agentBrief:
            'Use an atomically replaced JSON document as the canonical store. Preserve a small typed storage boundary so another backend can be introduced later.',
          signal: 'recommended',
        },
        {
          id: 'sqlite',
          label: 'Embedded SQLite',
          description: 'Persist normalized versions, decisions, and run events in SQLite.',
          impact: 'Stronger queries and transactions at the cost of a binary dependency.',
          agentBrief:
            'Replace the JSON persistence adapter with an embedded SQLite store. Model versions, decisions, alternatives, runs, and logs transactionally and retain the public API.',
          signal: 'balanced',
        },
        {
          id: 'event-log',
          label: 'Append-only event log',
          description: 'Derive current state by folding immutable domain events.',
          impact: 'Excellent provenance and replay, with more projection machinery.',
          agentBrief:
            'Represent every workspace mutation as an immutable event. Add deterministic projection and recovery code while keeping snapshots optional and disposable.',
          signal: 'experimental',
        },
      ],
    },
    {
      id: 'execution-isolation',
      title: 'Execution isolation',
      question: 'How should generated forks be isolated from the source checkout?',
      rationale:
        'Agents need real files and Git history, while unfinished experiments must stay out of the working branch.',
      chosenAlternativeId: 'git-worktree',
      alternatives: [
        {
          id: 'git-worktree',
          label: 'Git worktree',
          description: 'Give every fork a dedicated branch and linked checkout.',
          impact: 'Low disk overhead, native diffs, and immediately inspectable output.',
          agentBrief:
            'Create each generated version in a dedicated Git worktree rooted at its exact parent commit. Use sanitized, collision-resistant branch names and retain the worktree for inspection.',
          signal: 'recommended',
        },
        {
          id: 'full-clone',
          label: 'Ephemeral clone',
          description: 'Clone the repository into a fully independent directory per run.',
          impact: 'Clear isolation with higher setup and storage cost.',
          agentBrief:
            'Replace linked worktrees with local clones. Pin the clone to the parent commit, create a fork branch, and expose the resulting repository location through the run model.',
          signal: 'balanced',
        },
        {
          id: 'container',
          label: 'Disposable container',
          description: 'Execute each coding run inside a constrained container.',
          impact: 'Stronger process isolation but substantially more orchestration.',
          agentBrief:
            'Run generation and verification inside a disposable rootless container with a narrowly mounted checkout, explicit resource limits, and an exported Git commit as the only result.',
          signal: 'experimental',
        },
      ],
    },
    {
      id: 'agent-feedback',
      title: 'Agent feedback',
      question: 'How much execution detail should the interface expose?',
      rationale:
        'Useful progress builds trust, but raw model output is noisy and can disclose repository details.',
      chosenAlternativeId: 'phased-status',
      alternatives: [
        {
          id: 'phased-status',
          label: 'Curated phases',
          description: 'Show stable phases, progress, and short orchestration messages.',
          impact: 'Readable and safe, while retaining enough evidence to diagnose failures.',
          agentBrief:
            'Keep a curated run timeline with queued, preparing, generating, verifying, and terminal phases. Store bounded, human-readable orchestration messages rather than raw agent output.',
          signal: 'recommended',
        },
        {
          id: 'terminal-stream',
          label: 'Live terminal stream',
          description: 'Stream sanitized subprocess output into a terminal-style panel.',
          impact: 'Maximum immediacy with redaction, backpressure, and retention concerns.',
          agentBrief:
            'Add a bounded server-sent event stream for sanitized agent output. Apply backpressure, redact secrets and absolute paths, and retain only a concise terminal summary.',
          signal: 'balanced',
        },
        {
          id: 'result-only',
          label: 'Result only',
          description: 'Keep a run quiet until a commit or failure is available.',
          impact: 'Minimal interface noise, but long runs appear inert.',
          agentBrief:
            'Collapse active-run feedback into a single pending state. Publish only the final commit summary or normalized failure, preserving internal diagnostics in server logs.',
          signal: 'experimental',
        },
      ],
    },
    {
      id: 'verification-policy',
      title: 'Verification policy',
      question: 'What evidence is required before a generated fork is complete?',
      rationale:
        'A branch existing is weaker evidence than a focused change that passes the project’s own checks.',
      chosenAlternativeId: 'targeted-checks',
      alternatives: [
        {
          id: 'targeted-checks',
          label: 'Targeted checks',
          description: 'Ask the agent to run checks relevant to the edited surface, then enforce a clean diff.',
          impact: 'Good signal-to-runtime balance across unfamiliar repositories.',
          agentBrief:
            'Derive verification from the changed surface and existing project commands. Run focused tests plus static checks, then require a non-empty, whitespace-clean diff before commit.',
          signal: 'recommended',
        },
        {
          id: 'full-suite',
          label: 'Full project suite',
          description: 'Run every declared project check for every generated fork.',
          impact: 'Higher confidence when suites are reliable, with slower feedback.',
          agentBrief:
            'Discover the repository’s canonical complete validation workflow and require it before committing any fork. Record failed command names as structured diagnostics.',
          signal: 'balanced',
        },
        {
          id: 'review-council',
          label: 'Agent review council',
          description: 'Have independent agents test and adversarially review the implementation.',
          impact: 'Broad semantic scrutiny at materially greater compute and latency.',
          agentBrief:
            'After implementation, invoke independent test and adversarial-review agents. Reconcile findings, fix confirmed defects, and commit only after both reviewers approve the result.',
          signal: 'experimental',
        },
      ],
    },
  ]
}

export function createSeedWorkspace(options: SeedWorkspaceOptions): Workspace {
  const initializedAt = (options.now ?? (() => new Date()))().toISOString()
  const project: ProjectDescriptor = {
    id: options.project?.id ?? 'tree-complete',
    name: options.project?.name ?? 'Tree Complete',
    description:
      options.project?.description ??
      'Explore a program as a living tree of explicit, forkable design decisions.',
    repository: options.project?.repository ?? 'local://tree-complete-demo',
    defaultBranch: options.project?.defaultBranch ?? options.rootBranch ?? 'main',
  }

  return {
    project,
    runner: options.runner,
    versions: [
      {
        id: 'root',
        parentId: null,
        name: 'Current design',
        branch: options.rootBranch ?? project.defaultBranch,
        commit: options.rootCommit ?? 'preview-root',
        createdAt: SEED_TIME,
        status: 'ready',
        summary: 'The baseline program and its current architectural choices.',
        decisions: structuredClone(options.decisions ?? seedDecisions()),
      },
    ],
    runs: [],
    updatedAt: initializedAt,
  }
}
