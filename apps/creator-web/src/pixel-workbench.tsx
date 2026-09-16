import { useEffect, useMemo, useRef, useState } from 'react'
import { phenotypeFromLegacy, phenotypeKey } from '../../../packages/generator-core/src/feline-phenotype.js'
import { requirePixelArtCatalog, resolvePixelArt, restorePixelAppearance, savePixelAppearance } from '../../../packages/asset-catalog/src/pixel-art-catalog.js'
import { loadPixelArt, pixelCanvas } from '../../../packages/renderer-canvas/src/pixel-art-render.js'
import approvedInput from '../../../packages/asset-catalog/pixel/v1/catalog.approved.json'
import candidateInput from '../../../packages/asset-catalog/pixel/v1/catalog.candidate.json'
import legacyApprovedInput from '../../../packages/asset-catalog/pixel/v1/catalog.legacy-approved.json'
import './pixel-workbench.css'

const catalogs = { approved: requirePixelArtCatalog(approvedInput), candidate: requirePixelArtCatalog(candidateInput), 'legacy-approved': requirePixelArtCatalog(legacyApprovedInput) }
type BundleName = keyof typeof catalogs
const bundleNames: BundleName[] = ['approved', 'legacy-approved', 'candidate']
const urls = import.meta.glob('../../../packages/asset-catalog/pixel/v1/assets/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const STORAGE_KEY = 'qmonster.pixel-appearance.v1'
function initialState() {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (text) {
      const saved = JSON.parse(text)
      for (const bundle of bundleNames) {
        if (saved.art?.artVersion !== catalogs[bundle].artVersion) continue
        const phenotype = restorePixelAppearance(saved, catalogs[bundle])
        return { bundle, id: catalogs[bundle].coverage.find(c => phenotypeKey(c.phenotype) === phenotypeKey(phenotype))!.id, warning: '' }
      }
      throw new Error('保存的美术版本不在当前资源包中，请保留原 JSON 并载入对应版本。')
    }
  } catch (error) { return { bundle: 'approved' as const, id: 'approved-base', warning: String(error) } }
  return { bundle: 'approved' as const, id: 'approved-base', warning: '' }
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
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadPixelArt>> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState(initial.warning)
  const [importText, setImportText] = useState('')
  const [background, setBackground] = useState<'light' | 'dark' | 'checker'>('dark')
  const [onlyApproved, setOnlyApproved] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const catalog = catalogs[bundleName]
  const current = catalog.coverage.find(c => c.id === selection)!
  const isLoaded = loaded?.catalog.revision === catalog.revision
  const rendered = useMemo(() => {
    if (!isLoaded || !loaded || !current) return { pixels: null, error: '' }
    try { return { pixels: loaded.render(current.phenotype), error: '' } }
    catch (error) { return { pixels: null, error: String(error) } }
  }, [loaded, isLoaded, current])
  const pixels = rendered.pixels

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void loadPixelArt(catalog, resource => {
      const url = Object.entries(urls).find(([path]) => path.endsWith(`/${resource.path}`))?.[1]
      if (!url) throw new Error(`缺少资源：${resource.path}`)
      return url
    }).then(result => { if (!cancelled) setLoaded(result) }).catch(error => { if (!cancelled) setLoadError(String(error)) })
    return () => { cancelled = true }
  }, [catalog])

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d')
    context?.clearRect(0, 0, 64, 64)
    if (pixels) context?.putImageData(new ImageData(new Uint8ClampedArray(pixels), 64, 64), 0, 0)
  }, [pixels])

  function persist(id: string, name = bundleName) {
    setSelection(id); setBundleName(name); setActionError('')
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savePixelAppearance(catalogs[name].coverage.find(c => c.id === id)!.phenotype, catalogs[name]))) }
    catch (error) { setActionError(`保存失败，可导出 JSON 保留形象：${String(error)}`) }
  }
  function importAppearance() {
    try {
      const input = JSON.parse(importText)
      let name = bundleName
      if (input.schemaVersion === 'feline-appearance-v1') {
        const match = bundleNames.find(key => catalogs[key].artVersion === input.art?.artVersion)
        if (!match) throw new Error('当前未载入此美术版本。')
        name = match
      }
      const phenotype = input.schemaVersion === 'feline-combination-v1' ? phenotypeFromLegacy(input) : restorePixelAppearance(input, catalogs[name])
      resolvePixelArt(phenotype, catalogs[name])
      const entry = catalogs[name].coverage.find(c => phenotypeKey(c.phenotype) === phenotypeKey(phenotype))!
      setOnlyApproved(false); persist(entry.id, name)
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
    <div className="feline-intro"><p className="feline-eyebrow">PIXEL CAT STUDIO</p><h1>小小像素，奇妙生长。</h1><p>从两种体型开始，一批一批扩展新的模样。</p></div>
    <div className="feline-layout">
      <section className="feline-preview-column" aria-label="像素小猫预览">
        <div className={`feline-stage feline-stage-${background} pixel-stage`} aria-busy={!pixels && !loadError}>
          <canvas ref={canvasRef} width={64} height={64} aria-label="像素小猫透明画布" />
          {!pixels && <div className="feline-stage-message" role="status">{loadError || rendered.error ? '资源未就绪' : '正在载入像素资源…'}</div>}
        </div>
        <div className="feline-preview-tools"><div className="feline-backgrounds" role="group" aria-label="预览背景">{(['light','dark','checker'] as const).map(value => <button key={value} className={`feline-swatch feline-swatch-${value}`} aria-label={`${{ light: '浅色', dark: '深色', checker: '棋盘格' }[value]}背景`} aria-pressed={background === value} onClick={() => setBackground(value)} />)}</div><span>{pixels ? '64px 原生 · 整数倍预览' : '加载中'}</span></div>
        <h2 className="pixel-title">{current.label}</h2><p className={`pixel-review ${current.review}`}>{current.review === 'approved' ? '已验收 · 可用于生成' : '候选组合 · 待美术验收'}</p>
        <div className="pixel-export"><button disabled={!pixels} onClick={() => exportPng(1)}>导出 64px PNG</button><button className="feline-primary" disabled={!pixels} onClick={() => exportPng(2)}>导出 128px PNG</button><button disabled={!pixels} onClick={() => download(new Blob([JSON.stringify(savePixelAppearance(current.phenotype, catalog), null, 2)], { type: 'application/json' }), `qmonster-pixel-${current.id}.json`)}>保存形象 JSON</button></div>
        <p className="feline-preview-note">PNG 保留透明背景。形象 JSON 同时记录性状和美术版本，便于还原。</p>
        {(loadError || rendered.error) && <p role="alert" className="feline-error">{loadError || rendered.error}</p>}
      </section>
      <section className="feline-controls" aria-label="像素组合选择">
        <label className="pixel-bundle">资源范围<select aria-label="资源范围" value={bundleName} onChange={e => { const name = e.target.value as BundleName; persist(catalogs[name].coverage.some(c => c.id === selection) ? selection : 'approved-base', name) }}><option value="approved">已验收包 1.1.0 · {catalogs.approved.coverage.length} 个组合</option><option value="legacy-approved">历史首批 1.0.0 · {catalogs['legacy-approved'].coverage.length} 个组合</option><option value="candidate">历史候选快照 · {catalogs.candidate.coverage.length} 个组合</option></select></label>
        {bundleName !== 'approved' && <p className="feline-preview-note">正在还原历史版本及当时的验收状态。当前 1.1.0 已通过全部 14 个组合，可在上方切换。</p>}
        <div className="pixel-filter"><label><input type="checkbox" checked={onlyApproved} onChange={e => setOnlyApproved(e.target.checked)} />仅显示已验收</label><span>{catalog.generatable.length} 个可生成组合</span></div>
        <div className="pixel-samples" role="group" aria-label="组合样例">{catalog.coverage.filter(c => !onlyApproved || c.review === 'approved').map(c => <button key={c.id} aria-pressed={selection === c.id} onClick={() => persist(c.id)}><strong>{c.label}</strong><small>{c.review === 'approved' ? '已验收' : '待验收'}</small></button>)}</div>
        <details className="feline-spec-tools"><summary>恢复形象 / 导入旧规格</summary><p>粘贴形象 JSON 或旧毛绒规格。保留已确定的性状；当前资源未覆盖的组合会提示原因。</p><textarea aria-label="导入形象 JSON" rows={7} value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false}/><button onClick={importAppearance}>应用形象</button></details>
        {actionError && <p role="alert" className="feline-error">{actionError}</p>}
        <p className="feline-footer-note">当前仅有橘白双色；新体型与部件按批次验收后加入。<br/>毛绒版保留现有规模，后续资源以像素版为主。</p>
      </section>
    </div>
  </main>
}
