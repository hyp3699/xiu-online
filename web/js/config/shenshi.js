/* ★ 神识（代码 modules/shenshi.js）
 * 神识强度：初始 0，每养神 +1；每天元婴出窍次数 = 神识强度。养神丹 = BASE + ADD × floor(神识强度 ÷ EVERY)。
 * 灵识点：TYPES 里的功法和宗门秘法按星级占用 STAR[星级−1] 点，不够不能学；TYPES 功法可遗忘归还点数，秘法不能。
 * 总灵识点 = 买的 + 悟道室神魂之道给的。 */
window.CFG = window.CFG || {};

CFG.shenshi = {
  YANGSHEN: { BASE: 1, ADD: 1, EVERY: 36 },   // 养神一次的养神丹（公式见开头）
  INIT: 100,        // 初始灵识点
  STAR: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],          // 1 ~ 10 星每本占用灵识点
  TYPES: ["gongjue", "xinfa", "mijue", "tijue"],  // 占用灵识点、可遗忘的功法类别
  MIFA: true,       // 宗门秘法是否占用灵识点
  // 灵石买灵识点：BUY = [每阶段几点, 每阶段每点灵石递增]，从 INIT+1 点开始买
  //   第 1 阶段（101~150 点）每点 1×10 万，第 2 阶段（151~200）每点 2×10 万……
  BUY: [50, 100000],
  BUY_MAX: 0,      // 灵识点上限，0 = 不限（用户定）
};

/* 神识功法（神识页人物两侧 6 个光点，每个一本；代码 modules/shenshi.js ssGf*）
 * 存档 s.ssGf = { id: 层数 }。MAX 最高层数；STEPS 每段 [层数, 每层加多少]，按顺序往后排（超过 STEPS 合计的层用最后一段的每层值）。
 *   也可以不写 STEPS 改写 FIRST / TOTAL：第 1 层加 FIRST，以后每层平均递增，修满 MAX 层合计 = TOTAL（敛息归元诀：1 层 −1000，108 层合计 −72 万，用户定 2026-11-12）。
 * key：pow 神识强度（升一层直接加进神识强度）、cq 元婴出窍收益 %、ls 灵识点、
 *   ling 灵气消耗减少（具体数字，每 10 秒少耗多少点；修为、炼体、功法修炼各减这么多，不会减成负数）、
 *   gf 功法修炼时间 %（和秘法、经脉等减少% 相加，时间 = 基础 ÷ (1 + 合计%)，秘法也走这份）、sp 法术修炼时间 %。
 * 升层消耗：COST，修炼第 k 层要 灵石 STONE + STONE_ADD×(k−1)，元魂果、凝魂芝各 HERB + HERB_ADD×(k−1)，养神丹 YD + YD_ADD×(k−1)（0 = 不要）。
 *   GF_COST 不为空时改用表：每行 [从第几层, 到第几层, 灵石, 养神丹, 元魂果, 凝魂芝]（每层数量），表里没写的层不要消耗。
 * 药材掉落 HERB_DROP：元魂果 yhg、凝魂芝 nhz（config/mijing.js items）。境界 ≥ REALM（3 = 元婴）的普通地图每次探索 MAP_PCT% 掉 1 颗（两种随机一种）；
 *   进入境界 ≥ REALM 的秘境每次必掉 MJ[0]~MJ[1] 颗（每颗随机一种）。不吃地图收益倍率。
 * UNLOCK：神识强度达到多少才能修炼这本（0 = 不限）。 */
CFG.shenshi.GONGFA = [
  { id: "ningshen", name: "凝神观想诀", key: "pow",  MAX: 108, STEPS: [[36, 1], [36, 2], [36, 3]], UNLOCK: 0, desc: "观想识海，凝炼元神，增加神识强度。" },
  { id: "cailing",  name: "太虚采灵经", key: "cq",   MAX: 108, STEPS: [[108, 1]], UNLOCK: 0, desc: "元婴出窍时采撷天地灵物，增加元婴出窍收益。" },
  { id: "lingtai",  name: "灵台开识篇", key: "ls",   MAX: 108, STEPS: [[36, 1], [36, 2], [36, 3]], UNLOCK: 0, desc: "开辟灵台，识海更广，增加灵识点。" },
  { id: "lianxi",   name: "敛息归元诀", key: "ling", MAX: 108, FIRST: 1000, TOTAL: 720000, UNLOCK: 0, desc: "收敛周身气息，吐纳不泄，减少修为修炼、肉身修炼、功法修炼的灵气消耗。" },
  { id: "yandao",   name: "识海演道诀", key: "gf",   MAX: 108, STEPS: [[108, 1]], UNLOCK: 0, desc: "以识海推演功法运行，减少功法修炼时间。" },
  { id: "wanfa",    name: "万法通明录", key: "sp",   MAX: 108, STEPS: [[108, 1]], UNLOCK: 0, desc: "神识映照万法，法术一观即通，减少法术修炼时间。" },
];
CFG.shenshi.COST = { STONE: 3000, STONE_ADD: 3000, HERB: 10, HERB_ADD: 10, YD: 0, YD_ADD: 0 };
CFG.shenshi.GF_COST = [];   // 例：[[1, 36, 100000, 1, 2, 2], [37, 72, 300000, 2, 4, 4]]
CFG.shenshi.HERB_DROP = { REALM: 3, MAP_PCT: 4, MJ: [2, 5], ITEMS: ["yhg", "nhz"] };
