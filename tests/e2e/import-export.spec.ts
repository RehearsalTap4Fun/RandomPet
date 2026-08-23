import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'

const invalidConflictPath = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'invalid-conflict.json')

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

test('downloads exact JSON and PNG names, then re-imports the public seed and slots transactionally', async ({ page }) => {
  await openWorkbench(page)
  const seed = page.getByRole('textbox', { name: '种子' })
  const seedBefore = await seed.inputValue()
  const slotsBefore = await publicSlotState(page)
  const filenameStem = `qmonster-fungal-${seedBefore}`

  const jsonDownload = await expectDownload(page, '导出 JSON', `${filenameStem}.json`)
  await expectDownload(page, '导出透明 PNG', `${filenameStem}.png`)
  const jsonPath = await jsonDownload.path()
  expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({ seed: seedBefore, themeId: 'fungal' })

  await seed.fill('temporary-e2e-seed')
  await page.getByRole('button', { name: '孵化整只生物' }).click()
  await expect(page.locator('.preview-heading code')).toHaveAttribute('title', 'temporary-e2e-seed')

  await page.getByLabel('选择要导入的 JSON 文件').setInputFiles(jsonPath)
  await expect(seed).toHaveValue(seedBefore)
  await expect(page.locator('.preview-heading code')).toHaveAttribute('title', seedBefore)
  await expect.poll(() => publicSlotState(page)).toEqual(slotsBefore)

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
