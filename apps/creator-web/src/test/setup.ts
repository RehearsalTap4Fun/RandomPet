import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

if (globalThis.CSS?.escape === undefined) {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: {
      ...globalThis.CSS,
      escape: (value: string) => value,
    },
  })
}

afterEach(() => cleanup())

expect.extend({
  toBeDisabled(received: HTMLButtonElement) {
    const pass = received.disabled
    return {
      pass,
      message: () => `expected button ${pass ? 'not ' : ''}to be disabled`,
    }
  },
  toBeEnabled(received: HTMLButtonElement) {
    const pass = !received.disabled
    return {
      pass,
      message: () => `expected button ${pass ? 'not ' : ''}to be enabled`,
    }
  },
})

declare module 'vitest' {
  interface Assertion<T = any> {
    toBeDisabled(): T
    toBeEnabled(): T
  }
}
