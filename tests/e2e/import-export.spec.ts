import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'

const invalidConflictPath = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'invalid-conflict.json')
const expectedSlotControlIds = [
  'slot-control-arms',
  'slot-control-bodyFrame',
  'slot-control-colorScheme',
  'slot-control-effect',
  'slot-control-extraAppendage',
  'slot-control-eyes',
  'slot-control-headAppendage',
  'slot-control-headShape',
  'slot-control-legs',
  'slot-control-mouthShape',
  'slot-control-oralDetail',
  'slot-control-pattern',
  'slot-control-surfaceMaterial',
  'slot-control-tail',
] as const

async function openWorkbench(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()
}

async function expectDownload(page: Page, buttonName: string, filename: string): Promise<Download> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: buttonName }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  return download
}

async function publicSlotState(page: Page): Promise<Record<string, string>> {
  return page.locator('select[id^="slot-control-"]').evaluateAll(selects => Object.fromEntries(
    selects.map(select => [select.id, (select as HTMLSelectElement).value]),
  ))
}

test('downloads exact JSON and PNG names, then re-imports the public v0.2 specimen read-only', async ({ page }) => {
  await openWorkbench(page)
  const seed = page.getByRole('textbox', { name: '种子' })
  const seedBefore = await seed.inputValue()
  const slotControls = page.locator('select[id^="slot-control-"]')
  await expect(slotControls).toHaveCount(14)
  expect((await slotControls.evaluateAll(selects => selects.map(select => select.id))).sort()).toEqual(
    [...expectedSlotControlIds],
  )
  const slotsBefore = await publicSlotState(page)
  expect(Object.keys(slotsBefore)).toHaveLength(14)
  const filenameStem = `qmonster-fungal-${seedBefore}`

  const jsonDownload = await expectDownload(page, '导出 JSON', `${filenameStem}.json`)
  const pngDownload = await expectDownload(page, '导出透明 PNG', `${filenameStem}.png`)
  expect(await pngDownload.failure()).toBeNull()
  const pngPath = await pngDownload.path()
  const pngBytes = await readFile(pngPath)
  expect(pngBytes.byteLength).toBeGreaterThan(0)
  expect([...pngBytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const jsonPath = await jsonDownload.path()
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({ seed: seedBefore, themeId: 'fungal' })

  await seed.fill('temporary-e2e-seed')
  await page.getByRole('button', { name: '孵化整只生物' }).click()
  await expect(page.locator('.preview-heading code')).toHaveAttribute('title', 'temporary-e2e-seed')

  await page.getByLabel('选择要导入的 JSON 文件').setInputFiles(jsonPath)
  await expect(page.getByRole('heading', { name: '旧版标本 · 只读查看' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '目录 v0.2.0 · 渲染器 v0.2.0' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '种子' })).toHaveCount(0)
  await expect(page.locator('select[id^="slot-control-"]')).toHaveCount(0)
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()

  await page.getByRole('button', { name: '返回新版生成器' }).click()
  await expect(seed).toHaveValue('temporary-e2e-seed')
  await expect(page.locator('.preview-heading code')).toHaveAttribute('title', 'temporary-e2e-seed')

  const seedBeforeInvalidImport = await seed.inputValue()
  await page.getByLabel('选择要导入的 JSON 文件').setInputFiles(invalidConflictPath)
  await expect(page.getByLabel('诊断信息')).toContainText('SPEC_THEME_INCOMPATIBLE')
  await expect(seed).toHaveValue(seedBeforeInvalidImport)
  await expect(page.locator('.preview-heading code')).toHaveAttribute('title', seedBeforeInvalidImport)
})

test('keeps JSON and PNG enabled when WebP encoding is unsupported', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type, quality) {
      if (type === 'image/webp') {
        callback(new Blob(['unsupported'], { type: 'image/png' }))
        return
      }
      nativeToBlob.call(this, callback, type, quality)
    }
  })
  await page.goto('/')

  await expect(page.getByText('当前浏览器不支持 WebP 编码，请改用 PNG。')).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '导出透明 WebP' })).toBeDisabled()
})
