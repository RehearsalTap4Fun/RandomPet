import fs from 'node:fs/promises'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'..')
const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/manifest.json'),'utf8'))
const descriptions={
 shiba:'Shiba Inu, tan-orange fur, cream urajiro cheeks/chest/paws, small erect triangular ears, compact broad dog muzzle, single tightly curled fluffy tail',
 corgi:'Pembroke Welsh corgi, golden tan and white coat, broad white forehead blaze, very large upright rounded-triangular ears, long low dog torso, black dog nose, cheerful broad muzzle, short fluffy tail on viewer right',
 'golden-retriever':'golden retriever puppy, warm golden cream coat all over, floppy pendant ears, broad rounded retriever muzzle and black dog nose, gently wavy soft fur, single long feathery tail on viewer right',
 husky:'Siberian husky puppy, slate grey-black back and ears, white cheeks/chest/paws, symmetrical characteristic dark forehead cap and white face mask, erect ears, ice blue eyes, black nose, single bushy curved tail on viewer right',
 dalmatian:'Dalmatian puppy, white fur with several clearly separated bold black spots on ears and body, floppy ears, long rounded dog muzzle and black nose, amber-brown eyes, single long white tail with black spots on viewer right',
 poodle:'apricot toy poodle puppy, soft apricot curly coat, rounded curly topknot, drooping curly ears framing face, dark brown eyes, rounded dog muzzle and black nose, single small pompom tail on viewer right; recognizable poodle curls, no shaved show trim',
}
const exists=async p=>{try{await fs.access(p);return true}catch{return false}}
const [filterStyle,filterBreed]=process.argv.slice(2)
const selected=[]
for(const job of manifest.jobs){
 if(job.status==='ai-reviewed'||(filterStyle&&filterStyle!==job.style)||(filterBreed&&filterBreed!==job.breed))continue
 const rawPath=path.join(root,`docs/art/canine-v1/raw/${job.style}/${job.id}.png`)
 if(await exists(rawPath))continue
 const baselineId=job.style==='pixel'?`${job.breed}-standard-round-parted-mouth`:`${job.breed}-parted-mouth`
 const ownBaseline=manifest.jobs.find(j=>j.style===job.style&&j.id===baselineId)
 const isBaseline=job.id===baselineId
 if(!isBaseline&&ownBaseline?.status!=='ai-reviewed')continue
 let refId=isBaseline?(job.style==='pixel'?'shiba-standard-round-parted-mouth':'shiba-parted-mouth'):baselineId
 if(job.style==='pixel'&&!isBaseline){
   const sameBodyBase=`${job.breed}-${job.body}-round-${job.expression}`
   const sameExpression=`${job.breed}-standard-round-${job.expression}`
   const sameBodyParted=`${job.breed}-${job.body}-round-parted-mouth`
   for(const candidate of [sameBodyBase,sameBodyParted,sameExpression]){
     const found=manifest.jobs.find(j=>j.style===job.style&&j.id===candidate&&j.status==='ai-reviewed')
     if(found&&found.id!==job.id){refId=found.id;break}
   }
 }
 const refJob=manifest.jobs.find(j=>j.style===job.style&&j.id===refId)
 const ref=path.join(root,`docs/art/canine-v1/raw/${job.style}/${refJob?.acceptedAttempt??refId}.png`)
 if(!await exists(ref))continue
 const style=job.style==='pixel'?'Crisp 64x64 logical-grid pixel game sprite, discrete large flat color clusters, 2-3 shades per material, brown single-pixel-equivalent outline, no soft gradients or texture. Output high-resolution square image of this logical pixel sprite.':'Premium 3D plush toy character, detailed soft fur fibers, glossy expressive eyes, same upper-left studio illumination as reference, delicate fur edge on real transparency. Output 1254x1254 square.'
 const body=job.body==='shortleg-round'?'Make SHORT-LEGGED ROUND body: visibly broader rounded belly/haunches, squat low torso, very short thick forelegs. Keep head size, face coordinates, and paw baseline unchanged; body must visibly differ from standard.':job.body==='slender-tall'?'Make SLENDER TALL body: visibly narrower torso, slimmer hips and much longer slim forelegs; lean elegant seated silhouette. Keep head identity and head/paw registration consistent; body must visibly differ from standard.':'Standard cute compact seated body proportions, oversized head, two forepaws and two seated haunches.'
 const eye=job.eyes==='sleepy-almond'?'SLEEPY ALMOND EYES: both eyelids lowered into clear half-closed almond shapes, relaxed sleepy expression, irises still visible, not fully closed and not angry; clearly distinct from round eyes.':'ROUND wide-open expressive eyes with a simple light glint.'
 const mouth=job.expression==='small-fangs'?'Friendly toothy smile: a closed dark-brown mouth cavity about 10 logical pixels wide and 6 tall, with TWO widely separated ivory canine fangs inside, each 2 logical pixels wide and 3 long. Dark rim on top and sides separates teeth from cream muzzle. No tongue or red patch. Teeth must remain unmistakable at 64px.':job.expression==='tongue-tip'?'Natural small relaxed open mouth, with a short soft pink tongue tip emerging slightly. No visible teeth. Tongue integrates with 3D mouth anatomy, not a sticker.':'Natural tiny parted mouth, dark interior. No teeth, no tongue.'
 const sameExpression=refId.endsWith(job.expression)
 const invariants=isBaseline?'Image 1 is STYLE/REGISTRATION reference ONLY. Replace the breed with the specified dog, with correct breed ears, coat and tail; do NOT keep Shiba anatomy.':`Image 1 is EXACT identity/registration reference. Preserve the same breed, coat distribution, ears, nose, tail, head size, canvas placement and lighting. ${sameExpression?'Keep the reference mouth shape exactly unchanged.':''} Only change the explicitly requested eye/body/expression attributes.`
 const prompt=`Use case: ${isBaseline?'stylized-concept':'precise-object-edit'}. ONE production dog sprite. ${invariants} Subject: ${descriptions[job.breed]}. Style: ${style} Body: ${body} Eyes: ${eye} Mouth: ${job.style==='plush'&&job.expression==='small-fangs'?'Tiny natural open mouth showing two small ivory puppy teeth, naturally embedded, no tongue.':mouth} Front-facing sitting pose, whole dog within frame, eye line around y34%, paw baseline y95%, head center x44%, tail on viewer RIGHT. Keep transparent margins on every edge. Exactly one head, two ears, one tail and four correctly seated paws. No cat whiskers, no collar, no accessories, no text, no sprite sheet, no ground shadow, no floor. Genuine transparent alpha background. Preserve source alpha. Do not crop or recenter.`
 const refs=[ref]
 let finalPrompt=prompt
 if(job.style==='plush'&&job.expression==='small-fangs') finalPrompt+=' EXACT tooth count: only TWO tiny upper puppy canine tips, one each side pointing down, naturally under the furry upper lip. Middle between them must be dark. Zero incisors, zero lower teeth, zero tooth rows. Preserve a subtle tiny mouth, not a broad toothy grin.'
 if(job.style==='pixel'&&job.breed==='husky') finalPrompt+=' Production constraint: after resize to 64px and 32-colour quantization, BOTH irises must remain visibly BLUE. Use LARGE SOLID saturated cyan-blue (#168ADD) iris clusters at least 3 logical pixels wide by 2 pixels high per eye, small dark pupils, at most one tiny white glint. No tiny blue specks or blue gradients. Keep requested round or half-lowered almond eye shape.'
 if(!isBaseline&&refJob?.body===job.body) finalPrompt=finalPrompt.replace(`Body: ${body}`,`Body: KEEP EXACTLY the reference body silhouette, proportions, width, leg lengths and paws; already correct ${job.body}. Do not widen, slim, stretch or shorten it.`)
 if(!isBaseline&&refJob?.eyes===job.eyes) finalPrompt=finalPrompt.replace(`Eyes: ${eye}`,'Eyes: preserve the reference eyes exactly, including shape, glints and coordinates.')
 if(!isBaseline&&refJob?.expression===job.expression) finalPrompt=finalPrompt.replace(/Mouth: .*? Front-facing/,'Mouth: preserve reference mouth and teeth EXACTLY, pixel placement and shape unchanged. Front-facing')
 if(job.style==='pixel'&&job.expression==='small-fangs'&&refJob?.expression!=='small-fangs'){
   const mouthJob=manifest.jobs.find(j=>j.style==='pixel'&&j.id===`${job.breed}-standard-round-small-fangs`&&j.status==='ai-reviewed')??manifest.jobs.find(j=>j.style==='pixel'&&j.id==='shiba-standard-round-small-fangs'&&j.status==='ai-reviewed')
   if(mouthJob){refs.push(path.join(root,`docs/art/canine-v1/raw/pixel/${mouthJob.acceptedAttempt??mouthJob.id}.png`));finalPrompt+=' Image 2 is MOUTH-ONLY reference: copy its exact enclosed dark mouth cavity and two separated ivory fang shapes at the same logical-pixel size. Position this mouth underneath Image 1 nose, aligned with Image 1 muzzle. Do NOT copy Image 2 breed, body, ears, pose or absolute coordinates. Image 1 exclusively controls all body geometry.'}
 }
 selected.push({...job,prompt:finalPrompt,refs})
}
console.log(JSON.stringify(selected,null,2))
