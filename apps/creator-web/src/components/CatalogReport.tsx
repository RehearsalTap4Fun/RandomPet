import { useEffect, useMemo, useState } from 'react'
import type { AnimalArchetypeId, Rarity, VisualSlotId } from '@qmonster/generator-core'
import type { ImageResolver } from '@qmonster/renderer-canvas'
import {
  RARITY_ORDER,
  rarityLabel,
  type ArchetypeReport,
  type CatalogReportModel,
  type LegacyCatalogReportModel,
  type ReportBundle,
  type ReportTrait,
  type V09CatalogReportModel,
  type V09ReportTrait,
} from '../catalog-report.js'
import { resolveCatalogReportAssetUrl } from '../catalog-report-assets.js'
import { TraitPreviewCanvas } from './TraitPreviewCanvas.js'
import { resolveProductionV09ResourceUrl, type PreviewRenderer } from './PreviewCanvas.js'

type RarityFilter = 'all' | Rarity
type AssetUrlResolver = (catalogVersion: string, assetPath: string) => Promise<string>
type V09ResourceUrlResolver = (sha256: string) => Promise<string>

export interface CatalogReportProps {
  model: CatalogReportModel
  resolveAssetUrl?: AssetUrlResolver
  traitRenderer?: PreviewRenderer
  traitResolver?: ImageResolver
  resolveV09ResourceUrl?: V09ResourceUrlResolver
}

const FILTER_LABEL: Record<RarityFilter, string> = {
  all: '全部',
  N: '普通 N',
  R: '稀有 R',
  L: '传说 L',
}

export function CatalogReport({
  model,
  resolveAssetUrl = resolveCatalogReportAssetUrl,
  traitRenderer,
  traitResolver,
  resolveV09ResourceUrl = resolveProductionV09ResourceUrl,
}: CatalogReportProps) {
  if (model.kind === 'v09') {
    return <V09CatalogReport model={model} resolveResourceUrl={resolveV09ResourceUrl} />
  }
  return <LegacyCatalogReport
    model={model}
    resolveAssetUrl={resolveAssetUrl}
    {...(traitRenderer === undefined ? {} : { traitRenderer })}
    {...(traitResolver === undefined ? {} : { traitResolver })}
  />
}

function LegacyCatalogReport({
  model,
  resolveAssetUrl,
  traitRenderer,
  traitResolver,
}: {
  model: LegacyCatalogReportModel
  resolveAssetUrl: AssetUrlResolver
  traitRenderer?: PreviewRenderer
  traitResolver?: ImageResolver
}) {
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<AnimalArchetypeId | null>(model.defaultArchetypeId)
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all')
  const [selectedSlotId, setSelectedSlotId] = useState<VisualSlotId>('bodyFrame')
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
  const speciesRigBundle = model.catalogVersion === '0.8.0' ? selectedArchetype.bundles[0] : undefined
  const speciesRigGroups = speciesRigBundle === undefined
    ? []
    : [...speciesRigBundle.structuralTraits, ...speciesRigBundle.localTraits]
  const selectedTraitGroup = speciesRigGroups.find(group => group.slotId === selectedSlotId) ?? speciesRigGroups[0]
  const filteredTraits = selectedTraitGroup?.parts.filter(part => rarityFilter === 'all' || part.rarity === rarityFilter) ?? []

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
              <dd>{model.tierWeights[rarity]}{model.tierWeightUnit}</dd>
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
              setSelectedSlotId('bodyFrame')
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

      {speciesRigBundle !== undefined && selectedTraitGroup !== undefined && (
        <section className="catalog-report__section">
          <div className="catalog-report__section-heading catalog-report__section-heading--cards">
            <div>
              <p className="catalog-report__eyebrow">TRAIT SPECIMENS</p>
              <h2>部件完整形象预览</h2>
            </div>
            <span>每张卡都通过 V0.8 正式渲染器生成完整生物，不直接展示漂浮部件。</span>
          </div>
          <div className="catalog-report__slot-tabs" aria-label="部位分类">
            {speciesRigGroups.map(group => (
              <button
                key={group.slotId}
                type="button"
                aria-pressed={selectedTraitGroup.slotId === group.slotId}
                onClick={() => setSelectedSlotId(group.slotId)}
              >
                {group.label} · 8/4/1
              </button>
            ))}
          </div>
          <div className="catalog-report__filters catalog-report__trait-filters" aria-label="按部件稀有度筛选">
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
          <div className="catalog-report__trait-grid">
            {filteredTraits.map(trait => (
              <TraitCard
                key={trait.id}
                trait={trait}
                bundleId={speciesRigBundle.id}
                model={model}
                {...(traitRenderer === undefined ? {} : { renderer: traitRenderer })}
                {...(traitResolver === undefined ? {} : { resolver: traitResolver })}
              />
            ))}
          </div>
        </section>
      )}

      {speciesRigBundle === undefined && <section className="catalog-report__section">
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
      </section>}

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

function TraitCard({
  trait,
  bundleId,
  model,
  renderer,
  resolver,
}: {
  trait: ReportTrait
  bundleId: string
  model: LegacyCatalogReportModel
  renderer?: PreviewRenderer
  resolver?: ImageResolver
}) {
  return (
    <article className="trait-card" data-rarity={trait.rarity}>
      <TraitPreviewCanvas
        catalog={model.catalog}
        bundleId={bundleId}
        partId={trait.id}
        {...(renderer === undefined ? {} : { renderer })}
        {...(resolver === undefined ? {} : { resolver })}
      />
      <div className="trait-card__content">
        <span className="appearance-card__rarity">{rarityLabel(trait.rarity)} · {trait.rarity}</span>
        <h3>{trait.displayName}</h3>
        <code>{trait.id}</code>
        <dl>
          <div><dt>区域</dt><dd>{trait.ownerRegionId ?? '—'}</dd></div>
          <div><dt>表达</dt><dd>{trait.expressionKind ?? '—'}</dd></div>
        </dl>
      </div>
    </article>
  )
}

function V09CatalogReport({
  model,
  resolveResourceUrl,
}: {
  model: V09CatalogReportModel
  resolveResourceUrl: V09ResourceUrlResolver
}) {
  const [selectedSkeletonId, setSelectedSkeletonId] = useState(model.skeletons[0]?.id ?? '')
  const [selectedSlotId, setSelectedSlotId] = useState(model.slots[0]?.slotId ?? 'bodyColor')
  const [rarityFilter, setRarityFilter] = useState<'all' | V09ReportTrait['rarity']>('all')
  const selectedSlot = model.slots.find(slot => slot.slotId === selectedSlotId) ?? model.slots[0]
  const traits = selectedSlot?.traits.filter(trait => (
    trait.skeletonFamilyId === selectedSkeletonId
    && (rarityFilter === 'all' || trait.rarity === rarityFilter)
  )) ?? []

  return (
    <main className="catalog-report catalog-report--v09">
      <header className="catalog-report__hero">
        <div>
          <p className="catalog-report__eyebrow">Q MONSTER · IMMUTABLE RELEASE</p>
          <h1>v0.9 原子骨架图鉴</h1>
          <p>从内容寻址 release inventory 实时读取；不使用手写 trait 清单。</p>
          <code>{model.releaseManifestSha256}</code>
        </div>
      </header>

      <section className="catalog-report__section" aria-label="完整骨架池">
        <h2>完整骨架</h2>
        <div className="catalog-report__slot-tabs">
          {model.skeletons.map(skeleton => (
            <button
              key={skeleton.id}
              type="button"
              aria-pressed={selectedSkeletonId === skeleton.id}
              onClick={() => setSelectedSkeletonId(skeleton.id)}
            >
              {skeleton.id} · 权重 {skeleton.weight}
            </button>
          ))}
        </div>
      </section>

      <section className="catalog-report__section" aria-label="v0.9 外观槽位">
        <div className="catalog-report__slot-tabs">
          {model.slots.map(slot => (
            <button
              key={slot.slotId}
              type="button"
              aria-pressed={selectedSlot?.slotId === slot.slotId}
              onClick={() => {
                setSelectedSlotId(slot.slotId)
                setRarityFilter('all')
              }}
            >
              {slot.slotId} · {slot.counts.common}/{slot.counts.rare}/{slot.counts.legendary}
            </button>
          ))}
        </div>
        <div className="catalog-report__filters" aria-label="按 v0.9 trait 稀有度筛选">
          {(['all', 'common', 'rare', 'legendary'] as const).map(rarity => (
            <button key={rarity} type="button" aria-pressed={rarityFilter === rarity} onClick={() => setRarityFilter(rarity)}>
              {rarity === 'all' ? '全部' : rarity}
            </button>
          ))}
        </div>
        <div className="catalog-report__trait-grid">
          {traits.map(trait => (
            <V09TraitCard key={`${trait.skeletonFamilyId}:${trait.id}`} trait={trait} resolveResourceUrl={resolveResourceUrl} />
          ))}
        </div>
      </section>
    </main>
  )
}

function V09TraitCard({
  trait,
  resolveResourceUrl,
}: {
  trait: V09ReportTrait
  resolveResourceUrl: V09ResourceUrlResolver
}) {
  return (
    <article className="trait-card" aria-label={`${trait.slotId} trait ${trait.id}`} data-rarity={trait.rarity}>
      <AppearanceImage
        catalogVersion="0.9.0"
        assetPath={trait.fullContextPreviewSha256}
        alt={`${trait.id} 完整上下文预览`}
        resolveAssetUrl={async (_version, sha256) => resolveResourceUrl(sha256)}
      />
      <div className="trait-card__content">
        <span>{trait.rarity} · 已批准</span>
        <h3>{trait.id}</h3>
        <code>{trait.sealedArtifactSha256}</code>
        {trait.interfaceId !== null && <p>interface: {trait.interfaceId}</p>}
        {trait.shapeClass !== null && <p>shapeClass: {trait.shapeClass}</p>}
      </div>
    </article>
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
      {url !== null && <img src={url} alt={alt} onError={() => {
        setUrl(null)
        setFailed(true)
      }} />}
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
