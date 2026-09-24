export const traitSlots = ['body', 'coat', 'eyes', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip'] as const
export type TraitSlot = typeof traitSlots[number]
export type WorkbenchCoverage = { id: string; label: string; review: 'approved' | 'pending'; body: string; eyes: string }
export type WorkbenchBundle = {
  schemaVersion: 'feline-appearance-v1' | 'feline-appearance-v2'
  artVersion: string
  coverage: WorkbenchCoverage[]
  generatableCount: number
  render: (id: string) => Promise<Uint8ClampedArray>
  save: (id: string) => unknown
  restore: (input: unknown) => string
  key: (id: string) => string
  traits?: {
    value: (id: string, slot: TraitSlot) => string
    options: (id: string, slot: TraitSlot) => string[]
    select: (id: string, slot: TraitSlot, value: string) => string
  }
}

export const traitLabels: Record<TraitSlot, string> = {
  body: '体型', coat: '毛色', eyes: '眼型', expression: '表情', crown: '额顶', ears: '耳朵', neck: '颈部', back: '背部', tailTip: '尾尖',
}
export const valueLabels: Record<string, string> = {
  standard: '标准体型', 'shortleg-round': '短腿圆身', 'slender-tall': '修长高挑', round: '圆眼', 'sleepy-almond': '半眯杏仁眼',
  'orange-white': '橘白双色', 'brown-tabby': '棕灰虎斑', tuxedo: '黑白燕尾服', calico: '三花', colorpoint: '奶油重点色', rosetted: '金棕豹点',
  'parted-mouth': '自然微张嘴', 'small-fangs': '两颗小牙', none: '无异变', 'dragon-horns': '小龙角', 'crystal-horns': '晶角',
  'fin-ears': '鳍耳', 'feathered-ears': '羽翅耳', 'celestial-ears': '星辉翼耳', 'small-lion-mane': '小狮鬃', 'sunburst-ruff': '日冕颈饰',
  'small-wings': '小翅膀', 'dragon-wings': '龙翼', 'feathered-wings': '羽翼', 'flame-tail': '焰尾', 'phoenix-tail': '凤凰尾',
  halo: '光环', antlers: '鹿角', 'frill-neck': '伞蜥颈膜', 'forked-tail-tip': '分叉尾尖',
}
