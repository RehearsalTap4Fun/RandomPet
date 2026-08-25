export function partitionSeamAlpha(
  bridge: Uint8ClampedArray,
  transition: Uint8ClampedArray,
  receiver: Uint8ClampedArray,
  plug: Uint8ClampedArray,
): Uint8ClampedArray {
  if (
    bridge.length % 4 !== 0
    || transition.length !== bridge.length
    || receiver.length !== bridge.length
    || plug.length !== bridge.length
  ) throw new Error('Seam masks require matching RGBA dimensions.')
  const result = new Uint8ClampedArray(bridge.length)
  for (let offset = 0; offset < bridge.length; offset += 4) {
    const connectorAlpha = Math.max(receiver[offset + 3] ?? 0, plug[offset + 3] ?? 0) / 255
    const maskAlpha = (transition[offset + 3] ?? 0) / 255 * connectorAlpha
    result[offset] = bridge[offset] ?? 0
    result[offset + 1] = bridge[offset + 1] ?? 0
    result[offset + 2] = bridge[offset + 2] ?? 0
    result[offset + 3] = Math.round((bridge[offset + 3] ?? 0) * maskAlpha)
  }
  return result
}
