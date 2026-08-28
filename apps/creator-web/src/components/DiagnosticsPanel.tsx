import type { Diagnostic, VisualSlotId } from '@qmonster/generator-core'
import { VISUAL_SLOT_IDS } from '@qmonster/generator-core'
import { SLOT_LABELS } from './slot-config.js'

interface DiagnosticsPanelProps {
  diagnostics: readonly Diagnostic[]
}

function targetSlot(diagnostic: Diagnostic): VisualSlotId | null {
  if (diagnostic.code === 'CONNECTOR_COMPOSITE_FAILED' && diagnostic.path[0] === 'connectors') {
    const connectorId = diagnostic.path[1] ?? ''
    if (connectorId === 'neck') return 'headShape'
    if (connectorId.startsWith('shoulder')) return 'arms'
    if (connectorId.startsWith('hip')) return 'legs'
    if (connectorId === 'tailRoot') return 'tail'
    if (connectorId.startsWith('extra')) return 'extraAppendage'
    return 'bodyFrame'
  }
  if (diagnostic.code === 'COMPOSITION_BOUNDS_EXCEEDED') return 'bodyFrame'
  if (diagnostic.code === 'COMPOSITION_FACE_OUT_OF_ZONE' || diagnostic.code === 'COMPOSITION_FACE_OCCLUDED') {
    if (diagnostic.code === 'COMPOSITION_FACE_OCCLUDED' && diagnostic.path.some(segment => (
      segment === 'effect' || segment.startsWith('effect_')
    ))) return 'effect'
    if (diagnostic.path.includes('mouthShape')) return 'mouthShape'
    return 'eyes'
  }
  if (diagnostic.path[0] !== 'visualSlots') return null
  const value = diagnostic.path[1]
  return VISUAL_SLOT_IDS.find(slotId => slotId === value) ?? null
}

function diagnosticMessage(diagnostic: Diagnostic): string {
  switch (diagnostic.code) {
    case 'COMPOSITION_FACE_OUT_OF_ZONE':
      return '面部位置偏离安全区域，请调整相关特征。'
    case 'COMPOSITION_FACE_OCCLUDED':
      return '面部被遮挡，请调整眼睛、嘴型或氛围效果。'
    case 'COMPOSITION_BOUNDS_EXCEEDED':
      return '生物轮廓超出画面边界，请调整体型骨架。'
    case 'CONNECTOR_COMPOSITE_FAILED': {
      const connectorId = diagnostic.path[1] ?? ''
      const label = connectorId === 'neck' ? '颈部接口'
        : connectorId.startsWith('shoulder') ? '肩部接口'
          : connectorId.startsWith('hip') ? '髋部接口'
            : connectorId === 'tailRoot' ? '尾根接口'
              : connectorId.startsWith('extra') ? '附肢接口' : '结构接口'
      return `${label}合成失败，请调整对应结构部件。`
    }
    case 'CONNECTOR_VARIANT_MISSING':
    case 'CONNECTOR_PROFILE_INVALID':
    case 'CONNECTOR_WARP_EXCEEDED':
    case 'CONNECTOR_BRIDGE_MISSING':
      return '结构接口不兼容，请调整对应结构部件。'
    case 'STRUCTURE_DISCONNECTED':
      return '主体结构未连成一体，请调整体型或结构部件。'
    default:
      return diagnostic.message
  }
}

function DiagnosticItem({ diagnostic }: { diagnostic: Diagnostic }) {
  const slotId = targetSlot(diagnostic)

  return (
    <li className={`diagnostic diagnostic--${diagnostic.severity}`}>
      <div className="diagnostic__code">{diagnostic.code}</div>
      <p>{diagnosticMessage(diagnostic)}</p>
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
