import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
