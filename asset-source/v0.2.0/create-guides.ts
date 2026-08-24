import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const rigs = ['blob', 'biped', 'floating'] as const
const slots = [
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
  'arms', 'legs', 'tail', 'extraAppendage', 'surfaceMaterial', 'pattern',
  'colorScheme', 'effect',
] as const

const regions: Record<typeof slots[number], string> = {
  bodyFrame: '<rect x="72" y="72" width="880" height="880" rx="220"/>',
  headShape: '<ellipse cx="512" cy="335" rx="270" ry="245"/>',
  eyes: '<rect x="300" y="250" width="424" height="220" rx="100"/>',
  mouthShape: '<rect x="330" y="405" width="364" height="220" rx="100"/>',
  oralDetail: '<rect x="375" y="455" width="274" height="170" rx="72"/>',
  headAppendage: '<path d="M245 345 Q270 55 512 45 Q754 55 779 345 Z"/>',
  arms: '<path d="M70 405 H310 V730 H70 Z M714 405 H954 V730 H714 Z"/>',
  legs: '<path d="M270 650 H475 V930 H270 Z M549 650 H754 V930 H549 Z"/>',
  tail: '<path d="M625 440 H980 V790 H625 Z"/>',
  extraAppendage: '<path d="M55 280 H330 V720 H55 Z M694 280 H969 V720 H694 Z"/>',
  surfaceMaterial: '<ellipse cx="512" cy="525" rx="405" ry="420"/>',
  pattern: '<ellipse cx="512" cy="525" rx="405" ry="420"/>',
  colorScheme: '<ellipse cx="512" cy="525" rx="405" ry="420"/>',
  effect: '<rect x="72" y="72" width="880" height="880" rx="220"/>',
}

const sockets: Record<typeof slots[number], [number, number]> = {
  bodyFrame: [512, 512], headShape: [512, 350], eyes: [512, 350],
  mouthShape: [512, 350], oralDetail: [512, 350], headAppendage: [512, 350],
  arms: [350, 560], legs: [415, 725], tail: [755, 630], extraAppendage: [330, 465],
  surfaceMaterial: [512, 512], pattern: [512, 512], colorScheme: [512, 512], effect: [512, 512],
}

await mkdir('asset-source/v0.1.0/guides', { recursive: true })
for (const rig of rigs) {
  const base = `packages/asset-catalog/assets/v0.1.0/rigs/base_${rig}_v1.png`
  for (const slot of slots) {
    const [socketX, socketY] = sockets[slot]
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <g fill="#ff245f" fill-opacity="0.42" stroke="#ffefef" stroke-width="8" stroke-dasharray="20 14">${regions[slot]}</g>
      <g stroke="#29e7ff" stroke-width="10"><path d="M${socketX - 30} ${socketY}H${socketX + 30}"/><path d="M${socketX} ${socketY - 30}V${socketY + 30}"/></g>
      <circle cx="${socketX}" cy="${socketY}" r="14" fill="#29e7ff" stroke="#101820" stroke-width="5"/>
    </svg>`)
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#20242bff' } })
      .composite([{ input: base }, { input: overlay }])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toFile(`asset-source/v0.1.0/guides/${rig}-${slot}.png`)
  }
}
