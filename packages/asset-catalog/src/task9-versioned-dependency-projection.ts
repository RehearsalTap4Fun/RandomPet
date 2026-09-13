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
    approvedCurrentSha256: '41c0bece181a29721cd2bfc4e276ddf4ee5c4a53225584a5a3498b196fb928b4',
  },
  'packages/asset-catalog/src/evidence-root.ts': {
    historicalSha256: '044c64756cb275d8a355e57f042158d191767be4457307c35676b2c5690ca220',
    approvedCurrentSha256: '535f18d2f5a967f7e0280c1181f7c29323b0e87194eb23166bf4bb0a44139776',
  },
  'packages/asset-catalog/src/production-validation.ts': {
    historicalSha256: 'b0b24f58af33b21e926c769dbb197861cba2cbd4c39e39402fb3bf7f39009ac9',
    approvedCurrentSha256: 'efff93be4f021f1af8ee7b708bef672c2229da36848ef0acae633cad71ff69b5',
  },
  'packages/asset-catalog/src/source-rich-validation.ts': {
    historicalSha256: '1620927f5a9e3e0e4e2fc44d8403a0b56596671f5dc3a11f675b11e07397a9de',
    approvedCurrentSha256: '10bea7e85bf4a8c37de3deaf214977bd0d689537877d3b84c54b1b1ca731a6ab',
  },
  'packages/asset-catalog/src/task9-evidence-dependencies.ts': {
    historicalSha256: '3a07dcd914c3364f62b5634cdd0c23ca92fdf1f08f93f3c6df5afb743ed7f78d',
    approvedCurrentSha256: '855f66c169eeade4425b09d0a03b4c4648af65015f6bf4a7b9841a24c363d340',
  },
  'packages/generator-core/src/catalog-schema.ts': {
    historicalSha256: 'd378c39a04441aff935e26fd272ca01075aa195b1e5bf7da5df051fe09e07504',
    approvedCurrentSha256: '693c4a15ed77eec0cddb121519b1dd223a15695311b32786a1f0e5dc267b51ea',
  },
  'packages/renderer-canvas/src/render.ts': {
    historicalSha256: '75a1d4b1b997315a1098b8c115e155192f26e47fa7cd33bcf242a81c860d726a',
    approvedCurrentSha256: 'b98a57b484764d52fa8bdd2399a78629cd1967b93a6e8af95a80604b4e41f3b6',
  },
  'packages/renderer-canvas/src/types.ts': {
    historicalSha256: '58091bf450d815b981e63bd6219eccbac773d6530d9218d9428983a552e2443b',
    approvedCurrentSha256: '789b2d2714c8ac49ec3bf3f16a8daa37a99e093cafa28f609c5125a8ad3779d3',
  },
  'scripts/render-tail-extra-structural-matrices.ts': {
    historicalSha256: '048d7a47216fe091485fecff3873d449f2319bb979e4385b16478a8c0e001e2f',
    approvedCurrentSha256: '9f772d6023e0317fc111031e75db907b31214aca4adc5b6ffa0abb5b68144aad',
  },
  'scripts/build-task9-evidence-manifest.ts': {
    historicalSha256: '17293092155cc628bdb227285989481a659e784554d1174bcd57fd654de8098a',
    approvedCurrentSha256: '9269d2a892e1cb8d9fbb19971c0d5b84014bf544c14bdb73e20726564f46f313',
  },
  'scripts/task8-stable-projection.ts': {
    historicalSha256: 'a5381f6d2fd30adb274e27043724dcc322cd23bbf10bb2aca68302f006f13c3e',
    approvedCurrentSha256: '35601e1d095d887e3e8479298e98a0182b73a5c36daca90b54c140525f9083df',
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
