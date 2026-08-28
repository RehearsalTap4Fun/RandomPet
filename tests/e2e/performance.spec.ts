import { expect, test, type Page } from '@playwright/test'

interface PerformanceSamples {
  rerollMilliseconds: number[]
  rerollP95Milliseconds: number
  pngExportMilliseconds: number[]
  cacheEntries: {
    afterWarmPass: number
    afterRepeatPass: number
    afterTimedRerolls: number
  }
}

async function previewCommitCount(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByName('qmonster-preview-commit', 'mark').length)
}

async function waitForNextCommit(page: Page, previousCount: number): Promise<void> {
  await expect.poll(() => previewCommitCount(page)).toBe(previousCount + 1)
}

async function resolverCacheSize(page: Page): Promise<number> {
  return page.getByRole('img', { name: '生物预览' }).evaluate(canvas => {
    const value = (canvas as HTMLCanvasElement).dataset.resolverCacheSize
    if (value === undefined) throw new Error('Preview canvas does not expose resolver cache size.')
    return Number(value)
  })
}

async function selectTail(page: Page, partId: string): Promise<void> {
  const tail = page.getByRole('combobox', { name: '尾巴部件' })
  if (await tail.inputValue() === partId) return
  const commits = await previewCommitCount(page)
  await tail.selectOption(partId)
  await waitForNextCommit(page, commits)
}

test('meets the current-machine reroll, PNG export, and bounded-cache release gates', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  test.skip(testInfo.project.name !== 'chromium', 'Release performance gate uses bundled Chromium')

  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  await expect.poll(() => previewCommitCount(page), { timeout: 30_000 }).toBeGreaterThan(0)

  const tail = page.getByRole('combobox', { name: '尾巴部件' })
  const tailParts = await tail.locator('option:not([disabled])').evaluateAll(options => (
    options.map(option => (option as HTMLOptionElement).value)
  ))
  expect(tailParts.length).toBeGreaterThan(0)
  for (const partId of tailParts) await selectTail(page, partId)
  const cacheAfterWarmPass = await resolverCacheSize(page)
  for (const partId of tailParts) await selectTail(page, partId)
  const cacheAfterRepeatPass = await resolverCacheSize(page)
  expect(cacheAfterRepeatPass).toBe(cacheAfterWarmPass)

  await page.evaluate(() => {
    performance.clearMarks('qmonster-command-start')
    performance.clearMarks('qmonster-preview-commit')
    performance.clearMeasures()
  })

  const rerollMilliseconds: number[] = []
  const rerollTail = page.getByRole('button', { name: '重抽尾巴' })
  for (let index = 0; index < 100; index += 1) {
    await page.evaluate(() => {
      performance.clearMarks('qmonster-command-start')
      performance.clearMarks('qmonster-preview-commit')
    })
    await rerollTail.click()
    await waitForNextCommit(page, 0)
    rerollMilliseconds.push(await page.evaluate((sampleIndex) => {
      const marks = performance.getEntriesByType('mark')
      const commitIndex = marks.findIndex(entry => entry.name === 'qmonster-preview-commit')
      const commit = marks[commitIndex]
      if (commit === undefined) throw new Error('Missing preview commit mark.')
      const start = marks
        .slice(0, commitIndex)
        .find(entry => entry.name === 'qmonster-command-start')
      if (start === undefined) throw new Error('Missing command start mark before preview commit.')
      return performance.measure(`qmonster-tail-reroll-${sampleIndex}`, {
        start: start.startTime,
        end: commit.startTime,
      }).duration
    }, index))
  }
  const sortedRerolls = [...rerollMilliseconds].sort((left, right) => left - right)
  const rerollP95Milliseconds = sortedRerolls[Math.ceil(sortedRerolls.length * 0.95) - 1]!
  expect(rerollP95Milliseconds).toBeLessThanOrEqual(150)

  const cacheAfterTimedRerolls = await resolverCacheSize(page)
  expect(cacheAfterTimedRerolls).toBe(cacheAfterRepeatPass)

  const pngExportMilliseconds: number[] = []
  const pngButton = page.getByRole('button', { name: '导出透明 PNG' })
  for (let index = 0; index < 10; index += 1) {
    const started = await page.evaluate(() => performance.now())
    const downloadPromise = page.waitForEvent('download')
    await pngButton.click()
    const download = await downloadPromise
    expect(await download.failure()).toBeNull()
    const ended = await page.evaluate(() => performance.now())
    pngExportMilliseconds.push(ended - started)
  }

  const samples: PerformanceSamples = {
    rerollMilliseconds,
    rerollP95Milliseconds,
    pngExportMilliseconds,
    cacheEntries: {
      afterWarmPass: cacheAfterWarmPass,
      afterRepeatPass: cacheAfterRepeatPass,
      afterTimedRerolls: cacheAfterTimedRerolls,
    },
  }
  const body = Buffer.from(`${JSON.stringify(samples, null, 2)}\n`)
  await testInfo.attach('current-machine-performance-samples.json', {
    body,
    contentType: 'application/json',
  })
  console.log(`QM_RELEASE_PERFORMANCE=${JSON.stringify(samples)}`)
  for (const duration of pngExportMilliseconds) expect(duration).toBeLessThanOrEqual(2000)
})
