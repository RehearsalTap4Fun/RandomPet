import type { VisualSlotId } from '@qmonster/generator-core'

export const SLOT_LABELS: Record<VisualSlotId, string> = {
  bodyFrame: '体型骨架',
  headShape: '头部轮廓',
  eyes: '眼睛',
  mouthShape: '嘴型',
  oralDetail: '口腔细节',
  headAppendage: '头部附饰',
  arms: '手臂',
  legs: '腿脚',
  tail: '尾巴',
  extraAppendage: '额外附肢',
  surfaceMaterial: '表皮材质',
  pattern: '纹理图案',
  colorScheme: '色彩方案',
  effect: '氛围效果',
}

export const SLOT_GROUPS: ReadonlyArray<{
  id: string
  label: string
  slots: readonly VisualSlotId[]
}> = [
  { id: 'shape', label: '形体', slots: ['bodyFrame', 'headShape'] },
  { id: 'face', label: '面部', slots: ['eyes', 'mouthShape', 'oralDetail', 'headAppendage'] },
  { id: 'appendage', label: '附肢', slots: ['arms', 'legs', 'tail', 'extraAppendage'] },
  { id: 'surface', label: '表面', slots: ['surfaceMaterial', 'pattern', 'colorScheme', 'effect'] },
]
