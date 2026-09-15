export interface Rng {
  nextFloat(): number
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createRng(parts: readonly string[]): Rng {
  let state = fnv1a32(parts.join('\\u001f'))
  return {
    nextFloat() {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    },
  }
}

