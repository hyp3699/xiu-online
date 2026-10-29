/* ★ 修炼肉身（代码 modules/body.js）。需学会炼体秘诀（config/gongfa.js）；所需气血、突破加属性见 config/realm.js 的 BODY_EXP / BODY_GAIN。
 * T = 要突破到的总层序（第一境界一层 = 0，每境界 10 层）。
 * 修炼速度（每 10 秒）= (BASE_SPEED × SPEED_GROW^人物修为总层序 + 炼体秘诀 + 炼体秘法) × (1 + (炼体圆满% + 道童% + 修炼室%)/100)
 *   耗灵气 = 所得 × LING_RATE − 神魂之道减免。
 * 突破：灵石 = STONE_BASE × STONE_RATE^T；药材按 HERB_SEG 分段，段外境界用 HERBS_XIAN 指数公式。
 * 药材名可写 config/items.js 的药材或 content/items.js 的自定义物品。 */
window.CFG = window.CFG || {};

CFG.body = {
  // 只用数组长度（29 境界，每境界 10 层）；显示名在 config/names.js 的 body
  names: ["淬皮", "炼肉", "锻骨", "易筋", "洗髓", "通脉", "铜皮", "铁骨", "银身", "金身", "玉骨", "琉璃身", "金刚体", "不坏体", "宝体", "紫金体", "玄晶体", "灵体", "星辰体", "圣体", "太古体", "仙体", "万劫体", "神体", "道体", "混沌体", "鸿蒙体", "不灭体", "永恒体"],

  // ---------- 修炼 ----------
  BASE_SPEED: 1,      // 基础速度（肉身修为 / 10 秒）
  SPEED_GROW: 1.12,   // 人物修为每层的速度成长倍率
  LING_RATE: 1,       // 每点肉身修为耗灵气

  // ---------- 突破消耗 ----------
  STONE_BASE: 100, STONE_RATE: 1.2,                   // 灵石 = STONE_BASE × STONE_RATE^T（取整）
  // 药材分段：from~to = 起止境界序号；每种数量 = (base + step × 段内第几层(0 起)) × 倍率，四舍五入至少 1
  // mult："fan" 用 HERB_MULT_FAN，"xian" 用 HERB_MULT_XIAN
  HERB_SEG: [
    { from: 0, to: 8,                                         // 淬皮 ~ 银身
      herbs: ["青灵草", "凝露花", "赤血参", "紫灵芝", "幽冥花", "星辰草"],
      base: 10,
      step: 10,
      mult: "fan" },
    { from: 9, to: 17,                                        // 金身 ~ 仙体
      herbs: ["天元草", "玄霜花", "紫府灵根", "万年雪莲", "星河藤"],
      base: 20,
      step: 20,
      mult: "xian" },
  ],
  HERB_MULT_FAN: 1,   // 凡界药材分段倍率
  HERB_MULT_XIAN: 1,  // 仙界药材分段倍率

  // 分段外（神体及以上）：每种数量 = HERB_XIAN_BASE × HERB_RATE^(T − HERB_FROM × 10)，四舍五入至少 1
  HERB_XIAN_BASE: 1,
  HERB_RATE: 1.03,
  HERB_FROM: 11,      // 计数起点境界序号（11 = 琉璃身）
  HERBS_XIAN: ["九天仙芝", "瑶池玉莲", "彼岸花", "黄泉冥草", "魔血藤", "噬魂魔果"],
};
