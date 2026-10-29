/* =====================================================================
 * ★ 数值设置 · 秘境 ★（代码：modules/world.js 的 mjXxx；怪物属性、进入境界在 config/mobs.js 的 mijing）
 * 发现：在凡界第 find.map 张地图走完一次历练 / 探索，按 find.chance% 判定，一次最多发现一处
 *   地图序号：0 青云山林 1 黑风谷 2 万妖岭 3 幽冥沼泽 4 落星海 5 地火熔窟 6 埋骨战场 7 断魂谷 8 雷泽荒原
 * 一次 TIME 步：普通怪 MONSTERS + 精英 ELITES + 灵药 HERB + 矿脉 ORE（个数可写数字或 [最少, 最多]），其余空步，最后 BOSS 步是首领
 * 灵石：config/drops.js 的 RUN_STONE.mijing（按列表顺序）
 * 药材矿石：总数见 config/drops.js 的 dropTotal.mijing，从第 drops 张凡界地图的药材 / 矿石表等概率抽（不含 fixed）
 * extra 额外掉落：按事件分（monster / elite / boss / herbEvent / oreEvent），每条 { item, chance 几率%, n [最少, 最多] } 单独判定
 *   item：火髓、空间晶核、养神露；"耀石" / "灵晶" = 随机属性，或 "火耀石" 这样指定；也可写药材 / 矿石名或 content/items.js 的物品
 * 元婴期秘境首领另必掉养神露（config/sect.js 的 chuqiao.LU_DROP），普通地图不掉
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.mijing = {
  DAILY: 1,          // 每处每天能进几次（历练、探索合计）
  TIME: 100,         // 一次走多少步
  MONSTERS: 12,      // 普通怪个数
  ELITES: 5,         // 精英怪个数
  BOSS: 1,           // 首领个数（放在最后）
  HERB: [5, 10],     // 灵药次数 [最少, 最多]
  ORE: [5, 10],      // 矿脉次数 [最少, 最多]

  // 灵元掉落：凡界秘境（灵地不掉）每进一次合计 N = [最少, 最多] 个，不分第几处秘境；随机分到这次的怪物身上（普通、精英、首领，有的怪不掉）
  LINGYUAN: { N: [9, 18] },
  // 耀石 / 灵晶 / 灵元：每进一次只出 [最少, 最多] 种属性（本次随机抽），掉的每个从这几种里随机；数量仍按各自设置
  EL_KINDS: [2, 4],

  // 秘境专用材料：name 名字  sell 出售价（灵石）  desc 说明  names 各属性名字（顺序固定，对应图标序号）
  items: {
    kj:   { name: "空间晶核", sell: 20, desc: "炼制空间石的专用材料。" },
    // 耀石：金 木 水 火 土 雷，装备 / 戒指用任意一种，法宝要同属性（用量见 config/forge.js）
    ys:   { name: "耀石", names: ["金耀石", "木耀石", "水耀石", "火耀石", "土耀石", "雷耀石"], sell: 20,
            desc: "装备、戒指、法宝炼制和强化的专用矿石。" },
    // 灵晶：金 木 水 火 土，炼制、强化灵珠（config/array.js 的 lingzhu）
    lj:   { name: "灵晶", names: ["金灵晶", "木灵晶", "水灵晶", "火灵晶", "土灵晶"], sell: 20, desc: "炼制、强化灵珠的材料。" },
    // 灵元：金 木 水 火 土 雷，升级道童（按道童五行）、升级灵根（按灵根属性）
    ly:   { name: "灵元", names: ["金灵元", "木灵元", "水灵元", "火灵元", "土灵元", "雷灵元"], sell: 5, desc: "升级道童、灵根的材料。" },
    lu:   { name: "养神露", sell: 20, desc: "炼制养神丹的材料，元婴期秘境首领掉落。" },
    wdg:  { name: "悟道果", sell: 10, desc: "在「洞府 → 悟道室」悟道时消耗。四界功德司用功德购买。" },
    cmd:  { name: "冲脉丹", sell: 50, desc: "在「修炼 → 经脉」冲穴，每层消耗 1 颗。2 星宗门炼丹房学丹方炼制。" },
    yd:   { name: "养神丹", sell: 50, desc: "在「修炼 → 神识」养神，提升神识强度（每天可元婴出窍的次数）。2 星宗门炼丹房学丹方炼制。" },
  },

  // 秘境列表：顺序 = 存档序号，不要调换或插入；进入境界依次为练气、筑基……大乘（见 config/mobs.js）
  list: [
    { name: "灵泉洞天", find: { map: 0, chance: 5 }, drops: 0,
      bossName: "碧水蛟", monsters: ["灵泉水妖", "碧鳞鱼精", "水灵", "青藤妖"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "苍梧原", find: { map: 1, chance: 5 }, drops: 1,
      bossName: "苍梧石精", monsters: ["石傀儡", "山魈", "石甲蜥", "噬灵鼠"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [1, 1] }],
      } },
    { name: "赤炎火窟", find: { map: 2, chance: 5 }, drops: 2,
      bossName: "赤鳞火蜥", monsters: ["火灵", "火鼠", "赤炎蜥", "熔岩怪"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "寒渊冰宫", find: { map: 3, chance: 5 }, drops: 3,
      bossName: "玄冰雪狼", monsters: ["冰魄妖", "寒霜狼", "冰傀儡", "雪妖"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "万剑冢", find: { map: 3, chance: 5 }, drops: 3,
      bossName: "残剑灵", monsters: ["剑灵", "剑魂", "残剑傀儡", "剑奴"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "埋骨战场", find: { map: 4, chance: 5 }, drops: 4,
      bossName: "断魂将", monsters: ["残兵魂", "骷髅兵", "战场怨灵", "血煞兵"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "落星谷", find: { map: 5, chance: 5 }, drops: 5,
      bossName: "陨铁巨蜥", monsters: ["星斑兽", "陨石傀儡", "星芒灵", "食铁虫"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "阴风鬼窟", find: { map: 6, chance: 5 }, drops: 6,
      bossName: "阴风老鬼", monsters: ["游魂", "厉鬼", "冥鬼", "骨妖"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "迷雾幻林", find: { map: 6, chance: 5 }, drops: 6,
      bossName: "迷雾狐妖", monsters: ["幻影修士", "雾妖", "迷魂灵", "幻狐"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
    { name: "荒古遗迹", find: { map: 7, chance: 5 }, drops: 7,
      bossName: "独角荒兽", monsters: ["荒兽", "野魔灵", "荒原之灵", "石巨人"],
      extra: {
        boss: [{ item: "耀石", chance: 100, n: [10, 20] }, { item: "灵晶", chance: 100, n: [2, 5] }, { item: "火髓", chance: 100, n: [6, 16] }, { item: "空间晶核", chance: 100, n: [0, 1] }],
      } },
  ],
};
