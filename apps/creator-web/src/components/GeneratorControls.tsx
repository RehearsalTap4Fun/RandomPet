import { useEffect, useState } from 'react'
import type {
  Catalog,
  GenerationMode,
  ThemeId,
} from '@qmonster/generator-core'
import type { CreatorAction, CreatorSession } from '../state/contracts.js'

interface GeneratorControlsProps {
  session: CreatorSession
  catalog: Catalog
  onAction: (action: CreatorAction) => void
}

function currentMode(session: CreatorSession): GenerationMode {
  if (session.spec.aberrations.length > 0) return 'aberration'
  if (session.spec.mutation !== null) return 'mutation'
  return 'normal'
}

const MODE_OPTIONS: ReadonlyArray<{ value: GenerationMode; label: string; hint: string }> = [
  { value: 'normal', label: '正常', hint: '稳定的友善组合' },
  { value: 'mutation', label: '变异', hint: '加入一次整体变异' },
  { value: 'aberration', label: '畸变', hint: '出现更罕见的异常' },
]

export function GeneratorControls({ session, catalog, onAction }: GeneratorControlsProps) {
  const [seed, setSeed] = useState(session.spec.seed)

  useEffect(() => setSeed(session.spec.seed), [session.spec.seed])

  return (
    <section className="panel generator-controls" aria-labelledby="generator-controls-title">
      <div className="panel-heading">
        <p className="eyebrow">GLOBAL GENOME</p>
        <h2 id="generator-controls-title">全局条件</h2>
      </div>

      <label className="field-label" htmlFor="theme-control">主题</label>
      <select
        id="theme-control"
        value={session.spec.themeId}
        onChange={event => onAction({ type: 'setTheme', themeId: event.target.value as ThemeId })}
      >
        {catalog.themes.map(theme => (
          <option value={theme.id} key={theme.id}>{theme.displayName ?? theme.id}</option>
        ))}
      </select>
      <p className="field-hint">
        {catalog.themes.find(theme => theme.id === session.spec.themeId)?.flavorText
          ?? '主题决定默认配色与特征倾向。'}
      </p>

      <label className="field-label" htmlFor="seed-control">种子</label>
      <input
        id="seed-control"
        type="text"
        value={seed}
        spellCheck={false}
        onChange={event => setSeed(event.target.value)}
      />
      <p className="field-hint">相同种子与条件会生成相同生物。</p>

      <fieldset className="mode-fieldset">
        <legend>状态</legend>
        {MODE_OPTIONS.map(option => (
          <label className="mode-option" key={option.value}>
            <input
              type="radio"
              name="generation-mode"
              value={option.value}
              checked={currentMode(session) === option.value}
              aria-label={option.label}
              aria-describedby={`mode-hint-${option.value}`}
              onChange={() => onAction({ type: 'setMode', mode: option.value })}
            />
            <span>
              <strong>{option.label}</strong>
              <small id={`mode-hint-${option.value}`}>{option.hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        className="primary-action"
        type="button"
        disabled={seed.trim().length === 0}
        onClick={() => onAction({ type: 'newCreature', seed: seed.trim() })}
      >
        <span aria-hidden="true">✦</span>
        孵化整只生物
      </button>
    </section>
  )
}
