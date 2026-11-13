/* ★ 阵法室：阵法相关参数都在这里（代码 modules/formation.js，阵法室）
 * 一、主动阵法 ACTIVE：6 个，按六系，最高 MAX 级，可同时全开、随时开关。
 *   开着时只在战斗、度雷劫里生效：受到本系（el）属性伤害直接减 RED × 等级，受到克制系（ke）属性伤害直接加 ADD × 等级。
 *   固定点数，不乘任何倍率（用户定）；最后算，伤害最低减到 0。
 *   每次受到本系属性伤害：减少的伤害 = min(本次伤害, RED 上限)，消耗灵气 = 减少的伤害 × RATE（1 点伤害扣 3.6 点灵气）；
 *   灵气不够时按剩余灵气比例减伤（减伤 = 灵气 / RATE，灵气扣光），阵保持开启。克制系加伤不收费。
 *   运转消耗 KEEP（用户定 2026-11-13）：每个开着的主动阵每 10 秒扣灵气 KEEP（[1 级, 满级]，中间平均），灵气不够扣到 0，阵保持开启。
 *   布阵（第 1 级）= 1 级升 2 级消耗 × SET_K（3 倍）；从第 L 级升级：三种矿石各 ORE × L（1~12 级凡界、13~24 仙界、25~36 神界），灵石 = 每种矿石数 × STONE_K。
 * 二、属性阵法 STAT：7 种 × TIERS 阶，每阶是单独一个阵法，各自最高 MAX 级。
 *   1~12 阶上限合计 = 宗门功法 TOTAL[属性] × PCT%；第 t 阶占的份额是 1 阶的 t 倍（2 阶比 1 阶多 100%，3 阶多 200%…），
 *   每阶平均分给 MAX 级：升 1 级 = 这个阵法能提供的属性上限加一份（不直接加到人物身上）。
 *   布阵 = 1 级升 2 级消耗 × SET_K（3 倍）；从第 L 级升级：三种矿石各 ORE × L（1~4 阶凡界、5~8 仙界、9~12 神界），灵石 = 每种矿石数 × STONE_K。
 *   矿石种类：该界 6 种矿石轮流用，每个阵法取连续 PER 种（主动阵按阵序号，属性阵按界内序号查表轮流），各种矿石用得一样多（每界每种恰好 14 次）。
 *   修炼：点一次扣灵气 LING × 阶（1 阶 1500 万，每高 1 阶多 1500 万），SEC 秒后人物属性 +GAIN[0]~GAIN[1] 随机点，
 *   加到这个阵法当前上限为止。
 * 三、属性阵法图纸 BP：宗门宝库「图纸」页用贡献兑换，进背包，学习后阵法室里才出现这一阶，点阵法图片布阵 = 1 级（不花灵石）。
 *   第 t 阶：宗门星级 ≥ STAR[t-1] 才能兑换；贡献 CONTRIB + CONTRIB_ADD × (t−1)；学习 LEARN_MIN × t 分钟（炼器学习队列）。
 *   主动阵法也要图纸：宗门星级 ≥ ACT_STAR，贡献 ACT_CONTRIB，学习 ACT_LEARN_MIN 分钟；学会才出现，点图片布阵 = 1 级，之后升级花灵石。
 *   礼包码「图纸」里也能选（阵法种类 + 阶）。没学会的阵法在阵法室里不显示。
 * ===================================================================== */
CFG.zhenfa = {
  MAX: 36,
  ACTIVE: [
    { id: "jin",  name: "锐金阵", el: "jin",  ke: "huo", img: "img/zf/zfa_jin.webp" },
    { id: "mu",   name: "苍木阵", el: "mu",   ke: "jin", img: "img/zf/zfa_mu.webp" },
    { id: "shui", name: "壬水阵", el: "shui", ke: "tu", img: "img/zf/zfa_shui.webp" },
    { id: "huo",  name: "离火阵", el: "huo",  ke: "shui", img: "img/zf/zfa_huo.webp" },
    { id: "tu",   name: "戊土阵", el: "tu",   ke: "mu", img: "img/zf/zfa_tu.webp" },
    { id: "lei",  name: "雷泽阵", el: "lei",  ke: "tu", img: "img/zf/zfa_lei.webp" },
  ],
  ACT: { RED: [100, 18000], ADD: [90, 9000], KEEP: [100, 18000], RATE: 3.6, ORE: 1800, BAND: [12, 24, 36] },   // RED/ADD = [1 级, 满级]，中间每级平均增加（四舍五入）；RATE：每减 1 点伤害扣 3.6 点灵气；升级：每种矿石 ORE × 当前级；1~12 级凡界、13~24 仙界、25~36 神界矿石
  STAT: [
    { id: "atk",   name: "淬元阵", img: "img/zf/zfi_atk.webp" },
    { id: "def",   name: "聚元阵", img: "img/zf/zfi_def.webp" },
    { id: "speed", name: "御风阵", img: "img/zf/zfi_speed.webp" },
    { id: "hp",    name: "生元阵", img: "img/zf/zfi_hp.webp" },
    { id: "mana",  name: "凝元阵", img: "img/zf/zfi_mana.webp" },
    { id: "hit",   name: "破虚阵", img: "img/zf/zfi_hit.webp" },
    { id: "dodge", name: "幻影阵", img: "img/zf/zfi_dodge.webp" },
  ],
  BP: { STAR: [3, 3, 3, 5, 5, 5, 7, 7, 7, 9, 9, 9], CONTRIB: 1000, CONTRIB_ADD: 1000, LEARN_MIN: 5,
        ACT_STAR: 3, ACT_CONTRIB: 1000, ACT_LEARN_MIN: 5 },   // ACT_*：主动阵法图纸（没有阶）
  ST: { TIERS: 12, SEC: 5, LING: 15000000, PCT: 33, GAIN: [13, 49], ORE: 1000, BAND: [4, 8, 12] },   // 升级：每种矿石 ORE × 当前级；1~4 阶凡界、5~8 仙界、9~12 神界矿石
  // 升级用矿石池（凡界 / 仙界 / 神界各 6 种），每个阵法轮流取 PER 种，用得平均（用户定）；灵石 = 每种矿石数量 × STONE_K（用户定 2.5）
  ORES: [["铁精", "寒铁", "赤铜精", "玄冥铁", "星辰砂", "虚空石"],
         ["天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉", "玄黄晶"],
         ["神辉金", "神陨星铁", "太初神晶", "曜日神金", "九天玄玉", "混元神石"]],
  PER: 3,
  SET_K: 3,   // 布阵消耗 = 1 级升 2 级的 3 倍（用户定）
  STONE_K: 2.5,
};
