import type { VisualSlotId } from './contracts.js'

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

export function slotSeedParts(
  seed: string,
  themeId: string,
  slotId: VisualSlotId,
  rerollIndex: number,
): readonly string[] {
  return [seed, themeId, slotId, String(rerollIndex)]
}

export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  rng: Rng,
): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty weighted collection')
  }

  const weights = items.map(item => weightOf(item))
  const totalWeight = weights.reduce(
    (total, weight) => total + (weight > 0 ? weight : 0),
    0,
  )
  if (totalWeight <= 0) {
    throw new Error('Cannot pick from a weighted collection with no positive weight')
  }

  const roll = rng.nextFloat() * totalWeight
  let cumulativeWeight = 0
  let lastPositiveItem: T | undefined
  for (const [index, item] of items.entries()) {
    const weight = weights[index] ?? 0
    if (weight <= 0) {
      continue
    }
    lastPositiveItem = item
    cumulativeWeight += weight
    if (roll < cumulativeWeight) {
      return item
    }
  }

  return lastPositiveItem as T
}
