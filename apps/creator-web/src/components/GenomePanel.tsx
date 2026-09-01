import { useRef, useState } from 'react'
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
  const tabRefs = useRef<Record<GenomeLayer, HTMLButtonElement | null>>({
    P: null,
    H1: null,
    H2: null,
    H3: null,
  })
  const titleId = 'genome-panel-title'

  function selectLayer(nextLayer: GenomeLayer, focus = false): void {
    setLayer(nextLayer)
    if (focus) tabRefs.current[nextLayer]?.focus()
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, item: GenomeLayer): void {
    const currentIndex = GENOME_LAYERS.indexOf(item)
    let nextLayer: GenomeLayer | undefined
    if (event.key === 'ArrowRight') nextLayer = GENOME_LAYERS[(currentIndex + 1) % GENOME_LAYERS.length]
    if (event.key === 'ArrowLeft') nextLayer = GENOME_LAYERS[(currentIndex - 1 + GENOME_LAYERS.length) % GENOME_LAYERS.length]
    if (event.key === 'Home') nextLayer = GENOME_LAYERS[0]
    if (event.key === 'End') nextLayer = GENOME_LAYERS.at(-1)
    if (nextLayer === undefined) return
    event.preventDefault()
    selectLayer(nextLayer, true)
  }

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
                tabIndex={layer === item ? 0 : -1}
                ref={element => { tabRefs.current[item] = element }}
                onClick={() => selectLayer(item)}
                onKeyDown={event => handleTabKeyDown(event, item)}
                key={item}
              >
                {GENOME_LAYER_LABELS[item]}
              </button>
            ))}
          </div>
          {GENOME_LAYERS.map(item => (
            <dl
              className="genome-grid"
              role="tabpanel"
              id={`genome-layer-${item}`}
              aria-labelledby={`genome-tab-${item}`}
              hidden={layer !== item}
              key={item}
            >
              {VISUAL_SLOT_IDS.map(slotId => (
                <div className="gene-row" data-testid="gene-row" key={slotId}>
                  <dt>{SLOT_LABELS[slotId]}</dt>
                  <dd><code>{genome.genes[slotId][item]}</code></dd>
                </div>
              ))}
            </dl>
          ))}
        </>
      )}
    </section>
  )
}
