import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'

const N = 64
const catalogRoot = 'packages/asset-catalog/pixel/v3/approved-1.5.0'

const opaqueRuns = (pixels, y) => {
  const runs = []
  let start = -1
  for (let x = 0; x <= N; x++) {
    const opaque = x < N && pixels[(y * N + x) * 4 + 3] === 255
    if (opaque && start < 0) start = x
    if (!opaque && start >= 0) { runs.push([start, x - 1]); start = -1 }
  }
  return runs
}

const erase = (pixels, polygons) => {
  const output = new Uint8ClampedArray(pixels)
  for (const polygon of polygons) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let inside = false
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const [xi, yi] = polygon[index]
      const [xj, yj] = polygon[previous]
      if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside
    }
    if (inside) output.fill(0, (y * N + x) * 4, (y * N + x) * 4 + 4)
  }
  return output
}

test('sunburst ruff uses the approved small-lion-mane neck interface', async () => {
  const catalog = JSON.parse(await fs.readFile(`${catalogRoot}/catalog.approved.json`, 'utf8'))
  const ruff = new Uint8ClampedArray(await sharp('docs/qa/pixel-evolution-chains/layers/sunburst-ruff.png').ensureAlpha().raw().toBuffer())
  const report = JSON.parse(await fs.readFile('docs/qa/pixel-evolution-chains/report.json', 'utf8'))
  const candidate = report.candidates.find(item => item.id === 'sunburst-ruff')
  assert.equal(candidate.target, 'subject')
  assert.deepEqual(Object.keys(candidate.occlusionByBody).sort(), ['shortleg-round', 'slender-tall', 'standard'])

  for (const { profileId, bodyId } of [
    { profileId: 'standard-parted-mouth-round', bodyId: 'standard' },
    { profileId: 'shortleg-round-small-fangs-round', bodyId: 'shortleg-round' },
    { profileId: 'slender-tall-round-small-fangs', bodyId: 'slender-tall' },
  ]) {
    const profile = catalog.profiles.find(item => item.id === profileId)
    const neckStep = profile.steps.find(item => item.slot === 'neck')
    const maneResource = catalog.resources[neckStep.resources['small-lion-mane']]
    const mane = new Uint8ClampedArray(await sharp(`${catalogRoot}/${maneResource.path}`).ensureAlpha().raw().toBuffer())
    const visibleMane = erase(mane, neckStep.occlusion)
    const visibleRuff = erase(ruff, candidate.occlusionByBody[bodyId])
    let comparedRows = 0
    for (let y = 0; y < N; y++) {
      const maneRuns = opaqueRuns(visibleMane, y)
      if (maneRuns.length !== 2) continue
      const [left, right] = maneRuns
      assert.equal(visibleRuff[(y * N + left[1]) * 4 + 3], 255, `${profileId} row ${y}: missing left mane-interface tip x=${left[1]}`)
      assert.equal(visibleRuff[(y * N + right[0]) * 4 + 3], 255, `${profileId} row ${y}: missing right mane-interface tip x=${right[0]}`)
      assert.equal(visibleRuff[(y * N + 27) * 4 + 3], 0, `${profileId} row ${y}: face centre must remain clear`)
      comparedRows++
    }
    assert.ok(comparedRows >= 2, `${profileId}: expected at least two split neck-interface rows`)
  }
})
