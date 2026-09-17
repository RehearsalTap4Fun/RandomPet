import { useEffect, useRef, useState } from 'react'
import {
  phenotypeV2FromLegacy, phenotypeKeyV2, phenotypeKey,
  requirePixelArtCatalog, requirePixelArtCatalogV2,
  restorePixelAppearance, restorePixelAppearanceV2, savePixelAppearance, savePixelAppearanceV2,
  pixelArtKey, pixelArtKeyV2, resolvePixelArtV2, loadPixelArt, loadPixelArtV2, pixelCanvas,
  type PixelResource,
} from '../../../packages/incubator-adapter/src/pixel-art-sdk.js'
import approvedInput from '../../../packages/asset-catalog/pixel/v1/catalog.approved.json'
import candidateInput from '../../../packages/asset-catalog/pixel/v1/catalog.candidate.json'
import legacyApprovedInput from '../../../packages/asset-catalog/pixel/v1/catalog.legacy-approved.json'
import v2CandidateInput from '../../../packages/asset-catalog/pixel/v2/catalog.candidate.json'
import v2ApprovedInput from '../../../packages/asset-catalog/pixel/v2/catalog.approved.json'
import coverageInput from '../../../packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round/catalog.candidate.json'
import './pixel-workbench.css'

type WorkbenchCoverage = { id: string; label: string; review: 'approved' | 'pending'; body: string; eyes: string }
type WorkbenchBundle = {
  schemaVersion: 'feline-appearance-v1' | 'feline-appearance-v2'
  artVersion: string
  coverage: WorkbenchCoverage[]
  generatableCount: number
  render: (id: string) => Promise<Uint8ClampedArray>
  save: (id: string) => unknown
  restore: (input: unknown) => string
  key: (id: string) => string
}
const urls = import.meta.glob('../../../packages/asset-catalog/pixel/*/assets/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const resourceUrl = (version: 'v1' | 'v2') => (resource: PixelResource) => {
  const url = urls[`../../../packages/asset-catalog/pixel/${version}/${resource.path}`]
  if (!url) throw new Error(`缺少资源：${resource.path}`)
  return url
}
function v1Bundle(input: unknown): WorkbenchBundle {
  const catalog = requirePixelArtCatalog(input)
  let loaded: ReturnType<typeof loadPixelArt> | undefined
  const entry = (id: string) => {
    const found = catalog.coverage.find(c => c.id === id)
    if (!found) throw new Error(`Unknown coverage: ${id}`)
    return found
  }
  return {
    schemaVersion: 'feline-appearance-v1', artVersion: catalog.artVersion,
    coverage: catalog.coverage.map(c => ({ id: c.id, label: c.label, review: c.review, body: c.phenotype.body, eyes: 'round' })),
    generatableCount: catalog.generatable.length,
    render: async id => {
      loaded ??= loadPixelArt(catalog, resourceUrl('v1')).catch(error => { loaded = undefined; throw error })
      return (await loaded).render(entry(id).phenotype)
    },
    save: id => savePixelAppearance(entry(id).phenotype, catalog),
    restore: input => {
      const phenotype = restorePixelAppearance(input, catalog)
      return catalog.coverage.find(c => phenotypeKey(c.phenotype) === phenotypeKey(phenotype))!.id
    },
    key: id => pixelArtKey(entry(id).phenotype, catalog),
  }
}
const v2Catalog = requirePixelArtCatalogV2(v2ApprovedInput)
function v2Bundle(input: unknown): WorkbenchBundle {
  const catalog = requirePixelArtCatalogV2(input)
  let loaded: ReturnType<typeof loadPixelArtV2> | undefined
  const entry = (id: string) => {
    const found = catalog.coverage.find(c => c.id === id)
    if (!found) throw new Error(`Unknown coverage: ${id}`)
    return found
  }
  return {
    schemaVersion: 'feline-appearance-v2', artVersion: catalog.artVersion,
    coverage: catalog.coverage.map(c => ({ id: c.id, label: c.label, review: c.review, body: c.phenotype.body, eyes: c.phenotype.eyes })),
    generatableCount: catalog.generatable.length,
    render: async id => {
      loaded ??= loadPixelArtV2(catalog, resourceUrl('v2')).catch(error => { loaded = undefined; throw error })
      return (await loaded).render(entry(id).phenotype)
    },
    save: id => savePixelAppearanceV2(entry(id).phenotype, catalog),
    restore: input => {
      const phenotype = restorePixelAppearanceV2(input, catalog)
      return catalog.coverage.find(c => phenotypeKeyV2(c.phenotype) === phenotypeKeyV2(phenotype))!.id
    },
    key: id => pixelArtKeyV2(entry(id).phenotype, catalog),
  }
}
const bundles = { approved: v1Bundle(approvedInput), candidate: v1Bundle(candidateInput), 'legacy-approved': v1Bundle(legacyApprovedInput), 'v2-candidate': v2Bundle(v2CandidateInput), 'v2-approved': v2Bundle(v2ApprovedInput), 'v2-coverage-standard-small-fangs-round': v2Bundle(coverageInput) }
type BundleName = keyof typeof bundles
const bundleNames = Object.keys(bundles) as BundleName[]
const bodyLabels: Record<string, string> = { standard: '标准体型', 'shortleg-round': '短腿圆身', 'slender-tall': '修长高挑' }
const eyeLabels: Record<string, string> = { round: '圆眼', 'sleepy-almond': '半眯杏仁眼' }
const STORAGE_KEY = 'qmonster.pixel-appearance.v2'
function importedState(input: unknown): { bundle: BundleName; id: string } {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input)) throw new Error('缺少形象 schemaVersion。')
  if (input.schemaVersion === 'feline-combination-v1') {
    const phenotype = phenotypeV2FromLegacy(input)
    resolvePixelArtV2(phenotype, v2Catalog)
    return { bundle: 'v2-approved', id: v2Catalog.coverage.find(c => phenotypeKeyV2(c.phenotype) === phenotypeKeyV2(phenotype))!.id }
  }
  if (input.schemaVersion !== 'feline-appearance-v1' && input.schemaVersion !== 'feline-appearance-v2') throw new Error(`不支持的形象版本：${input.schemaVersion}`)
  const artVersion = 'art' in input && input.art && typeof input.art === 'object' && 'artVersion' in input.art ? input.art.artVersion : undefined
  const name = bundleNames.find(name => bundles[name].schemaVersion === input.schemaVersion && bundles[name].artVersion === artVersion)
  if (!name) throw new Error('当前未载入此美术版本。')
  return { bundle: name, id: bundles[name].restore(input) }
}
function initialState() {
  try {
    const text = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('qmonster.pixel-appearance.v1')
    if (text) return { ...importedState(JSON.parse(text)), warning: '' }
  } catch (error) { return { bundle: 'v2-approved' as const, id: 'approved-base', warning: String(error) } }
  return { bundle: 'v2-approved' as const, id: 'approved-base', warning: '' }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function PixelWorkbench() {
  const [initial] = useState(initialState)
  const [bundleName, setBundleName] = useState<BundleName>(initial.bundle)
  const [selection, setSelection] = useState(initial.id)
  const [result, setResult] = useState<{ key: string; pixels: Uint8ClampedArray } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState(initial.warning)
  const [importText, setImportText] = useState('')
  const [background, setBackground] = useState<'light' | 'dark' | 'checker'>('dark')
  const [onlyApproved, setOnlyApproved] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bundle = bundles[bundleName]
  const current = bundle.coverage.find(c => c.id === selection)!
  const renderKey = bundle.key(selection)
  const pixels = result?.key === renderKey ? result.pixels : null

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void bundle.render(selection).then(pixels => {
      if (!cancelled) setResult({ key: renderKey, pixels })
    }).catch(error => { if (!cancelled) setLoadError(String(error)) })
    return () => { cancelled = true }
  }, [bundle, selection, renderKey])

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    context?.clearRect(0, 0, 64, 64)
    if (pixels) context?.putImageData(new ImageData(new Uint8ClampedArray(pixels), 64, 64), 0, 0)
  }, [pixels])

  function persist(id: string, name = bundleName) {
    const saved = bundles[name].save(id)
    setSelection(id); setBundleName(name); setActionError('')
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)) }
    catch (error) { setActionError(`保存失败，可导出 JSON 保留形象：${String(error)}`) }
  }
  function importAppearance() {
    try {
      const next = importedState(JSON.parse(importText))
      persist(next.id, next.bundle); setOnlyApproved(false)
    } catch (error) { setActionError(`导入未应用：${String(error)}`) }
  }
  function exportPng(scale: 1 | 2) {
    if (!pixels) return
    const name = `qmonster-pixel-${current.id}-${scale * 64}.png`
    pixelCanvas(pixels, scale).toBlob(blob => {
      if (blob) download(blob, name)
      else setActionError('PNG 导出失败。')
    }, 'image/png')
  }
  return <main className="feline-workbench pixel-workbench">
    <header className="feline-header"><a className="feline-brand" href="/">QMONSTER<span>怪奇生物</span></a><nav><a href="/">毛绒工坊</a><span aria-current="page">像素工坊</span></nav></header>
    <div className="feline-intro"><p className="feline-eyebrow">PIXEL CAT STUDIO</p><h1>小小像素，奇妙生长。</h1><p>三种体型，两种眼神，一批一批扩展新的模样。</p></div>
    <div className="feline-layout">
      <section className="feline-preview-column" aria-label="像素小猫预览">
        <div className={`feline-stage feline-stage-${background} pixel-stage`} aria-busy={!pixels && !loadError}>
          <canvas ref={canvasRef} width={64} height={64} aria-label="像素小猫透明画布" />
          {!pixels && <div className="feline-stage-message" role="status">{loadError ? '资源未就绪' : '正在载入像素资源…'}</div>}
        </div>
        <div className="feline-preview-tools"><div className="feline-backgrounds" role="group" aria-label="预览背景">{(['light','dark','checker'] as const).map(value => <button key={value} className={`feline-swatch feline-swatch-${value}`} aria-label={`${{ light: '浅色', dark: '深色', checker: '棋盘格' }[value]}背景`} aria-pressed={background === value} onClick={() => setBackground(value)} />)}</div><span>{pixels ? '64px 原生 · 整数倍预览' : '加载中'}</span></div>
        <h2 className="pixel-title">{current.label}</h2><p className="pixel-traits">{bodyLabels[current.body] ?? current.body} · {eyeLabels[current.eyes] ?? current.eyes}</p><p className={`pixel-review ${current.review}`}>{current.review === 'approved' ? '已验收 · 可用于生成' : '候选组合 · 待美术验收'}</p>
        <div className="pixel-export"><button disabled={!pixels} onClick={() => exportPng(1)}>导出 64px PNG</button><button className="feline-primary" disabled={!pixels} onClick={() => exportPng(2)}>导出 128px PNG</button><button disabled={!pixels} onClick={() => download(new Blob([JSON.stringify(bundle.save(current.id), null, 2)], { type: 'application/json' }), `qmonster-pixel-${current.id}.json`)}>保存形象 JSON</button></div>
        <p className="feline-preview-note">PNG 保留透明背景。形象 JSON 同时记录性状和美术版本，便于还原。</p>
        {(loadError) && <p role="alert" className="feline-error">{loadError}</p>}
      </section>
      <section className="feline-controls" aria-label="像素组合选择">
        <label className="pixel-bundle">资源范围<select aria-label="资源范围" value={bundleName} onChange={e => { const name = e.target.value as BundleName; persist(bundles[name].coverage.some(c => c.id === selection) ? selection : bundles[name].coverage[0]!.id, name) }}><option value="v2-approved">已验收包 1.2.0 · {bundles['v2-approved'].coverage.length} 个组合</option><option value="v2-coverage-standard-small-fangs-round">覆盖候选 1.2.1 · 32 个组合（11 个待验收）</option><option value="approved">历史已验收包 1.1.0 · {bundles.approved.coverage.length} 个组合</option><option value="legacy-approved">历史首批 1.0.0 · {bundles['legacy-approved'].coverage.length} 个组合</option><option value="candidate">历史候选快照 · {bundles.candidate.coverage.length} 个组合</option><option value="v2-candidate">候选包 1.2.0 · {bundles['v2-candidate'].coverage.length} 个组合</option></select></label>
        {bundleName === 'v2-coverage-standard-small-fangs-round' && <p className="pixel-candidate-note">{bundle.artVersion} · 标准圆眼小尖牙新增 11 个待验收组合；21 个已验收组合可生成。</p>}
        {bundleName === 'v2-candidate' && <p className="pixel-candidate-note">历史版本 {bundle.artVersion} · 保留当时 7 个待验收组合；当前验收结果请切换至 1.2.0。</p>}
        {bundleName !== 'v2-approved' && bundleName !== 'v2-candidate' && bundleName !== 'v2-coverage-standard-small-fangs-round' && <p className="feline-preview-note">正在还原历史版本及当时的验收状态。当前 1.2.0 已通过全部 21 个组合，可在上方切换。</p>}
        <div className="pixel-filter"><label><input type="checkbox" checked={onlyApproved} onChange={e => setOnlyApproved(e.target.checked)} />仅显示已验收</label><span>{bundle.generatableCount} 个可生成组合</span></div>
        <div className="pixel-samples" role="group" aria-label="组合样例">{bundle.coverage.filter(c => !onlyApproved || c.review === 'approved').map(c => <button key={c.id} data-coverage-id={c.id} data-review={c.review} aria-pressed={selection === c.id} onClick={() => persist(c.id)}><strong>{c.label}</strong><small>{c.review === 'approved' ? '已验收' : '待验收'}</small></button>)}</div>
        <details className="feline-spec-tools"><summary>恢复形象 / 导入旧规格</summary><p>粘贴形象 JSON 或旧毛绒规格。保留已确定的性状；当前资源未覆盖的组合会提示原因。</p><textarea aria-label="导入形象 JSON" rows={7} value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false}/><button onClick={importAppearance}>应用形象</button></details>
        {actionError && <p role="alert" className="feline-error">{actionError}</p>}
        <p className="feline-footer-note">当前仅有橘白双色；新体型与部件按批次验收后加入。<br/>毛绒版保留现有规模，后续资源以像素版为主。</p>
      </section>
    </div>
  </main>
}
