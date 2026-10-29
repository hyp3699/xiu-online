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
DATA.matName = (kind, g) => kind === "sm" ? DATA.smName(g) : (kind === "herb" ? DATA.herbs : DATA.ores)[g];
// 显示名：药材、矿石都不显示品阶
DATA.matFull = (kind, g) => DATA.matName(kind, g);
// [[名字, 数量], ...] → [{ kind, g, n }]，名字写错会在控制台报错
DATA.parseMats = list => list.map(([name, n]) => {
  const sm = !DATA.matByName[name] && DATA.smByName(name); if (sm) return { kind: "sm", g: sm.k, n };   // 秘境专用材料（养神露等），g = 代号
  const m = DATA.matByName[name];
  if (!m) { console.error("js/config/ 数值文件 里有不存在的材料名：" + name); return { kind: "herb", g: 0, n: 1e15 }; }
  return { kind: m.kind, g: m.g, n };
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
DATA.danStar = (type, g) => (_AL.recipes[type] || {}).star || (Math.min(5, Math.floor(g / (_AL.SECT_STAR_TIERS || 2)) + 1));   // 凡丹学习需要的门派星级：1~5 星宗门每星两阶（一二阶 1 星 … 九十阶 5 星），6~10 星宗门全部；仙冥魔神丹在功德司学
DATA.danStat = type => (_AL.recipes[type] && _AL.recipes[type].stat) || type;
// v42：仙冥魔神丹（cat ≥ 1）用炼丹仙炉、炼丹仙师；修炼丹的品质 = 阶 + REALM0
DATA.danFu = type => DATA.danCat(type) === 4 ? "sdan" : DATA.danCat(type) ? "xdan" : "dan";   // 神丹用炼丹神炉
DATA.danCraft = type => DATA.danCat(type) ? "xdan" : "dan";
DATA.danSect = type => DATA.danCat(type) === 0;   // 在宗门炼丹房学的丹方：只有凡丹（仙冥魔神丹在四界功德司）
DATA.pillGrade = (type, g) => g + ((_AL.recipes[type] && _AL.recipes[type].REALM0) || 0);
DATA.isSpeedRecipe = type => !!(_AL.recipes[type] && _AL.recipes[type].speed);
// 一阶破军丹；修炼速度丹显示为 一阶聚气丹（练气期）
// 上古丹名（不含阶）：上古 + 原名去掉「丹」+ 分类名（config/alchemy.js 的 SHANGGU）
DATA.sgDanBase = type => ((_AL.SHANGGU || {}).PREFIX || "上古") + _AL.recipes[type].name.replace(/丹$/, "") + (_AL.CATS[DATA.danCat(type)] || "丹");
DATA.danName = (type, g, sg) => DATA.recipeItem(type) ? _AL.recipes[type].name : DATA.JIE[g] + (sg ? DATA.sgDanBase(type) : _AL.recipes[type].name) + (DATA.isSpeedRecipe(type) ? `（${DATA.realmLabel(DATA.pillGrade(type, g))}）` : "");
// 丹方效果说明
DATA.recipeEffect = (type, g) => DATA.recipeItem(type) ? (_AL.recipes[type].effect || "养神用") : DATA.isSpeedRecipe(type) ? `修炼速度+${Math.round(DATA.pillPct(type, DATA.pillGrade(type, g)))}%` : `${_AL.recipes[type].label}+${U.num(_AL.recipes[type].val[g])}`;
DATA.danVal = (type, g) => _AL.recipes[type].val[g];
DATA.danLimit = (type, g) => _AL.recipes[type].limit[g];
DATA.danRecipe = (type, g) => DATA.parseMats(_AL.recipes[type].herbs[g]);
DATA.danTime = (type, g) => _AL.recipes[type].time[g] * 60000;     // 毫秒（未算炉子加成）
DATA.danLearnTime = (type, g) => _AL.recipes[type].learnTime[g] * 60000;
DATA.danLearnCost = (type, g) => (_AL.recipes[type].learnCost || [])[g] || 0;
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
DATA.fieldCost = i => Math.floor(_GA.OPEN_COST * Math.pow(_GA.OPEN_RATE, i)); // 第 i+1 块
DATA.herbGrow = g => _GA.herbs[DATA.herbs[g]];
DATA.growTime = g => DATA.herbGrow(g).grow * 60000;
DATA.seedCost = g => DATA.herbGrow(g).seed;

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
