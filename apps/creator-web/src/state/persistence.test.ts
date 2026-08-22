import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession, type CreatorSession } from './contracts.js'
import {
  CREATOR_SESSION_STORAGE_KEY,
  loadSession,
  saveSession,
  type SessionStorage,
} from './persistence.js'

class MemoryStorage implements SessionStorage {
  readonly values = new Map<string, string>()
  reads = 0
  writes = 0
  readError: unknown
  writeError: unknown

  getItem(key: string): string | null {
    this.reads += 1
    if (this.readError !== undefined) throw this.readError
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    if (this.writeError !== undefined) throw this.writeError
    this.values.set(key, value)
  }
}

function makeFreshSession(seed = 'fresh-seed'): CreatorSession {
  return createCreatorSession(generateMonster({
    seed,
    themeId: 'fungal',
    mode: 'normal',
  }, makeValidCatalogFixture()), { png: true, webp: false })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('creator session persistence', () => {
  it('saves and loads one complete session without changing any field', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const session: CreatorSession = {
      ...makeFreshSession('saved-seed'),
      locks: { ...makeFreshSession().locks, eyes: true, tail: true },
      diagnostics: [{ severity: 'warning', code: 'EXAMPLE', path: ['tail'], message: 'kept' }],
      exportCapabilities: { png: true, webp: false },
    }

    const save = saveSession(session, storage)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(249)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(await save).toEqual([])
    expect(storage.writes).toBe(1)
    expect([...storage.values.keys()]).toEqual(['qmonster.creator.session.v1'])
    expect(loadSession(() => makeFreshSession(), storage)).toEqual(session)
  })

  it('debounces saves to one write containing only the latest complete snapshot', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const first = saveSession(makeFreshSession('first'), storage)
    await vi.advanceTimersByTimeAsync(100)
    const second = saveSession(makeFreshSession('second'), storage)

    await vi.advanceTimersByTimeAsync(249)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(await first).toEqual([])
    expect(await second).toEqual([])
    expect(storage.writes).toBe(1)
    expect(loadSession(() => makeFreshSession(), storage).spec.seed).toBe('second')
  })

  it('returns a fresh session plus one warning for corrupt JSON without partial hydration', () => {
    const storage = new MemoryStorage()
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, '{"schemaVersion":1,"session":{"blocked":true')
    const fresh = makeFreshSession()

    const loaded = loadSession(() => fresh, storage)

    expect(loaded.spec).toEqual(fresh.spec)
    expect(loaded.locks).toEqual(fresh.locks)
    expect(loaded.blocked).toBe(fresh.blocked)
    expect(loaded.diagnostics).toEqual([
      ...fresh.diagnostics,
      expect.objectContaining({ severity: 'warning', code: 'SESSION_LOAD_FAILED' }),
    ])
  })

  it('rejects an unsupported persistence schema as one whole transaction', () => {
    const storage = new MemoryStorage()
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      session: { ...makeFreshSession('stored'), blocked: true },
    }))
    const fresh = makeFreshSession()

    const loaded = loadSession(() => fresh, storage)

    expect(loaded.spec.seed).toBe('fresh-seed')
    expect(loaded.blocked).toBe(false)
    expect(loaded.diagnostics.at(-1)).toEqual(expect.objectContaining({ code: 'SESSION_LOAD_FAILED' }))
  })

  it('rejects a structurally partial session instead of merging it into the fresh state', () => {
    const storage = new MemoryStorage()
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      session: {
        ...makeFreshSession('partial'),
        locks: { eyes: true },
        exportCapabilities: { png: false },
      },
    }))

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.spec.seed).toBe('fresh-seed')
    expect(Object.values(loaded.locks).every(value => value === false)).toBe(true)
    expect(loaded.exportCapabilities).toEqual({ png: true, webp: false })
    expect(loaded.diagnostics.at(-1)?.code).toBe('SESSION_LOAD_FAILED')
  })

  it('returns a fresh session warning when storage cannot be read', () => {
    const storage = new MemoryStorage()
    storage.readError = new DOMException('denied', 'SecurityError')

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.spec.seed).toBe('fresh-seed')
    expect(loaded.diagnostics.at(-1)).toEqual(expect.objectContaining({ code: 'SESSION_LOAD_FAILED' }))
  })

  it('reports SESSION_SAVE_FAILED when the debounced storage write exceeds quota', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    storage.writeError = new DOMException('quota exceeded', 'QuotaExceededError')

    const save = saveSession(makeFreshSession(), storage)
    await vi.advanceTimersByTimeAsync(250)

    expect(await save).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_SAVE_FAILED' }),
    ])
    expect(storage.values.has(CREATOR_SESSION_STORAGE_KEY)).toBe(false)
  })

  it('rejects an unsupported monster schema before writing any session bytes', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const invalid = makeFreshSession()
    invalid.spec.schemaVersion = '9.9.9'

    const save = saveSession(invalid, storage)
    await vi.advanceTimersByTimeAsync(250)

    expect(await save).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_SAVE_FAILED' }),
    ])
    expect(storage.writes).toBe(0)
    expect(storage.values.has(CREATOR_SESSION_STORAGE_KEY)).toBe(false)
  })
})
