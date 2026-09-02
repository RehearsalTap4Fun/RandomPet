import type { Task9EvidenceDependency } from './evidence-root.js'

interface Task9VersionedDependencyProjection {
  historicalSha256: string
  approvedCurrentSha256: string
}

// These are the exact source-byte extensions introduced for the immutable v0.4
// release. They preserve the recorded Task 9 evidence hash only when the live
// source still equals this reviewed implementation byte-for-byte.
const TASK9_V04_SOURCE_PROJECTIONS: Readonly<Record<string, Task9VersionedDependencyProjection>> = {
  'packages/asset-catalog/src/cli.ts': {
    historicalSha256: 'e3c18b43c6d964fac3630429a273bfd5c4f0e22057be234e3529b22bb6e54435',
    approvedCurrentSha256: '1fd1c048a2db18b9db139dab70738097f2f349f7bf28ae3bd2bed29192a18040',
  },
  'packages/asset-catalog/src/evidence-root.ts': {
    historicalSha256: '044c64756cb275d8a355e57f042158d191767be4457307c35676b2c5690ca220',
    approvedCurrentSha256: '535f18d2f5a967f7e0280c1181f7c29323b0e87194eb23166bf4bb0a44139776',
  },
  'packages/asset-catalog/src/production-validation.ts': {
    historicalSha256: 'b0b24f58af33b21e926c769dbb197861cba2cbd4c39e39402fb3bf7f39009ac9',
    approvedCurrentSha256: '0c7b653c45b076766410518772d5f31b1a5acdb79bb0dfa409f032ea67bd639b',
  },
  'packages/generator-core/src/catalog-schema.ts': {
    historicalSha256: 'd378c39a04441aff935e26fd272ca01075aa195b1e5bf7da5df051fe09e07504',
    approvedCurrentSha256: 'a9d9894fd11122350695fa02fb1c759ba04bbf86c3f9c429b4bf54c2546c54d7',
  },
  'packages/renderer-canvas/src/render.ts': {
    historicalSha256: '75a1d4b1b997315a1098b8c115e155192f26e47fa7cd33bcf242a81c860d726a',
    approvedCurrentSha256: '5eb7cfbe1a8ea5823e05a9fce75e17ead08b530e202d1db2d5635c14f3ba060d',
  },
  'packages/renderer-canvas/src/types.ts': {
    historicalSha256: '58091bf450d815b981e63bd6219eccbac773d6530d9218d9428983a552e2443b',
    approvedCurrentSha256: '7482675d3358e420a2cc439a76e8c802b463a5cc42930c1710531c4aac7b0160',
  },
  'scripts/render-tail-extra-structural-matrices.ts': {
    historicalSha256: '048d7a47216fe091485fecff3873d449f2319bb979e4385b16478a8c0e001e2f',
    approvedCurrentSha256: '9f772d6023e0317fc111031e75db907b31214aca4adc5b6ffa0abb5b68144aad',
  },
  'scripts/task8-stable-projection.ts': {
    historicalSha256: 'a5381f6d2fd30adb274e27043724dcc322cd23bbf10bb2aca68302f006f13c3e',
    approvedCurrentSha256: '2cdfc142ddc2abca3c57f52a0085052d0ae3f1548b77e1f04e00e92829d8053c',
  },
}

export function task9HistoricalDependencySha256(path: string, currentSha256: string): string {
  const projection = TASK9_V04_SOURCE_PROJECTIONS[path]
  return projection?.approvedCurrentSha256 === currentSha256
    ? projection.historicalSha256
    : currentSha256
}

export function projectTask9EvidenceDependencies(
  dependencies: readonly Task9EvidenceDependency[],
): Task9EvidenceDependency[] {
  return dependencies.map(dependency => ({
    ...dependency,
    sha256: task9HistoricalDependencySha256(dependency.path, dependency.sha256),
  }))
}
