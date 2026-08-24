import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeValidCatalogFixture, makeValidMonsterSpecFixture } from '@qmonster/generator-core/test-fixtures'
import { LegacySpecViewer } from './LegacySpecViewer.js'

describe('LegacySpecViewer', () => {
  it('renders an exact legacy specimen as read-only and returns without editor actions', async () => {
    const user = userEvent.setup()
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const onReturn = vi.fn()

    render(<LegacySpecViewer
      spec={spec}
      catalog={catalog}
      exportCapabilities={{ png: true, webp: true }}
      onReturn={onReturn}
    />)

    expect(screen.getByText('旧版标本 · 只读查看')).toBeTruthy()
    expect(screen.getByText('目录 v0.1.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 PNG' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出透明 WebP' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '孵化整只生物' })).toBeNull()
    expect(screen.queryByLabelText('主题')).toBeNull()
    expect(screen.queryByRole('button', { name: /重抽/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: '返回新版生成器' }))
    expect(onReturn).toHaveBeenCalledOnce()
  })
})
