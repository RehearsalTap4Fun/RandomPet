import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateMonster } from '@qmonster/generator-core'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { createCreatorSession, type CreatorSession } from './contracts.js'
import { refreshSessionValidity } from './session-diagnostics.js'
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

function blockingDiagnostic() {
  return {
    severity: 'error' as const,
    code: 'LOCK_INCOMPATIBLE',
    path: ['visualSlots', 'eyes'],
    message: 'The locked eyes are incompatible.',
  }
}

function storeSession(storage: MemoryStorage, session: CreatorSession): void {
  storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, session }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('creator session persistence', () => {
  it('saves and loads one complete session without changing any field', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const session = refreshSessionValidity({
      ...makeFreshSession('saved-seed'),
      locks: { ...makeFreshSession().locks, eyes: true, tail: true },
      generationDiagnostics: [{ severity: 'warning', code: 'EXAMPLE', path: ['tail'], message: 'kept' }],
      exportCapabilities: { png: true, webp: false },
    })

    const save = saveSession(session, storage)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(249)
    expect(storage.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(await save).toEqual([])
    expect(storage.writes).toBe(1)
    expect([...storage.values.keys()]).toEqual(['qmonster.creator.session.v1'])
    expect(JSON.parse(storage.values.get(CREATOR_SESSION_STORAGE_KEY)!).schemaVersion).toBe(2)
    expect(loadSession(() => makeFreshSession(), storage).session).toEqual(session)
  })

  it('migrates a v1 diagnostic list into the generation bucket for the next v2 save', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const legacy = {
      ...makeFreshSession('legacy'),
      diagnostics: [blockingDiagnostic()],
      blocked: true,
    }
    delete (legacy as Partial<CreatorSession>).generationDiagnostics
    delete (legacy as Partial<CreatorSession>).renderDiagnostics
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, session: legacy }))

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.session.generationDiagnostics).toEqual([blockingDiagnostic()])
    expect(loaded.session.renderDiagnostics).toEqual([])
    expect(loaded.session.diagnostics).toEqual([blockingDiagnostic()])
    expect(loaded.session.blocked).toBe(true)

    const save = saveSession(loaded.session, storage)
    await vi.advanceTimersByTimeAsync(250)
    expect(await save).toEqual([])
    const migrated = JSON.parse(storage.values.get(CREATOR_SESSION_STORAGE_KEY)!)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.session.generationDiagnostics).toEqual([blockingDiagnostic()])
    expect(migrated.session.renderDiagnostics).toEqual([])
  })

  it('accepts a valid v2 derived cache regardless of diagnostic object property order', () => {
    const storage = new MemoryStorage()
    const diagnostic = blockingDiagnostic()
    const session = refreshSessionValidity({
      ...makeFreshSession('property-order'),
      renderDiagnostics: [diagnostic],
    })
    const stored = JSON.parse(JSON.stringify({ schemaVersion: 2, session }))
    stored.session.diagnostics = [{
      message: diagnostic.message,
      path: diagnostic.path,
      code: diagnostic.code,
      severity: diagnostic.severity,
    }]
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify(stored))

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.session).toEqual(session)
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
    expect(loadSession(() => makeFreshSession(), storage).session.spec.seed).toBe('second')
  })

  it('returns a fresh session plus one warning for corrupt JSON without partial hydration', () => {
    const storage = new MemoryStorage()
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, '{"schemaVersion":1,"session":{"blocked":true')
    const fresh = makeFreshSession()

    const loaded = loadSession(() => fresh, storage)

    expect(loaded.session.spec).toEqual(fresh.spec)
    expect(loaded.session.locks).toEqual(fresh.locks)
    expect(loaded.session.blocked).toBe(fresh.blocked)
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_LOAD_FAILED' }),
    ])
  })

  it('rejects an unsupported persistence schema as one whole transaction', () => {
    const storage = new MemoryStorage()
    storage.values.set(CREATOR_SESSION_STORAGE_KEY, JSON.stringify({
      schemaVersion: 99,
      session: { ...makeFreshSession('stored'), blocked: true },
    }))
    const fresh = makeFreshSession()

    const loaded = loadSession(() => fresh, storage)

    expect(loaded.session.spec.seed).toBe('fresh-seed')
    expect(loaded.session.blocked).toBe(false)
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

    expect(loaded.session.spec.seed).toBe('fresh-seed')
    expect(Object.values(loaded.session.locks).every(value => value === false)).toBe(true)
    expect(loaded.session.exportCapabilities).toEqual({ png: true, webp: false })
    expect(loaded.diagnostics.at(-1)?.code).toBe('SESSION_LOAD_FAILED')
  })

  it('returns a fresh session warning when storage cannot be read', () => {
    const storage = new MemoryStorage()
    storage.readError = new DOMException('denied', 'SecurityError')

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.session.spec.seed).toBe('fresh-seed')
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

  it('rejects a stored error diagnostic whose blocked flag is false without partial hydration', () => {
    const storage = new MemoryStorage()
    storeSession(storage, {
      ...makeFreshSession('semantically-corrupt'),
      diagnostics: [blockingDiagnostic()],
      blocked: false,
    })

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.session.spec.seed).toBe('fresh-seed')
    expect(loaded.session.blocked).toBe(false)
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_LOAD_FAILED' }),
    ])
  })

  it('rejects a stored blocked flag when no error diagnostic explains it', () => {
    const storage = new MemoryStorage()
    storeSession(storage, {
      ...makeFreshSession('semantically-corrupt'),
      diagnostics: [{ severity: 'warning', code: 'EXAMPLE', path: [], message: 'not blocking' }],
      blocked: true,
    })

    const loaded = loadSession(() => makeFreshSession(), storage)

    expect(loaded.session.spec.seed).toBe('fresh-seed')
    expect(loaded.session.blocked).toBe(false)
    expect(loaded.diagnostics.at(-1)).toEqual(expect.objectContaining({ code: 'SESSION_LOAD_FAILED' }))
  })

  it('rejects both directions of blocked-diagnostic mismatch before saving', async () => {
    vi.useFakeTimers()
    const falseNegativeStorage = new MemoryStorage()
    const falsePositiveStorage = new MemoryStorage()
    const errorButUnblocked: CreatorSession = {
      ...makeFreshSession(),
      generationDiagnostics: [blockingDiagnostic()],
      diagnostics: [blockingDiagnostic()],
      blocked: false,
    }
    const blockedWithoutError: CreatorSession = {
      ...makeFreshSession(),
      generationDiagnostics: [],
      renderDiagnostics: [],
      diagnostics: [],
      blocked: true,
    }

    const falseNegative = saveSession(errorButUnblocked, falseNegativeStorage)
    const falsePositive = saveSession(blockedWithoutError, falsePositiveStorage)
    await vi.advanceTimersByTimeAsync(250)

    expect(await falseNegative).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_SAVE_FAILED' }),
    ])
    expect(await falsePositive).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'SESSION_SAVE_FAILED' }),
    ])
    expect(falseNegativeStorage.writes).toBe(0)
    expect(falsePositiveStorage.writes).toBe(0)
  })

  it('round-trips a coherently blocked session without erasing independent encoder capabilities', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const session = refreshSessionValidity({
      ...makeFreshSession('blocked-but-capable'),
      generationDiagnostics: [blockingDiagnostic()],
      exportCapabilities: { png: true, webp: true },
    })

    const save = saveSession(session, storage)
    await vi.advanceTimersByTimeAsync(250)

    expect(await save).toEqual([])
    expect(loadSession(() => makeFreshSession(), storage).session).toEqual(session)
  })
})
