import type { Diagnostic, VisualSlotId } from '@qmonster/generator-core'
import { VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { SLOT_LABELS } from './slot-config.js'

interface DiagnosticsPanelProps {
  diagnostics: readonly Diagnostic[]
}

function targetSlot(diagnostic: Diagnostic): VisualSlotId | null {
  if (diagnostic.path[0] !== 'visualSlots') return null
  const value = diagnostic.path[1]
  return VISUAL_SLOT_IDS.find(slotId => slotId === value) ?? null
}

function DiagnosticItem({ diagnostic }: { diagnostic: Diagnostic }) {
  const slotId = targetSlot(diagnostic)

  return (
    <li className={`diagnostic diagnostic--${diagnostic.severity}`}>
      <div className="diagnostic__code">{diagnostic.code}</div>
      <p>{diagnostic.message}</p>
      {slotId !== null && (
        <a
          href={`#slot-control-${slotId}`}
          onClick={event => {
            const control = document.getElementById(`slot-control-${slotId}`)
            if (control === null) return
            event.preventDefault()
            control.focus()
          }}
        >
          定位到{SLOT_LABELS[slotId]}
        </a>
      )}
    </li>
  )
}

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return (
      <section className="diagnostics-panel diagnostics-panel--clear" aria-label="诊断信息">
        <p role="status"><span aria-hidden="true">✓</span> 组合状态良好，未发现冲突。</p>
      </section>
    )
  }

  const errors = diagnostics.filter(item => item.severity === 'error')
  const warnings = diagnostics.filter(item => item.severity === 'warning')

  return (
    <section className="diagnostics-panel" aria-label="诊断信息" aria-live="polite">
      {errors.length > 0 && (
        <div className="diagnostic-group diagnostic-group--error">
          <h3>错误 · {errors.length}</h3>
          <ul>{errors.map((item, index) => <DiagnosticItem diagnostic={item} key={`error-${index}`} />)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="diagnostic-group diagnostic-group--warning">
          <h3>提醒 · {warnings.length}</h3>
          <ul>{warnings.map((item, index) => <DiagnosticItem diagnostic={item} key={`warning-${index}`} />)}</ul>
        </div>
      )}
    </section>
  )
}
