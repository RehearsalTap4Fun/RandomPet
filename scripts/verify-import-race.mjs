import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Run against the real candidate app, without changing its source or render path.
const appUrl = process.argv[2] ?? 'http://127.0.0.1:4184/'
const storageKey = 'qmonster.feline-combination-candidate.v1'
const browser = await chromium.launch({ headless: true })
const report = { appUrl, checkedAt: new Date().toISOString(), passed: false, checks: [] }

async function snapshot(page) {
  return page.evaluate(key => ({
    spec: JSON.parse(localStorage.getItem(key)),
    textarea: document.querySelector('#feline-import-json').value,
  }), storageKey)
}

async function check(mode) {
  const page = await browser.newPage()
  try {
    await page.goto(appUrl)
    await page.getByText('保存与恢复规格', { exact: true }).click()
    const initial = (await snapshot(page)).spec
    const imported = structuredClone(initial)
    imported.seed = 'delayed-file'
    imported.selections.coat = 'orange-white'
    const pasted = structuredClone(initial)
    pasted.seed = 'newer-pasted-spec'
    pasted.selections.coat = 'tuxedo'

    // In the Apply case, populate the textarea before starting the old file read;
    // then only the Apply action can invalidate that read.
    if (mode === 'pasted-apply') await page.locator('#feline-import-json').fill(JSON.stringify(pasted))
    await page.evaluate(() => {
      const read = File.prototype.text
      File.prototype.text = async function () {
        await new Promise(resolve => { window.releaseFileRead = resolve })
        const text = await read.call(this)
        window.fileReadFinished = true
        return text
      }
    })
    await page.locator('input[type=file]').setInputFiles({
      name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
    })
    if (mode === 'newer-coat') await page.getByRole('button', { name: '黑白燕尾服', exact: true }).click()
    if (mode === 'textarea-edit') await page.locator('#feline-import-json').fill('newer textarea draft')
    if (mode === 'pasted-apply') await page.getByRole('button', { name: '应用规格', exact: true }).click()
    const before = await snapshot(page)

    await page.evaluate(() => window.releaseFileRead())
    await page.waitForFunction(() => window.fileReadFinished === true)
    // Flush the read callback and React's following update before inspecting state.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const after = await snapshot(page)
    if (mode === 'uninterrupted-import') {
      assert.deepEqual(after.spec, imported, 'A file import with no newer action must still apply')
      assert.equal(after.textarea, JSON.stringify(imported))
    } else {
      assert.deepEqual(after, before, 'A stale file read must not replace newer UI or saved state')
      if (mode === 'newer-coat') assert.equal(after.spec.selections.coat, 'tuxedo')
      if (mode === 'textarea-edit') assert.equal(after.textarea, 'newer textarea draft')
      if (mode === 'pasted-apply') assert.deepEqual(after.spec, pasted)
    }
    report.checks.push({ mode, passed: true, savedSeed: after.spec.seed, savedCoat: after.spec.selections.coat })
  } catch (error) {
    report.checks.push({ mode, passed: false, error: String(error) })
    throw error
  } finally { await page.close() }
}

try {
  for (const mode of ['newer-coat', 'textarea-edit', 'pasted-apply', 'uninterrupted-import']) await check(mode)
  report.passed = true
} finally {
  await browser.close()
  await writeFile(new URL('../docs/qa/import-race-verification.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}
