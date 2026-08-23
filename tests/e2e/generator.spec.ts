import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'

interface ExportedSpec {
  slotRolls: { tail: number }
}

async function openWorkbench(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()
}

async function downloadJson(page: Page): Promise<Download> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON' }).click()
  return downloadPromise
}

test('locks, rerolls, manually selects, and blocks an incompatible theme lock', async ({ page }) => {
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
