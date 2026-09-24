import { createPixelArtV3Session } from '../../../packages/incubator-adapter/src/pixel-art-browser-v3.js'
import { phenotypeKeyV2 } from '../../../packages/generator-core/src/feline-phenotype-v2.js'
import catalogUrl from '../../../packages/asset-catalog/pixel/v3/approved-1.6.1/catalog.approved.json?url'
import { traitSlots, valueLabels, type WorkbenchBundle } from './pixel-workbench-bundle.js'

const urls = import.meta.glob('../../../packages/asset-catalog/pixel/v3/approved-1.6.1/assets/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>
export async function loadLatestBundle(): Promise<WorkbenchBundle> {
  const response = await fetch(catalogUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}: 无法载入正式素材目录。`)
  const session = await createPixelArtV3Session(await response.json())
  const catalog = session.catalog
  const entries = new Map(catalog.coverage.map(row => [row.id, row]))
  const byPhenotype = new Map(catalog.coverage.map(row => [phenotypeKeyV2(row.phenotype), row.id]))
  const byProfile = new Map(catalog.profiles.map(profile => [profile.id, catalog.coverage.filter(row => row.profileId === profile.id)]))
  const entry = (id: string) => {
    const row = entries.get(id)
    if (!row) throw new Error(`Unknown coverage: ${id}`)
    return row
  }
  let loaded: ReturnType<typeof session.load> | undefined
  return {
    schemaVersion: 'feline-appearance-v2', artVersion: catalog.artVersion,
    coverage: catalog.coverage.map(row => ({ id: row.id, review: row.review, body: row.phenotype.body, eyes: row.phenotype.eyes,
      label: [row.phenotype.body, row.phenotype.coat, row.phenotype.eyes, row.phenotype.expression].map(value => valueLabels[value] ?? value).join(' · ') })),
    generatableCount: catalog.generatable.length,
    render: async id => {
      loaded ??= session.load(resource => {
        const url = urls[`../../../packages/asset-catalog/pixel/v3/approved-1.6.1/${resource.path}`]
        if (!url) throw new Error(`缺少资源：${resource.path}`)
        return url
      }).catch(error => { loaded = undefined; throw error })
      return (await loaded).render(entry(id).phenotype)
    },
    save: id => session.save(entry(id).phenotype),
    restore: input => byPhenotype.get(phenotypeKeyV2(session.restore(input)))!,
    key: id => session.key(entry(id).phenotype),
    traits: {
      value: (id, slot) => entry(id).phenotype[slot],
      options: (id, slot) => {
        const row = entry(id), index = traitSlots.indexOf(slot)
        if (index < 4) {
          const prefix = traitSlots.slice(0, index) as ('body' | 'coat' | 'eyes' | 'expression')[]
          const candidates = catalog.profiles.filter(profile => prefix.every(key => profile[key] === row.phenotype[key]))
          return [...new Set(candidates.map(profile => profile[slot as 'body' | 'coat' | 'eyes' | 'expression']))]
        }
        const others = traitSlots.slice(4).filter(key => key !== slot)
        return [...new Set(byProfile.get(row.profileId)!.filter(candidate => others.every(key => candidate.phenotype[key] === row.phenotype[key])).map(candidate => candidate.phenotype[slot]))]
      },
      select: (id, slot, value) => {
        const row = entry(id), index = traitSlots.indexOf(slot)
        let candidates = index < 4 ? catalog.coverage : byProfile.get(row.profileId)!
        const required = index < 4 ? traitSlots.slice(0, index) : traitSlots.filter(key => key !== slot)
        candidates = candidates.filter(candidate => candidate.phenotype[slot] === value && required.every(key => candidate.phenotype[key] === row.phenotype[key]))
        if (!candidates.length) throw new Error('当前素材未覆盖此选择。')
        // Preserve every compatible later choice; select a legal fallback for dependent fields.
        for (const key of traitSlots.slice(index + 1)) {
          const matching = candidates.filter(candidate => candidate.phenotype[key] === row.phenotype[key])
          if (matching.length) candidates = matching
        }
        return candidates[0]!.id
      },
    },
  }
}
