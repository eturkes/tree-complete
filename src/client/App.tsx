import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { ActivityCenter } from './components/ActivityCenter'
import { Icon } from './components/Icon'
import { Inspector } from './components/Inspector'
import type { PanelFeedbackValue } from './components/PanelFeedback'
import { RunDock } from './components/RunDock'
import {
  VersionNode,
  type VersionFlowNode,
  type VersionNodeData,
} from './components/VersionNode'
import { layoutVersionTree, lineageEdges, lineagePathVersionIds } from './layout'
import { useWorkspace } from './useWorkspace'

const nodeTypes: NodeTypes = { version: VersionNode }
const preserveNodeInteractions = () => undefined

interface Selection {
  versionId: string
  decisionId: string
}

interface Notice {
  title: string
  detail: string
}

function relativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'recently'
  const seconds = Math.round((timestamp - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

function absoluteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Update time unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
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
  onOpenActivity,
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
  onOpenActivity: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const absoluteUpdate = absoluteTime(updatedAt)
  const relativeUpdate = relativeTime(updatedAt, now)

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
        <div
          aria-label={`${runnerLabel}: ${runnerAvailable ? 'available' : 'unavailable'}`}
          className={`runner-pill ${runnerAvailable ? '' : 'runner-pill--offline'}`}
          role="status"
          title={`${runnerLabel}: ${runnerAvailable ? 'available' : 'unavailable'}`}
        >
          <span className="runner-pill__status" aria-hidden="true">
            <Icon name={runnerAvailable ? 'check' : 'warning'} size={11} />
          </span>
          <span><small>Runner</small><strong>{runnerMode}</strong></span>
        </div>
        <button
          aria-label={`Open activity. ${activeRuns ? `${activeRuns} active` : 'No active runs'}. Workspace updated ${relativeUpdate}; ${absoluteUpdate}.`}
          className={`activity-pill ${activeRuns ? 'activity-pill--active' : ''}`}
          onClick={onOpenActivity}
          title="Open complete run history"
          type="button"
        >
          <Icon name="activity" size={16} />
          <span>
            <strong>{activeRuns ? `${activeRuns} ${runnerMode === 'preview' ? 'preview' : `agent${activeRuns === 1 ? '' : 's'}`} active` : runnerMode === 'preview' ? 'Preview idle' : 'Agents idle'}</strong>
            <small title={absoluteUpdate}>Updated {relativeUpdate}</small>
          </span>
        </button>
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
  onOpenRun: (runId: string) => void
  onFocusVersion: (versionId: string) => void
  runs: AgentRun[]
  focusedVersionId: string | null
  focusRevision: number
}

function LineageCanvas({
  versions,
  selection,
  onSelectDecision,
  onOpenRun,
  onFocusVersion,
  runs,
  focusedVersionId,
  focusRevision,
}: LineageCanvasProps) {
  const positions = useMemo(() => layoutVersionTree(versions), [versions])
  const focusedPath = useMemo(
    () => lineagePathVersionIds(versions, focusedVersionId),
    [focusedVersionId, versions],
  )
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
          onOpenRun,
          onFocusVersion,
          highlighted: version.id === focusedVersionId,
          inFocusedPath: focusedPath.has(version.id),
        },
        draggable: false,
        selectable: false,
      })),
    [focusedPath, focusedVersionId, onFocusVersion, onOpenRun, onSelectDecision, positions, runs, selection, versions],
  )
  const edges = useMemo(() => lineageEdges(versions, focusedVersionId), [focusedVersionId, versions])
  const { fitView, getNode } = useReactFlow<VersionFlowNode>()
  const [compactViewport, setCompactViewport] = useState(
    () => window.matchMedia('(max-width: 820px)').matches,
  )
  const initialFitMode = useRef<boolean | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)')
    const update = () => setCompactViewport(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (initialFitMode.current === compactViewport) return
    const rootId = nodes.find((node) => node.data.version.parentId === null)?.id
    const mobileRoot = compactViewport && nodes.length > 2
    let frame = 0
    let attempts = 0
    const fitWhenReady = () => {
      const ready = nodes.every((node) => getNode(node.id))
      const root = rootId ? getNode(rootId) : undefined
      if ((!ready || (mobileRoot && !root)) && attempts < 30) {
        attempts += 1
        frame = window.requestAnimationFrame(fitWhenReady)
        return
      }
      if (!ready) return
      initialFitMode.current = compactViewport
      void fitView(mobileRoot
        ? { nodes: root ? [root] : undefined, padding: 0.04, duration: 450, minZoom: 1, maxZoom: 1 }
        : { padding: 0.14, duration: 450, maxZoom: 0.92 })
    }
    frame = window.requestAnimationFrame(fitWhenReady)
    return () => window.cancelAnimationFrame(frame)
  }, [compactViewport, fitView, getNode, nodes])

  useEffect(() => {
    if (!focusedVersionId || focusRevision < 1) return
    let frame = 0
    let attempts = 0
    const focusWhenReady = () => {
      const node = getNode(focusedVersionId)
      if (!node && attempts < 30) {
        attempts += 1
        frame = window.requestAnimationFrame(focusWhenReady)
        return
      }
      if (node) {
        void fitView({ nodes: [node], padding: 0.32, duration: 420, minZoom: 0.76, maxZoom: 1 })
      }
    }
    frame = window.requestAnimationFrame(focusWhenReady)
    return () => window.cancelAnimationFrame(frame)
  }, [fitView, focusRevision, focusedVersionId, getNode, nodes.length])

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
      maxZoom={1.3}
      minZoom={compactViewport ? 1 : 0.2}
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
      {versions.length > 2 ? (
        <MiniMap
          ariaLabel="Version lineage overview"
          className="lineage-minimap"
          maskColor="rgba(232, 234, 223, 0.72)"
          nodeColor={(node) => {
            const status = (node.data as VersionNodeData).version.status
            if (status === 'failed') return '#ff715e'
            if (status === 'working' || status === 'queued') return '#3e63f4'
            return '#29473e'
          }}
          pannable
          position="top-right"
          zoomable
        />
      ) : null}
      <Panel className="canvas-label" position="top-left">
        <span>Version lineage</span>
        <strong>{versions.length} version{versions.length === 1 ? '' : 's'}</strong>
      </Panel>
      {latestRun ? (
        <Panel className="run-panel" position="bottom-left">
          <RunDock onOpen={() => onOpenRun(latestRun.id)} run={latestRun} version={runVersion} />
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [focusedVersionId, setFocusedVersionId] = useState<string | null>(null)
  const [focusRevision, setFocusRevision] = useState(0)
  const panelTrigger = useRef<HTMLElement | null>(null)
  const panelRevision = useRef(0)
  const focusedVersionRef = useRef<string | null>(null)

  const selectedVersion = workspace?.versions.find((item) => item.id === selection?.versionId) ?? null
  const selectedDecision =
    selectedVersion?.decisions.find((item) => item.id === selection?.decisionId) ?? null
  const orderedRuns = useMemo(
    () =>
      [...(workspace?.runs ?? [])].sort((a, b) => {
        const activeDelta = Number(isRunActive(b)) - Number(isRunActive(a))
        return activeDelta || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)
      }),
    [workspace?.runs],
  )

  const rememberPanelTrigger = useCallback(() => {
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      !active.closest('.inspector, .activity-center')
    ) {
      panelTrigger.current = active
    }
  }, [])

  const focusVersion = useCallback((versionId: string) => {
    focusedVersionRef.current = versionId
    setFocusedVersionId(versionId)
    setFocusRevision((revision) => revision + 1)
  }, [])

  const focusVersionIfNeeded = useCallback((versionId: string) => {
    if (focusedVersionRef.current !== versionId) focusVersion(versionId)
  }, [focusVersion])

  const changeAlternative = useCallback((alternativeId: string) => {
    panelRevision.current += 1
    setSelectedAlternativeId(alternativeId)
  }, [])

  const closePanel = useCallback(() => {
    panelRevision.current += 1
    setSelection(null)
    setSelectedAlternativeId(null)
    setActivityOpen(false)
    setActionError(null)
    const trigger = panelTrigger.current
    panelTrigger.current = null
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    })
  }, [])

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

  useEffect(() => {
    if (!activityOpen) return
    if (!orderedRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(orderedRuns[0]?.id ?? null)
    }
  }, [activityOpen, orderedRuns, selectedRunId])

  useEffect(() => {
    if (!focusedVersionId || !workspace) return
    if (!workspace.versions.some((version) => version.id === focusedVersionId)) {
      focusedVersionRef.current = null
      setFocusedVersionId(null)
    }
  }, [focusedVersionId, workspace])

  const selectDecision = useCallback(
    (versionId: string, decisionId: string) => {
      panelRevision.current += 1
      const version = workspace?.versions.find((candidate) => candidate.id === versionId)
      const decision = version?.decisions.find((candidate) => candidate.id === decisionId)
      rememberPanelTrigger()
      setActivityOpen(false)
      setSelection({ versionId, decisionId })
      setSelectedAlternativeId(decision?.chosenAlternativeId ?? null)
      setActionError(null)
      focusVersion(versionId)
    },
    [focusVersion, rememberPanelTrigger, workspace],
  )

  const openActivity = useCallback(
    (runId?: string) => {
      panelRevision.current += 1
      rememberPanelTrigger()
      const run =
        workspace?.runs.find((candidate) => candidate.id === runId) ?? orderedRuns[0]
      setSelection(null)
      setSelectedAlternativeId(null)
      setActivityOpen(true)
      setSelectedRunId(run?.id ?? null)
      setActionError(null)
      if (run) focusVersion(run.versionId)
    },
    [focusVersion, orderedRuns, rememberPanelTrigger, workspace?.runs],
  )

  const selectRun = useCallback(
    (runId: string) => {
      panelRevision.current += 1
      setSelectedRunId(runId)
      const run = workspace?.runs.find((candidate) => candidate.id === runId)
      if (run) focusVersion(run.versionId)
    },
    [focusVersion, workspace?.runs],
  )

  const startFork = async (
    request: CreateForkRequest,
    destination: 'decision' | 'activity',
  ) => {
    if (generatingRequest.current) return
    const destinationRevision = panelRevision.current
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
      if (panelRevision.current === destinationRevision) {
        if (destination === 'activity') {
          setActivityOpen(true)
          setSelection(null)
          setSelectedAlternativeId(null)
          setSelectedRunId(response.runId)
        } else if (nextVersion && nextDecision) {
          setSelection({ versionId: nextVersion.id, decisionId: nextDecision.id })
          setSelectedAlternativeId(nextDecision.chosenAlternativeId)
        }
        focusVersion(response.versionId)
      }
      setNotice({
        title: workspace?.runner.mode === 'preview' ? 'Preview started' : 'Agent dispatched',
        detail: `${workspace?.runner.mode === 'preview' ? 'Preview' : 'Fork'} queued as ${nextVersion?.name ?? response.versionId}`,
      })
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      generatingRequest.current = false
      setGenerating(false)
    }
  }

  const generate = () => {
    if (!selection || !selectedAlternativeId) return
    void startFork(
      {
        baseVersionId: selection.versionId,
        decisionId: selection.decisionId,
        alternativeId: selectedAlternativeId,
      },
      'decision',
    )
  }

  const copyValue = async (label: string, value: string) => {
    try {
      await copyText(value)
      setActionError(null)
      setNotice({ title: `${label} copied`, detail: value })
    } catch {
      setNotice(null)
      setActionError(`Could not copy the ${label.toLowerCase()} to the clipboard.`)
    }
  }

  const feedback: PanelFeedbackValue | null = actionError
    ? { tone: 'error', title: 'Action failed', detail: actionError }
    : notice
      ? { tone: 'success', ...notice }
      : null
  const dismissFeedback = () => {
    setActionError(null)
    setNotice(null)
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
        onOpenActivity={() => openActivity()}
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

      <main className={`workspace ${selection || activityOpen ? 'workspace--inspecting' : ''}`} id="main">
        <section className="canvas" aria-label="Program version lineage">
          {workspace.versions.length ? (
            <ReactFlowProvider>
              <LineageCanvas
                onFocusVersion={focusVersionIfNeeded}
                onSelectDecision={selectDecision}
                onOpenRun={openActivity}
                runs={workspace.runs}
                selection={selection}
                versions={workspace.versions}
                focusedVersionId={focusedVersionId}
                focusRevision={focusRevision}
              />
            </ReactFlowProvider>
          ) : (
            <EmptyCanvas />
          )}
        </section>
        {activityOpen ? (
          <ActivityCenter
            feedback={feedback}
            onClose={closePanel}
            onCopy={(label, value) => void copyValue(label, value)}
            onDismissFeedback={dismissFeedback}
            onInspectDecision={selectDecision}
            onRetry={(request) => void startFork(request, 'activity')}
            onSelectRun={selectRun}
            runner={workspace.runner}
            runs={workspace.runs}
            selectedRunId={selectedRunId}
            starting={generating}
            versions={workspace.versions}
          />
        ) : (
          <Inspector
            decision={selectedDecision}
            feedback={feedback}
            generating={generating}
            matchingForkActive={matchingForkActive}
            onAlternativeChange={changeAlternative}
            onClose={closePanel}
            onGenerate={generate}
            onDismissFeedback={dismissFeedback}
            runner={workspace.runner}
            selectedAlternativeId={selectedAlternativeId}
            version={selectedVersion}
          />
        )}
      </main>

      {actionError && !activityOpen && !selection ? (
        <div className="toast toast--error" role="alert">
          <span><Icon name="warning" size={18} /></span>
          <div><strong>Action failed</strong><p>{actionError}</p></div>
          <button aria-label="Dismiss error" onClick={() => setActionError(null)} type="button"><Icon name="close" size={16} /></button>
        </div>
      ) : null}
      {notice && !activityOpen && !selection ? (
        <div className="toast toast--success" role="status">
          <span><Icon name="check" size={18} /></span>
          <div><strong>{notice.title}</strong><p>{notice.detail}</p></div>
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button"><Icon name="close" size={16} /></button>
        </div>
      ) : null}
    </div>
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    let timeout: number | undefined
    const copied = await Promise.race([
      navigator.clipboard.writeText(value).then(() => true, () => false),
      new Promise<false>((resolve) => {
        timeout = window.setTimeout(() => resolve(false), 1_200)
      }),
    ])
    if (timeout !== undefined) window.clearTimeout(timeout)
    if (copied) return
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;inset:-9999px auto auto -9999px;opacity:0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  active?.focus({ preventScroll: true })
  if (!copied) throw new Error('Clipboard write failed')
}

export default function App() {
  return <WorkspaceApp />
}
