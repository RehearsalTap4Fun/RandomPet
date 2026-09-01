import { useState } from 'react'
import {
  GENOME_LAYERS,
  VISUAL_SLOT_IDS,
  type GenomeLayer,
  type MonsterGenome,
} from '@qmonster/generator-core'
import { SLOT_LABELS } from './slot-config.js'

interface GenomePanelProps {
  genome: MonsterGenome | undefined
}

const GENOME_LAYER_LABELS: Record<GenomeLayer, string> = {
  P: 'P · 显性',
  H1: 'H1 · 隐藏',
  H2: 'H2 · 隐藏',
  H3: 'H3 · 隐藏',
}

export function GenomePanel({ genome }: GenomePanelProps) {
  const [layer, setLayer] = useState<GenomeLayer>('P')
  const titleId = 'genome-panel-title'

  return (
    <section className="genome-panel" role="region" aria-labelledby={titleId}>
      <div className="genome-panel__heading">
        <div>
          <p className="eyebrow">GENETIC RECORD</p>
          <h3 id={titleId}>基因记录</h3>
        </div>
        {genome !== undefined && <code>v{genome.genomeVersion}</code>}
      </div>
      {genome === undefined ? (
        <p className="genome-panel__legacy">旧版形象没有基因记录</p>
      ) : (
        <>
          <div className="genome-tabs" role="tablist" aria-label="基因层">
            {GENOME_LAYERS.map(item => (
              <button
                className="genome-tab"
                type="button"
                role="tab"
                id={`genome-tab-${item}`}
                aria-controls={`genome-layer-${item}`}
                aria-selected={layer === item}
                onClick={() => setLayer(item)}
                key={item}
              >
                {GENOME_LAYER_LABELS[item]}
              </button>
            ))}
          </div>
          <dl
            className="genome-grid"
            role="tabpanel"
            id={`genome-layer-${layer}`}
            aria-labelledby={`genome-tab-${layer}`}
          >
            {VISUAL_SLOT_IDS.map(slotId => (
              <div className="gene-row" data-testid="gene-row" key={slotId}>
                <dt>{SLOT_LABELS[slotId]}</dt>
                <dd><code>{genome.genes[slotId][layer]}</code></dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
