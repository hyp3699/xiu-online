/* =====================================================================
 * ★ 隐世宗门 ★（代码：modules/world.js 的 ys*）
 * 坐落在地图格子（游历）里：每个宗门在所在地图东西南北四域、每域 9×9 格中随机一格，
 * 角色第一次游历时随机定下位置（存档 s.ysPos），以后不变；游历点亮那一格即「发现」，格子上显示宗门小模型，点进去是宗门地图
 * list：w 界（fan 凡界 / xian 仙界 / mo 魔界 / ming 冥界 / shen 神界），m 该界第几张地图（1 起），name 宗门名，star 功法阁功法星级，st 能在宗门大殿修炼的神通（SHENTONG.LIST 的 id；神界最后两个宗门各 2 种，22 个宗门共 24 种）
 * 好感度：每个宗门单独计算（存档 s.ysFav），代替贡献，用来在功法阁兑换功法
 * FIXED：固定位置并直接算已发现（测试用），{ 宗门id: { a 地图序号（凡界 0 = 青云山林）, r 域（0 东 1 西 2 南 3 北）, i 格子序号（0 ~ 80，40 = 正中） } }
 * PLACES：宗门地图里的地点，x / y = 在宗门地图上的位置（%）
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.yinshi = {
  ON: 1,   // 0 = 关闭隐世宗门
  list: [
    { id: "zangjian", w: "fan",  m: 7, name: "葬剑宗", star: 5, st: ["wanjian"] },
    { id: "yinlei",   w: "fan",  m: 9, name: "引雷宗", star: 6, st: ["jiuxiao"] },
    { id: "taiqing",  w: "xian", m: 1, name: "太清观", star: 7, st: ["taiqing"] },
    { id: "lihuo",    w: "xian", m: 3, name: "离火仙宫", star: 7, st: ["lihuo"] },
    { id: "guanxing", w: "xian", m: 5, name: "观星阁", star: 8, st: ["xingyun"] },
    { id: "penglai",  w: "xian", m: 7, name: "蓬莱仙岛", star: 9, st: ["penglai"] },
    { id: "taixu",    w: "xian", m: 9, name: "太虚剑宗", star: 10, st: ["taixu"] },
    { id: "xuehe",    w: "mo",   m: 1, name: "血河宗", star: 7, st: ["xuehe"] },
    { id: "shihun",   w: "mo",   m: 3, name: "噬魂殿", star: 7, st: ["shihun"] },
    { id: "baigu",    w: "mo",   m: 5, name: "白骨魔门", star: 8, st: ["baigu"] },
    { id: "luocha",   w: "mo",   m: 7, name: "罗刹宫", star: 9, st: ["luocha"] },
    { id: "tianmo",   w: "mo",   m: 9, name: "天魔宗", star: 10, st: ["tianmo"] },
    { id: "yinhun",   w: "ming", m: 1, name: "引魂门", star: 7, st: ["minghe"] },
    { id: "shehun",   w: "ming", m: 3, name: "摄魂宗", star: 7, st: ["hanchao"] },
    { id: "jimie",    w: "ming", m: 5, name: "寂灭禅院", star: 8, st: ["kuchan"] },
    { id: "wangui",   w: "ming", m: 7, name: "万鬼宗", star: 9, st: ["wangui"] },
    { id: "qingdeng", w: "ming", m: 9, name: "青灯古寺", star: 10, st: ["qingdeng"] },
    { id: "taichu",   w: "shen", m: 1, name: "太初神宗", star: 11, st: ["taichu"] },
    { id: "wanhua",   w: "shen", m: 3, name: "万化神宫", star: 12, st: ["wanhua"] },
    { id: "xuanming", w: "shen", m: 5, name: "玄冥神教", star: 13, st: ["xuanming"] },
    { id: "zhuque",   w: "shen", m: 7, name: "朱雀神庭", star: 14, st: ["zhuque", "zhenyue"] },
    { id: "dari",     w: "shen", m: 9, name: "大日神宗", star: 15, st: ["dari", "leiji"] },
  ],
  FIXED: {
    zangjian: { a: 0, r: 0, i: 40 },   // 葬剑宗先放在青云山林东域正中，直接已发现
  },
  // 事务堂：每天每个宗门刷新 HERB 个药材任务 + ORE 个矿石任务（本宗门所在界的药材 / 矿石，凡界宗门就是凡界的），每个提交 NUM 个，好感度 + FAV
  TASK: { HERB: 2, ORE: 2, NUM: 200, FAV: 10 },
  // 功法阁：每个宗门 12 本（攻击 防御 生命 命中 法力 闪避 + 六种抗性真经）各一本，兑换一次后不能再换；效果 = 同星级宗门功法 × GF_PCT%，不占灵识点
  GF_PCT: 195,
  GF_COST: 500,   // 5 星每本需要好感度（兑换扣除）
  GF_COST_STEP: 100,   // 每高 1 星多要好感度（6 星 600 …… 15 星 1500）
  GF_KEYS: ["gongjue", "xinfa", "zhenjing", "shenfa", "fajue", "dunshu", "jin", "mu", "shui", "huo", "tu", "lei", "mijue", "mijue2", "tijue", "tijue2"],   // 后 4 本：修为速度秘诀 2 本、炼体秘诀 2 本
  GF_SUFFIX: { gongjue: "镇岳诀", xinfa: "不动心经", zhenjing: "万寿宝典", shenfa: "踏虚步", fajue: "归元法典", dunshu: "化虹遁法",
    jin: "太白金经", mu: "青帝木经", shui: "玄冥水经", huo: "南明火经", tu: "厚土宝经", lei: "九霄雷经",
    mijue: "聚元秘诀", mijue2: "归墟秘诀", tijue: "金刚炼体诀", tijue2: "不灭炼体诀" },
  HALL_FAV: 1000,   // 进入宗门大殿需要好感度达到（不消耗）
  HALL_FREE: ["zangjian"],   // 测试用：这些宗门进大殿、修神通不看好感度（测完删掉）
  // 宗门大殿学神通：每个宗门一种，NODES 个节点按「天地玄黄宇宙洪荒日月星辰」排，从最下面的「辰」开始往上修，最后修「天」；每个节点 LV 级
  //   学习：修炼顺序第 n 个节点（1 起，辰 = 1 …… 天 = 12）每级消耗神通碎片 COST[n-1] 个、灵石 STONE[n-1]
  //   某种神通要单独设置，在 LIST 里给它写 learn: { frag: [12 个数], stone: [12 个数] }（不写就用这里的 COST / STONE）
  //   神通不分星级，每个宗门的神通都一样：全部修满（12 节点 120 级）加的属性 = MAX，每级平分；res = 六系抗性每一系
  SHENTONG: {
    NODES: ["天", "地", "玄", "黄", "宇", "宙", "洪", "荒", "日", "月", "星", "辰"],
    LV: 10,
    COST: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
    STONE: [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
    MAX: { hp: 30000, atk: 9000, def: 9000, mana: 10000, res: 3000 },
    /* 领悟（修满 120 级）的神通放进背包「神通秘术」，出战位数由 SLOT_SS 按神识强度开启，被动最多 PAS_MAX 个
     * 主动神通：战斗中像法术一样施展，每场最多 USES 次；伤害 = 自身全部攻击（不受境界限制）× (PCT + 修炼等级 × LV_PCT)% + 精研次数 × JY_DMG（该系属性伤害），再按对方防御 / 该系抗性减免（同法术）
     *   法力消耗 = 法力上限 × MANA_PCT%（0 = 不耗法力）；命中后触发附加效果 fx
     *   附加效果加的攻击 / 防御，对之后的普通攻击、法术、法宝也生效
     * 被动神通：出战就生效，每回合开始触发，数值见各自 fx；只能修炼，不能精研
     * 修炼：最多 UP_MAX 级，每种神通单独设置（LIST 里的 up）：第 n+1 级消耗本宗门神通碎片 frag + n × fragAdd 个、灵石 stone + n × stoneAdd
     * 精研（只有主动，所有神通共用 JY_COST）：不限次数，第 n+1 次消耗碎片 frag + floor(n ÷ EVERY) × fragAdd 个、灵石 stone + floor(n ÷ EVERY) × stoneAdd
     *   现在：学习每级 12 碎片 1万灵石；修炼每级 360 碎片 100万灵石；精研每次 120 碎片 10万灵石（都不涨） */
    EQ_MAX: 4,
    SLOT_SS: [0, 350, 700, 1000],   // 神通位：第 1~4 个位需要的神识强度（0 = 一开始就有）
    PAS_MAX: 2,                     // 被动神通最多出战几个（主动不限，只受神通位数限制）
    PCT: 100, LV_PCT: 2, USES: 1, MANA_PCT: 0, UP_MAX: 36, JY_DMG: 36,
    JY_COST: { frag: 120, stone: 100000, EVERY: 100, fragAdd: 0, stoneAdd: 0 },
    /* 主动附加效果 fx（r = 持续回合，再次触发刷新回合数，不叠加）：
     *   buff  自身 k +p%（atk 攻击 / def 防御 / res 本系抗性）     deb  对手 k −p%（atk / def / res 本系抗性 / hit 命中 / dodge 闪避 / speed 速度，k 可写数组）
     *   heal  恢复生命 = 本次伤害 × p%     stun  chance% 几率击晕对手 r 回合
     *   （另有 shield 护盾 / drain 降当前法力 / pshield 破盾增伤 / hp50 对手半血以上增伤，现在没用上）
     * 被动 fx（每回合开始，都是具体数字）：
     *   regen  恢复生命 p 点
     *   mana   恢复法力 p 点，并且属性伤害（法术 / 法宝 / 神通命中后）每回合 +eld 点
     *   grow   自身 k（数组：atk / def / hit / dodge / speed）每回合 +p 点
     *   n = 最多累加几回合（之后不再增加）：最高 = 每回合数值 × n，例如每回合 +10 攻击、n 30 → 最多 +300
     *   修炼每级：每回合数值 + lvP（mana 的属性伤害 + lvE） */
    /* 主动神通释放动画 anim（和法术不同：先天色一暗、神通名大字浮现、脚下法阵，再播放）：
     *   rain 天降（animShape: bolt 雷 / star 流星 / sword 剑，animN 道数）   swords 万剑合围   slash 巨大剑光横斩   sigil 八卦法印压下
     *   chain 地下锁链缠身   bird 神鸟扑击   mountain 山岳砸落   sun 烈日坠落（animShape: bolt 带雷）   wave 巨浪卷过   vortex 漩涡吸入
     *   lamp 青灯光束   ground 大地裂开吞噬       animCol: [r, g, b] 颜色（不写按属性）
     * 背包「神通秘术」的图标 img: "img/st/xxx.webp"（不写就按 animCol / 属性颜色画一个带名字的圆章） */
    LIST: [
      // 被动
      { id: "xuehe",    name: "血海长生", img: "img/st/xuehe.webp", el: "mu",   type: "pas", fx: { t: "regen", p: 1000, lvP: 50 },
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "xuanming", name: "玄冥归元", img: "img/st/xuanming.webp", el: "shui", type: "pas", fx: { t: "mana", p: 300, lvP: 15, eld: 100, lvE: 5, n: 30 },
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "kuchan",   name: "寂灭无相", img: "img/st/kuchan.webp", el: "shui", type: "pas", fx: { t: "grow", k: ["hit", "dodge", "speed"], p: 50, lvP: 3, n: 30 },
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "lihuo",    name: "离火燎原", img: "img/st/lihuo.webp", el: "huo",  type: "pas", fx: { t: "grow", k: ["atk"], p: 300, lvP: 15, n: 30 },
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "wangui",   name: "万鬼护体", img: "img/st/wangui.webp", el: "tu",   type: "pas", fx: { t: "grow", k: ["def"], p: 300, lvP: 15, n: 30 },
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      // 主动
      { id: "jiuxiao",  name: "九霄引雷", img: "img/st/jiuxiao.webp", el: "lei",  fx: { t: "stun", chance: 100, r: 1 }, anim: "rain", animN: 9,
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "wanjian",  name: "万剑归宗", img: "img/st/wanjian.webp", el: "jin",  fx: { t: "buff", k: "atk", p: 20, r: 10 }, anim: "swords", animN: 18,
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "taichu",   name: "太初元始", img: "img/st/taichu.webp", el: "tu",   fx: { t: "buff", k: "def", p: 20, r: 10 }, anim: "sigil",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "taiqing",  name: "太清化气", img: "img/st/taiqing.webp", el: "mu",   fx: { t: "heal", p: 50 }, anim: "sigil", animCol: [160, 255, 200],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "tianmo",   name: "天魔雷狱", img: "img/st/tianmo.webp", el: "lei",  fx: { t: "deb", k: "atk", p: 20, r: 10 }, anim: "chain", animCol: [170, 80, 255],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "taixu",    name: "太虚剑意", img: "img/st/taixu.webp", el: "jin",  fx: { t: "deb", k: "def", p: 20, r: 10 }, anim: "slash",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "penglai",  name: "蓬莱幻海", img: "img/st/penglai.webp", el: "shui", fx: { t: "deb", k: ["hit", "dodge", "speed"], p: 30, r: 10 }, anim: "wave",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "baigu",    name: "白骨锁金", img: "img/st/baigu.webp", el: "jin",  fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "chain", animCol: [235, 230, 210],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "qingdeng", name: "青灯长明", img: "img/st/qingdeng.webp", el: "mu",   fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "lamp", animCol: [120, 255, 200],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "hanchao",  name: "摄魂寒潮", img: "img/st/hanchao.webp", el: "shui", fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "vortex", animCol: [170, 230, 255],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "zhuque",   name: "朱雀涅槃", img: "img/st/zhuque.webp", el: "huo",  fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "bird",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "zhenyue",  name: "神庭镇岳", img: "img/st/zhenyue.webp", el: "tu",   fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "mountain",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "luocha",   name: "罗刹惊雷", img: "img/st/luocha.webp", el: "lei",  fx: { t: "buff", k: "res", p: 30, r: 10 }, anim: "rain", animN: 6, animCol: [255, 70, 90],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "xingyun",  name: "星陨金芒", img: "img/st/xingyun.webp", el: "jin",  fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "rain", animShape: "star", animN: 10,
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "wanhua",   name: "万化归一", img: "img/st/wanhua.webp", el: "mu",   fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "vortex",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "minghe",   name: "冥河引渡", img: "img/st/minghe.webp", el: "shui", fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "wave", animCol: [60, 150, 150],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "dari",     name: "大日焚世", img: "img/st/dari.webp", el: "huo",  fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "sun",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "shihun",   name: "噬魂葬土", img: "img/st/shihun.webp", el: "tu",   fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "ground",
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
      { id: "leiji",    name: "大日雷殛", img: "img/st/leiji.webp", el: "lei",  fx: { t: "deb", k: "res", p: 30, r: 10 }, anim: "sun", animShape: "bolt", animCol: [255, 220, 120],
        up: { frag: 360, fragAdd: 0, stone: 1000000, stoneAdd: 0 } },
    ],
  },
  // 宗门秘境：好感度达到 FAV_REQ 才能进，每次进入消耗 FAV_COST 好感度，每天 DAILY 次，走 TIME 步；怪物 = 宗门所在地图北域
  //   每次走完的总量（随机分到各怪物步，[最少, 最多]）：FRAG_N 本宗神通碎片（放背包）、HERB_N 药材、ORE_N 矿石（宗门所在地图的表）、STONE 灵石
  MJ: {
    FAV_REQ: 1200, FAV_COST: 20, DAILY: 1, TIME: 100, MONSTERS: 12, ELITES: 5, BOSS: 1, HERB: 0, ORE: 0,
    FRAG_N: [30, 60], HERB_N: [50, 100], ORE_N: [50, 100], STONE: [10000, 30000],
  },
  // 炼丹房：用本宗好感度兑换丹药，兑换后直接服用；每颗固定 +VAL 对应属性，每种最多服 MAX 颗（所有宗门合计），每颗 FAV 好感度
  //   k：hp 生命 atk 攻击 def 防御 mana 法力 hit 命中 dodge 闪避 speed 速度 res_属性 该系抗性
  DAN: { FAV: 120, VAL: 100, MAX: 100, LIST: [
    { k: "hp", name: "玄元丹" }, { k: "atk", name: "破军丹" }, { k: "def", name: "金刚丹" }, { k: "mana", name: "蕴灵丹" },
    { k: "hit", name: "鹰瞳丹" }, { k: "dodge", name: "幻影丹" }, { k: "speed", name: "疾风丹" },
    { k: "res_jin", name: "庚金护心丹" }, { k: "res_mu", name: "乙木护心丹" }, { k: "res_shui", name: "癸水护心丹" },
    { k: "res_huo", name: "丙火护心丹" }, { k: "res_tu", name: "戊土护心丹" }, { k: "res_lei", name: "紫雷护心丹" },
  ] },   // 图片：img/ysdan/<k>.webp
  PLACES: [
    { id: "hall",  name: "宗门大殿", x: 55, y: 21 },
    { id: "dan",   name: "炼丹房",   x: 25, y: 39 },
    { id: "qi",    name: "炼器室",   x: 78, y: 41 },
    { id: "gf",    name: "功法阁",   x: 70, y: 56 },
    { id: "shiwu", name: "事务堂",   x: 28, y: 71 },
    { id: "mj",    name: "宗门秘境", x: 70, y: 87 },
  ],
};
