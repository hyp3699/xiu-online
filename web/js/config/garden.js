/* =====================================================================
 * ★ 灵药园 · 灵田 ★ 代码见 js/data/craft.js、js/modules/garden.js
 * 第 n 块灵田灵石 = floor(OPEN_COST × OPEN_RATE^(n−1))
 * 成熟时间 = grow ÷ (1 + 缩短%/100)，缩短% = 灵植夫/仙植师 GROW_CUT + 秘法「育灵」+ 道童（TIME_CUT_MAX.plantTime 为空即不封顶）
 * 每季数量 = floor(yield 随机 × (1 + 增产%/100))，增产% = 灵植夫/仙植师 YIELD_ADD + 秘法「丰灵」
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.garden = {
  MAX: 20,            // 最多灵田块数
  OPEN_COST: 1000,    // 开第 1 块灵田的灵石
  OPEN_RATE: 1.5,     // 每多开一块灵石 × 此倍率
  // 药材名: { grow 成熟（分钟）, yield [最少, 最多] 每季收获, ling 每季开始时扣的灵气, seed 宗门宝库兑换种子的贡献（一次永久） }
  // 药材名须与 config/items.js 的 mats.herb / matsOther.herb 一致；能兑换种子的药材都要写；仙/冥/魔特色药材不能种
  // star：写了就是该药材的种子要门派达到这个星级才能在宝库兑换（神界药材用；药材本身仍不能兑换）
  herbs: {
    // 凡界：种子不限门派星级，按灵植夫加成
    青灵草: { grow: 1440, yield: [40, 60], ling: 200000, seed: 100 },
    凝露花: { grow: 1440, yield: [40, 60], ling: 375000, seed: 200 },
    赤血参: { grow: 1440, yield: [35, 55], ling: 550000, seed: 450 },
    紫灵芝: { grow: 1680, yield: [35, 55], ling: 725000, seed: 800 },
    幽冥花: { grow: 1680, yield: [30, 50], ling: 900000, seed: 1250 },
    星辰草: { grow: 1680, yield: [30, 50], ling: 1075000, seed: 1800 },
    // 仙界通用：门派达 config/items.js matsOther.STAR 星才能兑换种子，按仙植师加成
    天元草:   { grow: 2100, yield: [30, 50], ling: 1250000, seed: 5000 },
    玄霜花:   { grow: 2100, yield: [30, 50], ling: 1425000, seed: 6000 },
    紫府灵根: { grow: 2100, yield: [25, 45], ling: 1600000, seed: 8000 },
    万年雪莲: { grow: 2400, yield: [25, 45], ling: 1775000, seed: 10000 },
    星河藤:   { grow: 2400, yield: [20, 40], ling: 1950000, seed: 12000 },
    // 神界：种子 9~10 星门派宝库兑换（药材本身不能兑换），贡献 15000，按灵植夫加成
    神曦花:   { grow: 2700, yield: [20, 40], ling: 2125000, seed: 15000, star: 9 },
    九霄神芝: { grow: 2700, yield: [20, 40], ling: 2300000, seed: 15000, star: 9 },
    天曜神莲: { grow: 2700, yield: [20, 40], ling: 2475000, seed: 15000, star: 9 },
    太阳神果: { grow: 3000, yield: [20, 40], ling: 2650000, seed: 15000, star: 9 },
    紫极神参: { grow: 3000, yield: [20, 40], ling: 2825000, seed: 15000, star: 9 },
    星魂神藤: { grow: 3000, yield: [20, 40], ling: 3000000, seed: 15000, star: 9 },
  },
};
