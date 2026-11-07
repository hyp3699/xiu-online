/* =====================================================================
 * ★ 灵药园 · 灵田 ★ 代码见 js/data/craft.js、js/modules/garden.js
 * 第 n 块灵田灵石 = floor(OPEN_COST × OPEN_RATE^(n−1))
 * 成熟时间 = grow ÷ (1 + 缩短%/100)，缩短% = 灵植夫/仙植师 GROW_CUT + 秘法「育灵」+ 道童（TIME_CUT_MAX.plantTime 为空即不封顶）
 * 每季数量 = floor(yield 随机 × (1 + 增产%/100))，增产% = 灵植夫/仙植师 YIELD_ADD + 秘法「丰灵」
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.garden = {
  MAX: 80,            // 最多灵田块数
  PAGE: 20,           // 灵药园每页几块（灵药园一 / 二 / 三 …… 按钮切换）
  OPEN_COST: 3000,     // 开第 1 块灵田的灵石
  OPEN_LAST: 3000000,  // 开最后一块（第 MAX 块）的灵石；中间按相同倍率递增（每块约 × (OPEN_LAST ÷ OPEN_COST)^(1 ÷ (MAX − 1))）
  // 种子：背包物品，每块灵田每开始一季（含自动续种）消耗 PLANT_SEED 颗对应种子，没种子就停在「缺少种子」
  PLANT_SEED: 1,        // 每季消耗几颗种子
  SEED_COST_MUL: 5,     // 宗门宝库兑换一颗种子的贡献 = 药材出售价 × 此值（可无限兑换，放进背包）
  SEED_SELL_MUL: 3,     // 种子出售价 = 药材出售价 × 此值
  SEED_DROP: 6,         // 地图每次探索、元婴出窍走完（历练、秘境、灵地不算）：此 % 几率掉 1 颗本图药材的种子（drop 特色药材除外）
  SEED_DROP_SPECIAL: 12, // 同上：此 % 几率掉 1 颗本图特色药材（config/drops.js worldDrops 的 special）的种子
  SEED_DROP_DAY_MAX: 9, // 药材种子（含特色）：每个玩家每天每种最多掉几颗（北京时间换日），掉满的种子不再抽
  // 药材名: { grow 成熟（分钟）, yield [最少, 最多] 每季收获, ling 每季开始时扣的灵气 }
  // 药材名须与 config/items.js 的 mats.herb / matsOther.herb 一致；写在这里的药材才能种、才有种子
  // star：种子要门派达到这个星级才能在宝库兑换；drop: 1 = 特色药材，种子宗门不兑换，只在对应地图掉落（SEED_DROP_SPECIAL）
  herbs: {
    // 凡界：种子不限门派星级，按灵植夫加成
    青灵草: { grow: 1440, yield: [40, 60], ling: 200000 },
    凝露花: { grow: 1440, yield: [40, 60], ling: 375000 },
    赤血参: { grow: 1440, yield: [35, 55], ling: 550000 },
    紫灵芝: { grow: 1680, yield: [35, 55], ling: 725000 },
    幽冥花: { grow: 1680, yield: [30, 50], ling: 900000 },
    星辰草: { grow: 1680, yield: [30, 50], ling: 1075000 },
    // 仙界通用：门派达 config/items.js matsOther.STAR 星才能兑换种子，按仙植师加成
    天元草:   { grow: 2100, yield: [30, 50], ling: 1250000 },
    玄霜花:   { grow: 2100, yield: [30, 50], ling: 1425000 },
    紫府灵根: { grow: 2100, yield: [25, 45], ling: 1600000 },
    万年雪莲: { grow: 2400, yield: [25, 45], ling: 1775000 },
    星河藤:   { grow: 2400, yield: [20, 40], ling: 1950000 },
    // 特色药材：仙 / 冥 / 魔 / 神各界地图掉落种子，宗门不兑换
    琼华仙草: { grow: 2700, yield: [20, 40], ling: 2125000, drop: 1 },
    冥魂花:   { grow: 2700, yield: [20, 40], ling: 2125000, drop: 1 },
    噬血魔莲: { grow: 2700, yield: [20, 40], ling: 2125000, drop: 1 },
    神曦花:   { grow: 2700, yield: [20, 40], ling: 2125000, drop: 1 },
    // 神界：种子 9~10 星门派宝库兑换（药材本身不能兑换），按灵植夫加成
    九霄神芝: { grow: 2700, yield: [20, 40], ling: 2300000, star: 9 },
    天曜神莲: { grow: 2700, yield: [20, 40], ling: 2475000, star: 9 },
    太阳神果: { grow: 3000, yield: [20, 40], ling: 2650000, star: 9 },
    紫极神参: { grow: 3000, yield: [20, 40], ling: 2825000, star: 9 },
    星魂神藤: { grow: 3000, yield: [20, 40], ling: 3000000, star: 9 },
  },
  // ★ 灵果（18 种）：服用后永久加属性，每颗加一次、没有上限；种子种在灵药园（每季耗 1 颗种子，同 PLANT_SEED）
  //   k：dmg_属性 该系属性伤害（法术 / 神通 / 法宝） res_属性 该系抗性（减伤） atk 攻击 def 防御 hp 生命 mana 法力 cult 修为修炼速度 body 气血修炼速度；v 每颗加多少（具体数字）
  //   图片：img/lg/序号.png（灵果）、img/lg/seed序号.png（种子）
  LINGGUO: {
    GROW: 4320,          // 成熟时间（分钟，72 小时），灵植夫 / 秘法 / 道童的种植速度照样缩短
    LING: 2400000,       // 每季消耗灵气
    YIELD: [[1, 88], [2, 8], [3, 4]],   // 每季收获：[颗数, 几率%]（不吃收获加成）
    SELL: 100,           // 灵果出售价
    SEED_SELL: 100,      // 种子出售价
    DROP_REALM: 2,       // 秘境（凡界秘境，不含灵地、宗门秘境）进入境界 ≥ 此值才掉种子（2 = 金丹）
    DROP_PCT: 40,        // 每走完一处这样的秘境：此 % 几率随机掉 1 颗种子
    DROP_DAY_MAX: 2,     // 每个玩家每天每种种子最多掉几颗（北京时间换日），掉满的种子不再抽
    YS_N: 18,            // 隐世宗门：随机挑这么多个宗门，每个宗门固定一种种子（进入游戏时定下，不再更换）
    YS_FAV: 10,          // 兑换一颗种子扣本宗好感度
    YS_DAY: 1,           // 每天每个宗门能兑换几颗
    EXP_TIER: 15,        // 收获每颗灵果给灵植夫的经验，按第几品药材算（config/craftsman.js ling.ITEM_EXP）
    list: [
      { name: "金乌果", k: "dmg_jin",  v: 25 }, { name: "九叶果", k: "dmg_mu",  v: 25 }, { name: "玉露果", k: "dmg_shui", v: 25 },
      { name: "火灵枣", k: "dmg_huo",  v: 25 }, { name: "黄中李", k: "dmg_tu",  v: 25 }, { name: "紫阳果", k: "dmg_lei",  v: 25 },
      { name: "铁骨藤", k: "dr_jin",  v: 25 }, { name: "枯荣草", k: "dr_mu",  v: 25 }, { name: "定海莲", k: "dr_shui", v: 25 },
      { name: "冰魄花", k: "dr_huo",  v: 25 }, { name: "黄玉参", k: "dr_tu",  v: 25 }, { name: "雷公藤", k: "dr_lei",  v: 25 },
      { name: "玄元果", k: "cult", v: 120 }, { name: "血菩提", k: "body", v: 120 },
      { name: "赤龙果", k: "atk",  v: 27 },  { name: "玄灵草", k: "def",  v: 27 },
      { name: "长生果", k: "hp",   v: 180 }, { name: "碧灵花", k: "mana", v: 90 },
    ],
  },
};
