export const TASK9_RIG_IDS = ['blob', 'biped', 'floating'] as const
export type Task9RigId = typeof TASK9_RIG_IDS[number]

export const TASK9_TAIL_IDS = ['tail_fish_fan', 'tail_soft_curl', 'tail_mushroom_cluster'] as const
export const TASK9_EXTRA_IDS = ['extra_moth_wings', 'extra_soft_tentacles', 'extra_side_fins'] as const

export const TASK9_BODY_RIG_IDS = {
  body_blob_round: 'blob',
  body_blob_wide: 'blob',
  body_biped_peanut: 'biped',
  body_biped_tall: 'biped',
  body_floating_drop: 'floating',
} as const satisfies Record<string, Task9RigId>
