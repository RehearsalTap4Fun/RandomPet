import type { Task9EvidenceDependency } from './evidence-root.js'

interface Task9VersionedDependencyProjection {
  historicalSha256: string
  approvedCurrentSha256: string
}

// These are the exact source-byte extensions introduced for immutable post-v0.3
// releases. They preserve the recorded Task 9 evidence hash only when the live
// source still equals the reviewed implementation byte-for-byte.
const TASK9_VERSIONED_SOURCE_PROJECTIONS: Readonly<Record<string, Task9VersionedDependencyProjection>> = {
  'apps/creator-web/src/render-test.ts': {
    historicalSha256: '2951ed7c40081e7f7f1da24436a9a95e1418feb5ac8c0ff2fb669e93a030b4ab',
    approvedCurrentSha256: '55abdd88428982ebdcc78d1b2c1c06dc28fc5e5f4882ed6a1568448770eed35b',
  },
  'packages/asset-catalog/src/cli.ts': {
    historicalSha256: 'e3c18b43c6d964fac3630429a273bfd5c4f0e22057be234e3529b22bb6e54435',
    approvedCurrentSha256: '05c58266a9666367490038bd2e593242d72023cedeabb7b4f73c66516c1962a3',
  },
  'packages/asset-catalog/src/evidence-root.ts': {
    historicalSha256: '044c64756cb275d8a355e57f042158d191767be4457307c35676b2c5690ca220',
    approvedCurrentSha256: '535f18d2f5a967f7e0280c1181f7c29323b0e87194eb23166bf4bb0a44139776',
  },
  'packages/asset-catalog/src/production-validation.ts': {
    historicalSha256: 'b0b24f58af33b21e926c769dbb197861cba2cbd4c39e39402fb3bf7f39009ac9',
    approvedCurrentSha256: '3c3875597a7fd725f1cdeed201bb0c0f444402217c76bda3e3968f8a548c9a9f',
  },
  'packages/asset-catalog/src/source-rich-validation.ts': {
    historicalSha256: '1620927f5a9e3e0e4e2fc44d8403a0b56596671f5dc3a11f675b11e07397a9de',
    approvedCurrentSha256: '10bea7e85bf4a8c37de3deaf214977bd0d689537877d3b84c54b1b1ca731a6ab',
  },
  'packages/generator-core/src/catalog-schema.ts': {
    historicalSha256: 'd378c39a04441aff935e26fd272ca01075aa195b1e5bf7da5df051fe09e07504',
    approvedCurrentSha256: 'a4027ce2e9e138768016a83ba9cd2292a9048f08e8616b3beba34a9d15274277',
  },
  'packages/renderer-canvas/src/render.ts': {
    historicalSha256: '75a1d4b1b997315a1098b8c115e155192f26e47fa7cd33bcf242a81c860d726a',
    approvedCurrentSha256: 'ac2c6d919c2005dc9f709448fa478bf9a59db26dcdd0fef42c835b36270921bf',
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
    approvedCurrentSha256: '74c32d9187c4d7b1a042e635fe8b32eab88b09685c8389ff289ef1bbc84e49f3',
  },
  'vitest.coverage.config.ts': {
    historicalSha256: '94929030ffd95831ae0276e3f9b80e4921ecaf8940089d8952bde268d47b9538',
    approvedCurrentSha256: 'd98ab0d5dd05b90e80dcd1f77b4fa8b180ec198e210b082c7eb39a9177364df1',
  },
}

export function task9HistoricalDependencySha256(path: string, currentSha256: string): string {
  const projection = TASK9_VERSIONED_SOURCE_PROJECTIONS[path]
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
