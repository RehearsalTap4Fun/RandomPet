import fs from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const manifestPath=path.join(root,'docs/art/canine-v1/parts-manifest.json')
const bodyManifest=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/manifest.json'),'utf8'))
const descriptions={
 'dragon-horns':'Exactly TWO short gently outward-curving ivory dragon horns. Broad softly ridged bases, tapered rounded tips, warm cream highlight and caramel shadow. Two separate horns with transparent gap; no head, no connecting band.',
 'antlers':'Exactly TWO small warm beige deer antlers, each with one central stem and two short rounded branches, readable branching silhouette. Matching frontal pair with transparent gap; no head or connecting band.',
 'halo':'ONE simple floating golden elliptical halo seen slightly from above, thick continuous ring with large genuinely transparent central opening. Warm pale gold highlight, amber lower edge. No support, gems, rays or sparkles.',
 'crystal-horns':'Exactly TWO compact lavender-blue crystal horns, three broad facets per horn, bright lavender top planes and deep purple bases. Tapered upward, no shards, no scattered sparkles, no head.',
 'fin-ears':'Exactly TWO fantasy fin replacement ears, lateral triangular fans pointing outward and slightly upward. Turquoise membrane, three thick teal ribs per ear, cream soft fur at inner roots. Broad rounded attachment roots face inward. Transparent center, no head, no original ears.',
 'feathered-ears':'Exactly TWO fantasy feather replacement ears, outward upright fans of three broad ivory feathers with warm golden tips and soft cream root fur. Roots face inward, genuinely transparent gap, no head, no original ears.',
 'celestial-ears':'Exactly TWO fantasy celestial replacement ears, softly pointed blue-violet ears with large pale blue inner crescents and soft lavender root fur. Simple solid geometry, no floating particles, roots face inward, transparent middle, no head.',
 'small-lion-mane':'ONE compact golden lion mane collar for a front-facing sitting puppy, a deep U-shaped fluffy crescent with genuinely transparent center and top opening for the chin. Dense layered warm gold fur clumps, rounded lobes at both shoulders, small central chest tuft. No face, no body, no hardware.',
 'frill-neck':'ONE fantasy turquoise neck frill, horseshoe-shaped fan with transparent center and top opening for a puppy chin, rounded teal membrane lobes with cream ribs. Broad shoulder lobes and small lower point; no head, no body, no hardware.',
 'sunburst-ruff':'ONE golden sunburst neck ruff, U-shaped soft collar with seven broad rounded flame-like ivory/gold tufts, transparent center and open top for chin. No head, no face, no metallic jewelry or detached sparks.',
 'small-wings':'Exactly TWO small soft rounded ivory downy wings, frontal symmetrical pair spreading outward and gently upward, three simple rounded feather lobes per wing. Attachment roots point inward and downward, transparent gap, no body.',
 'feathered-wings':'Exactly TWO majestic cream and pale gold feathered wings, frontal symmetrical pair spreading outward and upward, five broad overlapping flight feathers on each wing. Compact rounded tips, inward-downward roots, transparent center, no body.',
 'dragon-wings':'Exactly TWO compact turquoise dragon wings, frontal symmetrical pair spreading outward and upward. Dark teal curved leading edges, three warm pale turquoise membrane panels each, rounded friendly tips, inward-downward attachment roots. Transparent middle, no body.',
 'forked-tail-tip':'ONE complete fluffy ivory fantasy dog tail, continuous stem curves from lower left upward to upper right and splits near its upper end into exactly TWO rounded fluffy tips. Warm cream fur, golden shadows; solid continuous stem, attachment root at lower left. No body, no detached tufts.',
 'flame-tail':'ONE complete magical dog tail, a continuous thick golden-orange tail stem curving from lower left upward to upper right into one large flame-shaped tuft. Red-orange outer flame, warm golden inner flame, friendly rounded pointed silhouette. No detached sparks, root at lower left, no body.',
 'phoenix-tail':'ONE complete phoenix feather dog tail, continuous golden stem curves from lower left upward to upper right ending in three broad overlapping red-orange and gold feather plumes. One connected silhouette, no separate floating feathers, attachment root at lower left, no body.'
}
if(process.argv[2]==='init'){
 try{await fs.access(manifestPath);throw new Error('Parts manifest already exists')}catch(e){if(e.code!=='ENOENT')throw e}
 const jobs=[]
 for(const [slot,traits] of Object.entries(bodyManifest.partSlots))for(const trait of traits)for(const style of ['pixel','plush']){
  if(style==='plush'&&bodyManifest.plushExcluded.includes(trait))continue
  jobs.push({id:`growth-${trait}`,trait,slot,style,status:'pending',registrationStatus:'pending',sourceMode:'new-independent-generation'})
 }
 await fs.writeFile(manifestPath,JSON.stringify({schemaVersion:'canine-growth-production-v1',expectedTypes:{pixel:16,plush:11},maxReworks:3,reviewer:'AI',userArtApproval:false,adaptation:'Individual geometric registration and replacement masks for all 18 pixel breed/body profiles and all 6 plush breed profiles; all 90 expression bodies verified in composition.',jobs},null,2)+'\n')
 console.log('Initialized 27 independently generated part types; registration remains a separate gate.')
}else{
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'))
 const jobs=[]
 for(const job of manifest.jobs){
  if(job.status!=='pending'||(process.argv[2]&&job.style!==process.argv[2])||(process.argv[3]&&job.slot!==process.argv[3]))continue
  try{await fs.access(path.join(root,`docs/art/canine-v1/raw/${job.style}/${job.id}.png`));continue}catch{}
  const style=job.style==='pixel'
   ? 'Match reference pixel-art material and warm outlines. Deliberate chunky square pixel clusters designed for 64px game assets; no anti-aliasing, no smooth vector curves, no fine noise. Limited palette. Large simplified details remain legible after small-scale placement.'
   : 'Match reference premium soft 3D plush/fur game-asset style, soft upper-left studio lighting and gentle volume. Fine clean fur only where appropriate; horns and halo have soft ivory/gold surfaces. No cast shadow onto background.'
  const refs=[path.join(root,`docs/art/canine-v1/raw/${job.style}/shiba-${job.style==='pixel'?'standard-round-':''}parted-mouth.png`)]
  jobs.push({...job,refs,prompt:`Create one independent transparent growth-part PNG for the canine asset collection. The reference dog is ONLY a rendering-style reference; DO NOT render the dog, head, face, eyes, ears or body unless the requested part explicitly is an ear.\n${descriptions[job.trait]}\n${style}\nThe requested single component (or anatomical left/right pair) should occupy the central 75% of a square canvas, entirely visible with generous transparent margins. Treat a pair as one paired overlay with matching perspective, not a sprite sheet. Frontal view matching the reference puppy with a very slight three-quarter perspective. True transparent RGBA background, transparent gaps and holes, no text, labels, watermark, guides, floor, checkerboard, backing card or extra objects. Output only the requested ${job.trait} component. This will be registered separately to each canine profile.`})
 }
 console.log(JSON.stringify(jobs,null,2))
}
