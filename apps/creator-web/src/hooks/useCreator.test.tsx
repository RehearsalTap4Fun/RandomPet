import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession } from '../state/contracts.js'
import { saveSession, type SessionStorage } from '../state/persistence.js'
import { useCreator } from './useCreator.js'

class MemoryStorage implements SessionStorage {
  readonly values = new Map<string, string>()
  writes = 0
  writeError: unknown

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    if (this.writeError !== undefined) throw this.writeError
    this.values.set(key, value)
  }
}

const initialRequest = {
  seed: 'initial-seed',
  themeId: 'fungal',
  mode: 'normal',
} as const

afterEach(() => {
  vi.useRealTimers()
})

describe('useCreator', () => {
  it('hydrates the complete saved session before exposing editor state', async () => {
    vi.useFakeTimers()
    const catalog = makeValidCatalogFixture()
    const storage = new MemoryStorage()
    const saved = createCreatorSession(generateMonster({
      seed: 'saved-seed',
      themeId: 'shadow',
      mode: 'mutation',
    }, catalog), { png: false, webp: false })
    saved.locks.eyes = true
    const save = saveSession(saved, storage)
    await vi.advanceTimersByTimeAsync(250)
    await save
    storage.writes = 0

    const { result } = renderHook(() => useCreator({ catalog, initialRequest, storage }))

    expect(result.current.session).toEqual(saved)
    expect(result.current.session.locks.eyes).toBe(true)
    expect(result.current.session.exportCapabilities).toEqual({ png: false, webp: false })
  })

  it('does not write during render and autosaves from an effect after 250ms', async () => {
    vi.useFakeTimers()
    const catalog = makeValidCatalogFixture()
    const storage = new MemoryStorage()

    renderHook(() => useCreator({ catalog, initialRequest, storage }))

    expect(storage.writes).toBe(0)
    await act(async () => vi.advanceTimersByTimeAsync(249))
    expect(storage.writes).toBe(0)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(storage.writes).toBe(1)
  })

  it('dispatches through the injected-catalog reducer and exposes save failures as warnings', async () => {
    vi.useFakeTimers()
    const catalog = makeValidCatalogFixture()
    const storage = new MemoryStorage()
    storage.writeError = new DOMException('quota', 'QuotaExceededError')
    const { result } = renderHook(() => useCreator({ catalog, initialRequest, storage }))

    act(() => result.current.dispatch({ type: 'setMode', mode: 'mutation' }))
    expect(result.current.session.spec.mutation).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(250))

    expect(result.current.session.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'SESSION_SAVE_FAILED',
    }))
  })
})
