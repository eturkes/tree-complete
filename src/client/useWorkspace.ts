import { useCallback, useEffect, useRef, useState } from 'react'
import type { Workspace } from '../shared/model'
import { isRunActive } from '../shared/model'
import { getWorkspace, readableError } from './api'

const ACTIVE_POLL_MS = 1_400

export interface WorkspaceState {
  workspace: Workspace | null
  loading: boolean
  initialError: string | null
  syncError: string | null
  refreshing: boolean
  refresh: () => Promise<void>
  acceptWorkspace: (workspace: Workspace) => void
}

export function useWorkspace(): WorkspaceState {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef<Promise<void> | null>(null)
  // POST responses are newer authoritative snapshots. Preserve that state when
  // an earlier, slower GET eventually resolves.
  const authorityRevision = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async (background: boolean): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const requestRevision = authorityRevision.current
    const request = (async () => {
      if (!background && mounted.current) setRefreshing(true)
      try {
        const nextWorkspace = await getWorkspace()
        if (!mounted.current || requestRevision !== authorityRevision.current) return
        setWorkspace(nextWorkspace)
        setInitialError(null)
        setSyncError(null)
      } catch (error) {
        if (!mounted.current || requestRevision !== authorityRevision.current) return
        const message = readableError(error)
        setWorkspace((current) => {
          if (current) setSyncError(message)
          else setInitialError(message)
          return current
        })
      } finally {
        if (mounted.current) {
          setLoading(false)
          setRefreshing(false)
        }
        inFlight.current = null
      }
    })()
    inFlight.current = request
    return request
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const hasActiveRun = workspace?.runs.some(isRunActive) ?? false
  useEffect(() => {
    if (!hasActiveRun) return
    const timer = window.setInterval(() => void load(true), ACTIVE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasActiveRun, load])

  const acceptWorkspace = useCallback((nextWorkspace: Workspace) => {
    authorityRevision.current += 1
    setWorkspace(nextWorkspace)
    setInitialError(null)
    setSyncError(null)
    setLoading(false)
  }, [])

  return {
    workspace,
    loading,
    initialError,
    syncError,
    refreshing,
    refresh: () => load(false),
    acceptWorkspace,
  }
}
