import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  makeLimbMatrixPlan,
  reconstructLimbMatrixEvidence,
} from '../../../scripts/render-limb-contact-sheets.js'
import { task8HistoricalCausalCatalog } from '../../../scripts/validate-interface-slice.js'

const plan = makeLimbMatrixPlan('full')
for (const index of [0, 36, 48]) {
  const item = plan[index]
  if (item === undefined) throw new Error(`Missing plan entry ${index}.`)
  const live = (await reconstructLimbMatrixEvidence({
    planOverride: [item],
    catalogProjection: task8HistoricalCausalCatalog,
  })).entries[0]
  if (live === undefined) throw new Error(`Missing live entry ${index}.`)
  const manifestName = `limb-contact-sheet-${live.rigId}-manifest.json`
  const manifest = JSON.parse(await readFile(resolve(
    'packages/asset-catalog/review/v0.3.0',
    manifestName,
  ), 'utf8'))
  const stored = manifest.entries.find((entry: typeof live) => (
    entry.rigId === live.rigId
    && entry.bodyFrame === live.bodyFrame
    && entry.arms === live.arms
    && entry.legs === live.legs
  ))
  console.log(JSON.stringify({
    index,
    key: [live.rigId, live.bodyFrame, live.arms, live.legs],
    liveDiagnostics: live.diagnostics,
    storedDiagnostics: stored?.diagnostics,
    liveGateErrors: live.gateErrors,
    storedGateErrors: stored?.gateErrors,
  }, null, 2))
}
