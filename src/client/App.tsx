import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRun, CreateForkRequest, ProgramVersion, RunnerMode } from '../shared/model'
import { isRunActive } from '../shared/model'
import { createFork, readableError } from './api'
import { Icon } from './components/Icon'
import { Inspector } from './components/Inspector'
import { RunDock } from './components/RunDock'
import {
  VersionNode,
  type VersionFlowNode,
} from './components/VersionNode'
import { layoutVersionTree, lineageEdges } from './layout'
import { useWorkspace } from './useWorkspace'

const nodeTypes: NodeTypes = { version: VersionNode }
const preserveNodeInteractions = () => undefined

interface Selection {
  versionId: string
  decisionId: string
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'recently'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

function Header({
  projectName,
  repository,
  defaultBranch,
  runnerLabel,
  runnerMode,
  runnerAvailable,
  activeRuns,
  updatedAt,
  refreshing,
  onRefresh,
}: {
  projectName: string
  repository: string
  defaultBranch: string
  runnerLabel: string
  runnerMode: RunnerMode
  runnerAvailable: boolean
  activeRuns: number
  updatedAt: string
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <header className="app-header">
      <a className="brand" href="#main" aria-label="Tree Complete home">
        <span className="brand__mark"><Icon name="tree" size={22} /></span>
        <span><strong>tree</strong><em>complete</em></span>
      </a>
      <div className="project-heading">
        <span className="project-heading__eyebrow">Program map</span>
        <h1>{projectName}</h1>
        <span className="project-heading__repo">
          <Icon name="code" size={13} />{repository}<span>/</span>{defaultBranch}
        </span>
      </div>
      <div className="header-actions">
        <div className={`runner-pill ${runnerAvailable ? '' : 'runner-pill--offline'}`} title={`${runnerLabel}: ${runnerAvailable ? 'available' : 'unavailable'}`}>
          <span className="runner-pill__status" />
          <span><small>Runner</small><strong>{runnerMode}</strong></span>
        </div>
        <div className={`activity-pill ${activeRuns ? 'activity-pill--active' : ''}`}>
          <Icon name="activity" size={16} />
          <span>
            <strong>{activeRuns ? `${activeRuns} ${runnerMode === 'preview' ? 'preview' : `agent${activeRuns === 1 ? '' : 's'}`} active` : runnerMode === 'preview' ? 'Preview idle' : 'Agents idle'}</strong>
            <small>Updated {relativeTime(updatedAt)}</small>
          </span>
        </div>
        <button className="refresh-button" disabled={refreshing} onClick={onRefresh} type="button" aria-label="Refresh workspace">
          <Icon className={refreshing ? 'is-spinning' : ''} name="refresh" size={17} />
        </button>
      </div>
    </header>
  )
}

function LoadingScreen() {
  return (
    <main className="state-screen" aria-busy="true" aria-label="Loading workspace">
      <div className="loading-tree" aria-hidden="true">
        <span /><span /><span /><i /><i />
      </div>
      <p className="section-kicker">Reading the program</p>
      <h1>Tracing decisions and branches…</h1>
    </main>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="state-screen state-screen--error">
      <span className="state-screen__icon"><Icon name="warning" size={27} /></span>
      <p className="section-kicker">Workspace unreachable</p>
      <h1>The tree could not take root.</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={onRetry} type="button">
        <Icon name="refresh" size={17} />Try again
      </button>
    </main>
  )
}

function EmptyCanvas() {
  return (
    <div className="empty-canvas">
      <span><Icon name="tree" size={28} /></span>
      <h2>No versions yet</h2>
      <p>The workspace is connected, but it has not published a program version.</p>
    </div>
  )
}

interface LineageCanvasProps {
  versions: ProgramVersion[]
  selection: Selection | null
  onSelectDecision: (versionId: string, decisionId: string) => void
  runs: AgentRun[]
}

function LineageCanvas({ versions, selection, onSelectDecision, runs }: LineageCanvasProps) {
  const positions = useMemo(() => layoutVersionTree(versions), [versions])
  const nodes = useMemo<VersionFlowNode[]>(
    () =>
      versions.map((version) => ({
        id: version.id,
        type: 'version',
        position: positions.get(version.id) ?? { x: 0, y: 0 },
        data: {
          version,
          runnerMode: runs.find(
            (run) => run.id === version.runId || run.versionId === version.id,
          )?.mode,
          selectedDecisionId: selection?.versionId === version.id ? selection.decisionId : null,
          onSelectDecision,
        },
        draggable: false,
        selectable: false,
      })),
    [onSelectDecision, positions, runs, selection, versions],
  )
  const edges = useMemo(() => lineageEdges(versions), [versions])
  const { fitView } = useReactFlow<VersionFlowNode>()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.14, duration: 450, maxZoom: 0.92 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitView, versions.length])

  const latestRun = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const activeDelta = Number(isRunActive(b)) - Number(isRunActive(a))
        return activeDelta || b.startedAt.localeCompare(a.startedAt)
      })[0],
    [runs],
  )
  const runVersion = latestRun
    ? versions.find((version) => version.id === latestRun.versionId)
    : undefined

  return (
    <ReactFlow<VersionFlowNode>
      colorMode="light"
      defaultEdgeOptions={{ type: 'smoothstep' }}
      edges={edges}
      fitView
      fitViewOptions={{ padding: 0.14, maxZoom: 0.92 }}
      maxZoom={1.3}
      minZoom={0.2}
      nodeTypes={nodeTypes}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodesFocusable={false}
      onNodeClick={preserveNodeInteractions}
      panOnScroll
      proOptions={{ hideAttribution: true }}
      selectionOnDrag={false}
    >
      <Background color="#aeb7ad" gap={24} size={1.15} variant={BackgroundVariant.Dots} />
      <Controls position="bottom-right" showInteractive={false} />
      <Panel className="canvas-label" position="top-left">
        <span>Version lineage</span>
        <strong>{versions.length} version{versions.length === 1 ? '' : 's'}</strong>
      </Panel>
      {latestRun ? (
        <Panel className="run-panel" position="bottom-left">
          <RunDock run={latestRun} version={runVersion} />
        </Panel>
      ) : null}
    </ReactFlow>
  )
}

function WorkspaceApp() {
  const {
    workspace,
    loading,
    initialError,
    syncError,
    refreshing,
    refresh,
    acceptWorkspace,
  } = useWorkspace()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const generatingRequest = useRef(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedVersion = workspace?.versions.find((item) => item.id === selection?.versionId) ?? null
  const selectedDecision =
    selectedVersion?.decisions.find((item) => item.id === selection?.decisionId) ?? null

  useEffect(() => {
    if (!selection || loading || !workspace) return
    if (!selectedVersion || !selectedDecision) {
      setSelection(null)
      setSelectedAlternativeId(null)
    }
  }, [loading, selectedDecision, selectedVersion, selection, workspace])

  useEffect(() => {
    if (!selectedDecision) return
    if (!selectedDecision.alternatives.some((item) => item.id === selectedAlternativeId)) {
      setSelectedAlternativeId(selectedDecision.chosenAlternativeId)
    }
  }, [selectedAlternativeId, selectedDecision])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectDecision = useCallback(
    (versionId: string, decisionId: string) => {
      const version = workspace?.versions.find((candidate) => candidate.id === versionId)
      const decision = version?.decisions.find((candidate) => candidate.id === decisionId)
      setSelection({ versionId, decisionId })
      setSelectedAlternativeId(decision?.chosenAlternativeId ?? null)
      setActionError(null)
    },
    [workspace],
  )

  const generate = async () => {
    if (!selection || !selectedAlternativeId || generatingRequest.current) return
    const request: CreateForkRequest = {
      baseVersionId: selection.versionId,
      decisionId: selection.decisionId,
      alternativeId: selectedAlternativeId,
    }
    generatingRequest.current = true
    setGenerating(true)
    setActionError(null)
    try {
      const response = await createFork(request)
      acceptWorkspace(response.workspace)
      const nextVersion = response.workspace.versions.find(
        (version) => version.id === response.versionId,
      )
      const nextDecision = nextVersion?.decisions.find(
        (decision) => decision.id === request.decisionId,
      )
      if (nextVersion && nextDecision) {
        setSelection({ versionId: nextVersion.id, decisionId: nextDecision.id })
        setSelectedAlternativeId(nextDecision.chosenAlternativeId)
      }
      setNotice(
        `${workspace?.runner.mode === 'preview' ? 'Preview' : 'Fork'} queued as ${nextVersion?.name ?? response.versionId}`,
      )
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      generatingRequest.current = false
      setGenerating(false)
    }
  }

  if (loading && !workspace) return <LoadingScreen />
  if (initialError && !workspace) return <ErrorScreen message={initialError} onRetry={() => void refresh()} />
  if (!workspace) return null

  const activeRuns = workspace.runs.filter(isRunActive).length
  const matchingForkActive = Boolean(
    selection &&
      selectedAlternativeId &&
      workspace.versions.some((version) => {
        const origin = version.forkOrigin
        if (
          version.parentId !== selection.versionId ||
          origin?.decisionId !== selection.decisionId ||
          origin.toAlternativeId !== selectedAlternativeId
        ) {
          return false
        }
        const run = workspace.runs.find(
          (candidate) => candidate.id === version.runId || candidate.versionId === version.id,
        )
        return run ? isRunActive(run) : false
      }),
  )

  return (
    <div className={`app-shell ${syncError ? 'app-shell--sync-error' : ''}`}>
      <a className="skip-link" href="#main">Skip to program map</a>
      <Header
        activeRuns={activeRuns}
        defaultBranch={workspace.project.defaultBranch}
        onRefresh={() => void refresh()}
        projectName={workspace.project.name}
        refreshing={refreshing}
        repository={workspace.project.repository}
        runnerAvailable={workspace.runner.available}
        runnerLabel={workspace.runner.label}
        runnerMode={workspace.runner.mode}
        updatedAt={workspace.updatedAt}
      />

      {syncError ? (
        <div className="sync-banner" role="status">
          <Icon name="warning" size={15} />
          Live updates paused: {syncError}
          <button onClick={() => void refresh()} type="button">Retry</button>
        </div>
      ) : null}

      <main className={`workspace ${selection ? 'workspace--inspecting' : ''}`} id="main">
        <section className="canvas" aria-label="Program version lineage">
          {workspace.versions.length ? (
            <ReactFlowProvider>
              <LineageCanvas
                onSelectDecision={selectDecision}
                runs={workspace.runs}
                selection={selection}
                versions={workspace.versions}
              />
            </ReactFlowProvider>
          ) : (
            <EmptyCanvas />
          )}
        </section>
        <Inspector
          decision={selectedDecision}
          generating={generating}
          matchingForkActive={matchingForkActive}
          onAlternativeChange={setSelectedAlternativeId}
          onClose={() => {
            setSelection(null)
            setSelectedAlternativeId(null)
            setActionError(null)
          }}
          onGenerate={() => void generate()}
          runner={workspace.runner}
          selectedAlternativeId={selectedAlternativeId}
          version={selectedVersion}
        />
      </main>

      {actionError ? (
        <div className="toast toast--error" role="alert">
          <span><Icon name="warning" size={18} /></span>
          <div><strong>Fork could not start</strong><p>{actionError}</p></div>
          <button aria-label="Dismiss error" onClick={() => setActionError(null)} type="button"><Icon name="close" size={16} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast toast--success" role="status">
          <span><Icon name="check" size={18} /></span>
          <div><strong>{workspace.runner.mode === 'preview' ? 'Preview started' : 'Agent dispatched'}</strong><p>{notice}</p></div>
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button"><Icon name="close" size={16} /></button>
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  return <WorkspaceApp />
}
