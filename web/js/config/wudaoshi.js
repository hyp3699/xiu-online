/* ★ 洞府 · 悟道室（代码 modules/wudaoshi.js）。每条道每天悟道 1 次，每次耗悟道果。k = 第几阶段（1 起）。
 * 两条道通用：第 k 阶段需悟道 TIMES + ADD × (k−1) 次，每次耗悟道果 FRUIT + FRUIT_ADD × (k−1) 个。
 * 修炼之道：每次得修为 = 当前境界升级所需 × EXP_PCT 随机 %；每阶段给 BOOKS 本秘诀（TYPES 轮流），
 *   效果 = min(k, MAX_STAR) 星宗门秘诀 × MULT 随机倍，名字 = NAME[类别]·第N卷。
 * 神魂之道：每阶段给 SS 次神识强度（每次 +SS_N）；每次悟道永久减修炼灵气消耗 RED + RED_ADD × (k−1) 点（RED_TYPES 轮流）；
 *   阶段最后一次额外给灵识点 LS + LS_ADD × (k−1)。 */
window.CFG = window.CFG || {};

CFG.wudaoRoom = {
  DESC: "大道无形，玄机藏于天地万物，唯静心方可窥见一二。悟道果生于灵脉深处，蕴含一丝道韵，服之静坐，可令心神通明，悟道之路一日千里。",
  TIME: 5,             // 一次悟道读条（秒）
  // 悟道结束随机显示一句
  TEXTS: ["灵台空明，天地间的道韵如潮水般涌来……", "冥冥之中，似有大道之音在耳畔低语……", "心神沉入丹田，一缕明悟自识海深处升起……",
    "周身气机流转，仿佛与天地同呼吸……", "恍惚间看见万物生灭，心中若有所得……", "道心澄澈，往日修行的迷障豁然开朗……"],
  FRUIT_MERIT: 100,    // 仙冥魔功德司悟道果价格（功德 / 个）
  FRUIT_MERIT_SHEN: 200,   // 神界功德司悟道果价格（功德 / 个）
  daos: [   // 顺序 = 按钮顺序；open: false = 暂未开放
    { id: "xiulian", name: "修炼之道", open: true,  desc: "吐纳天地，问道长生。" },
    { id: "shenhun", name: "神魂之道", open: true,  desc: "淬炼神魂，明照灵台。" },
    { id: "zhandou", name: "战斗之道", open: false, desc: "以战证道，杀伐果决。" },
  ],
  xiulian: {
    TIMES: 100, ADD: 30,        // 阶段次数
    FRUIT: 1, FRUIT_ADD: 1,     // 每次悟道果
    EXP_PCT: [2, 5],            // 修为 % 范围
    BOOKS: 10,                  // 每阶段秘诀本数
    TYPES: ["mijue", "tijue"],  // 轮流给：修炼秘诀、炼体秘诀
    MULT: [1.5, 1.9],           // 秘诀效果倍率范围
    MAX_STAR: 10,               // 星级上限
    NAME: { mijue: "无名秘诀", tijue: "无名练体诀" },
  },
  shenhun: {
    TIMES: 100, ADD: 30,        // 阶段次数
    FRUIT: 1, FRUIT_ADD: 1,     // 每次悟道果
    SS: 10, SS_N: 1,            // 每阶段几次神识强度、每次加几
    RED: 36, RED_ADD: 36,         // 每次减灵气消耗（点 / 10 秒）
    RED_TYPES: ["exp", "body"], // 轮流减：修为修炼、肉身修炼
    LS: 1, LS_ADD: 1,           // 阶段最后一次额外灵识点
  },
};
