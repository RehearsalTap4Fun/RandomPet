import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { generatablePixelPhenotypesV3, requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'

const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.3.0/'
const candidateRoot = 'packages/asset-catalog/pixel/v3/profile-gap-1.3.1/'
const releaseRoot = 'packages/asset-catalog/pixel/v3/approved-1.3.1/'
const qaRoot = 'docs/qa/pixel-profile-gap/'
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

it('adds only the approved sleepy-almond parted-mouth profile and closes its 288-state island', () => {
  expect(existsSync(candidateRoot + 'catalog.candidate.json'), '1.3.1 candidate must exist').toBe(true)
  expect(existsSync(releaseRoot + 'catalog.approved.json'), 'approved 1.3.1 must exist').toBe(true)
  const base = requirePixelArtCatalogV3(json(baseRoot + 'catalog.approved.json'))
  const candidate = requirePixelArtCatalogV3(json(candidateRoot + 'catalog.candidate.json'))
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const approval = json(qaRoot + 'approval.json')

  expect(approval.userStatement).toBe('只改了面部和其他组合都不会有衔接问题，直接通过')
  expect(candidate.artVersion).toBe('1.3.1-candidate.1')
  expect(candidate.profiles).toHaveLength(8)
  expect(candidate.coverage).toHaveLength(2304)
  expect(Object.keys(candidate.resources)).toHaveLength(23)
  expect(candidate.coverage.filter(row => row.review === 'pending')).toHaveLength(288)
  expect(candidate.generatable).toEqual(base.generatable)
  expect(candidate.profiles.slice(0, 7)).toEqual(base.profiles)
  expect(candidate.coverage.slice(0, 2016)).toEqual(base.coverage)
  expect(candidate.resources).toMatchObject(base.resources)

  const profile = candidate.profiles.at(-1)!
  expect(profile).toMatchObject({ id: 'standard-sleepy-almond-parted-mouth', body: 'standard', coat: 'orange-white', eyes: 'sleepy-almond', expression: 'parted-mouth' })
  const added = candidate.coverage.slice(2016)
  expect(new Set(added.map(row => row.profileId))).toEqual(new Set([profile.id]))
  expect(new Set(added.map(row => row.phenotype.expression))).toEqual(new Set(['parted-mouth']))
  expect(new Set(added.map(row => row.phenotype.eyes))).toEqual(new Set(['sleepy-almond']))

  expect(approved.artVersion).toBe('1.3.1')
  expect(approved.coverage).toEqual(candidate.coverage.map(row => ({ ...row, review: 'approved' })))
  expect(approved.generatable).toEqual(approved.coverage.map(row => row.id))
  expect(generatablePixelPhenotypesV3(approved)).toHaveLength(2304)
  expect(approved.evidence[qaRoot + 'approval.json']).toBe(sha(readFileSync(qaRoot + 'approval.json')))
  const { revision, ...content } = approved
  expect(revision).toBe(sha(canonicalJson(content)))
  for (const [id, resource] of Object.entries(candidate.resources)) {
    expect(readFileSync(releaseRoot + resource.path), id).toEqual(readFileSync(candidateRoot + resource.path))
  }
})

it('keeps the four standard horizontal profiles as a complete eyes by expression matrix', () => {
  const approved = requirePixelArtCatalogV3(json(releaseRoot + 'catalog.approved.json'))
  const standard = approved.profiles.filter(profile => profile.body === 'standard' && profile.coat === 'orange-white')
  expect(standard.map(profile => `${profile.eyes}/${profile.expression}`).sort()).toEqual([
    'round/parted-mouth',
    'round/small-fangs',
    'sleepy-almond/parted-mouth',
    'sleepy-almond/small-fangs',
  ])
  expect(standard.every(profile => approved.coverage.filter(row => row.profileId === profile.id).length === 288)).toBe(true)
})
