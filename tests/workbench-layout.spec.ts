import { expect, test, type Page } from '@playwright/test'

interface LayoutSnapshot {
  viewportWidth: number
  documentWidth: number
  documentHeight: number
  scrollY: number
  controls: DOMRect
  preview: DOMRect
  slots: DOMRect
  stage: DOMRect
}

async function snapshot(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const rect = (selector: string): DOMRect => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`)
      return element.getBoundingClientRect().toJSON() as DOMRect
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      controls: rect('.generator-controls'),
      preview: rect('.preview-column'),
      slots: rect('.slot-panel'),
      stage: rect('.preview-stage'),
    }
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()
})

test('desktop keeps 210px and 320px rails around a square preview without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await expect(page.getByRole('status')).toContainText('组合状态良好')
  const layout = await snapshot(page)

  expect(layout.controls.width).toBeCloseTo(210, 0)
  expect(layout.slots.width).toBeCloseTo(320, 0)
  expect(layout.controls.x).toBeLessThan(layout.preview.x)
  expect(layout.preview.x).toBeLessThan(layout.slots.x)
  expect(Math.abs(layout.stage.width - layout.stage.height)).toBeLessThanOrEqual(1)
  expect(layout.documentWidth).toBe(layout.viewportWidth)
  expect(layout.scrollY).toBe(0)
})

test('below 880px moves slots beneath preview while retaining the global rail', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 })
  await page.reload()
  const layout = await snapshot(page)

  expect(layout.controls.x).toBeLessThan(layout.preview.x)
  expect(layout.slots.x).toBeCloseTo(layout.preview.x, 0)
  expect(layout.slots.y).toBeGreaterThanOrEqual(layout.preview.bottom)
  expect(layout.documentWidth).toBe(layout.viewportWidth)
})

test('below 560px stacks controls, preview and slots without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 1000 })
  await page.reload()
  const layout = await snapshot(page)

  expect(layout.preview.y).toBeGreaterThanOrEqual(layout.controls.bottom)
  expect(layout.slots.y).toBeGreaterThanOrEqual(layout.preview.bottom)
  expect(layout.documentWidth).toBe(layout.viewportWidth)
})
