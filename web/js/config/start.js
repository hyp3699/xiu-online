/* =====================================================================
 * 开局：新建角色时拿到的东西（只影响新存档）。开局生命、法力 = config/player.js 的 base（满状态）
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.start = {
  stone: 30000,              // 开局灵石
  ling: 30000,               // 开局灵气（洞府储存，修炼消耗）
  // 开局丹药 [丹药 id（config/alchemy.js）, 品质 = 大境界序号（0 = 练气）, 数量]
  pills: [["juqi", 0, 3]],  // 练气品质聚气丹 ×3
  // 开局功法书（秘诀）：背包里点「学习」学会第 1 层，之后在功法页修炼升层
  book: {
    name: "练气诀",         // 名字
    MAX: 3,                 // 最多几层
    SPEED: 50,               // 每层加修炼速度（第 n 层合计 = SPEED × n）
    STUDY_MIN: [1, 2],      // 升层时间（分钟）：第 1 个 = 1→2 层，第 2 个 = 2→3 层
    STUDY_PER: 5,           // 修炼时每 5 秒消耗灵气 = STUDY_PER × config/gongfa.js 的 STUDY_LING
  },
};

/* ---------------------------------------------------------------------
 * 出身（创建角色时选，最多 PICK 个；选了就永久生效，以后不能改）
 *   name 名字  desc 显示的说明（只是文字，改效果要改下面的数值键）
 * 开局一次性给的（不写 = 不给）：
 *   stone 灵石  ling 灵气  pills [[丹药id, 品质, 数量]]
 *   recipe 送几张丹方（随机 RECIPE_STAR 星宗门可学的凡丹，一阶，直接学会）
 *   eqBp 送几张装备图谱（随机部位，一阶，直接学会）
 *   herbs / ores [[药材 / 矿石序号, 数量]]（序号见 config/drops.js 名字顺序，0 = 第一种）
 *   field 灵田多几块（免费开好）   qiExp 炼器经验
 *   fabao 送几件法宝（FABAO_G 阶，形状、属性随机）
 *   gf 送功法 ["mijue" 秘诀 / "zhenjue" 真经 …]（GF_STAR 星宗门，随机一个宗门）
 *   furnace [["dan" 炼丹炉 / "qi" 炼器炉, 阶序号 0 = 一星]]
 *   bodyL 开局肉身层数
 * 永久效果：
 *   sectRank 加入 SECT_STAR 星宗门直接成为第几个职务（0 外门 1 内门 2 真传…），contrib 同时加贡献（只第一次加入时）
 *   gfStudyPct 学习、修炼功法时间 -%   leiCut 渡劫雷属性伤害 -%   bodyPct 肉身修炼（气血）速度 +%
 *   danRate / qiRate 炼丹 / 炼器成功率 +%   explore 探索、出窍每步 -秒（仍受 config/explore.js STEP_MIN 下限）
 *   mjDrop 秘境收益 +%   noTribLoss 1 = 渡劫失败不掉修为   shopCut 坊市（凡界 + 四界）灵石价格 -%   ls 神识（灵识点）+
 * --------------------------------------------------------------------- */
CFG.origin = {
  PICK: 5,           // 能选几个
  RECIPE_STAR: 1,    // 送的丹方：几星宗门能学的
  FABAO_G: 0,        // 送的法宝阶（0 = 一星）
  GF_STAR: 1,        // 送的功法：几星宗门
  SECT_STAR: 1,      // 宗门遗孤：加入几星宗门生效
  LIST: [
    { id: "yigu",     name: "宗门遗孤", desc: "师门长辈收养。加入任一 1 星宗门直接是真传弟子，贡献 +1000。", sectRank: 2, contrib: 1000 },
    { id: "shijia",   name: "世家子弟", desc: "灵石 +50000，聚气丹 +5。", stone: 50000, pills: [["juqi", 0, 5]] },
    { id: "yaonong",  name: "药农之子", desc: "送 1 星丹方 3 张、凡界药材一批，灵田开局多 3 块。", recipe: 3, herbs: [[0, 50], [1, 50], [2, 50], [3, 50], [4, 50], [5, 50]], field: 3 },
    { id: "tiejiang", name: "铁匠学徒", desc: "送 1 星装备图谱 3 张、凡界矿石一批，炼器经验 +600。", eqBp: 3, ores: [[0, 50], [1, 50], [2, 50], [3, 50], [4, 50], [5, 50]], qiExp: 600 },
    { id: "shuxiang", name: "书香门第", desc: "学习功法时间 永久 -10%。", gfStudyPct: 10 },
    { id: "zhuiya",   name: "坠崖奇遇", desc: "崖底古修遗骸。送 1 星法宝 1 件、1 星秘诀 1 本。", fabao: 1, gf: ["mijue"] },
    { id: "yixiang",  name: "天降异象", desc: "出生时雷光入体。渡劫时雷属性伤害 -30%。", leiCut: 30 },
    { id: "dongfu",   name: "古修洞府", desc: "误入残破洞府。灵气 +5000000，送 1 星真经 1 本。", ling: 5000000, gf: ["zhenjue"] },
    { id: "liehu",    name: "猎户之后", desc: "山中长大，筋骨强健。肉身修炼气血 +10%，开局肉身多 5 层。", bodyPct: 10, bodyL: 5 },
    { id: "dantong",  name: "丹童出身", desc: "自幼在丹房烧火。炼丹成功率 永久 +8%，送 1 星丹炉 1 座。", danRate: 8, furnace: [["dan", 0]] },
    { id: "qifang",   name: "器坊学徒", desc: "自幼在器坊拉风箱。炼器成功率 永久 +8%，送 1 星炼器炉 1 座。", qiRate: 8, furnace: [["qi", 0]] },
    { id: "youfang",  name: "游方散修", desc: "随师父走遍凡界。探索每步时间 永久 -0.5 秒。", explore: 0.5 },
    { id: "mijing",   name: "秘境遗民", desc: "生于秘境边缘。秘境掉落 永久 +30%。", mjDrop: 30 },
    { id: "simiao",   name: "寺庙寄养", desc: "在古寺长大，心性平和。渡劫失败不掉修为。", noTribLoss: 1 },
    { id: "shangjia", name: "商贾之家", desc: "家中经商。坊市购买价格 永久 -10%（包括四界坊市），灵石 +30000。", shopCut: 10, stone: 30000 },
    { id: "canhun",   name: "残魂附体", desc: "一缕上古残魂寄于识海。神识 +100。", ls: 100 },
  ],
};
