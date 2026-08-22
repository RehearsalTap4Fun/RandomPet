import type { RenderLayer, RigId, ThemeId, VisualSlotId } from '@qmonster/generator-core'

export interface ProductionPart {
  id: string
  displayName: string
  flavorText: string
  slotId: VisualSlotId
  description: string
  rigId: RigId
  compatibleRigs: RigId[]
  themeIds: ThemeId[]
  rarity: 'N' | 'R'
  layer: RenderLayer
  socket: string | null
  origin: { x: number; y: number }
  semanticTraitId: string | null
  semanticPriority: number
  excludes: string[]
  boosts: Record<string, number>
  maximumSubjectSize: number
  visible: boolean
}

const allRigs: RigId[] = ['blob', 'biped', 'floating']
const allThemes: ThemeId[] = ['deep-sea', 'fungal', 'shadow']

function part(input: Omit<ProductionPart, 'compatibleRigs' | 'themeIds' | 'rarity' | 'layer' | 'socket' | 'origin' | 'semanticPriority' | 'excludes' | 'boosts' | 'maximumSubjectSize' | 'visible'> & Partial<Pick<ProductionPart, 'compatibleRigs' | 'themeIds' | 'rarity' | 'layer' | 'socket' | 'origin' | 'semanticPriority' | 'excludes' | 'boosts' | 'maximumSubjectSize' | 'visible'>>): ProductionPart {
  return {
    compatibleRigs: input.compatibleRigs ?? allRigs,
    themeIds: input.themeIds ?? allThemes,
    rarity: input.rarity ?? 'N',
    layer: input.layer ?? 'faceAndHeadwear',
    socket: input.socket ?? null,
    origin: input.origin ?? { x: 512, y: 512 },
    semanticPriority: input.semanticPriority ?? 5,
    excludes: input.excludes ?? [],
    boosts: input.boosts ?? {},
    maximumSubjectSize: input.maximumSubjectSize ?? 768,
    visible: input.visible ?? true,
    ...input,
  }
}

export const PRODUCTION_PARTS: ProductionPart[] = [
  part({ id: 'body_blob_round', displayName: '圆团体', flavorText: '一团稳稳坐住的柔软圆影。', slotId: 'bodyFrame', description: 'a complete squat rounded blob body silhouette, featureless and limb-free, with a softly flattened bottom', rigId: 'blob', compatibleRigs: ['blob'], layer: 'body', semanticTraitId: 'frame_blob_round', semanticPriority: 10, maximumSubjectSize: 1792, boosts: { personality_gentle: 1.12 } }),
  part({ id: 'body_blob_wide', displayName: '宽云体', flavorText: '像一小片落到地面的蓬松云。', slotId: 'bodyFrame', description: 'a complete extra-wide low cloud-blob body silhouette with two gentle asymmetric lobes, featureless and limb-free', rigId: 'blob', compatibleRigs: ['blob'], layer: 'body', semanticTraitId: 'frame_blob_wide', semanticPriority: 10, maximumSubjectSize: 1792, rarity: 'R' }),
  part({ id: 'body_biped_peanut', displayName: '豆豆双足体', flavorText: '圆肚皮下面藏着两只短短的脚墩。', slotId: 'bodyFrame', description: 'a complete upright peanut-shaped biped torso with two very short rounded leg-stump foundations and no feet details', rigId: 'biped', compatibleRigs: ['biped'], layer: 'body', semanticTraitId: 'frame_biped_peanut', semanticPriority: 10, maximumSubjectSize: 1792 }),
  part({ id: 'body_biped_tall', displayName: '高软双足体', flavorText: '它努力站高一点，又不舍得失去圆润。', slotId: 'bodyFrame', description: 'a complete slightly taller rounded biped body silhouette with a small waist and two soft leg-stump foundations', rigId: 'biped', compatibleRigs: ['biped'], layer: 'body', semanticTraitId: 'frame_biped_tall', semanticPriority: 10, maximumSubjectSize: 1792, rarity: 'R' }),
  part({ id: 'body_floating_drop', displayName: '浮滴体', flavorText: '一滴没有落下的软光停在半空。', slotId: 'bodyFrame', description: 'a complete hovering teardrop-cloud body silhouette with a rounded crown and gently tapered lower edge, no ground contact', rigId: 'floating', compatibleRigs: ['floating'], layer: 'body', semanticTraitId: 'frame_floating_drop', semanticPriority: 10, maximumSubjectSize: 1792 }),

  part({ id: 'head_round_dome', displayName: '软圆脑袋', flavorText: '一个适合装下许多好奇心的圆脑袋。', slotId: 'headShape', description: 'a separate rounded dome-shaped plush monster head shell with a flat hidden attachment underside and no face', rigId: 'blob', layer: 'head', socket: 'head', semanticTraitId: 'head_round', maximumSubjectSize: 900 }),
  part({ id: 'head_mushroom_cap', displayName: '菌伞脑袋', flavorText: '软软的伞沿会在高兴时轻轻抖动。', slotId: 'headShape', description: 'a separate friendly mushroom-cap head shell with a thick rounded brim, velvety texture, and no face', rigId: 'biped', themeIds: ['fungal'], layer: 'head', socket: 'head', semanticTraitId: 'head_mushroom', maximumSubjectSize: 900 }),
  part({ id: 'head_angler_bulb', displayName: '潮泡脑袋', flavorText: '像深海里一颗还没破掉的圆泡。', slotId: 'headShape', description: 'a separate smooth bulbous deep-sea head shell shaped like a soft water droplet, no lure and no face', rigId: 'floating', themeIds: ['deep-sea'], layer: 'head', socket: 'head', semanticTraitId: 'head_angler_bulb', maximumSubjectSize: 900, rarity: 'R' }),
  part({ id: 'head_shadow_hood', displayName: '幽帽脑袋', flavorText: '暗色软帽里只藏着一点温柔。', slotId: 'headShape', description: 'a separate rounded hood-like plush head shell with a softly folded crown, friendly not sinister, no face', rigId: 'blob', themeIds: ['shadow'], layer: 'head', socket: 'head', semanticTraitId: 'head_shadow_hood', maximumSubjectSize: 900, rarity: 'R' }),

  part({ id: 'eyes_glossy_pair', displayName: '亮晶晶双眼', flavorText: '两颗亮眼总比嘴巴更早发现新朋友。', slotId: 'eyes', description: 'a matched pair of oversized glossy off-white cartoon eyeballs with large dark pupils and soft toy-like rims', rigId: 'blob', semanticTraitId: 'eyes_glossy_pair', maximumSubjectSize: 620 }),
  part({ id: 'eyes_asymmetric', displayName: '一大一小眼', flavorText: '一只看现在，一只急着看下一秒。', slotId: 'eyes', description: 'a friendly asymmetric pair of glossy cartoon eyes, one large and one small, with coordinated curious pupils', rigId: 'biped', semanticTraitId: 'eyes_asymmetric', maximumSubjectSize: 620 }),
  part({ id: 'eyes_triple_pearl', displayName: '三珠眼', flavorText: '第三只眼只负责欣赏漂亮的光。', slotId: 'eyes', description: 'three rounded pearl-like glossy cartoon eyes arranged in a gentle shallow arc, cute rather than eerie', rigId: 'floating', semanticTraitId: 'eyes_triple', maximumSubjectSize: 650, rarity: 'R', boosts: { quirk_light_chaser: 1.2 } }),
  part({ id: 'eyes_sleepy_crescent', displayName: '困困月牙眼', flavorText: '它看起来快睡着了，其实什么都知道。', slotId: 'eyes', description: 'a pair of soft crescent-shaped sleepy eyelids with tiny glossy pupils, calm and friendly', rigId: 'blob', themeIds: ['shadow'], semanticTraitId: 'eyes_sleepy', maximumSubjectSize: 620 }),
  part({ id: 'eyes_stalk_pair', displayName: '短梗眼', flavorText: '两颗眼睛踮起脚尖向外张望。', slotId: 'eyes', description: 'a pair of short rounded eye stalks ending in oversized glossy friendly eyeballs, compact and toy-like', rigId: 'floating', themeIds: ['deep-sea', 'fungal'], semanticTraitId: 'eyes_stalk', maximumSubjectSize: 720, rarity: 'R' }),

  part({ id: 'mouth_wide_grin', displayName: '阔阔笑口', flavorText: '它的笑容总是比脑袋先挤进画面。', slotId: 'mouthShape', description: 'a separate oversized wide smiling cartoon mouth opening with thick soft rounded lips and a dark warm interior, no teeth', rigId: 'blob', layer: 'faceAndHeadwear', socket: 'head', semanticTraitId: 'mouth_wide', maximumSubjectSize: 560 }),
  part({ id: 'mouth_soft_pout', displayName: '软嘟嘟嘴', flavorText: '并没有生气，只是在认真吹一颗看不见的泡泡。', slotId: 'mouthShape', description: 'a separate small plush puckered pout mouth with rounded lips, playful and friendly, no teeth', rigId: 'biped', socket: 'head', semanticTraitId: 'mouth_pout', maximumSubjectSize: 430 }),
  part({ id: 'mouth_soft_beak', displayName: '软喙嘴', flavorText: '像小鸟一样啾一声，却软得像橡皮糖。', slotId: 'mouthShape', description: 'a separate short rounded soft-cartoon beak mouth made of flexible toy-like material, no sharp point', rigId: 'floating', socket: 'head', semanticTraitId: 'mouth_soft_beak', maximumSubjectSize: 480, excludes: ['oral_lolling_tongue'] }),
  part({ id: 'mouth_vertical_oval', displayName: '惊讶竖圆口', flavorText: '每一件小事都值得发出一声圆圆的惊叹。', slotId: 'mouthShape', description: 'a separate vertical oval surprised mouth opening with a thick rounded rim and warm dark interior, friendly not frightened', rigId: 'blob', socket: 'head', semanticTraitId: 'mouth_oval', maximumSubjectSize: 480, rarity: 'R' }),

  part({ id: 'oral_round_teeth', displayName: '圆锥小牙', flavorText: '牙齿参差不齐，但每一颗都很钝。', slotId: 'oralDetail', description: 'a separate curved row of six irregular blunt rounded cream cartoon teeth, gummy and harmless', rigId: 'blob', socket: 'head', semanticTraitId: 'oral_round_teeth', maximumSubjectSize: 420 }),
  part({ id: 'oral_single_fang', displayName: '独颗软牙', flavorText: '唯一的一颗小牙非常努力地露在外面。', slotId: 'oralDetail', description: 'one oversized but blunt rounded cream toy-like fang with a soft gum base, cute and harmless', rigId: 'biped', socket: 'head', semanticTraitId: 'oral_single_fang', maximumSubjectSize: 300 }),
  part({ id: 'oral_lolling_tongue', displayName: '歪歪软舌', flavorText: '它一专心，舌头就会偷偷跑出来。', slotId: 'oralDetail', description: 'a separate short lolling coral-pink cartoon tongue with a rounded tip and soft moist-gel material', rigId: 'floating', socket: 'head', semanticTraitId: 'oral_tongue', maximumSubjectSize: 420, excludes: ['mouth_soft_beak'] }),
  part({ id: 'oral_gummy_ridges', displayName: '软胶齿脊', flavorText: '像牙又像软糖，咬什么都只会弹一下。', slotId: 'oralDetail', description: 'a separate row of rounded translucent gummy mouth ridges, tooth-like but soft and friendly', rigId: 'blob', socket: 'head', semanticTraitId: 'oral_gummy', maximumSubjectSize: 430, rarity: 'R' }),

  part({ id: 'head_appendage_none', displayName: '没有头饰', flavorText: '光秃秃也很神气。', slotId: 'headAppendage', description: 'no visible head appendage at all', rigId: 'blob', semanticTraitId: null, maximumSubjectSize: 1, visible: false }),
  part({ id: 'head_horns_soft_nubs', displayName: '软角芽', flavorText: '两颗角还没决定要往哪边长。', slotId: 'headAppendage', description: 'a symmetric pair of very short rounded plush horn nubs, flexible and harmless, no sharp tips', rigId: 'biped', socket: 'head', semanticTraitId: 'head_horn_nubs', maximumSubjectSize: 760 }),
  part({ id: 'head_antennae_glow', displayName: '灯泡触角', flavorText: '想到好点子时，两颗小灯会一起亮。', slotId: 'headAppendage', description: 'a pair of soft curved antennae ending in round warm glowing bulbs, toy-like and friendly', rigId: 'floating', themeIds: ['deep-sea', 'fungal'], socket: 'head', semanticTraitId: 'head_glow_antennae', maximumSubjectSize: 850, rarity: 'R', boosts: { quirk_light_chaser: 1.25 } }),
  part({ id: 'head_ears_floppy_fins', displayName: '垂垂鳍耳', flavorText: '听见水声时，软鳍耳朵会轻轻张开。', slotId: 'headAppendage', description: 'a bilateral pair of floppy rounded fin-like ears with soft ribbing, no sharp edges', rigId: 'blob', themeIds: ['deep-sea'], socket: 'head', semanticTraitId: 'head_fin_ears', maximumSubjectSize: 850 }),

  part({ id: 'arms_short_plush', displayName: '短短绒手', flavorText: '抱不住大东西，却很会挥手。', slotId: 'arms', description: 'a separate bilateral pair of short dangling plush arms with mitten-like rounded ends, aligned symmetrically', rigId: 'blob', compatibleRigs: ['blob'], layer: 'frontAppendage', semanticTraitId: 'arms_short', maximumSubjectSize: 1500 }),
  part({ id: 'arms_long_noodle', displayName: '面条长手', flavorText: '手臂晃起来像两根开心的软面条。', slotId: 'arms', description: 'a separate bilateral pair of long flexible noodle-like soft arms with rounded mitten tips, playful not anatomical', rigId: 'biped', compatibleRigs: ['biped'], layer: 'frontAppendage', semanticTraitId: 'arms_noodle', maximumSubjectSize: 1500, rarity: 'R' }),
  part({ id: 'arms_paddle', displayName: '小桨手', flavorText: '不用船，它自己就是两把小桨。', slotId: 'arms', description: 'a separate bilateral pair of short rounded paddle-like fin arms with soft webbed edges', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['deep-sea'], layer: 'frontAppendage', semanticTraitId: 'arms_paddle', maximumSubjectSize: 1500 }),

  part({ id: 'legs_stub_feet', displayName: '圆墩脚', flavorText: '每一步都像软垫落地。', slotId: 'legs', description: 'a separate bilateral pair of short sturdy plush legs ending in broad rounded pad feet', rigId: 'blob', compatibleRigs: ['blob'], layer: 'frontAppendage', semanticTraitId: 'legs_stub', maximumSubjectSize: 1100 }),
  part({ id: 'legs_webbed', displayName: '蹼蹼脚', flavorText: '水洼再小，也值得认真划两下。', slotId: 'legs', description: 'a separate bilateral pair of short rounded legs with soft three-lobed webbed feet, no claws', rigId: 'biped', compatibleRigs: ['biped'], themeIds: ['deep-sea'], layer: 'frontAppendage', semanticTraitId: 'legs_webbed', maximumSubjectSize: 1100 }),
  part({ id: 'legs_mushroom', displayName: '菌柄脚', flavorText: '走累了就把自己当成两朵小蘑菇。', slotId: 'legs', description: 'a separate bilateral pair of stout mushroom-stem legs with small rounded cap-like feet', rigId: 'biped', compatibleRigs: ['biped'], themeIds: ['fungal'], layer: 'frontAppendage', semanticTraitId: 'legs_mushroom', maximumSubjectSize: 1100, rarity: 'R' }),
  part({ id: 'legs_shadow_tiptoe', displayName: '影尖脚', flavorText: '脚尖其实很圆，只是影子把它拉长了。', slotId: 'legs', description: 'a separate bilateral pair of tapered shadow-plush legs ending in tiny rounded tiptoe pads, soft not sharp', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['shadow'], layer: 'frontAppendage', semanticTraitId: 'legs_shadow', maximumSubjectSize: 1100, rarity: 'R' }),

  part({ id: 'tail_none', displayName: '没有尾巴', flavorText: '身后空空的，转身更轻松。', slotId: 'tail', description: 'no visible tail at all', rigId: 'blob', layer: 'rearAppendage', semanticTraitId: null, maximumSubjectSize: 1, visible: false }),
  part({ id: 'tail_fish_fan', displayName: '扇形鱼尾', flavorText: '轻轻一摆，就把想象里的海水推开。', slotId: 'tail', description: 'a separate side-view rounded fan-shaped fish tail with soft translucent ribbing and a compact attachment base', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['deep-sea'], layer: 'rearAppendage', socket: 'tail', origin: { x: 128, y: 512 }, semanticTraitId: 'tail_fish_fan', maximumSubjectSize: 820, excludes: ['extra_moth_wings'] }),
  part({ id: 'tail_soft_curl', displayName: '卷卷软尾', flavorText: '尾巴末端总在画一个没有画完的圆。', slotId: 'tail', description: 'a separate thick curled plush tail shaped like a loose spiral, with a rounded attachment base and tip', rigId: 'blob', compatibleRigs: ['blob'], layer: 'rearAppendage', socket: 'tail', origin: { x: 128, y: 512 }, semanticTraitId: 'tail_soft_curl', maximumSubjectSize: 820 }),
  part({ id: 'tail_mushroom_cluster', displayName: '菌簇尾', flavorText: '尾巴上挤着三朵总想一起点头的小菌伞。', slotId: 'tail', description: 'a separate short plush tail ending in a cluster of three tiny rounded mushroom caps, compact and friendly', rigId: 'biped', compatibleRigs: ['biped'], themeIds: ['fungal'], layer: 'rearAppendage', socket: 'tail', origin: { x: 128, y: 512 }, semanticTraitId: 'tail_mushroom', maximumSubjectSize: 820, rarity: 'R' }),

  part({ id: 'extra_appendage_none', displayName: '没有额外附肢', flavorText: '两侧留白，刚好装下风。', slotId: 'extraAppendage', description: 'no visible extra appendage at all', rigId: 'blob', layer: 'rearAppendage', semanticTraitId: null, maximumSubjectSize: 1, visible: false }),
  part({ id: 'extra_moth_wings', displayName: '圆蛾翅', flavorText: '翅膀像两片会呼吸的软绒叶。', slotId: 'extraAppendage', description: 'a separate bilateral pair of small rounded moth wings with plush edges and simple soft eye-spot-free ribbing', rigId: 'biped', compatibleRigs: ['biped'], themeIds: ['fungal', 'shadow'], rarity: 'R', layer: 'rearAppendage', semanticTraitId: 'extra_moth_wings', maximumSubjectSize: 1500, excludes: ['tail_fish_fan'] }),
  part({ id: 'extra_soft_tentacles', displayName: '软带附肢', flavorText: '几根软带在身后慢半拍地挥手。', slotId: 'extraAppendage', description: 'a separate bilateral arrangement of four short ribbon-like soft tentacle appendages with rounded tips, cute and non-anatomical', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['deep-sea'], rarity: 'R', layer: 'rearAppendage', semanticTraitId: 'extra_soft_tentacles', maximumSubjectSize: 1500 }),
  part({ id: 'extra_side_fins', displayName: '侧边软鳍', flavorText: '它不一定会游泳，但鳍很乐意试试。', slotId: 'extraAppendage', description: 'a separate bilateral pair of broad rounded side fins with soft scalloped edges and gentle ribbing', rigId: 'blob', compatibleRigs: ['blob'], themeIds: ['deep-sea'], layer: 'rearAppendage', semanticTraitId: 'extra_side_fins', maximumSubjectSize: 1500 }),

  part({ id: 'surface_short_fur', displayName: '短绒表皮', flavorText: '摸起来像一阵刚晒过太阳的软风。', slotId: 'surfaceMaterial', description: 'a sparse modular overlay of fine short plush fibers and soft highlight tufts following the masked body surface; only fibers visible, no opaque body fill', rigId: 'blob', compatibleRigs: ['blob'], layer: 'surface', semanticTraitId: 'surface_short_fur', maximumSubjectSize: 1792 }),
  part({ id: 'surface_gel_bubbles', displayName: '泡泡凝胶皮', flavorText: '半透明小泡在皮肤下面慢慢挪位置。', slotId: 'surfaceMaterial', description: 'a modular overlay of rounded translucent gel bubbles, glossy soft highlights, and sparse droplets following the body mask; no opaque body fill', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['deep-sea'], layer: 'surface', semanticTraitId: 'surface_gel', maximumSubjectSize: 1792, rarity: 'R' }),
  part({ id: 'surface_soft_scales', displayName: '软鳞表皮', flavorText: '每片鳞都像圆圆的小指纹。', slotId: 'surfaceMaterial', description: 'a modular overlay of broad overlapping rounded soft scales with subtle highlights, sparse enough to reveal the base; no opaque body fill', rigId: 'biped', compatibleRigs: ['biped'], themeIds: ['deep-sea', 'shadow'], layer: 'surface', semanticTraitId: 'surface_soft_scales', maximumSubjectSize: 1792 }),
  part({ id: 'surface_mushroom_velvet', displayName: '菌绒表皮', flavorText: '细密菌绒让它总像刚从苔床上醒来。', slotId: 'surfaceMaterial', description: 'a modular overlay of velvety micro-spore fuzz and a few soft raised patches following the body mask; no opaque body fill', rigId: 'blob', compatibleRigs: ['blob'], themeIds: ['fungal'], layer: 'surface', semanticTraitId: 'surface_mushroom_velvet', maximumSubjectSize: 1792 }),

  part({ id: 'pattern_soft_spots', displayName: '软斑纹', flavorText: '大小不一的圆斑像在皮肤上玩捉迷藏。', slotId: 'pattern', description: 'a modular overlay of twelve irregular rounded coral and cream spots distributed within the body mask; spots only, no body fill', rigId: 'blob', compatibleRigs: ['blob'], layer: 'pattern', semanticTraitId: 'pattern_spots', maximumSubjectSize: 1792 }),
  part({ id: 'pattern_gentle_stripes', displayName: '缓弧纹', flavorText: '几道弧线顺着圆肚皮慢慢弯过去。', slotId: 'pattern', description: 'a modular overlay of five broad softly curved lavender-blue stripes following the body volume; stripes only, no body fill', rigId: 'biped', compatibleRigs: ['biped'], layer: 'pattern', semanticTraitId: 'pattern_stripes', maximumSubjectSize: 1792 }),
  part({ id: 'pattern_constellation', displayName: '星点纹', flavorText: '身上的小光点总想连成一幅新星图。', slotId: 'pattern', description: 'a modular overlay of tiny warm-gold star dots connected by a few faint curved lines within the body mask; marks only', rigId: 'floating', compatibleRigs: ['floating'], themeIds: ['shadow'], rarity: 'R', layer: 'pattern', semanticTraitId: 'pattern_constellation', maximumSubjectSize: 1792, boosts: { quirk_light_chaser: 1.2 } }),
  part({ id: 'pattern_spore_rings', displayName: '孢环纹', flavorText: '一圈圈菌纹记录了它做过的软绵绵的梦。', slotId: 'pattern', description: 'a modular overlay of soft amber concentric spore rings and dotted arcs within the body mask; marks only, no body fill', rigId: 'blob', compatibleRigs: ['blob'], themeIds: ['fungal'], layer: 'pattern', semanticTraitId: 'pattern_spore_rings', maximumSubjectSize: 1792 }),

  part({ id: 'color_deep_sea_coral', displayName: '深海珊瑚配色', flavorText: '深蓝里藏着一小口温暖的珊瑚光。', slotId: 'colorScheme', description: 'a modular palette overlay of deep ocean-blue primary patches, pale pearl secondary patches, and warm coral accents arranged in three broad body-following zones; color patches only', rigId: 'floating', themeIds: ['deep-sea'], layer: 'pattern', semanticTraitId: 'color_deep_sea', maximumSubjectSize: 1792 }),
  part({ id: 'color_fungal_amber', displayName: '菌沼琥珀配色', flavorText: '泥土色、奶油色和琥珀橙在一起发芽。', slotId: 'colorScheme', description: 'a modular palette overlay of earthy plum primary patches, creamy secondary patches, and amber-orange accents arranged in three broad body-following zones; color patches only', rigId: 'biped', themeIds: ['fungal'], layer: 'pattern', semanticTraitId: 'color_fungal', maximumSubjectSize: 1792 }),
  part({ id: 'color_shadow_violet', displayName: '幽影金紫配色', flavorText: '紫色把影子抱紧，金光从缝里探头。', slotId: 'colorScheme', description: 'a modular palette overlay of deep violet primary patches, dusty lilac secondary patches, and warm gold accents arranged in three broad body-following zones; color patches only', rigId: 'blob', themeIds: ['shadow'], layer: 'pattern', semanticTraitId: 'color_shadow', maximumSubjectSize: 1792 }),

  part({ id: 'effect_none', displayName: '没有特效', flavorText: '安安静静地站着，本身就足够奇妙。', slotId: 'effect', description: 'no visible effect at all', rigId: 'blob', layer: 'foregroundEffect', semanticTraitId: null, maximumSubjectSize: 1, visible: false }),
  part({ id: 'effect_bioluminescent_orbs', displayName: '浮游光泡', flavorText: '几颗小光泡像朋友一样围着它慢慢游。', slotId: 'effect', description: 'a modular foreground effect layer of seven small warm bioluminescent floating orbs with very soft halos, sparse and isolated', rigId: 'floating', themeIds: ['deep-sea', 'shadow'], rarity: 'R', layer: 'foregroundEffect', semanticTraitId: null, maximumSubjectSize: 1792, boosts: { quirk_light_chaser: 1.3 } }),
  part({ id: 'effect_spore_glow', displayName: '暖孢微光', flavorText: '轻轻一抖，身边就亮起一阵会打哈欠的孢子。', slotId: 'effect', description: 'a modular foreground effect layer of sparse amber glowing spores drifting upward in a gentle arc, isolated particles only', rigId: 'biped', themeIds: ['fungal'], layer: 'foregroundEffect', semanticTraitId: null, maximumSubjectSize: 1792, boosts: { quirk_spore_sneeze: 1.3 } }),
]

export const EDIT_PROMPT_TEMPLATE = `Edit the supplied locked QMonster rig base. Change only the masked {slotId} region to: {partDescription}.
Preserve the camera, 3/4 front pose, body silhouette outside the mask, eye-level perspective,
upper-left soft key light, broad front fill, friendly rounded 3D cartoon proportions, and tactile material response.
Keep attachment points aligned with the supplied socket guides. No text, no props, no environment,
no extra limbs outside the requested slot, no gore, no horror-valley anatomy. Output a clean isolated subject.`

export function buildPartPrompt(value: ProductionPart): string {
  const edit = EDIT_PROMPT_TEMPLATE
    .replace('{slotId}', value.slotId)
    .replace('{partDescription}', value.description)
  return `Use case: precise-object-edit
Asset type: QMonster modular ${value.slotId} game-art layer, four-candidate production sheet
Input images: Image 1 is STYLE REFERENCE ONLY for bright rounded tactile friendly 3D-cartoon rendering; never copy its character identity or palette. Image 2 is the LOCKED RIG BASE edit target (${value.rigId}); preserve its camera, scale, light and pose as alignment reference. Image 3 is the SLOT MASK AND SOCKET GUIDE; the pink region is the only permitted design region and the cyan cross is the required attachment point.
Primary request:
${edit}
Candidate layout: create exactly four distinct variants of this one exact request in a clean unlabelled 2x2 sheet, reading order left-top, right-top, left-bottom, right-bottom. Each equal quadrant must contain only the requested modular ${value.slotId} layer, aligned and scaled as if attached to the locked base. The locked base and every non-requested region must be completely absent from the output, replaced by key background. No dividers, labels or numbers.
Scene/backdrop: perfectly uniform flat pure chroma green #00FF00 in every background pixel and every gap; no checkerboard, gradient, texture, vignette, floor, horizon, ambient scene or cast shadow. Pure green is an extraction key and must not appear in the requested layer.
Style/medium: polished original friendly tactile 3D cartoon matching Image 1 only in general rendering language; rounded soft toy anatomy, controlled highlights, clean tactile edges.
Composition/framing: preserve the guide's three-quarter front orientation, eye-level 50mm-equivalent camera, scale and socket alignment; generous green margin around each isolated layer.
Constraints: only the requested modular layer visible; genuine flat key background; no locked-base pixels; no full creature overlay; no text, logo, watermark, gore, sharp photoreal anatomy, horror-valley forms, props, environment, extra subjects, extra limbs or cropped edges.
Avoid: green spill, green details, camera drift, light drift, silhouette outside the guide, disconnected socket, fake transparency, copying Image 1.`
}

export function countBySlot(): Record<VisualSlotId, number> {
  return PRODUCTION_PARTS.reduce((counts, value) => {
    counts[value.slotId] += 1
    return counts
  }, {
    bodyFrame: 0, headShape: 0, eyes: 0, mouthShape: 0, oralDetail: 0,
    headAppendage: 0, arms: 0, legs: 0, tail: 0, extraAppendage: 0,
    surfaceMaterial: 0, pattern: 0, colorScheme: 0, effect: 0,
  })
}
