import {
  checkPartCompatibility,
  type Catalog,
  type VisualPartDefinition,
  type VisualSlotId,
} from '@qmonster/generator-core'
import type { CreatorAction, CreatorSession } from '../state/contracts.js'
import { SLOT_GROUPS, SLOT_LABELS } from './slot-config.js'

interface SlotPanelProps {
  session: CreatorSession
  catalog: Catalog
  onAction: (action: CreatorAction) => void
}

function partLabel(part: VisualPartDefinition): string {
  return part.displayName ?? part.id
}

interface SlotRowProps extends SlotPanelProps {
  slotId: VisualSlotId
}

function SlotRow({ slotId, session, catalog, onAction }: SlotRowProps) {
  const label = SLOT_LABELS[slotId]
  const selection = session.spec.visualSlots[slotId]
  const rigId = session.spec.visualSlots.bodyFrame.rigId
  const candidates = catalog.parts.filter(part => part.slotId === slotId)
  const incompatible = candidates.filter(part => !checkPartCompatibility(
    part,
    rigId,
    catalog,
    session.spec.visualSlots,
  ))
  const incompatibleIds = new Set(incompatible.map(part => part.id))
  const selectedPart = candidates.find(part => part.id === selection.partId)
  const locked = session.locks[slotId]
  const selectId = `slot-control-${slotId}`
  const reasonId = `slot-reason-${slotId}`

  return (
    <article
      className={`slot-row${incompatibleIds.has(selection.partId) ? ' slot-row--conflict' : ''}`}
      data-testid="visual-slot-row"
      id={`slot-row-${slotId}`}
    >
      <div className="slot-row__topline">
        <div>
          <span className="slot-row__label">{label}</span>
          <span className="rarity-badge" data-rarity={selectedPart?.rarity ?? 'N'}>
            {selectedPart?.rarity ?? '—'}
          </span>
        </div>
        <label className="lock-control">
          <input
            type="checkbox"
            checked={locked}
            onChange={() => onAction({ type: 'toggleLock', slotId })}
          />
          <span>锁定 {label}</span>
        </label>
      </div>

      <label className="sr-only" htmlFor={selectId}>{label}部件</label>
      <select
        id={selectId}
        value={selection.partId}
        aria-describedby={incompatible.length > 0 || locked ? reasonId : undefined}
        onChange={event => onAction({
          type: 'manualSelect',
          slotId,
          partId: event.target.value,
        })}
      >
        {candidates.map(part => (
          <option key={part.id} value={part.id} disabled={incompatibleIds.has(part.id)}>
            {partLabel(part)}{incompatibleIds.has(part.id) ? ' — 不兼容' : ''}
          </option>
        ))}
      </select>

      <div className="slot-row__actions">
        <span className="part-id" title={selection.partId}>{selection.partId}</span>
        <button
          type="button"
          disabled={locked}
          onClick={() => onAction({ type: 'rerollSlot', slotId })}
          aria-label={`重抽${label}`}
        >
          <span aria-hidden="true">↻</span>
          重抽
        </button>
      </div>

      {(incompatible.length > 0 || locked) && (
        <p className="slot-reason" id={reasonId}>
          {locked && '此槽位已锁定，解锁后可重抽。'}
          {locked && incompatible.length > 0 && ' '}
          {incompatible.length > 0
            && `${incompatible.map(partLabel).join('、')}与当前骨架或部件组合不兼容。`}
        </p>
      )}
    </article>
  )
}

export function SlotPanel(props: SlotPanelProps) {
  return (
    <aside className="panel slot-panel" aria-labelledby="slot-panel-title">
      <div className="panel-heading slot-panel__heading">
        <div>
          <p className="eyebrow">14 VISUAL SLOTS</p>
          <h2 id="slot-panel-title">特征槽位</h2>
        </div>
        <span className="slot-total">14 / 14</span>
      </div>

      {SLOT_GROUPS.map(group => (
        <section
          className="slot-group"
          role="group"
          aria-labelledby={`slot-group-${group.id}`}
          key={group.id}
        >
          <h3 id={`slot-group-${group.id}`}>{group.label}</h3>
          {group.slots.map(slotId => <SlotRow {...props} slotId={slotId} key={slotId} />)}
        </section>
      ))}
    </aside>
  )
}
