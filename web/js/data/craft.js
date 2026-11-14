/* =====================================================================
 * 数据：丹方、炼丹炉/炼器炉、灵田（数值都在 js/config/ 下的数值文件 第八~十一部分）
 * ---------------------------------------------------------------------
 * 材料只有 药材 herb、矿石 ore（各 6 种），背包里按 名字 区分，g 是它在列表里的序号（0~5）。
 * 配方里直接写药材/矿石名字，这里把名字换成 { kind, g, n }。
 * 属性丹在背包里是 { t: "dan", type: "atk", g: 阶, n: 数量 }
 * 修炼速度丹（丹方 speed: true）炼出来是 { t: "pill", type: "juqi", g: 境界品质 }，一阶 = 练气期品质
 * 炉子 { t: "fu", kind: "dan"|"qi", g: 阶 }，图纸 { t: "bp", kind, g }，都在背包里点击使用/学习
 * ===================================================================== */
const _AL = CFG.alchemy, _FU = CFG.furnace, _GA = CFG.garden;

// 名字 → { kind, g }
DATA.matByName = {};
DATA.herbs.forEach((n, g) => DATA.matByName[n] = { kind: "herb", g });
DATA.ores.forEach((n, g) => DATA.matByName[n] = { kind: "ore", g });
DATA.matName = (kind, g) => kind === "sm" ? DATA.smName(g) : kind === "cu" ? g : (kind === "herb" ? DATA.herbs : DATA.ores)[g];
// 显示名：药材、矿石都不显示品阶
DATA.matFull = (kind, g) => DATA.matName(kind, g);
// [[名字, 数量], ...] → [{ kind, g, n }]，名字写错会在控制台报错
DATA.parseMats = list => list.map(([name, n]) => {
  const sm = !DATA.matByName[name] && DATA.smByName(name); if (sm) return { kind: "sm", g: sm.k, n, ft: sm.ft };   // 秘境专用材料（养神露等），g = 代号；ft 也带上，分属性材料退款时才不会丢属性
  const m = DATA.matByName[name];
  if (m) return { kind: m.kind, g: m.g, n };
  if (typeof ITEMS !== "undefined" && ITEMS.list && ITEMS.list[name]) return { kind: "cu", g: name, n };   // 自定义物品（瑶池玉蕊、蟠桃灵果），g = 物品名
  console.error("js/config/ 数值文件 里有不存在的材料名：" + name); return { kind: "herb", g: 0, n: 1e15 };
});

/* ---------- 丹方 / 属性丹 / 修炼速度丹 ---------- */
DATA.recipes = _AL.recipes;                                         // 全部丹方（含修炼速度丹）
DATA.dans = {};                                                      // 只含属性丹 { atk: {name, label, val[], ...} }
for (const t in _AL.recipes) if (!_AL.recipes[t].speed && !_AL.recipes[t].item) DATA.dans[t] = _AL.recipes[t];
DATA.recipeItem = type => (_AL.recipes[type] || {}).item;           // 炼出来是专用材料（养神丹 yd）
DATA.recipeHas = (type, g) => !!(_AL.recipes[type] && _AL.recipes[type].herbs[g]);   // 这一阶有没有（养神丹只有一阶）
// v41：丹方分类（0 凡丹 1 仙丹 2 冥丹 3 魔丹 4 神丹）、学习需要的门派星级、加成的属性
DATA.danCat = type => (_AL.recipes[type] && _AL.recipes[type].cat) || 0;
// 凡丹：N 星宗门有一阶~N 阶（用户定，2026-10-20）；仙冥魔神丹在四界功德司学，这里的星级只作旧配置兼容
DATA.danStar = (type, g) => DATA.danSectX(type) ? ((_AL.SECT_XMM.STAR || [])[g] || 10) : (_AL.recipes[type] || {}).star || (Math.min(5, Math.floor(g / (_AL.SECT_STAR_TIERS || 2)) + 1));   // 凡丹学习需要的门派星级：1~5 星宗门每星两阶（一二阶 1 星 … 九十阶 5 星），6~10 星宗门全部；仙冥魔神丹在功德司学
DATA.danStat = type => (_AL.recipes[type] && _AL.recipes[type].stat) || type;
// v42：仙冥魔神丹（cat ≥ 1）用炼丹仙炉、炼丹仙师；修炼丹的品质 = 阶 + REALM0
DATA.danFu = type => DATA.danCat(type) === 4 ? "sdan" : DATA.danCat(type) ? "xdan" : "dan";   // 神丹用炼丹神炉
DATA.danCraft = type => DATA.danCat(type) ? "xdan" : "dan";
// v256 仙 / 冥 / 魔丹的命中、速度、闪避、生命、法力丹方在宗门炼丹房学（config/alchemy.js SECT_XMM）
DATA.danSectX = type => { const X = _AL.SECT_XMM, r = _AL.recipes[type]; return !!(X && r && !r.speed && !r.item && (X.CATS || []).includes(r.cat || 0) && (X.STATS || []).includes(DATA.danStat(type))); };
DATA.danSect = type => DATA.danCat(type) === 0 || DATA.danSectX(type);   // 在宗门炼丹房学的丹方：凡丹 + 上面这些（其余仙冥魔神丹在四界功德司）
DATA.pillGrade = (type, g) => g + ((_AL.recipes[type] && _AL.recipes[type].REALM0) || 0);
DATA.isSpeedRecipe = type => !!(_AL.recipes[type] && _AL.recipes[type].speed);
// 一阶破军丹；修炼速度丹显示为 一阶聚气丹（练气期）
// 上古丹名（不含阶）：上古 + 原名去掉「丹」+ 分类名（config/alchemy.js 的 SHANGGU）
DATA.sgDanBase = type => ((_AL.SHANGGU || {}).PREFIX || "上古") + _AL.recipes[type].name.replace(/丹$/, "") + (((_AL.SHANGGU || {}).CAT_NAME || {})[DATA.danCat(type)] || _AL.CATS[DATA.danCat(type)] || "丹");
DATA.danName = (type, g, sg) => type === "wuzhen" ? _AL.recipes[type].name : DATA.recipeItem(type) ? _AL.recipes[type].name : DATA.JIE[g] + (sg ? DATA.sgDanBase(type) : _AL.recipes[type].name) + (DATA.isSpeedRecipe(type) ? `（${DATA.realmLabel(DATA.pillGrade(type, g))}）` : "");
// 丹方效果说明
DATA.recipeEffect = (type, g) => type === "wuzhen" ? (_AL.recipes[type].effect || "") : DATA.recipeItem(type) ? (_AL.recipes[type].effect || "养神用") : DATA.isSpeedRecipe(type) ? `修炼速度+${Math.round(DATA.pillPct(type, DATA.pillGrade(type, g)))}%` : `${_AL.recipes[type].label}+${U.num(_AL.recipes[type].val[g])}`;
DATA.danVal = (type, g) => (_AL.recipes[type].val || [])[g] || 0;
DATA.danLimit = (type, g) => (_AL.recipes[type].limit || [])[g] || 0;
DATA.danRecipe = (type, g) => DATA.parseMats(_AL.recipes[type].herbs[g]);
DATA.danTime = (type, g) => _AL.recipes[type].time[g] * 60000;     // 毫秒（未算炉子加成）
DATA.danLearnTime = (type, g) => _AL.recipes[type].learnTime[g] * 60000;
DATA.danLearnCost = (type, g) => DATA.danSectX(type) ? (_AL.SECT_XMM.COST || 0) + (_AL.SECT_XMM.STEP || 0) * g : (_AL.recipes[type].learnCost || [])[g] || 0;
// 四界功德司丹方在背包里学习的时间（毫秒），ss = 神识强度
DATA.danGdLearnMs = (g, ss) => { const R = _AL.GD_RECIPE || {}, d = (k, v) => R[k] === undefined ? v : R[k];
  ss = Math.max(0, ss || 0);
  let sec = (d("LEARN_MIN", 5) + d("LEARN_STEP", 5) * g) * 60 - ss * d("SS_SEC", 10);
  sec *= 1 - Math.min(d("SS_PCT_MAX", 50), Math.floor(ss / 100) * d("SS_PCT", 2)) / 100;
  return Math.max(d("MIN_SEC", 30), sec) * 1000; };
DATA.danGdCost = (g, shen) => { const R = _AL.GD_RECIPE || {}, m = shen && R.SHEN_MERIT !== undefined ? R.SHEN_MERIT : R.MERIT, st = shen && R.SHEN_STEP !== undefined ? R.SHEN_STEP : R.STEP; return (m === undefined ? 5000 : m) + (st === undefined ? 1000 : st) * g; };   // 四界功德司兑换丹方的功德（神界单独）
DATA.danPrice = (type, g) => (_AL.recipes[type].price || [])[g] || 0;

/* ---------- 炼丹炉 / 炼器炉 ---------- */
DATA.furnaces = _FU;                                                // dan / qi
DATA.furnaceName = (kind, g) => (kind === "qi" ? DATA.XING : DATA.JIE)[g] + _FU[kind].name;   // 炼器炉 / 炼器仙炉按星
DATA.furnaceN = kind => Math.min(DATA.FU_N_MAX(kind), (_FU[kind].mats || []).length);   // 炉子阶数：炼器炉 = 星数（十二），其他 = 丹阶数（十）
DATA.FU_N_MAX = kind => kind === "qi" ? DATA.XING.length : DATA.DAN_JIE_N;
DATA.furnaceMats = (kind, g) => DATA.parseMats(_FU[kind].mats[g]);
DATA.furnaceTime = (kind, g) => _FU[kind].time[g] * 60000;
DATA.furnaceBonus = (kind, g) => g >= 0 ? _FU[kind].bonus[g] : 0;  // 缩短时间 %
DATA.furnaceKinds = { dan: "炼丹炉", qi: "炼器炉", xdan: "炼丹仙炉", sdan: "炼丹神炉" };
for (const k in DATA.furnaceKinds) if (_FU[k] && _FU[k].name) DATA.furnaceKinds[k] = _FU[k].name;   // 名字在 config/names.js 的 furnace
DATA.FURNACE_KINDS = Object.keys(DATA.furnaceKinds).filter(k => _FU[k]);
DATA.isDanFu = k => k === "dan" || k === "xdan" || k === "sdan";                                // 炼丹用的炉子
// v42：宗门宝库兑换第 g 阶图纸需要的门派星级
DATA.blueprintStar = (kind, g) => _FU[kind].STARS ? _FU[kind].STARS[g] || 10 : (_FU[kind].STAR || 1) + Math.floor(g / (kind === "dan" || kind === "qi" ? 1 : _FU[kind].STAR_TIERS || _FU.STAR_TIERS || 1));   // 炼丹炉 / 炼器炉：N 星宗门有一阶~N 阶图纸
DATA.blueprintCost = (kind, g) => _FU[kind].blueprint[g];

/* ---------- 灵田 ---------- */
DATA.GARDEN_MAX = _GA.MAX;
DATA.fieldCost = i => { const a = _GA.OPEN_COST, b = _GA.OPEN_LAST, n = (_GA.MAX || 1) - 1;   // 第 i+1 块
  return Math.round(b && n > 0 ? a * Math.pow(b / a, Math.min(i, n) / n) : a * Math.pow(_GA.OPEN_RATE || 1, i)); };
// 土地（config/garden.js LAND）：等级 0~36，每块灵田单独（s.fields[i].lv）
DATA.LAND = () => Object.assign({ MAX: 36, BAND: [12, 24, 36], PCT: [1, 1, 1], PCT_LV1: 1, PCT_MAX: 72, LY: [100, 5000] }, _GA.LAND || {});   // 默认值与 config/garden.js 一致（1 级 1%，满级 72%）：配置缺失时也不静默变分档
DATA.landBand = lv => { const B = DATA.LAND().BAND; const i = B.findIndex(v => lv <= v); return i < 0 ? B.length - 1 : i; };
// 生长速度：1 级 PCT_LV1 %，满级 PCT_MAX %，中间每级平均增加（有 PCT_MAX 时用；否则按旧的 BAND×PCT 累加）
DATA.landPct = lv => { const L = DATA.LAND(); lv = Math.max(0, Math.min(L.MAX, Math.floor(+lv || 0))); if (!lv) return 0;
  if (L.PCT_MAX != null) { const a = +L.PCT_LV1 || 0, b = +L.PCT_MAX || 0; return Math.round((L.MAX <= 1 ? b : a + (b - a) * (lv - 1) / (L.MAX - 1)) * 100) / 100; }
  let t = 0, lo = 0; L.BAND.forEach((hi, b) => { t += Math.max(0, Math.min(lv, hi) - lo) * (+L.PCT[b] || 0); lo = hi; }); return Math.round(t * 100) / 100; };
// 第 i 块灵田升到第 lv 级的矿石：ORE_N 种各 ORE × lv，按 BAND 取凡 / 仙 / 神界矿石池，从 (i + lv) 种起连续取
DATA.landMats = (i, lv) => { const L = DATA.LAND(), P = (L.ORES || [])[DATA.landBand(lv)] || [], N = P.length, k = Math.min(N, Math.max(0, +L.ORE_N || 0)), n = Math.round((+L.ORE || 0) * lv), st = (Math.floor(+i) || 0) + lv;
  return N && k && n > 0 ? DATA.parseMats([...Array(k).keys()].map(j => [P[(st + j) % N], n])) : []; };
DATA.landCost = lv => { const L = DATA.LAND(), a = +L.LY[0] || 0, b = +L.LY[1] || a, n = Math.max(1, L.MAX - 1); return Math.round(a + (b - a) * (Math.max(1, Math.min(L.MAX, lv)) - 1) / n); };   // 升到第 lv 级的灵液
DATA.landColorName = lv => ["普通", "绿色", "红色"][DATA.landBand(lv)] || "";
// 土地外观：三张满幅土壤图（0~12 级普通土、13~24 绿、25~36 红），同一样式、只换土色，边缘带一点坡度、不带硬边框，不随等级加深
DATA.landStyle = lv => { const n = Math.floor(+lv || 0) ? DATA.landBand(Math.floor(+lv)) + 1 : 1;
  return `background-color:transparent;background-image:url(img/land_${n}.webp?v=${DATA.IMG_V});background-size:cover;background-position:center;background-repeat:no-repeat`; };
// 开辟第 i+1 块灵田的矿石：每种 OPEN_ORE × (i+1)，从 OPEN_ORES 第 i 种起连续取 OPEN_ORE_N 种
DATA.fieldMats = i => { const P = _GA.OPEN_ORES || [], L = P.length, k = Math.min(L, Math.max(0, +_GA.OPEN_ORE_N || 0)), n = Math.round((+_GA.OPEN_ORE || 0) * (i + 1));
  return L && k && n > 0 ? DATA.parseMats([...Array(k).keys()].map(j => [P[(i + j) % L], n])) : []; };
// 灵果（config/garden.js LINGGUO）：灵田作物编号 = LG_BASE + 序号，和药材序号分开；种子物品同样是 { t: "seed", g }
DATA.LG_BASE = 100;
DATA.LG = () => (_GA.LINGGUO || { list: [] });
DATA.isLg = g => g >= DATA.LG_BASE;
DATA.lgDef = i => (DATA.LG().list || [])[i];
DATA.lgN = () => (DATA.LG().list || []).length;
DATA.lgImg = i => `img/lg/${i}.png?v=${DATA.IMG_V}`;
DATA.lgLab = k => k.startsWith("dmg_") ? ((DATA.elById[k.slice(4)] || {}).name || "") + "系属性伤害" : k.startsWith("dr_") ? ((DATA.elById[k.slice(3)] || {}).name || "") + "系属性减伤"
  : { atk: "攻击", def: "防御", hp: "生命", mana: "法力", cult: "修为修炼速度", body: "气血修炼速度" }[k] || k;
DATA.herbGrow = g => { if (DATA.isLg(g)) { const L = DATA.LG(); return DATA.lgDef(g - DATA.LG_BASE) ? { grow: L.GROW || 4320, ling: L.LING || 0, yield: [1, 3], lg: 1 } : undefined; } const h = _GA.herbs[DATA.herbs[g]]; if (!h || h.ling != null) return h; return Object.assign({}, h, { ling: h.div ? Math.round((h.yield || [0])[0] * DATA.matPrice("herb", g) * ((DATA.array || {}).STONE_LING || 0) / h.div) : 0 }); };   // 种植灵气 = 最低产量 × 售价 × 1 灵石灵气 ÷ div；没写 div 的药材灵气按 0 算，不返回 undefined（否则扣灵气会变 NaN）
DATA.cropName = g => DATA.isLg(g) ? (DATA.lgDef(g - DATA.LG_BASE) || {}).name || "灵果" : DATA.herbs[g];
DATA.cropImg = g => DATA.isLg(g) ? DATA.lgImg(g - DATA.LG_BASE) : DATA.matImg("herb", g);
DATA.growTime = g => DATA.herbGrow(g).grow * 60000;
DATA.seedCost = g => { const h = DATA.herbGrow(g); return !h ? 0 : Math.max(1, Math.ceil(DATA.matPrice("herb", g) * (_GA.SEED_COST_MUL ?? 5))); };   // 兑换一颗种子的贡献
DATA.seedSell = g => DATA.isLg(g) ? (DATA.LG().SEED_SELL ?? 100) : Math.floor(DATA.matPrice("herb", g) * (_GA.SEED_SELL_MUL ?? 3));   // 种子出售价
DATA.seedDropOnly = g => !!(DATA.herbGrow(g) || {}).drop;   // 特色药材：种子只能地图掉落
DATA.seedName = g => DATA.cropName(g) + "种子";

/* ---------- v213 宗主清灵丹（config/sect.js 的 qingling）：每个门派一种，数值 = 同星级对应属性丹一枚 ---------- */
DATA.qlName = sectId => { const o = DATA.sectById[sectId]; return (o ? o.name : "") + CFG.sect.qingling.NAME; };
DATA.qlLimit = sectId => { const o = DATA.sectById[sectId]; return o ? CFG.sect.qingling.LIMIT[o.star - 1] || 0 : 0; };
DATA._qlV = {};
DATA.qlVals = sectId => {
  if (DATA._qlV[sectId]) return DATA._qlV[sectId];
  const Q = CFG.sect.qingling, o = DATA.sectById[sectId], out = {}; if (!o) return out;
  const cat = Q.CAT[o.star - 1] || 0, g = (Q.TIER[o.star - 1] || 1) - 1;
  for (const k of Q.STATS) { const t = Object.keys(DATA.dans).find(x => (DATA.dans[x].cat || 0) === cat && DATA.danStat(x) === k); out[k] = t ? DATA.danVal(t, g) || 0 : 0; }
  return DATA._qlV[sectId] = out;
};
DATA.QL_LABEL = { hp: "生命", atk: "攻击", def: "防御", mana: "法力", hit: "命中", dodge: "闪避", speed: "速度" };
DATA.qlTxt = sectId => { const v = DATA.qlVals(sectId); return Object.keys(v).map(k => `${DATA.QL_LABEL[k] || k} +${U.num(v[k])}`).join("、"); };

/* v216 丹药品质外观（同装备 css .eqt0 ~ .eqt11）：凡丹 一阶~十阶 → 0~5，仙冥魔神丹 → 6~11，越高级效果越好 */
DATA.danTier = (type, g) => { const f = Math.min(5, Math.floor((g || 0) * 6 / 10)); return (DATA.danCat(type) || 0) > 0 ? 6 + f : f; };
DATA.danCls = (type, g) => ` eqt eqt${DATA.danTier(type, g)}`;
DATA.qlCls = sectId => { const Q = CFG.sect.qingling, o = DATA.sectById[sectId], st = o ? o.star : 1, f = Math.min(5, Math.floor(((Q.TIER[st - 1] || 1) - 1) * 6 / 10));
  return ` eqt eqt${(Q.CAT[st - 1] || 0) > 0 ? 6 + f : f}`; };
// v217 高阶丹药流光：品质 ≥ 4 的丹药图标外面包一层（css .dsh），圆形流光，越高级越亮越快
//   kind：mi 背包格子 / li 列表小图 / big 详情大图；cls = danCls / qlCls 的结果
DATA.danImg = (src, cls, kind) => {
  const m = /eqt(\d+)/.exec(cls || ""), tr = m ? +m[1] : 0;
  const img = kind === "li" ? `<img class="li dan${cls}" src="${src}" alt="" loading="lazy">` : `<img class="${kind === "big" ? "item-img" : "mi"} dan${cls}" src="${src}" alt="">`;   // .dan：丹药低阶不压暗
  return tr >= 4 ? `<span class="dsh dsh-${kind} dsh${tr}">${img}</span>` : img;
};
