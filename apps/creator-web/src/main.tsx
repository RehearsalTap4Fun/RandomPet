import { createRoot } from 'react-dom/client'
import './styles.css'

const element = document.getElementById('root')
if (!element) throw new Error('Application root is missing.')
const root = createRoot(element)
const pixel = location.pathname === '/pixel'
root.render(<main className="feline-workbench"><p role="status">正在载入{pixel ? '像素' : '毛绒'}工坊…</p></main>)

// Load only the selected workbench; shared dependencies remain reusable chunks.
async function loadWorkbench() {
  if (pixel) {
    const module = await import('./pixel-workbench.js')
    return module.PixelWorkbench
  }
  const module = await import('./feline-workbench.js')
  return module.FelineWorkbench
}
void loadWorkbench().then(Workbench => root.render(<Workbench />)).catch(() => {
  root.render(<main className="feline-workbench">
    <p className="feline-error" role="alert">工坊载入失败，请重新加载。</p>
    <button onClick={() => location.reload()}>重新加载</button>
    <p><a href={pixel ? '/' : '/pixel'}>切换到{pixel ? '毛绒' : '像素'}工坊</a></p>
  </main>)
})
