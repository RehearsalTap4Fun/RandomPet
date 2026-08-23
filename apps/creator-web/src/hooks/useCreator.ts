import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
} from 'react'
import {
  generateMonster,
  type Catalog,
  type Diagnostic,
  type GenerationRequest,
} from '@qmonster/generator-core'
import { createCreatorReducer } from '../state/creator-reducer.js'
import {
  createCreatorSession,
  type CreatorAction,
  type CreatorSession,
} from '../state/contracts.js'
import {
  loadSession,
  saveSession,
  type LoadSessionResult,
  type SessionStorage,
} from '../state/persistence.js'

export interface UseCreatorOptions {
  catalog: Catalog
  initialRequest: GenerationRequest
  storage?: SessionStorage
  exportCapabilities?: CreatorSession['exportCapabilities']
}

export interface UseCreatorResult {
  session: CreatorSession
  dispatch: Dispatch<CreatorAction>
}

function initializeCreator(options: UseCreatorOptions): LoadSessionResult {
  return loadSession(
    () => createCreatorSession(
      generateMonster(options.initialRequest, options.catalog),
      options.exportCapabilities,
    ),
    options.storage,
  )
}

export function useCreator(options: UseCreatorOptions): UseCreatorResult {
  const reducer = useMemo(() => createCreatorReducer(options.catalog), [options.catalog])
  const [loaded] = useState(() => initializeCreator(options))
  const [editorSession, baseDispatch] = useReducer(reducer, loaded.session)
  const [persistenceDiagnostics, setPersistenceDiagnostics] = useState<Diagnostic[]>(loaded.diagnostics)
  const dispatch = useCallback((action: CreatorAction) => {
    performance.mark('qmonster-command-start')
    baseDispatch(action)
  }, [])

  useEffect(() => {
    let active = true
    void saveSession(editorSession, options.storage).then(diagnostics => {
      if (active) setPersistenceDiagnostics(diagnostics)
    })
    return () => {
      active = false
    }
  }, [editorSession, options.storage])

  const session = useMemo<CreatorSession>(() => {
    if (persistenceDiagnostics.length === 0) return editorSession
    return {
      ...editorSession,
      diagnostics: [...editorSession.diagnostics, ...persistenceDiagnostics],
    }
  }, [editorSession, persistenceDiagnostics])

  return { session, dispatch }
}
