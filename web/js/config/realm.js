/* =====================================================================
 * 境界突破：修为突破 / 肉身突破 需要的修为（气血）和每层增加的属性（计算在 js/data/realms.js）
 * 需要表 [境界序号, 一层需要, 十层需要]：练气/淬皮中间各层平均递增；后面境界按 EXP_FIRST/EXP_GROW（BODY_ 同）自动算；
 *   突破后扣掉本层需要，多余保留。没写的境界沿用上面最近一行。
 * 属性表 [境界序号, { 属性: 每层加多少 }]：hp 生命 atk 攻击 def 防御 mana 法力 speed 速度 hit 命中 dodge 闪避
 *   res 每系抗性 cultivate 修炼速度（只有修为突破有）。没写的属性不加。怪物、雷劫、试炼塔等也按这里算。
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.realm = {
  /* 修为突破：需要的修为 [境界序号, 一层需要, 十层需要] */
  EXP_FIRST: 1.14,    // 每个境界一层 = 上一境界十层 × 1.4（练气十层 185239 → 筑基一层 259335）
  EXP_GROW: 2.4,     // 每个境界十层 = 上一境界十层 × 2.4（→ 筑基十层 444574）；一层到十层中间每层按相同倍率递增
  EXP: [   // 只写练气；想单独改某个境界就照格式加一行 [境界序号, 一层, 十层]，它后面的境界从这行接着 × EXP_GROW
    [0, 1000, 185239],   // 练气
  ],

  /* 修为突破：每层增加的属性 */
  // 每层加的属性；AUTO.on = 1 时只看各境界之间的比例（数字是按 AUTO 算好的结果）
  FIRST_MULT: 3,   // 每个境界第一层 = 本境界每层 × 3（也可写数组按境界分别设）
  GAIN_RATE: 1,    // 修为突破属性总倍率（人物、怪物、雷劫、装备参考属性全部生效；修炼速度不乘）
  /* ★ 突破属性自动计算（on = 1 时生效；0 = 直接用下面 GAIN / BODY_GAIN 表里的数字）
   *   第一个境界每层 = 1 星宗门功法同属性每层 × (1 + FIRST_PCT%)，只有第一个境界对标功法
   *   后面境界按 GAIN / BODY_GAIN 表的增长比例自动算，让全部境界全部层（含第一层 × 3）合计 = 宗门功法合计 × TOTAL_PCT%
   *   修炼速度 cultivate 照表原值；肉身不加法力 */
  AUTO: {
    on: 1,
    // 第一个境界每层比 1 星宗门功法每层高 %，每种属性单独设；可写负数，-12 = 比功法低 12%（res = 六系抗性）
    XW_FIRST_PCT:   { hp: 12, atk: 12, def: 12, mana: 12, speed: 12, hit: 12, dodge: 10, res: -55 },   // 修为
    BODY_FIRST_PCT: { hp: 18, atk: 18, def: 18, speed: 18, hit: 18, dodge: 16, res: -47 },             // 肉身（不加法力）
    // 全部境界合计 = 宗门功法合计的 %（写一个数 = 全部属性一样；也可写 { hp: 55, atk: 50 } 分别设）
    XW_TOTAL_PCT: 39,      // 修为（用户定 2026-11-13，原 55）
    BODY_TOTAL_PCT: 49,    // 肉身（用户定 2026-11-13，原 75）
    RAND_PCT: 2,           // 随机：每突破一层，每项属性在上面百分比基础上随机 ±2%（例 12% → 10%~14%）；0 = 不随机
  },
  GAIN: [
    [0, { hp: 437, atk: 118, def: 116, mana: 314, speed: 58.2, hit: 60, dodge: 59.2, res: 144, cultivate: 0.0273 }],  // 练气
    [1, { hp: 522, atk: 140, def: 139, mana: 375, speed: 69.5, hit: 71.6, dodge: 70.8, res: 172, cultivate: 0.0384 }],  // 筑基
    [2, { hp: 623, atk: 167, def: 166, mana: 448, speed: 83.1, hit: 85.6, dodge: 84.6, res: 206, cultivate: 0.0541 }],  // 金丹
    [3, { hp: 745, atk: 200, def: 198, mana: 535, speed: 99.3, hit: 102, dodge: 101, res: 245, cultivate: 0.0762 }],  // 元婴
    [4, { hp: 892, atk: 239, def: 237, mana: 641, speed: 118, hit: 121, dodge: 121, res: 294, cultivate: 0.107 }],  // 出窍
    [5, { hp: 1061, atk: 285, def: 282, mana: 766, speed: 141, hit: 146, dodge: 144, res: 351, cultivate: 0.151 }],  // 化神
    [6, { hp: 1268, atk: 342, def: 338, mana: 910, speed: 170, hit: 175, dodge: 173, res: 420, cultivate: 0.212 }],  // 练虚
    [7, { hp: 1517, atk: 408, def: 404, mana: 1090, speed: 202, hit: 209, dodge: 206, res: 503, cultivate: 0.299 }],  // 合体
    [8, { hp: 1816, atk: 488, def: 484, mana: 1303, speed: 241, hit: 250, dodge: 247, res: 602, cultivate: 0.423 }],  // 洞真
    [9, { hp: 2171, atk: 580, def: 577, mana: 1560, speed: 289, hit: 299, dodge: 294, res: 721, cultivate: 0.595 }],  // 大乘
    [10, { hp: 2594, atk: 696, def: 690, mana: 1864, speed: 346, hit: 355, dodge: 352, res: 856, cultivate: 0.839 }],  // 渡劫
    [11, { hp: 3095, atk: 830, def: 825, mana: 2230, speed: 413, hit: 426, dodge: 419, res: 1030, cultivate: 1.18 }],  // 散仙
    [12, { hp: 3694, atk: 991, def: 982, mana: 2656, speed: 492, hit: 506, dodge: 501, res: 1226, cultivate: 1.66 }],  // 游仙
    [13, { hp: 4399, atk: 1182, def: 1172, mana: 3158, speed: 585, hit: 604, dodge: 596, res: 1462, cultivate: 2.34 }],  // 地仙
    [14, { hp: 5242, atk: 1405, def: 1395, mana: 3761, speed: 698, hit: 719, dodge: 710, res: 1739, cultivate: 3.3 }],  // 天仙
    [15, { hp: 6219, atk: 1667, def: 1657, mana: 4468, speed: 830, hit: 854, dodge: 844, res: 2068, cultivate: 4.64 }],  // 金仙
    [16, { hp: 7389, atk: 1984, def: 1971, mana: 5307, speed: 985, hit: 1015, dodge: 1003, res: 2454, cultivate: 6.55 }],  // 太乙金仙
    [17, { hp: 8749, atk: 2343, def: 2337, mana: 6286, speed: 1163, hit: 1201, dodge: 1183, res: 2909, cultivate: 9.22 }],  // 大罗金仙
    [18, { hp: 10356, atk: 2774, def: 2764, mana: 7446, speed: 1379, hit: 1421, dodge: 1401, res: 3442, cultivate: 13 }],  // 玄仙
    [19, { hp: 12195, atk: 3281, def: 3262, mana: 8774, speed: 1631, hit: 1680, dodge: 1657, res: 4073, cultivate: 18.2 }],  // 仙王
    [20, { hp: 14407, atk: 3868, def: 3845, mana: 10372, speed: 1924, hit: 1982, dodge: 1955, res: 4797, cultivate: 25.7 }],  // 仙君
    [21, { hp: 16979, atk: 4563, def: 4529, mana: 12174, speed: 2266, hit: 2335, dodge: 2305, res: 5656, cultivate: 36.3 }],  // 仙帝
    [22, { hp: 19935, atk: 5338, def: 5315, mana: 14312, speed: 2664, hit: 2738, dodge: 2706, res: 6649, cultivate: 51.1 }],  // 准圣
    [23, { hp: 23393, atk: 6276, def: 6235, mana: 16802, speed: 3124, hit: 3213, dodge: 3176, res: 7778, cultivate: 72 }],  // 圣人
  ],

  /* 肉身突破：需要的气血 [境界序号, 一层需要, 十层需要] */
  BODY_EXP_FIRST: 1.14,    // 每个肉身境界一层 = 上一境界十层 × 1.4
  BODY_EXP_GROW: 2.4,     // 每个肉身境界十层 = 上一境界十层 × 2.4；中间每层按相同倍率递增
  BODY_EXP: [   // 只写淬皮；想单独改某个境界就加一行 [境界序号, 一层, 十层]
    [0, 1000, 149857],   // 淬皮
  ],

  /* 肉身突破：每层增加的属性 */
  BODY_FIRST_MULT: 3,  // 肉身每个境界第一层 = 本境界每层 × 3
  BODY_GAIN_RATE: 1,   // 肉身突破属性总倍率
  BODY_GAIN: [   // 每层加的属性；AUTO.on = 1 时只看各境界之间的比例；琉璃身起每阶增长比例同修为 GAIN（删境界后重排）
    [0, { hp: 460, atk: 124, def: 123, speed: 61.3, hit: 63.2, dodge: 62.4, res: 152 }],  // 淬皮
    [1, { hp: 555, atk: 150, def: 147, speed: 74.2, hit: 76.4, dodge: 75.4, res: 183 }],  // 炼肉
    [2, { hp: 671, atk: 182, def: 179, speed: 89.7, hit: 92.6, dodge: 91.2, res: 222 }],  // 锻骨
    [3, { hp: 811, atk: 219, def: 215, speed: 108, hit: 111, dodge: 110, res: 268 }],  // 易筋
    [4, { hp: 984, atk: 265, def: 260, speed: 131, hit: 135, dodge: 133, res: 325 }],  // 洗髓
    [5, { hp: 1186, atk: 320, def: 316, speed: 158, hit: 163, dodge: 161, res: 392 }],  // 通脉
    [6, { hp: 1435, atk: 387, def: 381, speed: 191, hit: 197, dodge: 194, res: 474 }],  // 铜皮
    [7, { hp: 1735, atk: 469, def: 462, speed: 232, hit: 239, dodge: 236, res: 575 }],  // 铁骨
    [8, { hp: 2096, atk: 566, def: 560, speed: 280, hit: 288, dodge: 284, res: 694 }],  // 银身
    [9, { hp: 2536, atk: 682, def: 675, speed: 338, hit: 350, dodge: 344, res: 840 }],  // 金身
    [10, { hp: 3030, atk: 818, def: 807, speed: 405, hit: 416, dodge: 412, res: 997 }],  // 琉璃身
    [11, { hp: 3615, atk: 975, def: 965, speed: 483, hit: 499, dodge: 490, res: 1200 }],  // 金刚体
    [12, { hp: 4315, atk: 1164, def: 1149, speed: 575, hit: 593, dodge: 586, res: 1428 }],  // 不坏体
    [13, { hp: 5139, atk: 1388, def: 1371, speed: 684, hit: 708, dodge: 697, res: 1703 }],  // 宝体
    [14, { hp: 6124, atk: 1650, def: 1632, speed: 816, hit: 843, dodge: 830, res: 2026 }],  // 紫金体
    [15, { hp: 7265, atk: 1958, def: 1939, speed: 970, hit: 1001, dodge: 987, res: 2409 }],  // 玄晶体
    [16, { hp: 8632, atk: 2330, def: 2306, speed: 1151, hit: 1190, dodge: 1173, res: 2859 }],  // 星辰体
    [17, { hp: 10221, atk: 2752, def: 2734, speed: 1359, hit: 1408, dodge: 1384, res: 3389 }],  // 太古体
    [18, { hp: 12098, atk: 3258, def: 3234, speed: 1611, hit: 1666, dodge: 1639, res: 4010 }],  // 万劫体
    [19, { hp: 14246, atk: 3853, def: 3817, speed: 1905, hit: 1970, dodge: 1938, res: 4745 }],  // 神王体
    [20, { hp: 16830, atk: 4542, def: 4499, speed: 2247, hit: 2324, dodge: 2287, res: 5588 }],  // 混沌体
    [21, { hp: 19835, atk: 5358, def: 5299, speed: 2646, hit: 2738, dodge: 2696, res: 6589 }],  // 鸿蒙体
    [22, { hp: 23288, atk: 6268, def: 6219, speed: 3111, hit: 3211, dodge: 3165, res: 7746 }],  // 不灭体
    [23, { hp: 27328, atk: 7369, def: 7295, speed: 3648, hit: 3768, dodge: 3715, res: 9061 }],  // 永恒体
  ],
};
