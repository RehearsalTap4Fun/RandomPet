import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'

interface ExportedSpec {
  slotRolls: { tail: number }
}

async function openWorkbench(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()
  await expect.poll(() => previewCommitCount(page), { timeout: 120_000 }).toBeGreaterThan(0)
}

async function previewCommitCount(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByName('qmonster-preview-commit', 'mark').length)
}

async function waitForCommitAfter(page: Page, previousCount: number): Promise<void> {
  await expect.poll(() => previewCommitCount(page), { timeout: 30_000 }).toBeGreaterThan(previousCount)
}

async function strongFeatureCount(page: Page): Promise<number> {
  const composition = page.getByRole('list', { name: '组合约束' })
  const text = await composition.textContent()
  const match = text?.match(/强特征\s+(\d+)\/2/u)
  if (match?.[1] === undefined) throw new Error(`Missing strong-feature status in: ${text ?? ''}`)
  return Number(match[1])
}

async function downloadJson(page: Page): Promise<Download> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON' }).click()
  return downloadPromise
}

test('locks, rerolls, manually selects, and blocks an incompatible theme lock', async ({ page }) => {
  test.setTimeout(120_000)
  await openWorkbench(page)

  const eyes = page.getByRole('combobox', { name: '眼睛部件' })
  const tail = page.getByRole('combobox', { name: '尾巴部件' })
  const eyesBefore = await eyes.inputValue()
  const tailRollBefore = JSON.parse(
    await readFile(await (await downloadJson(page)).path(), 'utf8'),
  ) as ExportedSpec

  await page.getByRole('checkbox', { name: '锁定 眼睛' }).check()
  await page.getByRole('button', { name: '重抽尾巴' }).click()
  await expect(page.getByRole('checkbox', { name: '锁定 眼睛' })).toBeChecked()
  await expect(eyes).toHaveValue(eyesBefore)

  const tailRollAfter = JSON.parse(
    await readFile(await (await downloadJson(page)).path(), 'utf8'),
  ) as ExportedSpec
  expect(tailRollAfter.slotRolls.tail).toBe(tailRollBefore.slotRolls.tail + 1)
  await expect(tail).toBeEnabled()

  const mouth = page.getByRole('combobox', { name: '嘴型部件' })
  const currentMouth = await mouth.inputValue()
  const legalMouths = await mouth.locator('option:not([disabled])').evaluateAll(options => (
    options.map(option => (option as HTMLOptionElement).value)
  ))
  const manualMouth = legalMouths.find(value => value !== currentMouth)
  expect(manualMouth).toBeDefined()
  await mouth.selectOption(manualMouth!)
  await expect(mouth).toHaveValue(manualMouth!)

  const colorScheme = page.getByRole('combobox', { name: '色彩方案部件' })
  const colorLock = page.getByRole('checkbox', { name: '锁定 色彩方案' })
  const colorSchemeBefore = await colorScheme.inputValue()
  await colorLock.check()
  await page.getByRole('combobox', { name: '主题' }).selectOption('shadow')
  await expect(colorScheme).toHaveValue(colorSchemeBefore)
  await expect(colorLock).toBeChecked()

  const diagnostics = page.getByLabel('诊断信息')
  const colorLockDiagnostic = diagnostics.getByText('LOCK_INCOMPATIBLE', { exact: true }).locator('..')
  await expect(colorLockDiagnostic).toHaveCount(1)
  await expect(colorLockDiagnostic.getByRole('link', { name: '定位到色彩方案' })).toHaveAttribute(
    'href',
    '#slot-control-colorScheme',
  )
  await expect(page.getByRole('button', { name: '导出 JSON' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '导出透明 PNG' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '导出透明 WebP' })).toBeDisabled()
})

test('keeps automatic composition within budget and leaves warning-only manual composites exportable', async ({ page }) => {
  test.setTimeout(120_000)
  await openWorkbench(page)
  await expect(page.getByLabel('作品状态')).toContainText('错误 0')
  const composition = page.getByRole('list', { name: '组合约束' })
  await expect(composition).toContainText(/强特征 \d\/2/u)
  expect(await strongFeatureCount(page)).toBeLessThanOrEqual(2)
  await expect(composition).toContainText('面部清晰')

  const oralDetail = page.getByRole('combobox', { name: '口腔细节部件' })
  await expect(oralDetail).toHaveValue('oral_lolling_tongue')
  await page.getByRole('checkbox', { name: '锁定 口腔细节' }).check()

  let commits: number
  const rerollEffect = page.getByRole('button', { name: '重抽氛围效果' })
  for (let index = 0; index < 8; index += 1) {
    commits = await previewCommitCount(page)
    await rerollEffect.click()
    await waitForCommitAfter(page, commits)
    expect(await strongFeatureCount(page)).toBeLessThanOrEqual(2)
    await expect(oralDetail).toHaveValue('oral_lolling_tongue')
  }

  const effect = page.getByRole('combobox', { name: '氛围效果部件' })
  commits = await previewCommitCount(page)
  await effect.selectOption('effect_none')
  await waitForCommitAfter(page, commits)
  const eyes = page.getByRole('combobox', { name: '眼睛部件' })
  commits = await previewCommitCount(page)
  await eyes.selectOption('eyes_triple_pearl')
  await waitForCommitAfter(page, commits)

  await expect(composition).toContainText('强特征 3/2')
  const warning = page.getByLabel('诊断信息').getByText('COMPOSITION_INTENSITY_EXCEEDED', { exact: true })
  await expect(warning).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '导出透明 WebP' })).toBeEnabled()
})
