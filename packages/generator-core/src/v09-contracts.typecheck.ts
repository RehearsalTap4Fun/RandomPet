import { parseContentResourceId } from './v09-contracts.js'
import type { ContentResourceId, PngResourceRef } from './v09-contracts.js'

const sha256 = 'a'.repeat(64)

// @ts-expect-error Content resource IDs are opaque and cannot be constructed from strings.
const unparsedPathLikeResourceId: ContentResourceId = 'sha256:https://example.invalid/trait.png'
const unparsedPathLikeResource: PngResourceRef = {
  // @ts-expect-error Resource refs cannot bypass controlled resource-ID parsing.
  resourceId: 'sha256:../outside.png',
  sha256,
  mediaType: 'image/png',
  width: 2048,
  height: 2048,
}

const parsedResourceId = parseContentResourceId(`sha256:${sha256}`)
if (parsedResourceId !== undefined) {
  const parsedResource: PngResourceRef = {
    resourceId: parsedResourceId,
    sha256,
    mediaType: 'image/png',
    width: 2048,
    height: 2048,
  }
  void parsedResource
}

void unparsedPathLikeResourceId
void unparsedPathLikeResource
