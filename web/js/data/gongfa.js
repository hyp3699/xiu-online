/* =====================================================================
 * 数据：功法 & 法术
 * ---------------------------------------------------------------------
 * 【功法】六大类，每类加成一种属性（固定数值，不是百分比）：
 *   心法 → 防御      功诀 → 攻击      真诀 → 生命上限
 *   秘诀 → 修炼速度  身法 → 速度、命中 遁术 → 闪避      法诀 → 法力上限
 *   真经 → 本门派属性的抗性（金木水火土雷之一，v15）
 * 每个门派每类功法若干本（config/gongfa.js 的 BOOKS），效果按 sect.TOTAL 分配
 * 必须学会至少一部秘诀才能修炼。
 *
 * 【法术】每个门派有 金木水火土雷 六系法术，每系一本。
 *   伤害 = 法术攻击 × SPELL_LV_PCT[层]% × 倍率；法力消耗按星级对应境界（config/gongfa.js 的 REF / MANA_*）
 *
 * 【宗门秘法】秘法殿学习，同星级门派共用，1~10 星每星 9 部（config/wudao.js），id "w星级:mf:种类"
 *
 * 【来源类型】功法内部标记来源：sect 宗门功法（功法殿，贡献）、shop 凡界坊市功法（坊市，灵石）、
 *   jshop 仙魔冥神坊市功法（灵石 + 本图贡献）、gd 仙魔冥神功德司功法（功德），后两种见 data/jiegf.js
 *   功法效果 = 宗门 TOTAL 分配 × STAT_STAR × 类型倍率 × 各自 PCT%（config/gongfa.js）
 *
 * 功法、法术都是 12 层：功法殿首次学习消耗贡献，等 LEARN_MIN 分钟后学会第 1 层；
 * 之后在“功法”页修炼升层：需要时间（见 studyMin），修炼期间每 5 秒消耗一次灵气；
 * 可排队，队列最多 GF_QUEUE 个。
 * ===================================================================== */

const _GF = CFG.gongfa;
// 名字在 config/names.js（gfType / gfSource / element / gfWords / spellSuffix / shopGf / towerGf / mifa / mifaStar）
const _NM = CFG.names;

// 功法类别：stat = 加成的属性（数值见 config/gongfa.js 的 base）
DATA.gongfaTypes = [
  { id: "xinfa",    name: "心法", suffix: "心法", stat: "def",       label: "防御" },
  { id: "gongjue",  name: "功诀", suffix: "诀",   stat: "atk",       label: "攻击" },
  { id: "zhenjing", name: "真诀", suffix: "真诀", stat: "hp",        label: "生命上限" },
  { id: "mijue",    name: "秘诀", suffix: "秘诀", stat: "cultivate", label: "修炼速度" },
  { id: "shenfa",   name: "身法", suffix: "身法", stat: "hit",       label: "命中", catLabel: "命中、速度" },   // v240：身法拆成两本：这本只加命中（id 不变，已学的自动去掉速度）
  { id: "dunshu",   name: "遁术", suffix: "遁术", stat: "dodge",     label: "闪避" },
  { id: "fajue",    name: "法诀", suffix: "法诀", stat: "mana",      label: "法力上限" },
  { id: "zhenjue",  name: "真经", suffix: "真经", stat: "res",       label: "抗性" }, // 抗性属性 = 来源属性
  { id: "tijue",    name: "炼体秘诀", suffix: "炼体诀", stat: "body", label: "肉身修炼速度", sectOnly: true }, // 修炼肉身的前提；只在宗门功法殿学习
];

DATA.gongfaTypes.forEach(t => { const n = (_NM.gfType || {})[t.id]; if (n) { t.name = DATA.nmPick(n, 0, t.name); t.suffix = DATA.nmPick(n, 1, t.suffix); } });
// v121：宗门每类功法几本（config/gongfa.js 的 BOOKS，只有宗门有）；第 2、3 本是新类别 id「xinfa2」「xinfa3」，排在同类后面，倍率、价格按原类别
//   ni = 原来的序号（起名用，不影响原有功法的名字）
//   功法分阶段（BOOK_STAGE）：fam = 本数按哪一类算（sufa 单独一类），bk = 这一类的第几本；第 4 本起 id「mijue4」…，sufa 第 2 本起「sufa2」…
DATA.GF_STAGE_SRC = ["sect"];   // 分阶段加书的来源（只有宗门）
DATA.GF_NEW_SRC = ["sect", "shop", "jshop", "gd", "tianwai"];   // 按新算法算效果的来源：坊市、功德司、天外天每本 = 宗门同星级每本 × PCT%（跟本数无关）
DATA.gfStage = star => { const n = (_GF.BOOK_STAGE || [1]).length; return Math.max(1, Math.min(n, Math.ceil((star || 1) / (_GF.BOOK_STAGE_STARS || 2)))); };
DATA.gfBookN = (src, star, fam) => {   // 某来源、某星级、某一类有几本
  src = src || "sect"; const b1 = src === "sect" ? (_GF.BOOKS || {})[fam] || 1
    : Math.min(DATA.gfBookMax(fam), ((_GF[src] || {}).BOOKS || {})[fam] || 1);   // 坊市、功德司：config 里 BOOKS 写几本就几本（没写 1 本）
  if (!DATA.GF_STAGE_SRC.includes(src)) return b1;
  return b1 * ((_GF.BOOK_STAGE || [1])[DATA.gfStage(star) - 1] || 1);
};
DATA.gfBookMax = fam => Math.max(((_GF.BOOKS || {})[fam] || 1) * Math.max(1, ...(_GF.BOOK_STAGE || [1])), ...["jshop", "gd"].map(k => (((_GF[k] || {}).BOOKS || {})[fam]) || 1));   // 四界坊市、功德司真经 6 本也算进来
DATA.gongfaTypes = DATA.gongfaTypes.flatMap((t, i) => { t.ni = i; t.fam = t.id; t.bk = 1; const r = [t];
  for (let b = 2; b <= DATA.gfBookMax(t.id); b++) r.push(Object.assign({}, t, { id: t.id + b, base: t.id, book: b, bk: b }));
  if (t.id === "shenfa") { const sf = Object.assign({}, t, { id: "sufa", base: "shenfa", book: 2, allSrc: true, stat: "speed", label: "速度", catLabel: undefined, fam: "sufa", bk: 1 });   // v240：另一本身法只加速度（同属身法类，宗门、坊市、功德司都有）
    r.push(sf); for (let b = 2; b <= DATA.gfBookMax("sufa"); b++) r.push(Object.assign({}, sf, { id: "sufa" + b, allSrc: false, bk: b })); }
  return r; });
// 某来源、某星级有哪些功法类别（星级不写 = 第 1 阶段）
DATA.gfTypesOf = (src, star) => DATA.gongfaTypes.filter(t => t.bk <= DATA.gfBookN(src, star, t.fam));
DATA.gfTypeKey = id => { const t = DATA.gongfaTypes.find(x => x.id === id); return t && t.base || id; };   // 倍率、价格表用的类别 id

/* 功法来源类型（内部标记）：sect 宗门功法、shop 凡界坊市功法；以后加新类型在这里加一行 + config 加一组 */
// 效果 = 宗门功法 × PCT%（凡界坊市、仙魔冥神坊市、功德司用）
//   GF_K = 功法效果倍率（宗门 = 1），EFFECT_PCT = 法术伤害倍率
DATA.gfDerive = P => { const S = _GF.sect, k = (P === undefined ? 100 : P) / 100;
  return Object.assign({}, S, { GF_K: k, EFFECT_PCT: (S.EFFECT_PCT === undefined ? 1 : S.EFFECT_PCT) * k }); };
DATA.gfSources = {
  sect: { name: "宗门", cfg: () => _GF.sect },
  shop: { name: "坊市", cfg: () => DATA.gfDerive(_GF.shop.PCT) },
  jshop: { name: "坊市", cfg: () => DATA.gfDerive((_GF.jshop || {}).PCT) },
  gd: { name: "功德司", cfg: () => DATA.gfDerive((_GF.gd || {}).PCT) },
  tower: { name: "试炼塔", cfg: () => Object.assign({}, _GF.sect, { learn: 0 }) },   // 试炼塔秘诀：效果 = 每本 mult（config/sect.js 的 trial.MIJUE）
  tianwai: { name: "天外天", cfg: () => DATA.gfDerive((_GF.tianwai || {}).PCT) },   // v106：天外天 11、12 星（暂未开放获取）
  cc: { name: "宗门传承", cfg: () => { const C = CFG.sect.chuancheng || {}, S = _GF.sect;   // v213 宗门传承：宗门同星级 × PCT%，学习贡献 × LEARN
    return Object.assign(DATA.gfDerive(C.PCT), { EFFECT_LEARN: (S.EFFECT_LEARN === undefined ? 1 : S.EFFECT_LEARN) * (C.LEARN || 1) }); } },
};
/* v213 功法六大类（显示用；名字在 config/names.js 的 gfCat）：来源类型 → 大类 */
DATA.GF_CAT_OF = { sect: "sect", shop: "shop", jshop: "shop", gd: "gd", tower: "tower", wdroom: "wd", cc: "cc", tianwai: "tianwai" };
DATA.GF_CATS = { sect: "宗门功法", shop: "坊市功法", gd: "功德司功法", tower: "试炼塔功法", wd: "悟道功法", cc: "宗门传承功法", tianwai: "天外天功法" };
for (const k in DATA.GF_CATS) DATA.GF_CATS[k] = DATA.nmPick(_NM.gfCat, k, DATA.GF_CATS[k]);
DATA.gfCat = g => g && g.kind !== "mf" && g.src ? DATA.GF_CAT_OF[g.src] || "" : "";   // 秘法、开局功法不算
DATA.gfCatName = g => DATA.GF_CATS[DATA.gfCat(g)] || "";

for (const k in DATA.gfSources) DATA.gfSources[k].name = DATA.nmPick(_NM.gfSource, k, DATA.gfSources[k].name);

/* 六种属性（起名用词在 config/names.js 的 gfWords，按星级分档） */
DATA.elements = [
  { id: "jin",  name: "金" }, { id: "mu", name: "木" }, { id: "shui", name: "水" },
  { id: "huo",  name: "火" }, { id: "tu", name: "土" }, { id: "lei",  name: "雷" },
];
DATA.elements.forEach(e => { e.name = DATA.nmPick(_NM.element, e.id, e.name); });
DATA.elById = Object.fromEntries(DATA.elements.map(e => [e.id, e]));
// 某星级用哪一档起名词：键 = 档的起始星级，取 ≤ star 的最大一档
DATA.gfWordsOf = star => { const W = _NM.gfWords || {}; let k = null; for (const x of Object.keys(W)) if (+x <= (star || 1) && (k === null || +x > +k)) k = x; return W[k === null ? Object.keys(W)[0] : k] || {}; };
DATA.spellSuffix = typeof _NM.spellSuffix === "string" ? _NM.spellSuffix : "术";   // 法术后缀兜底
// 法术后缀：只用 config/names.js spellSuffixes 里按系分的那组（术、印、诀、剑、雷、火），
// 剑限金系、雷限雷系、火限火系，其它系的组里根本没有这三个后缀；同门派同系法术固定不变。
// 印、诀的格式特殊：返回的是完整名字尾部「一字 + 属性 + 后缀」，调用方不要再在前面加词。
DATA.spellSuffixOf = (sect, el, word) => {
  const list = (_NM.spellSuffixes || {})[el.id] || [DATA.spellSuffix];
  let sh = 0; for (const c of sect.id + ":" + el.id) sh = (sh + c.charCodeAt(0)) % list.length;
  let suffix = list[sh];
  // 系后缀不能跟词尾重复：词以雷结尾就不能再出雷，以火结尾就不能再出火，退回术
  if ((suffix === "雷" || suffix === "火") && word && word.endsWith(suffix)) suffix = "术";
  return suffix;
};

// 同一门派、同一类型固定的随机词表：按门派 id + 类型洗牌（结果每次都一样）。
// 每类功法用自己在 config/names.js gfTypeWords 里的一组词，不再所有类型共用一个词表：
// 心法只从心法组出，秘诀只从秘诀组出（养元只在秘诀组），法术单独走本属性词（见 spellName）。
// 没写进 gfTypeWords 的类型，退回旧的本属性词 + 通用词，保证不改名就不断。
DATA._words = {};
DATA.gfTypeWordsOf = (star, typeKey) => { const T = (_NM.gfTypeWords || {})[typeKey] || {}; let k = null; for (const x of Object.keys(T)) if (+x <= (star || 1) && (k === null || +x > +k)) k = x; return T[k === null ? Object.keys(T)[0] : k] || []; };
DATA.sectWords = (sect, typeKey) => {
  const key = sect.id + ":" + (typeKey || "");
  if (DATA._words[key]) return DATA._words[key];
  let list;
  if (typeKey && (_NM.gfTypeWords || {})[typeKey]) list = [...DATA.gfTypeWordsOf(sect.star, typeKey)];
  else { const W = DATA.gfWordsOf(sect.star); list = [...(W[sect.el] || W.jin || []), ...(W.common || [])]; }
  list = list.filter(w => w !== sect.prefix);
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let i = list.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return (DATA._words[key] = list);
};
// 功法名：门派前缀 + 随机词 + 类别后缀（每个类别 / 第几本用不同的词）
DATA.gfCn = n => { const d = "零一二三四五六七八九"; return n < 10 ? d[n] : n < 20 ? "十" + (n % 10 ? d[n % 10] : "") : d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : ""); };
DATA.gongfaName = (sect, type) => {
  if (sect.src === "yl" && DATA.ylGfName) return DATA.ylGfName(sect, type);   // 游历功法（data/youli.js）
  if (sect.src === "ys" && DATA.ysGfName) return DATA.ysGfName(sect, type);   // 隐世宗门功法（data/yinshi.js）
  if (sect.src === "cc") { const C = CFG.sect.chuancheng; return sect.name + C.WORD + (C.NAME[type.id] || type.suffix); }   // 宗门传承
  if (sect.src === "wdroom") return `${CFG.wudaoRoom.xiulian.NAME[type.id] || type.suffix}·第${DATA.cnNum(sect.juan)}卷`;   // 悟道室秘诀
  if (sect.book) return `${sect.prefix}${type.suffix}·第${sect.book}卷`;   // 试炼塔秘诀
  if (sect.plain && type.fam === "zhenjue") return sect.prefix + (DATA.elById[(sect.els || {})[type.id]] || {}).name + type.suffix;   // 四界真经 6 本：地图名 + 属性 + 真经（梵度天火真经）
  // 分阶段多出来的书：也用随机词起名（跳过同类原有书已用的词，同类不重名；宗门原来就有的第 2、3 本不变）
  const isSect = (sect.src || "sect") === "sect", bOf = f => isSect ? (_GF.BOOKS || {})[f] || 1 : 1;
  const nb = bOf(type.fam), old = !type.bk || type.bk <= nb || ["cc", "wdroom", "tianwai"].includes(sect.src);
  if (!old) {
    const w = DATA.sectWords(sect, type.fam || type.id), used = new Set(), extra = [];
    for (const t of DATA.gongfaTypes) if ((t.fam || t.id) === (type.fam || type.id)) {   // 同类（同词组）一起排，保证不重名
      const tb = bOf(t.fam || t.id);
      if (!t.bk || t.bk <= tb) used.add((t.ni * 4 + (t.book ? t.book - 1 : 0)) % w.length); else extra.push(t.id);
    }
    let k = extra.indexOf(type.id) + 1, i = (type.ni * 7 + 3) % w.length;
    for (let n = 0; n < w.length * 2; n++, i = (i + 1) % w.length) { if (used.has(i)) continue; if (--k <= 0) break; }
    return sect.prefix + w[i] + type.suffix;
  }
  if (sect.plain) return sect.prefix + DATA.nmPick(_NM.jieGfSuffix, type.id, type.suffix);   // 仙魔冥神坊市、功德司：地图名 + 后缀（config/names.js 的 jieGfSuffix）
  const w = DATA.sectWords(sect, type.fam || type.id);
  return sect.prefix + w[(type.ni * 4 + (type.book ? type.book - 1 : 0)) % w.length] + type.suffix;   // 第 2、3 本用同类别后面的词
};
// 法术名：门派前缀 + 本属性词 + 后缀，不再从通用词里抽（养元、清心、吐纳这类修炼词不会再变成法术名，
// 如火系法术只从火系词里出：青阳烈焰术、青阳焚天术，而不是青阳养元术）
DATA.spellName = (sect, el) => {
  if (sect.src === "cc") return sect.name + CFG.sect.chuancheng.WORD + CFG.sect.chuancheng.SPELL;   // 宗门传承法术
  const W = DATA.gfWordsOf(sect.star), key = sect.id + ":spell:" + el.id;
  if (!DATA._words[key]) {
    const list = [...(W[el.id] || W.jin || [])].filter(w => w !== sect.prefix);
    let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    for (let i = list.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [list[i], list[j]] = [list[j], list[i]]; }
    DATA._words[key] = list;
  }
  const w = DATA._words[key], word = w[0] || "", suffix = DATA.spellSuffixOf(sect, el, word);
  if (suffix === "印" || suffix === "诀") {
    // 印、诀：一字 + 属性 + 后缀，如火系青阳*火印、水系青阳*水印；* 取词里不是属性字的那个字
    const elChar = el.name || "";
    const one = word && elChar && word[0] === elChar ? (word[1] || word[0]) : (word[0] || "");
    return sect.prefix + one + elChar + suffix;
  }
  return sect.prefix + word + suffix;
};
DATA.GONGFA_MAX = _GF.MAX;
DATA.GF_QUEUE = _GF.QUEUE;
DATA.STUDY_STEP = _GF.STUDY_STEP;
DATA.studyMin = _GF.STUDY_MIN;

/* ---------- 凡界坊市功法的「来源」（相当于一个门派，1~5 星，每星 6 个 = 金木水火土雷各一个，id f星级_序号） ---------- */
DATA.SHOP_GF_PREFIX = [["青冥", "云笈", "丹霞", "太微", "云岫", "松鹤"], ["琼华", "栖霞", "青萍", "鹤鸣", "灵枢", "素问"], ["抱朴", "听松", "霁月", "揽星", "停云", "观澜"],
  ["凌虚", "洞玄", "归云", "栖梧", "白鹿", "青牛"], ["玄真", "星槎", "紫芝", "玉衡", "天枢", "摇光"]];
DATA.shopSources = [];
DATA.SHOP_GF_PREFIX.forEach((pair, i) => pair.forEach((prefix, n) => {
  const star = i + 1;
  const id = `f${star}_${n}`; prefix = DATA.nmPick(_NM.shopGf, id, prefix);
  DATA.shopSources.push({ id, src: "shop", star, prefix, name: prefix + DATA.nmPick(_NM, "shopGfSuffix", "传承"), el: DATA.elements[(star * 2 + n) % 6].id,
    reqRealm: DATA.sectReq(star) });   // 境界要求 = 同星级门派
}));
/* ---------- v25：试炼塔秘诀的「来源」（每星一个，id t星级，只有秘诀） ---------- */
DATA.TOWER_GF_PREFIX = ["问心", "登仙", "通玄", "摘星", "揽月", "踏虚", "擎天", "证道", "归真", "登极"];
DATA.towerSources = DATA.TOWER_GF_PREFIX.map((p0, i) => DATA.nmPick(_NM.towerGf, `t${i + 1}`, p0)).map((prefix, i) => ({ id: `t${i + 1}`, src: "tower", star: i + 1, prefix, name: prefix + DATA.nmPick(_NM, "towerGfSuffix", "塔"), el: DATA.elements[i % 6].id, reqRealm: -1 }));
// v223 试炼塔秘诀（只有修炼秘诀）：按 config/sect.js 的 trial.MIJUE 在指定层给，每本一个来源 t星级_f层数，效果 = 宗门同星级秘诀（平均）× 该本 %
//   每 EVERY 层给一本（给戒指、戒指图纸的那几层除外，最后一层除外）效果 PCT %；最后一层 LAST %（0 = 不给）
DATA.towerBookFloors = star => {
  const T = (CFG.sect || {}).trial || {}, M = T.MIJUE || {}, i = star - 1, max = DATA.towerMax(star), E = T.EVERY || 10;
  const ev = (M.EVERY || [])[i] || 0, pct = (M.PCT || [])[i] || 0, last = (M.LAST || [])[i] || 0, r = (T.RING || [])[i], ringN = r !== undefined && r >= 0 ? 10 : 0, out = [];
  if (ev > 0 && pct > 0) for (let f = ev; f < max; f += ev) if (!(f % E === 0 && f / E <= ringN)) out.push({ f, pct });
  if (last > 0) out.push({ f: max, pct: last });
  return out;
};
DATA.towerBookCount = star => DATA.towerBookFloors(star).length;
DATA.TOWER_TYPES = ["mijue"];   // 试炼塔给的秘诀种类（v223 只给修炼秘诀）
DATA.towerBooks = [];
DATA.towerSources.forEach(src => DATA.towerBookFloors(src.star).forEach((x, k) =>
  DATA.towerBooks.push({ id: `${src.id}_f${x.f}`, src: "tower", star: src.star, prefix: src.prefix, name: src.name, el: src.el, reqRealm: -1, book: k + 1, floor: x.f, mult: x.pct / 100 })));
DATA.towerBookAt = (star, f) => { const b = DATA.towerBooks.find(x => x.star === star && x.floor === f); return b ? `${b.id}:mijue` : null; };
/* ---------- v106：天外天功法、法术的「来源」（11 ~ 15 星，每星 6 个 = 金木水火土雷各一个，id tw星级_序号；暂未开放获取） ---------- */
DATA.TW_GF_PREFIX = [["太初", "太始", "太素", "太易", "元始", "灵宝"], ["无极", "无量", "无上", "无始", "无终", "无相"],
  ["鸿蒙", "混元", "玄黄", "开天", "造化", "归墟"], ["混沌", "太虚", "大罗", "周天", "万象", "轮回"], ["道源", "道玄", "道极", "道衍", "道真", "道一"]];   // 11 ~ 15 星
DATA.twSources = [];
DATA.TW_GF_PREFIX.forEach((list, i) => list.forEach((prefix, n) => {
  const star = 11 + i, id = `tw${star}_${n}`; prefix = DATA.nmPick(_NM.twGf, id, prefix);
  DATA.twSources.push({ id, src: "tianwai", star, prefix, name: prefix + DATA.nmPick(_NM, "shopGfSuffix", "传承"), el: DATA.elements[n].id,
    reqRealm: ((_GF.tianwai || {}).REQ || [20, 22, 24, 26, 28])[i] });
}));
/* ---------- v213：宗门传承的「来源」（每个门派一个，id cc_门派id；只有本门派宗主能领悟） ---------- */
DATA.ccSources = DATA.sects.map(x => ({ id: "cc_" + x.id, src: "cc", sectId: x.id, star: x.star, prefix: x.prefix, name: x.name, el: x.el, reqRealm: x.reqRealm }));
DATA.ccSrcOf = sectId => DATA.gfSrcById["cc_" + sectId];
// 某门派全部传承功法 id：功法 + 一本本属性法术
DATA.ccIds = sectId => { const o = DATA.ccSrcOf(sectId); return o ? [...(CFG.sect.chuancheng.TYPES || []).map(t => DATA.gongfaId(o.id, t)), DATA.spellId(o.id, o.el)] : []; };
// 所有来源：门派（src = "sect"）+ 坊市 + 试炼塔 + 天外天
DATA.gfSrcById = Object.assign({}, ...DATA.sects.map(x => ({ [x.id]: x })), ...DATA.shopSources.map(x => ({ [x.id]: x })), ...DATA.twSources.map(x => ({ [x.id]: x })), ...DATA.towerSources.map(x => ({ [x.id]: x })), ...DATA.towerBooks.map(x => ({ [x.id]: x })), ...DATA.ccSources.map(x => ({ [x.id]: x })));
DATA.gfSrc = sid => DATA.gfSrcById[sid] || (DATA.wdSrc ? DATA.wdSrc(sid) : null);   // 悟道室秘诀的来源现算（modules/wudaoshi.js）
DATA.srcType = o => o.src || "sect";
DATA.srcCfg = o => DATA.gfSources[DATA.srcType(o)].cfg();

/* 功法效果：按 sect.TOTAL 分配（gfCalc）；学习价格另算（gfLearnCost）
 *   o 来源、typeId 类别 id、key = TOTAL 里的属性 */
// v121：战斗属性每单位（sect.TOTAL ÷ 1~10 星全部宗门功法练满的 STAT_STAR 合计）
DATA._gfUnit = {};
//   分阶段：每星每个宗门这一属性的本数按 gfBookN 算（各阶段书越多，每本越少，总数不变）
DATA.gfUnit = key => {
  if (DATA._gfUnit[key] !== undefined) return DATA._gfUnit[key];
  const S = _GF.sect, fams = DATA.gongfaTypes.filter(t => t.bk === 1 && (t.stat === key || t.stat2 === key)).map(t => t.fam);
  let d = 0; for (let st = 1; st <= 10; st++) { let nb = 0; for (const f of fams) nb += DATA.gfBookN("sect", st, f); d += (S.STAT_STAR[st - 1] || 0) * DATA.sects.filter(x => x.star === st).length * nb; }
  return DATA._gfUnit[key] = d ? ((S.TOTAL || {})[key] || 0) / (d * DATA.lvMul(_GF.MAX)) : 0;
};
// 旧算法（宗门传承、悟道室、试炼塔秘诀、天外天用，不受分阶段影响）：宗门每类按 BOOKS 本、STAT_STAR_OTHER
DATA._gfUnitOld = {};
DATA.gfUnitOld = key => {
  if (DATA._gfUnitOld[key] !== undefined) return DATA._gfUnitOld[key];
  const S = _GF.sect, SS = S.STAT_STAR_OTHER || S.STAT_STAR, nT = DATA.gongfaTypes.filter(t => (t.stat === key || t.stat2 === key) && t.bk <= ((_GF.BOOKS || {})[t.fam] || 1)).length;
  let d = 0; for (let st = 1; st <= 10; st++) d += (SS[st - 1] || 0) * DATA.sects.filter(x => x.star === st).length;
  return DATA._gfUnitOld[key] = d && nT ? ((S.TOTAL || {})[key] || 0) / (d * nT * DATA.lvMul(_GF.MAX)) : 0;
};
// 每本功法固定的随机倍率 1 ± RAND
DATA.gfRand = id => { const R = _GF.sect.RAND || 0; let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return 1 + R * ((h % 20001) / 10000 - 1); };
DATA.gfCalc = (o, typeId, key) => {
  const C = DATA.srcCfg(o), tm = (C.TYPE_MULT || {})[DATA.gfTypeKey(typeId)];
  if (!C.TOTAL || C.TOTAL[key] === undefined || typeId === "spell") return 0;   // v121：只按 TOTAL 分配（v125 起秘诀、炼体秘诀也是）
  const ek = o.floor ? 1 : C.GF_K === undefined ? 1 : C.GF_K;   // v223 新版试炼塔秘诀：只看每本 mult   // 坊市 / 功德司 = 宗门 × PCT%
  const nw = DATA.GF_NEW_SRC.includes(DATA.srcType(o)) && !o.floor;   // 宗门、坊市、功德司按新算法（宗门每本 × PCT%）；其他按旧算法
  return (nw ? DATA.gfUnit(key) : DATA.gfUnitOld(key)) * ((nw ? C.STAT_STAR : C.STAT_STAR_OTHER || C.STAT_STAR)[o.star - 1] || 0) * (tm === undefined ? 1 : tm) * ek * (o.mult || DATA.gfRand((o.src === "cc" ? o.sectId : o.id) + ":" + typeId));   // 宗门传承：随机倍率同本门同类功法 → 正好 PCT%   // 悟道秘诀：固定倍率 o.mult
};

// 层数倍率：第 lv 层效果 = 每层效果 × LV_MULT[lv-1]（没写就是 lv）
DATA.lvMul = lv => { const m = (_GF.LV_MULT || [])[lv - 1]; return m === undefined ? lv : m; };
// 修炼：每 5 秒消耗灵气 = STUDY_RATE × STUDY_STAR[星级-1] × STUDY_LING（不乘层数；开局功法书 = STUDY_PER × STUDY_LING）
DATA.studyPer = info => { const v = (x, d) => x === undefined ? d : x, M = v(_GF.STUDY_LING, 1);
  const base = info.per ? info.per : Math.max(1, Math.floor(v(_GF.STUDY_RATE, 5) * v((_GF.STUDY_STAR || [])[info.star - 1], info.star)));
  const L = v((_GF.STUDY_LV || [])[(info.lv || 1) - 1], 1);   // v248 每层单独倍率
  return Math.max(1, Math.round(base * M * L)); };
// 四界坊市 / 功德司功法价格：仙冥魔用 KEY[星级-6]，神界新 11、12 星用 SHEN_KEY[星级-11]（config/gongfa.js 的 jshop / gd）
// 坊市灵石价格：出身「商贾之家」打折（凡界坊市 + 四界坊市；功德司、宗门不打折）
DATA.shopPrice = v => { const g = typeof G !== "undefined" && G.s && G.oriSum ? G.oriSum("shopCut") : 0; return g > 0 && v > 0 ? Math.max(1, Math.ceil(v * Math.max(0, 1 - g / 100))) : v; };
DATA.jiePrice = (o, key) => { const J = _GF[o.src] || {}; return (o.nw ? (J["SHEN_" + key] || [])[o.star - 11] : (J[key] || [])[o.star - 6]) || 0; };
// 学习所需：宗门 = 贡献，坊市 = 灵石
DATA.gfLearnCost = (o, typeId) => {
  if (DATA.srcType(o) !== "shop") {   // 宗门学习贡献单独设置：learn × LEARN_TYPE × LEARN_STAR × EFFECT_LEARN（不用效果倍率）
    const C = DATA.srcCfg(o), v = (x, d = 1) => x === undefined ? d : x;
    if (o.src === "jshop" || o.src === "gd") { const t = v(((_GF[o.src] || {}).TYPE || {})[DATA.gfTypeKey(typeId)]);   // 仙魔冥 / 神界价格分开（DATA.jiePrice）
      const c = Math.floor(DATA.jiePrice(o, o.src === "gd" ? "MERIT" : "STONE") * t); return o.src === "jshop" ? DATA.shopPrice(c) : c; }
    return Math.floor(v(C.learn, 0) * v((C.LEARN_TYPE || {})[DATA.gfTypeKey(typeId)]) * v((C.LEARN_STAR || [])[o.star - 1]) * v(C.EFFECT_LEARN));
  }
  // 坊市售价单独设置：price × PRICE_TYPE × PRICE_STAR × EFFECT_PRICE
  const C = _GF.shop, v = (x, d = 1) => x === undefined ? d : x;
  return DATA.shopPrice(Math.floor(v(C.price, 0) * v((C.PRICE_TYPE || {})[DATA.gfTypeKey(typeId)]) * v((C.PRICE_STAR || [])[o.star - 1]) * v(C.EFFECT_PRICE)));
};

/* ---------- 功法 ----------
 * id 规则："来源id:类别id"，例如 "s1_0:mijue"（门派）、"f1_0:mijue"（坊市） */
DATA.gongfaId = (sectId, typeId) => `${sectId}:${typeId}`;
// 学习功法 / 法术需要的时间（分钟），按星级
DATA.gfLearnMin = star => { const a = _GF.LEARN_MIN || []; return a[Math.max(0, Math.min(a.length - 1, (star || 1) - 1))] || 0; };
// 开局功法书（config/start.js 的 book）：id "start:mijue"，无属性，层数上限 MAX
DATA.START_GF = "start:mijue";
DATA.startGfInfo = (lv = 1) => {
  const B = CFG.start.book || {}, type = DATA.gongfaTypes.find(x => x.id === "mijue"), sp = B.SPEED || 0;
  return { kind: "gf", id: DATA.START_GF, src: "start", star: 0, type, lv, noEl: true, el: { id: "", name: "" },
    max: B.MAX || 1, studyMin: B.STUDY_MIN || [], per: B.STUDY_PER || 1,
    label: type.label, name: B.name || "练气诀", value: sp * lv, next: sp * (lv + 1), perLv: sp, cost: 0 };
};
DATA.gongfaInfo = (id, lv = 1) => {
  if (id === DATA.START_GF) return DATA.startGfInfo(lv);
  const p = id.split(":"), sect = DATA.gfSrc(p[0]), type = DATA.gongfaTypes.find(x => x.id === p[1]);
  if (p.length !== 2 || !sect || !type || type.bk > DATA.gfBookN(sect.src, sect.star, type.fam)) return null;
  const per = DATA.gfCalc(sect, type.id, type.stat), per2 = type.stat2 ? DATA.gfCalc(sect, type.id, type.stat2) : 0;
  const el = DATA.elById[(sect.els || {})[type.id] || sect.el];   // 仙魔冥神坊市、功德司：每本单独的属性
  const J = sect.src === "jshop" ? _GF.jshop || {} : null;
  return {
    kind: "gf", id, sect, src: DATA.srcType(sect), star: sect.star, type, lv, el,
    label: type.stat === "res" ? el.name + "抗性" : type.label, // 显示用：真经写成「火抗性」等
    gx: J ? Math.floor(DATA.jiePrice(sect, "GX") * (((J.TYPE || {})[DATA.gfTypeKey(type.id)]) === undefined ? 1 : J.TYPE[DATA.gfTypeKey(type.id)])) : 0,   // 仙魔冥神坊市：还要本图贡献
    name: DATA.gongfaName(sect, type),
    value: per * DATA.lvMul(lv),                  // 当前加成（固定数值）
    next: per * DATA.lvMul(lv + 1),               // 下一层的加成
    perLv: per,                                   // 每层加成
    label2: type.label2, value2: per2 * DATA.lvMul(lv), next2: per2 * DATA.lvMul(lv + 1), perLv2: per2,   // 第二项属性（身法的命中）
    cost: DATA.gfLearnCost(sect, type.id),  // 首次学习：宗门 = 贡献，坊市 = 灵石，功德司 = 功德
  };
};

/* ---------- 法术 ----------
 * id 规则："来源id:sp:系id"，例如 "s1_0:sp:huo" */
DATA.spellId = (sectId, elId) => `${sectId}:sp:${elId}`;
DATA.isSpell = id => id.split(":")[1] === "sp";
DATA.spellInfo = (id, lv = 1, own) => {
  const p = id.split(":"), sect = DATA.gfSrcById[p[0]], el = DATA.elements.find(x => x.id === p[2]);
  if (p.length !== 3 || !sect || !el) return null;
  const C = DATA.srcCfg(sect), v = (x, d = 1) => x === undefined ? d : x, tm = v((C.TYPE_MULT || {}).spell);
  const LP = _GF.SPELL_LV_PCT || [100], lp = n => v(LP[n - 1], LP[LP.length - 1]);
  return {
    kind: "sp", id, sect, src: DATA.srcType(sect), star: sect.star, el, lv,
    name: DATA.spellName(sect, el),
    // 法术攻击 = 自己修为 + 肉身攻击（不超过该星级对应境界的）+ 功法攻击（own 不写 = 玩家自己的）；伤害 = 法术攻击 × pct% × mul（mul = SPELL_MUL × 来源倍率，不显示）
    uses: (U0 => v(U0[lv - 1], U0[U0.length - 1]))(_GF.SPELL_USES || [99]),   // v152 每场战斗最多施展几次
    atk: DATA.capAtk(DATA.spellRef(sect.star).atk, own), pct: lp(lv), next: lp(lv + 1), mul: v(_GF.SPELL_MUL) * tm * v(C.EFFECT_PCT),
    // 法力消耗 = 该星级对应境界的修为突破法力（REF）× MANA_PCT% × 灵根倍率（灵根倍率 = 1 + 该系灵根等级 × MANA_LINGEN）
    mana: Math.max(1, Math.round(DATA.spellManaBase(sect.star) * v(_GF.MANA_PCT, 0) / 100
      * (1 + (typeof G !== "undefined" && G.s && G.s.lingen ? G.s.lingen[el.id] || 0 : 0) * v(_GF.MANA_LINGEN, 0))
      * (1 + (Math.max(1, lv) - 1) * v(_GF.MANA_LV, 0))   // 层消耗倍率
      * DATA.manaRealmK(typeof G !== "undefined" && G.s && !G.s.mortal ? G.s.L : 0))),   // 法力境界倍率（config/mobs.js magic.MANA_REALM，按人物当前大境界，与怪物共用）
    cost: DATA.gfLearnCost(sect, "spell"),
    // v239 精研：jy 次数，jyDmg 属性伤害（加在法术伤害上）
    jy: DATA.spellJy(id), jyDmg: DATA.spellJy(id) * DATA.jyStep(sect.star, "JY_DMG"),
    fu: DATA.spellFu(id), fuPct: DATA.fusePct(DATA.spellFu(id)),   // 融合：伤害结果 +%
  };
};
// v239 法术精研：每星的参数（config/gongfa.js 的 JY_DMG / JY_COST），玩家某法术已精研次数
DATA.jyStep = (star, k) => { const A = _GF[k] || [0]; return A[Math.min(Math.max(0, star - 1), A.length - 1)] || 0; };
// 第 n+1 次精研的消耗（n = 已精研次数）：初始 + floor(n / N) × 每段增加
DATA.jyCost = (star, n) => { const U0 = _GF.JY_UP || {}, k = U0.N > 0 ? Math.floor((n || 0) / U0.N) : 0;
  return { xd: DATA.jyStep(star, "JY_COST") + k * (U0.XD || 0), stone: DATA.jyStep(star, "JY_STONE") + k * (U0.STONE || 0) }; };
DATA.spellJy = id => (typeof G !== "undefined" && G.s && G.s.spJy && G.s.spJy[id]) || 0;
// 融合（config/gongfa.js FUSE）：fu = { 星级: 个数 }，返回伤害结果 +%
DATA.fuseCfg = () => Object.assign({ PER_STAR: 5, PCT: [0.5, 0.5, 0.5, 0.7, 0.7, 0.7, 0.9, 0.9, 0.9, 1.15, 1.15, 1.15, 1.5, 1.5], FB_RJ: 5 }, _GF.FUSE || {});
DATA.fusePct = fu => { const P = DATA.fuseCfg().PCT || [0]; let t = 0; for (const k in fu || {}) t += (+fu[k] || 0) * (P[Math.min(+k - 1, P.length - 1)] || 0); return t; };
DATA.fuseTxt = fu => Object.keys(fu || {}).filter(k => fu[k] > 0).sort((a, b) => a - b).map(k => `${k}星×${fu[k]}`).join("、");
DATA.spellFu = id => (typeof G !== "undefined" && G.s && G.s.spFuse && G.s.spFuse[id]) || null;

// 通用：功法、法术或秘法
// 法宝、法术攻击 = min(使用者修为 + 肉身突破的攻击, 上限 cap) + 其余全部攻击（v235：功法、装备、戒指、法宝、丹药、炼体池等都算）
//   own = { br: 修为 + 肉身攻击, gf: 功法攻击 }，不写 = 玩家自己的
DATA.ownAtk = () => {
  if (typeof G === "undefined" || !G.s || !G.gongfaBonus) return { br: 0, gf: 0 };
  const br = DATA.plRealmStat(G.s.mortal ? -1 : G.s.L, "atk") + (G.s.mortal || !G.brRand ? 0 : G.brRand("xw", "atk")) + ((G.bodyBonus ? G.bodyBonus() : {}).atk || 0);
  // v235 上限只管 修为 + 肉身；其余全算（功法、装备、戒指、法宝、丹药、炼体池……）= 人物总攻击 − 修为肉身
  //   属性正在计算中（还没有缓存）时退回只算功法攻击，避免循环
  const st = G._cache && G._cache.stats;
  return { br, gf: st ? Math.max(0, st.atk - br) : G.gongfaBonus().atk };
};
// v165 通用版：k = hp / def …（盾的护盾值、防御用）：min(修为 + 肉身, 参考值) + 功法
DATA.ownStat = k => {
  if (typeof G === "undefined" || !G.s || !G.gongfaBonus) return { br: 0, gf: 0 };
  return { br: DATA.plRealmStat(G.s.mortal ? -1 : G.s.L, k) + (G.s.mortal || !G.brRand || k === "res" ? 0 : G.brRand("xw", k)) + ((G.bodyBonus ? G.bodyBonus() : {})[k] || 0), gf: G.gongfaBonus()[k] || 0 };
};
DATA.capStat = (cap, k) => { const o = DATA.ownStat(k); return o.br || o.gf ? Math.min(o.br, cap) + o.gf : cap; };
DATA.capAtk = (cap, own) => { const o = own || DATA.ownAtk(); return Math.min(o.br, cap) + o.gf; };
// 法术第 star 星对应境界（config/gongfa.js 的 REF）的人物属性：修为突破 + 肉身突破（不算功法），含 manaBr
DATA._spRef = {};
DATA.spellRef = star => DATA._spRef[star] || (DATA._spRef[star] = (() => { const r = (_GF.REF || [])[star - 1] || [2 * star - 1, 10]; return DATA.mobStats([r[0], r[1], 0, [1, 0, 0], [2, 0, 0], [3, 0, 0], 1]); })());
// 法术法力消耗的基数：该星级对应境界的修为突破法力
DATA.spellManaBase = star => DATA.spellRef(star).manaBr;
DATA.skillInfo = (id, lv) => DATA.isSpell(id) ? DATA.spellInfo(id, lv) : DATA.isMifa(id) ? DATA.mifaInfo(id, lv) : DATA.gongfaInfo(id, lv);

/* ---------- 宗门秘法 ----------
 * id 规则："w星级:mf:种类"，例如 "w3:mf:expSpeed"。el 只用来选图片，灵根对秘法无效 */
DATA.mifaKinds = [
  { id: "mpBattle",  name: "斗灵秘法", label: "战斗每步回法力", unit: "点", sign: "+", el: "shui", cfg2: "DOULING" },
  { id: "mpIdle",    name: "养灵秘法", label: "平时法力恢复", unit: "%", sign: "+", el: "shui" },
  { id: "hpBattle",  name: "斗血秘法", label: "战斗每步回血", unit: "点", sign: "+", el: "mu", cfg2: "DOUXUE" },
  { id: "hpIdle",    name: "养血秘法", label: "平时生命恢复", unit: "%", sign: "+", el: "mu" },
  { id: "spStudy",   name: "悟法秘法", label: "法术修炼时间", unit: "%", sign: "-", el: "lei" },
  { id: "gfStudy",   name: "悟道秘法", label: "功法修炼时间", unit: "%", sign: "-", el: "jin" },
  { id: "expSpeed",  name: "聚元秘法", label: "修为修炼速度", unit: "", sign: "+", el: "huo" },
  { id: "bodySpeed", name: "炼体秘法", label: "气血修炼速度", unit: "", sign: "+", el: "tu" },
  { id: "explore",   name: "神行秘法", label: "地图每步", unit: "秒", sign: "-", el: "jin" },
  { id: "danTime",   name: "丹火秘法", label: "炼丹时间", unit: "%", sign: "-", el: "huo" },
  { id: "danRate",   name: "丹心秘法", label: "炼丹成功率", unit: "%", sign: "+", el: "huo" },
  { id: "danExtra",  name: "丹灵秘法", label: "炼丹额外一颗几率", unit: "%", sign: "+", el: "huo" },
  { id: "qiTime",    name: "器火秘法", label: "炼器时间", unit: "%", sign: "-", el: "jin" },
  { id: "qiRate",    name: "器心秘法", label: "炼器成功率", unit: "%", sign: "+", el: "jin" },
  { id: "plantTime", name: "育灵秘法", label: "灵药生长时间", unit: "%", sign: "-", el: "mu" },
  { id: "plantYield",name: "丰灵秘法", label: "灵药收获数量", unit: "%", sign: "+", el: "mu" },
  { id: "lianxing",  name: "连星秘法", label: "连续出手几率", unit: "%", sign: "+", el: "lei", full: true, cfg: "LIANXING" },   // 圆满才生效（config/wudao.js LIANXING）
  { id: "yutian",    name: "御天秘法", label: "致命伤害保命几率", unit: "%", sign: "+", el: "tu", full: true, cfg: "YUTIAN" },
  { id: "pojun",     name: "破军秘法", label: "无视防御几率", unit: "%", sign: "+", el: "jin", full: true, cfg: "POJUN" },
  { id: "xuesha",    name: "血煞秘法", label: "最高伤害提升", unit: "%", sign: "+", el: "huo", full: true, cfg: "XUESHA" },
  { id: "zhenhun",   name: "镇魂秘法", label: "镇魂几率", unit: "%", sign: "+", el: "shui", full: true, cfg: "ZHENHUN" },
  { id: "jinchan",   name: "金蝉秘法", label: "金蝉触发几率", unit: "%", sign: "+", el: "mu", full: true, cfg: "JINCHAN" },
];
DATA.mifaKinds.forEach(k => { k.name = DATA.nmPick(_NM.mifa, k.id, k.name); });
DATA.mifaKindById = Object.fromEntries(DATA.mifaKinds.map(k => [k.id, k]));
DATA.MIFA_PREFIX = ["一元", "两仪", "三才", "四象", "五行", "六合", "七星", "八荒", "九宫", "十方"].map((x, i) => DATA.nmPick(_NM.mifaStar, i + 1, x));
DATA.mifaId = (star, kind) => `w${star}:mf:${kind}`;
// 秘法修到圆满后额外的 %：聚元 / 炼体（修炼速度 %）、斗血 / 斗灵（每步恢复上限 %）
DATA.mifaFullPct = (kind, star) => {
  const W = CFG.wudao, arr = kind === "expSpeed" ? W.JUYUAN_PCT : kind === "bodySpeed" ? W.LIANTI_PCT : kind === "hpBattle" ? (W.DOUXUE || {}).PCT : kind === "mpBattle" ? (W.DOULING || {}).PCT : null;
  return (arr || [])[star - 1] || 0;
};
DATA.mifaFullTxt = (kind, pct) => kind === "hpBattle" ? `每步再回生命上限 ${U.num(pct)}%` : kind === "mpBattle" ? `每步再回法力上限 ${U.num(pct)}%` : `再 +${U.num(pct)}%`;
DATA.isMifa = id => id.split(":")[1] === "mf";
// 秘法灵石倍率（config/wudao.js STONE_KIND，没写 = 1）：首次学习、升层灵石都乘
DATA.mifaStoneK = kind => { const k = ((CFG.wudao.STONE_KIND || {})[kind]); return k === undefined ? 1 : k; };
DATA.mifaLearnCost = (star, kind) => { const W = CFG.wudao, m = (W.STAR_COST || [])[star - 1] || 1; return { stone: Math.round(((W.LEARN_STONES || [])[star - 1] || 0) * DATA.mifaStoneK(kind)), contrib: Math.floor(W.LEARN_CONTRIB * m) }; };
DATA.mifaInfo = (id, lv = 1) => {
  const [w, , kind] = id.split(":"), star = +w.slice(1), K = DATA.mifaKindById[kind], W = CFG.wudao;
  if (!K || !(star >= 1 && star <= 10)) return null;
  const per = K.cfg ? (((W[K.cfg] || {}).STAR || [])[star - 1] || 0) : kind === "explore" && W.SHENXING ? (W.SHENXING[star - 1] || 0) : kind === "gfStudy" && W.WUDAO ? (W.WUDAO[star - 1] || 0) / DATA.lvMul(DATA.GONGFA_MAX) : kind === "spStudy" && W.WUFA ? (W.WUFA[star - 1] || 0) / DATA.lvMul(DATA.GONGFA_MAX) : K.cfg2 && W[K.cfg2] ? ((W[K.cfg2].FLAT || [])[star - 1] || 0) : kind === "danTime" && W.DANHUO ? (W.DANHUO[star - 1] || 0) / DATA.lvMul(DATA.GONGFA_MAX) : kind === "qiTime" && W.QIHUO ? (W.QIHUO[star - 1] || 0) / DATA.lvMul(DATA.GONGFA_MAX) : (W.base[kind] || 0) * ((W.STAR_MULT || [])[star - 1] || 1), max = DATA.GONGFA_MAX;
  // 神行：修到圆满才生效一次（不乘层数）
  const val = l => kind === "explore" || K.full ? (l >= max ? per : 0) : per * DATA.lvMul(l);
  return { kind: "mf", id, star, mk: K, lv, el: DATA.elById[K.el], label: K.label,
    name: `${DATA.MIFA_PREFIX[star - 1] || star + "星"}·${K.name}`, value: val(lv), next: val(lv + 1), perLv: per,
    cost: DATA.mifaLearnCost(star, kind),
    layerStone: Math.round(((W.LAYER_STONE || [])[star - 1] || 0) * DATA.mifaStoneK(kind)) };   // 修炼升一层的灵石（平均分到每 5 秒）
};
