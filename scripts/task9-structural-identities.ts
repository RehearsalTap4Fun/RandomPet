export const TASK9_RIG_IDS = ['blob', 'biped', 'floating'] as const
export type Task9RigId = typeof TASK9_RIG_IDS[number]

export const TASK9_TAIL_IDS = ['tail_fish_fan', 'tail_soft_curl', 'tail_mushroom_cluster'] as const
export const TASK9_EXTRA_IDS = ['extra_moth_wings', 'extra_soft_tentacles', 'extra_side_fins'] as const

export const TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE = {
  id: 'task9-tail-extra',
  activeVisualSlots: ['tail', 'extraAppendage'],
  activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight'],
} as const

export const TASK9_BODY_RIG_IDS = {
  body_blob_round: 'blob',
  body_blob_wide: 'blob',
  body_biped_peanut: 'biped',
  body_biped_tall: 'biped',
  body_floating_drop: 'floating',
} as const satisfies Record<string, Task9RigId>

export const TASK9_BODIES_BY_RIG = Object.fromEntries(TASK9_RIG_IDS.map(rigId => [
  rigId,
  Object.entries(TASK9_BODY_RIG_IDS)
    .filter(([, candidateRigId]) => candidateRigId === rigId)
    .map(([bodyId]) => bodyId),
])) as Record<Task9RigId, string[]>

export function assertTask9Task8BodyRoster(candidate: Record<string, readonly string[]>): void {
  for (const [bodyId, rigId] of Object.entries(TASK9_BODY_RIG_IDS)) {
    if (!candidate[rigId]?.includes(bodyId)) throw new Error(`TASK9_BODY_ROSTER_MISMATCH: missing ${rigId}:${bodyId}`)
  }
  for (const [rigId, bodyIds] of Object.entries(candidate)) {
    for (const bodyId of bodyIds) {
      if ((TASK9_BODY_RIG_IDS as Record<string, string>)[bodyId] !== rigId) {
        throw new Error(`TASK9_BODY_ROSTER_MISMATCH: unexpected ${rigId}:${bodyId}`)
      }
    }
  }
}
