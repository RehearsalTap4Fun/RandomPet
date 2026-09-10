import { createRoot } from 'react-dom/client'
import { generateMonsterV09 } from '@qmonster/generator-core'
import candidatePointer from '../../../packages/asset-catalog/releases/candidate-v0.9.0.json'
import { PreviewCanvas } from './components/PreviewCanvas.js'
import { loadActiveProductionRelease } from './v09-production-release.js'

const root = document.getElementById('root')
if (root === null) throw new Error('Preview test root is missing.')
const release = await loadActiveProductionRelease({ pointer: candidatePointer })
const generated = generateMonsterV09({ seed: 'production-preview-default-resolver' }, release.catalog)
if (generated.blocked) throw new Error('Candidate preview generation is blocked.')

createRoot(root).render(<PreviewCanvas
  spec={generated.spec}
  catalog={release.catalog}
  onDiagnosticsChange={diagnostics => {
    document.body.dataset.previewDiagnostics = JSON.stringify(diagnostics)
    if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) document.body.dataset.previewStatus = 'failed'
  }}
  onRenderCommit={() => { document.body.dataset.previewStatus = 'committed' }}
/>)
