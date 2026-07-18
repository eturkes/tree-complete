import { setTimeout as delay } from 'node:timers/promises'

import type { AgentRunner, RunnerContext, RunnerResult } from './types.js'

export class PreviewRunner implements AgentRunner {
  readonly mode = 'preview' as const

  constructor(private readonly phaseDelayMs = 55) {}

  async run(context: RunnerContext): Promise<RunnerResult> {
    await delay(this.phaseDelayMs)
    await context.transition({
      phase: 'preparing',
      progress: 18,
      message: `Pinned ${context.baseVersion.name} as the fork baseline.`,
    })
    await delay(this.phaseDelayMs)
    await context.transition({
      phase: 'generating',
      progress: 52,
      message: `Applying “${context.toAlternative.label}” across the affected design surface.`,
    })
    await delay(this.phaseDelayMs)
    await context.transition({
      phase: 'verifying',
      progress: 84,
      message: 'Simulating diff review and focused checks.',
    })
    await delay(this.phaseDelayMs)

    return {
      commit: `preview-${context.run.id.replaceAll('-', '').slice(0, 10)}`,
      changedFiles: 3 + (context.decision.id.length % 5),
      summary: `${context.decision.title}: ${context.toAlternative.label}`,
    }
  }
}
