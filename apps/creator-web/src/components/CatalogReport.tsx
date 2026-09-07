import { useEffect, useMemo, useState } from 'react'
import type { AnimalArchetypeId, Rarity } from '@qmonster/generator-core'
import {
  RARITY_ORDER,
  rarityLabel,
  type ArchetypeReport,
  type CatalogReportModel,
  type ReportBundle,
} from '../catalog-report.js'
import { resolveProductionAssetUrl } from './PreviewCanvas.js'

type RarityFilter = 'all' | Rarity
type AssetUrlResolver = (catalogVersion: string, assetPath: string) => Promise<string>

export interface CatalogReportProps {
  model: CatalogReportModel
  resolveAssetUrl?: AssetUrlResolver
}

const FILTER_LABEL: Record<RarityFilter, string> = {
  all: '全部',
  N: '普通 N',
  R: '稀有 R',
  L: '传说 L',
}

export function CatalogReport({ model, resolveAssetUrl = resolveProductionAssetUrl }: CatalogReportProps) {
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<AnimalArchetypeId | null>(model.defaultArchetypeId)
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all')
  const selectedArchetype = useMemo(() => (
    model.archetypes.find(item => item.id === selectedArchetypeId) ?? model.archetypes[0]
  ), [model.archetypes, selectedArchetypeId])

  if (selectedArchetype === undefined) {
    return (
      <main className="catalog-report catalog-report--empty">
        <p className="catalog-report__eyebrow">CATALOG REPORT</p>
        <h1>尚无可展示的生物图鉴</h1>
        <p>当前目录还没有可用的完整外形 bundle。</p>
      </main>
    )
  }

  const filteredBundles = selectedArchetype.bundles.filter(bundle => (
    rarityFilter === 'all' || bundle.rarity === rarityFilter
  ))
  const allLocalTraitsNormal = selectedArchetype.categoryRows
    .filter(row => row.scope === 'local')
    .every(row => row.counts.R === 0 && row.counts.L === 0)

  return (
    <main className="catalog-report">
      <header className="catalog-report__hero">
        <div>
          <p className="catalog-report__eyebrow">Q MONSTER · CATALOG REPORT</p>
          <h1>{selectedArchetype.label}稀有度图鉴</h1>
          <p className="catalog-report__intro">
            从 catalog v{model.catalogVersion} 自动读取。每次目录或素材更新后，刷新此页面即可查看最新类型与稀有度分布。
          </p>
        </div>
        <dl className="catalog-report__weights" aria-label="完整外形抽取权重">
          {RARITY_ORDER.map(rarity => (
            <div key={rarity} data-rarity={rarity}>
              <dt>{rarityLabel(rarity)} {rarity}</dt>
              <dd>{model.tierWeights[rarity]}%</dd>
            </div>
          ))}
        </dl>
      </header>

      <nav className="catalog-report__archetypes" aria-label="动物原型">
        {model.archetypes.map(archetype => (
          <button
            key={archetype.id}
            type="button"
            aria-current={selectedArchetype.id === archetype.id ? 'page' : undefined}
            className={selectedArchetype.id === archetype.id ? 'is-selected' : undefined}
            onClick={() => {
              setSelectedArchetypeId(archetype.id)
              setRarityFilter('all')
            }}
          >
            {archetype.label}
          </button>
        ))}
      </nav>

      <section className="catalog-report__summary" aria-label="当前完整外形概览">
        <Metric label="完整外形" value={selectedArchetype.bundles.length} />
        {RARITY_ORDER.map(rarity => (
          <Metric key={rarity} label={`${rarityLabel(rarity)} ${rarity}`} value={selectedArchetype.bundleCounts[rarity]} rarity={rarity} />
        ))}
      </section>

      <section className="catalog-report__section">
        <div className="catalog-report__section-heading">
          <div>
            <p className="catalog-report__eyebrow">TYPE COUNTS</p>
            <h2>部位类型与稀有度</h2>
          </div>
          <span>仅统计当前{selectedArchetype.label}完整外形可实际调用的部位</span>
        </div>
        <div className="catalog-report__table-wrap">
          <table>
            <thead>
              <tr><th>分类</th><th>普通 N</th><th>稀有 R</th><th>传说 L</th></tr>
            </thead>
            <tbody>
              {selectedArchetype.categoryRows.map(row => (
                <tr key={row.id} data-scope={row.scope}>
                  <td>{row.label}</td>
                  {RARITY_ORDER.map(rarity => <td key={rarity}>{row.counts[rarity]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allLocalTraitsNormal && (
          <p className="catalog-report__callout">
            <strong>局部特征当前全部为普通</strong>：稀有度目前施加在完整外形 bundle 与全局变异，而不是单个局部部位。
          </p>
        )}
      </section>

      <section className="catalog-report__section">
        <div className="catalog-report__section-heading catalog-report__section-heading--cards">
          <div>
            <p className="catalog-report__eyebrow">VISUAL LIBRARY</p>
            <h2>完整外形库</h2>
          </div>
          <div className="catalog-report__filters" aria-label="按稀有度筛选">
            {(['all', ...RARITY_ORDER] as const).map(filter => (
              <button
                key={filter}
                type="button"
                aria-pressed={rarityFilter === filter}
                data-rarity={filter === 'all' ? undefined : filter}
                onClick={() => setRarityFilter(filter)}
              >
                {FILTER_LABEL[filter]}
              </button>
            ))}
          </div>
        </div>

        {filteredBundles.length > 0 ? (
          <div className="catalog-report__cards">
            {filteredBundles.map(bundle => (
              <AppearanceCard
                key={bundle.id}
                bundle={bundle}
                catalogVersion={model.catalogVersion}
                resolveAssetUrl={resolveAssetUrl}
              />
            ))}
          </div>
        ) : <p className="catalog-report__empty-filter">当前筛选下没有完整外形。</p>}
      </section>
    </main>
  )
}

function Metric({ label, value, rarity }: { label: string; value: number; rarity?: Rarity }) {
  return (
    <article className="catalog-report__metric" data-rarity={rarity}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>类型</span>
    </article>
  )
}

function AppearanceCard({
  bundle,
  catalogVersion,
  resolveAssetUrl,
}: {
  bundle: ReportBundle
  catalogVersion: string
  resolveAssetUrl: AssetUrlResolver
}) {
  return (
    <article className="appearance-card" data-rarity={bundle.rarity}>
      <AppearanceImage
        catalogVersion={catalogVersion}
        assetPath={bundle.structuralAssetPath}
        alt={`${bundle.label} 外观预览`}
        resolveAssetUrl={resolveAssetUrl}
      />
      <div className="appearance-card__content">
        <div className="appearance-card__headline">
          <span className="appearance-card__rarity">{rarityLabel(bundle.rarity)} · {bundle.rarity}</span>
          <code>{bundle.poseId}</code>
        </div>
        <h3>{bundle.label}</h3>
        <TraitList title="一体化结构" groups={bundle.structuralTraits} />
        <TraitList title="局部特征池" groups={bundle.localTraits} />
      </div>
    </article>
  )
}

function AppearanceImage({
  catalogVersion,
  assetPath,
  alt,
  resolveAssetUrl,
}: {
  catalogVersion: string
  assetPath: string
  alt: string
  resolveAssetUrl: AssetUrlResolver
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)
    resolveAssetUrl(catalogVersion, assetPath).then(
      result => { if (active) setUrl(result) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [assetPath, catalogVersion, resolveAssetUrl])

  return (
    <div className="appearance-card__image">
      {url !== null && <img src={url} alt={alt} />}
      {url === null && !failed && <span>加载外观图…</span>}
      {failed && <span>外观图暂不可用</span>}
    </div>
  )
}

function TraitList({ title, groups }: { title: string; groups: ReportBundle['structuralTraits'] }) {
  return (
    <details className="appearance-card__traits">
      <summary>{title}</summary>
      <dl>
        {groups.map(group => (
          <div key={group.slotId}>
            <dt>{group.label}</dt>
            <dd>{group.values.join('、')}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
