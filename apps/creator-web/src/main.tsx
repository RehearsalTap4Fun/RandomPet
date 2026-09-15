import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  COMBINATION_OPTIONS, COMBINATION_SLOTS, generateFelineCombination,
  parseFelineCombinationSpec, rerollFelineCombination, rerollFelineCombinationSlot,
  setFelineCombinationSelection, type FelineCombinationSlot, type FelineCombinationSpec,
} from '@qmonster/generator-core'
import { parseFelineCombinationCatalog, resolveFelineCombination } from '../../../packages/asset-catalog/src/feline-combination-catalog.js'
import { createFelineCombinationResourceResolver, renderFelineCombination } from '../../../packages/renderer-canvas/src/feline-combination-render.js'
import manifest from '../../../packages/asset-catalog/catalog/v0.10.0/catalog.json'
import './styles.css'

const STORAGE_KEY = 'qmonster.feline-combination-candidate.v1'
const slotLabels: Record<FelineCombinationSlot, string> = {
  coat: '花纹', expression: '表情', crown: '额顶', ears: '耳朵', neck: '颈部', back: '背部', tailTip: '尾尖',
}
const optionLabels: Record<string, string> = {
  'brown-tabby': '棕灰虎斑', 'orange-white': '橘白双色', tuxedo: '黑白燕尾服', calico: '三花',
  colorpoint: '奶油重点色', rosetted: '金棕豹点', 'parted-mouth': '自然微张嘴',
  'small-fangs': '两颗小牙', 'tongue-tip': '轻吐舌', none: '无异变',
  'dragon-horns': '小龙角', antlers: '鹿角', 'fin-ears': '鳍耳',
  'small-lion-mane': '小狮鬃', 'small-wings': '小翅膀', 'forked-tail-tip': '分叉尾尖',
}
const assetUrls = import.meta.glob('../../../packages/asset-catalog/assets/v0.10.0/*.png', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>
const parsedCatalog = parseFelineCombinationCatalog(manifest)
const diagnosticText = (diagnostics: { path: string[]; message: string }[]) => diagnostics.map(item => `${item.path.join('.') || '规格'}：${item.message}`).join('\n')
const resolver = createFelineCombinationResourceResolver(resource => {
  const matches = Object.entries(assetUrls).filter(([path]) => path.endsWith(`/${resource.path}`))
  if (matches.length !== 1) throw new Error(`素材文件${matches.length ? '不唯一' : '缺失'}：${resource.path}`)
  return matches[0]![1]
})

function loadInitialState(): { spec: FelineCombinationSpec; warning: string } {
  const initial = generateFelineCombination('qmonster-feline-01', {
    coat: 'orange-white', expression: 'small-fangs', crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
  })
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = parseFelineCombinationSpec(JSON.parse(stored))
      if (!parsed.ok) return { spec: initial, warning: `保存的规格无法恢复：\n${diagnosticText(parsed.diagnostics)}` }
      return { spec: parsed.value, warning: '' }
    }
  } catch (error) {
    return { spec: initial, warning: `保存的规格无法恢复：${error instanceof Error ? error.message : String(error)}` }
  }
  return { spec: initial, warning: '' }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function FelineWorkbench() {
  const [initial] = useState(loadInitialState)
  const [spec, setSpec] = useState(initial.spec)
  const [seed, setSeed] = useState(initial.spec.seed)
  const [actionError, setActionError] = useState(initial.warning)
  const [renderError, setRenderError] = useState('')
  const [pending, setPending] = useState(true)
  const [ready, setReady] = useState(false)
  const [background, setBackground] = useState<'light' | 'dark' | 'checker'>('light')
  const [importText, setImportText] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderEpoch = useRef(0)
  const importEpoch = useRef(0)

  useEffect(() => {
    const epoch = ++renderEpoch.current
    let cancelled = false
    const display = canvasRef.current
    setPending(true)
    setReady(false)
    setRenderError('')
    display?.getContext('2d')?.clearRect(0, 0, 1254, 1254)
    const render = async () => {
      try {
        if (!parsedCatalog.ok) throw new Error(diagnosticText(parsedCatalog.diagnostics))
        const plan = resolveFelineCombination(spec, parsedCatalog.value)
        const privateCanvas = document.createElement('canvas')
        privateCanvas.width = 1254
        privateCanvas.height = 1254
        await renderFelineCombination(privateCanvas, plan, resolver)
        if (cancelled || epoch !== renderEpoch.current) return
        const context = display?.getContext('2d')
        if (!context) throw new Error('预览画布不可用。')
        context.clearRect(0, 0, 1254, 1254)
        context.drawImage(privateCanvas, 0, 0)
        setReady(true)
      } catch (error) {
        if (cancelled || epoch !== renderEpoch.current) return
        display?.getContext('2d')?.clearRect(0, 0, 1254, 1254)
        setRenderError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled && epoch === renderEpoch.current) setPending(false)
      }
    }
    void render()
    return () => { cancelled = true }
  }, [spec])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(spec)) }
    catch { setActionError('浏览器无法保存规格，请使用「导出规格」保留本次结果。') }
  }, [spec])

  const update = (operation: () => FelineCombinationSpec) => {
    importEpoch.current += 1
    try {
      const next = operation()
      // Invalidate the current render immediately, before React schedules the next effect.
      renderEpoch.current += 1
      setPending(true)
      setReady(false)
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, 1254, 1254)
      setSpec(next)
      setSeed(next.seed)
      setActionError('')
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }
  const importSpec = (text: string) => update(() => {
    let decoded: unknown
    try { decoded = JSON.parse(text) } catch { throw new Error('JSON 格式错误，请检查引号、逗号与括号。') }
    const result = parseFelineCombinationSpec(decoded)
    if (!result.ok) throw new Error(diagnosticText(result.diagnostics))
    return result.value
  })
  const exportPng = () => {
    if (!ready || pending) return
    canvasRef.current?.toBlob(blob => {
      if (blob) download(blob, `qmonster-${spec.selections.coat}-${spec.selections.expression}.png`)
      else setActionError('PNG 导出失败，请重新生成后再试。')
    }, 'image/png')
  }
  const isAvailable = (slot: FelineCombinationSlot, value: string) => {
    if (!parsedCatalog.ok) return false
    const catalog = parsedCatalog.value
    if (slot === 'coat') return Boolean(catalog.bodies[value as typeof spec.selections.coat]?.[spec.selections.expression])
    if (slot === 'expression') return Boolean(catalog.bodies[spec.selections.coat]?.[value as typeof spec.selections.expression])
    return value === 'none' || Boolean(catalog.mutations[spec.selections.coat]?.[value as Exclude<typeof spec.selections.crown | typeof spec.selections.ears | typeof spec.selections.neck | typeof spec.selections.back | typeof spec.selections.tailTip, 'none'>])
  }

  return <main className="feline-workbench">
    <header className="feline-header">
      <a className="feline-brand" href="/">QMONSTER<span>怪奇生物</span></a>
      <span className="feline-version-badge">小猫组合工坊</span>
    </header>
    <div className="feline-intro"><p className="feline-eyebrow">CAT CREATION STUDIO</p><h1>给小猫，一点奇妙。</h1><p>挑选花纹与表情，让不同位置的异变一起生长。</p></div>
    <div className="feline-layout">
      <section className="feline-preview-column" aria-label="小猫预览">
        <div className={`feline-stage feline-stage-${background}`} aria-busy={pending}>
          <canvas ref={canvasRef} width={1254} height={1254} aria-label="组合小猫透明画布" />
          {(pending || renderError) && <div className="feline-stage-message" role="status">{pending ? '正在绘制小猫…' : '此组合暂无可用预览'}</div>}
        </div>
        <div className="feline-preview-tools">
          <div className="feline-backgrounds" role="group" aria-label="预览背景">
            {(['light', 'dark', 'checker'] as const).map(value => <button key={value} className={`feline-swatch feline-swatch-${value}`} aria-label={`${{ light: '浅色', dark: '深色', checker: '棋盘格' }[value]}背景`} aria-pressed={background === value} onClick={() => setBackground(value)} />)}
          </div>
          <span>{ready ? '素材已载入' : pending ? '加载中' : '素材未就绪'}</span>
          <button className="feline-primary" disabled={!ready || pending} onClick={exportPng}>导出透明 PNG</button>
        </div>
        {renderError && <p className="feline-error" role="alert">{renderError}</p>}
        <p className="feline-preview-note">背景仅用于预览，导出的图片保留透明区域。</p>
      </section>

      <section className="feline-controls" aria-label="组合选择">
        <div className="feline-seed-row"><label htmlFor="feline-seed">生成种子</label><div><input id="feline-seed" value={seed} onChange={event => setSeed(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') update(() => generateFelineCombination(seed)) }} /><button onClick={() => update(() => generateFelineCombination(seed))}>按种子生成</button></div></div>
        <div className="feline-section-heading"><h2>自由搭配</h2><button onClick={() => update(() => rerollFelineCombination(spec))}>重掷未锁定位置 ↻</button></div>
        {COMBINATION_SLOTS.map(slot => <fieldset key={slot} className="feline-slot">
          <legend>{slotLabels[slot]}</legend>
          <div className="feline-slot-actions"><label><input type="checkbox" aria-label={`锁定${slotLabels[slot]}`} checked={spec.locks.includes(slot)} onChange={event => update(() => {
            const parsed = parseFelineCombinationSpec({ ...spec, locks: event.target.checked ? [...spec.locks, slot] : spec.locks.filter(value => value !== slot) })
            if (!parsed.ok) throw new Error(diagnosticText(parsed.diagnostics))
            return parsed.value
          })} />锁定</label><button aria-label={`重掷${slotLabels[slot]}`} disabled={spec.locks.includes(slot)} onClick={() => update(() => rerollFelineCombinationSlot(spec, slot))}>↻</button></div>
          <div className="feline-options" role="group" aria-label={`${slotLabels[slot]}选项`}>{COMBINATION_OPTIONS[slot].map(value => <button key={value} aria-pressed={spec.selections[slot] === value} className={spec.selections[slot] === value ? 'is-selected' : ''} onClick={() => update(() => setFelineCombinationSelection(spec, slot, value))}>{optionLabels[value]}{!isAvailable(slot, value) && <small>待补素材</small>}</button>)}</div>
        </fieldset>)}
        <p className="feline-control-note">锁定可保留重掷结果；手动选择仍可替换。龙角与鹿角共用额顶位置。</p>
        {actionError && <p className="feline-error" role="alert">{actionError}</p>}
        <details className="feline-spec-tools"><summary>保存与恢复规格</summary>
          <p>保留花纹、表情、全部异变、种子及锁定状态。</p>
          <div className="feline-spec-buttons"><button onClick={() => download(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), 'qmonster-feline-spec.json')}>导出规格 JSON</button><label className="feline-file-button">导入文件<input type="file" accept="application/json,.json" onChange={event => {
            const file = event.target.files?.[0]
            const epoch = ++importEpoch.current
            if (file) void file.text().then(text => { if (epoch === importEpoch.current) { setImportText(text); importSpec(text) } }).catch(error => { if (epoch === importEpoch.current) setActionError(String(error)) })
            event.target.value = ''
          }} /></label></div>
          <label htmlFor="feline-import-json">也可粘贴规格 JSON</label><textarea id="feline-import-json" rows={5} value={importText} onChange={event => { importEpoch.current += 1; setImportText(event.target.value) }} placeholder="粘贴导出的完整规格…" spellCheck={false} /><button onClick={() => importSpec(importText)}>应用规格</button>
        </details>
        <p className="feline-footer-note">6 种花纹 · 3 套表情 · 48 种异变组合<br />各位置独立抽取，同位置异变互斥。</p>
      </section>
    </div>
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing.')
createRoot(root).render(<FelineWorkbench />)
