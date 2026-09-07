import {
  deriveCollectionRarity,
  STRUCTURAL_SLOT_IDS,
  type Catalog,
} from '@qmonster/generator-core'
import type { CreatorAction, CreatorSession } from '../state/contracts.js'

interface AnatomyBundlePanelProps {
  session: CreatorSession
  catalog: Catalog
  onAction: (action: CreatorAction) => void
}

const rarityLabel = { N: '普通', R: '稀有', L: '传说' } as const

export function AnatomyBundlePanel({ session, catalog, onAction }: AnatomyBundlePanelProps) {
  const bundle = catalog.anatomyBundles?.find(item => item.id === session.spec.anatomyBundleId)
  if (catalog.version !== '0.6.0' || bundle === undefined) return null

  const body = catalog.parts.find(part => part.id === bundle.derivedSlots.bodyFrame)
  const locked = STRUCTURAL_SLOT_IDS.some(slotId => session.locks[slotId])
  const displayName = body?.displayName ?? bundle.id
  const collectionRarity = deriveCollectionRarity(session.spec, catalog)

  return (
    <section className="slot-group anatomy-bundle-panel" aria-labelledby="anatomy-bundle-title">
      <div className="slot-row__topline">
        <div>
          <p className="eyebrow">WHOLE APPEARANCE</p>
          <h3 id="anatomy-bundle-title">外形基因</h3>
        </div>
        <label className="lock-control">
          <input
            type="checkbox"
            checked={locked}
            onChange={() => {
              for (const slotId of STRUCTURAL_SLOT_IDS) {
                if (session.locks[slotId] !== !locked) onAction({ type: 'toggleLock', slotId })
              }
            }}
          />
          <span>锁定外形</span>
        </label>
      </div>
      <p>{displayName}</p>
      <dl>
        <div><dt>姿势</dt><dd>{bundle.poseId}</dd></div>
        <div><dt>稀有度</dt><dd><span className="rarity-badge" data-rarity={collectionRarity}>{rarityLabel[collectionRarity]} · {collectionRarity}</span></dd></div>
      </dl>
      <code title={bundle.id}>{bundle.id}</code>
      <button type="button" disabled={locked} onClick={() => onAction({ type: 'rerollAppearance' })}>
        重掷外形
      </button>
      {locked && <p className="slot-reason">外形已锁定，解锁后可重掷。</p>}
    </section>
  )
}
