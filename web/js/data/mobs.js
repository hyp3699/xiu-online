/* =====================================================================
 * 怪物属性生成（数值在 config/mobs.js）
 * 每个怪物 6 个数 [境界, 层, [1, 前星%, 前星层, 星级, 本星%, 本星层], [2, ..坊市], [3, ..功德司], 倍率]：
 * 进入境界写在每组的「进入」（天将 / 星君就任写「天将需」「星君需」，宗门考官 = 考官境界，可用「晋升需」单独改）：
 *   怪物基础属性 = (修为突破属性 + 肉身突破属性 + 功法属性) × 倍率
 *   遇到时 × 随机(RAND[0] ~ RAND[1])；暴击 = CRIT
 * 生成后写进：
 *   CFG.monster.regions[地图][区域][normal/elite/boss]、CFG.monster.MAP_REALM（凡界 + 仙魔冥神）
 *   CFG.mijing.list[i] / CFG.lingdi.list[i] 的 realm 和 normal/elite/boss
 *   天将 / 星君 / 界主、宗门考官用 DATA.mobTj / mobXj / mobJz / mobExam 现取
 * ===================================================================== */
DATA.MOB_KIND = { normal: "普通", elite: "精英", boss: "首领" };
DATA.MOB_KEYS = ["hp", "atk", "def", "speed", "hit", "dodge", "mana", "res"];
// 遇到时的随机倍率
// v180 RAND 每种属性单独：{ atk: [a, b], hp: [a, b], 其他: [a, b] }
DATA.MOB_RAND_ZH = { hp: "气血", atk: "攻击", def: "防御", speed: "速度", hit: "命中", dodge: "闪避", mana: "法力",
  res_jin: "金抗性", res_mu: "木抗性", res_shui: "水抗性", res_huo: "火抗性", res_tu: "土抗性", res_lei: "雷抗性" };
DATA.mobRandOf = k => { const R = CFG.mobs.RAND || {}; return R[DATA.MOB_RAND_ZH[k]] || R[k] || R["其他"] || (k.startsWith("res") && (R["金抗性"] || R.res)) || [1, 1]; };   // k = hp / atk … / res_jin（每系抗性）
DATA.mobRnd = k => { const R = DATA.mobRandOf(k); return R[0] + Math.random() * (R[1] - R[0]); };
// 肉身突破 n 次的合计加成（同 modules/body.js bodyBonus）
DATA.mobBody = n => { const o = {}; for (const k of DATA.MOB_KEYS) o[k] = DATA.bodyStat(n, k); return o; };
// 怪物功法的三类来源（悟道、试炼塔、宗门传承功法怪物不算）
//   1 宗门功法（宗门功法殿，不含传承功法）  2 坊市功法（凡阶坊市 + 四界坊市）  3 四界功德司功法
DATA.MOB_GF_CAT = { 1: "宗门功法", 2: "坊市功法", 3: "功德司功法" };
DATA.mobCatSrcs = c => c === 1 ? [...DATA.sects, ...(DATA.twSources || [])] : c === 2 ? [...DATA.shopSources, ...((DATA.jieGf || {}).jshop || []).filter(x => !x.old)] : c === 3 ? ((DATA.jieGf || {}).gd || []).filter(x => !x.old) : [];   // 宗门功法 11 星以上用天外天（宗门只到 10 星）
// 一行怪物数据转成对象：[境界, 层, 宗门组, 倍率]（坊市、功德司组已去掉；以前 6 个数 [境界, 层, 宗门组, 坊市组, 功德司组, 倍率] 也能读）
//   每组 [类别, 前星学%, 前星层, 星级, 本星学%, 本星层]：1 ~ 星级−1 星全部按前星学% / 前星层；星级那一星按本星学% / 本星层
//   层、学%、功法层都可以写一个数或 [最小, 最大]（遇到时随机：学% 每种功法一次、功法层每本一次）；星级 0 = 该境界能学到的最高星
//   旧格式 7 个数 [境界, 层, 星级, [1, 学%, 层], [2, ..], [3, ..], 倍率] 仍能读（前星、本星都用同一个学% 和层）
//   cats = [{ c, star, pre: { pct, gf }, cur: { pct, gf } }]
DATA.MOB_NONE = [0, 1, [1, 0, 0, 1, 0, 0], 1];   // 没写时：练气一层、不算功法
DATA.mobRange = v => Array.isArray(v) ? [v[0], v[v.length - 1]] : [v || 0, v || 0];
DATA.mobRow = t => {
  t = t || DATA.MOB_NONE;
  // 末尾可写额外倍率 { 生命, 攻击, 防御, jin, mu, shui, huo, tu, lei }（不写 = 1）；去掉后按原格式解析
  const X = t.length && t[t.length - 1] && typeof t[t.length - 1] === "object" && !Array.isArray(t[t.length - 1]) ? t[t.length - 1] : null;
  if (X) t = t.slice(0, -1);
  const realm = Math.max(0, Math.min(DATA.realms.length - 1, t[0] || 0)), old = !Array.isArray(t[2]);
  const gs = old ? [t[3], t[4], t[5]].map(x => [x[0], x[1], x[2], t[2], x[1], x[2]]) : t.slice(2, -1).filter(Array.isArray);
  const part = (p, g) => ({ pct: DATA.mobRange(p), gf: DATA.mobRange(g) });
  const cats = gs.filter(x => x && DATA.MOB_GF_CAT[x[0]]).map(x => ({ c: x[0], star: x[3] > 0 ? x[3] : DATA.refStar(realm), pre: part(x[1], x[2]), cur: part(x[4], x[5]) }));
  return { realm, lay: DATA.mobRange(t[1]), cats, k: old ? t[6] : t[t.length - 1], x: X };
};
// 怪物六系抗性：o.res（修为 + 肉身 + 不分系的）+ 各系真经 → o.resEl { jin: …, mu: … }；o.res 改成六系平均（只给显示用）
DATA.mobResEl0 = () => Object.fromEntries(DATA.elements.map(e => [e.id, 0]));
DATA.mobResSplit = (o, rEl, k = 1) => { const E = DATA.elements; o.resEl = {}; let s = 0; for (const e of E) s += o.resEl[e.id] = o.res + (rEl[e.id] || 0) * k; o.res = E.length ? s / E.length : o.res; return o; };
DATA.mobOn = P => P.pct[1] > 0 && P.gf[1] > 0;
// 某一类来源里 lo ~ hi 星的全部功法，按种类分组：{ 种类id: [{ id, stat, stat2 }] }（缓存）
DATA._mobBooks = {};
DATA.mobBooks = (cat, lo, hi) => {
  const key = cat + ":" + lo + ":" + hi;
  if (DATA._mobBooks[key]) return DATA._mobBooks[key];
  const o = {};
  for (const sc of DATA.mobCatSrcs(cat)) { if (sc.star < lo || sc.star > hi) continue;
    for (const t of DATA.gfTypesOf(sc.src, sc.star)) { if (sc.src === "shop" && t.sectOnly) continue;
      (o[t.id] = o[t.id] || []).push({ id: DATA.gongfaId(sc.id, t.id), stat: t.stat, stat2: t.stat2, el: sc.el }); } }
  return DATA._mobBooks[key] = o;
};
// 一类来源拆成两段：[[最低星, 最高星, { pct, gf }], ...]（学 0% 或功法层 0 的段不算）
DATA.mobParts = C => [[1, C.star - 1, C.pre], [C.star, C.star, C.cur]].filter(([lo, hi, P]) => lo <= hi && DATA.mobOn(P));
DATA._mobGfv = new Map();
DATA.mobGfVal = (id, lv) => { const k = id + ":" + lv; let v = DATA._mobGfv.get(k); if (!v) { const g = lv > 0 ? DATA.gongfaInfo(id, lv) : null; v = g ? [g.value || 0, g.value2 || 0] : [0, 0]; DATA._mobGfv.set(k, v); } return v; };
// 一类来源 lo~hi 星、功法层 g0/g1 时，每个种类全部功法的属性合计（未乘学%）：{ 种类: { add: {属性: 值}, rEl: {系: 值} } }（缓存）
DATA._mobBookSum = new Map();
DATA.mobBookSum = (cat, lo, hi, g0, g1) => {
  const key = cat + ":" + lo + ":" + hi + ":" + g0 + ":" + g1; let S = DATA._mobBookSum.get(key); if (S) return S;
  S = {}; const B = DATA.mobBooks(cat, lo, hi), rE = DATA.mobResEl0(), keys = new Set(DATA.MOB_KEYS);
  for (const ty in B) { const T = S[ty] = { add: {}, rEl: {} };
    for (const b of B[ty]) { const v0 = DATA.mobGfVal(b.id, g0), v1 = DATA.mobGfVal(b.id, g1);
      if (b.stat === "res" && b.el && b.el in rE) T.rEl[b.el] = (T.rEl[b.el] || 0) + (v0[0] + v1[0]) / 2; else if (keys.has(b.stat)) T.add[b.stat] = (T.add[b.stat] || 0) + (v0[0] + v1[0]) / 2;
      if (b.stat2 && keys.has(b.stat2)) T.add[b.stat2] = (T.add[b.stat2] || 0) + (v0[1] + v1[1]) / 2; } }
  DATA._mobBookSum.set(key, S); return S;
};
const _mobRi = r => r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
// 算属性：rnd = true 每次遇到随机（层、学%、功法层）；false = 显示用的平均值
DATA.mobCalc = (t, crit, rnd) => {
  const R = DATA.mobRow(t), lay = Math.max(1, Math.min(DATA.LAYERS, rnd ? _mobRi(R.lay) : Math.round((R.lay[0] + R.lay[1]) / 2)));
  const st = DATA.refStats(R.realm, lay, 0, 0, 1), bd = DATA.mobBody(R.realm * DATA.LAYERS + lay), add = {};
  for (const x of DATA.MOB_KEYS) add[x] = 0;
  const rEl = DATA.mobResEl0();   // 真经抗性按系分开：每本只加它自己那一系
  for (const C of R.cats) for (const [lo, hi, P] of DATA.mobParts(C)) {   // 每类来源分前星、本星两段，各按自己的学% 和功法层
    const B = DATA.mobBooks(C.c, lo, hi);
    if (!rnd) {   // 显示用：功法层固定，每个种类的合计只算一次（缓存），乘平均学% 即可（结果和逐本累加相同）
      const f = (P.pct[0] + P.pct[1]) / 200, S = DATA.mobBookSum(C.c, lo, hi, P.gf[0], P.gf[1]);
      for (const ty in S) { const T = S[ty]; for (const k in T.add) add[k] += T.add[k] * f; for (const e in T.rEl) rEl[e] += T.rEl[e] * f; }
      continue;
    }
    for (const ty in B) {
      // 每个种类 = 全部功法 × 学%（1% × 12 本 = 0.12 本的属性）
      //   遇到时（rnd）：学% 在范围内随机（每种一次），功法层每本单独随机取整；显示用：学% 取平均、功法层两头平均
      const f = (rnd ? P.pct[0] + Math.random() * (P.pct[1] - P.pct[0]) : (P.pct[0] + P.pct[1]) / 2) / 100;
      for (const b of B[ty]) {
        const g0 = rnd ? _mobRi(P.gf) : P.gf[0], g1 = rnd ? g0 : P.gf[1], v0 = DATA.mobGfVal(b.id, g0), v1 = DATA.mobGfVal(b.id, g1);
        if (b.stat === "res" && b.el && b.el in rEl) rEl[b.el] += (v0[0] + v1[0]) / 2 * f; else if (add[b.stat] !== undefined) add[b.stat] += (v0[0] + v1[0]) / 2 * f; if (b.stat2 && add[b.stat2] !== undefined) add[b.stat2] += (v0[1] + v1[1]) / 2 * f; }
    }
  }
  const o = {};
  for (const x of DATA.MOB_KEYS) o[x] = (st[x] + add[x] + bd[x]) * R.k;
  DATA.mobResSplit(o, rEl, R.k);
  if (R.x) {   // 额外倍率：生命、攻击、防御、六系抗性各自单独（显示用的平均抗性跟着重算）
    const m = v => typeof v === "number" && v >= 0 ? v : 1, E = DATA.elements;
    o.hp *= m(R.x.生命); o.atk *= m(R.x.攻击); o.def *= m(R.x.防御);
    if (E.length) { let s = 0; for (const e of E) s += o.resEl[e.id] *= m(R.x[e.id]); o.res = s / E.length; }
  }
  if (R.x && Array.isArray(R.x.神通)) o.stl = R.x.神通.filter(v => Array.isArray(v) && v[0]).map(v => [String(v[0]), Math.max(0, Math.round(+v[1] || 0))]);   // 怪物神通 [[id, 等级]]（config/mobs.js 额外倍率里的 神通，固定不随机）
  o.manaBr = st.manaBr;   // 修为突破的法力（法术 / 法宝耗法力用，不乘倍率）
  o.crit = crit || 0; o.layer = lay; o.L = R.realm * DATA.LAYERS + lay - 1;   // v171 总层序（保底伤害用）
  return o;
};
// 显示用（平均值）
DATA.mobStats = (t, crit) => DATA.mobCalc(t, crit, false);
// v168 每次遇到随机：层、学%、功法层（v225 功法按 全部 × 学% 算，不再随机挑书）
DATA.mobRoll = (t, crit) => DATA.mobCalc(t, crit, true);
// 按名字取，名字对不上时按顺序取（地图改了名也不会丢）
DATA.mobPick = (obj, name, i) => { if (!obj) return null; if (obj[name]) return obj[name]; const v = Object.values(obj); return v[i] || null; };
DATA.mobCrit = k => (CFG.mobs.CRIT || {})[k] || 0;
// 一组 {普通, 精英, 首领} → {normal, elite, boss}
DATA.mobGroup = g => { const o = { _t: {} }; for (const k in DATA.MOB_KIND) { const t = (g || {})[DATA.MOB_KIND[k]]; o[k] = DATA.mobStats(t, DATA.mobCrit(DATA.MOB_KIND[k])); o._t[k] = t; } return o; };
// v168 遇到怪物时按这一组的原始数据重新随机（没有原始数据就用算好的）
DATA.mobMeet = (grp, kind) => { const t = grp && grp._t && grp._t[kind]; return t ? DATA.mobRoll(t, DATA.mobCrit(DATA.MOB_KIND[kind])) : grp[kind]; };

// ---------- 凡界 + 仙魔冥神地图 ----------
(() => {
  const M = CFG.mobs;
  for (let a = 0; a < DATA.FAN_MAP_N; a++) {
    const c = DATA.mobPick(M.fan, DATA.maps[a].name, a) || {};
    CFG.monster.regions[a] = DATA.regionDirs.map((n, r) => Object.assign({ name: n, L: a * 10 + M.FAN_L[r] }, DATA.mobGroup(c[n])));
    CFG.monster.MAP_REALM[a] = c["进入"] || 0;
  }
  for (const w of ["xian", "ming", "mo", "shen"]) for (const a of DATA.worldMapIdx[w] || []) {
    const m = DATA.maps[a], c = DATA.mobPick(M[w], m.name, m.wi) || {}, R = CFG.monster.regions[a] || [];
    CFG.monster.regions[a] = DATA.regionDirs.map((n, r) => Object.assign({ name: n, L: (R[r] || {}).L || 0 }, DATA.mobGroup(c[n])));
    CFG.monster.MAP_REALM[a] = c["进入"] || 0;
    m.mob = c;   // 天将 / 星君 / 界主，就任境界「天将需」「星君需」
  }
  // v258 地图等级（法术 / 法宝伤害加成用）：凡界 1~9，仙魔冥第 N 张 9+N，神界第 N 张 19+N
  DATA.mapLv = a => { const m = DATA.maps[a]; if (!m) return 0; if (!m.w || m.w === "fan") return a + 1; return (m.wi || 0) + (m.w === "shen" ? 20 : 10); };
  // 不在地图上的怪：按怪物境界折算，练气 = 1 级，每个大境界 +1，最多 24（圣人）
  DATA.mapLvByL = L => Math.min(24, Math.max(1, Math.floor((L || 0) / DATA.LAYERS) + 1));
})();
DATA.mobTj = a => (DATA.maps[a].mob || {})["天将"] || DATA.MOB_NONE;
DATA.mobXj = (a, i) => { const l = (DATA.maps[a].mob || {})["星君"] || []; return l[i] || l[l.length - 1] || DATA.MOB_NONE; };
DATA.mobJz = a => (DATA.maps[a].mob || {})["界主"] || DATA.MOB_NONE;

// ---------- 秘境 / 灵地 ----------
(() => {
  for (const [C, key] of [[CFG.mijing, "mijing"], [CFG.lingdi, "lingdi"]]) {
    if (!C || !C.list) continue;
    C.list.forEach((d, i) => {
      const g = DATA.mobPick(CFG.mobs[key], d.name, i) || {};
      Object.assign(d, DATA.mobGroup(g));
      d.realm = g["进入"] || 0;
    });
  }
})();

// ---------- 试炼塔守关者（v221，config/mobs.js 的 tower）：按「第几层 ÷ 总层数」算境界、宗门功法学习比例、功法层、阶段倍率 ----------
//   逢 10 层 × BOSS（v222）；2 星及以上 = 上一星塔顶（不含 BOSS 倍）的全部属性 + 本星塔多出来的境界 / 肉身属性 + 本星宗门功法，本星部分 × 阶段倍率
DATA._tower = {};
DATA.towerPart = (star, floor, max) => {   // 返回 { total, ng: 不含功法的累计属性, realm, lay, pct, gf, mul }
  const T = CFG.mobs.tower, LN = T.REALMS * DATA.LAYERS, f = Math.max(1, Math.min(max, floor)), p = f / max;
  const step = (n) => Math.max(1, Math.min(n, Math.ceil(p * n - 1e-9)));
  const r0 = CFG.sect.REQ_REALM[star - 1];
  const j = step(LN), realm = Math.min(DATA.realms.length - 1, r0 + Math.floor((j - 1) / DATA.LAYERS)), lay = (j - 1) % DATA.LAYERS + 1;
  const gf = step(T.GF_MAX), sg = step(T.STAGES);
  const pct = T.PCT_START + (T.STAGES > 1 ? (sg - 1) * (T.PCT_END - T.PCT_START) / (T.STAGES - 1) : 0);   // 学习比例：第 1 段 PCT_START % 平均递增到最后一段 PCT_END %
  const mul = (T.MUL + (sg - 1) * T.MUL_ADD) / 100;   // 第 1 段 MUL %，每段 + MUL_ADD %
  const Lof = (r, l) => r * DATA.LAYERS + l;
  const cur = DATA.refStats(realm, lay, 0, star, 1), bd = DATA.mobBody(Lof(realm, lay));
  let pre = null, pbd = null, base = null;
  if (star > 1) {   // 上一星塔顶（不含功法，功法按 PRE_PCT / PRE_GF 另算）
    const pm = DATA.towerMax(star - 1), pp = DATA.towerPart(star - 1, pm, pm);
    pre = DATA.refStats(pp.realm, pp.lay, 0, star - 1, 1); pbd = DATA.mobBody(Lof(pp.realm, pp.lay)); base = pp.ng;
  }
  const add = {}; for (const k of DATA.MOB_KEYS) add[k] = 0;
  const rEl = DATA.mobResEl0();   // 真经抗性按系分开
  for (const sc of DATA.sects || []) {   // 本星：学 pct%、gf 层；前面星级：学 PRE_PCT%、PRE_GF 层（全部功法 × 学习比例，平均）
    const P = sc.star === star ? pct : sc.star < star ? (T.PRE_PCT || 0) : 0, L = sc.star === star ? gf : T.PRE_GF || 1; if (!P) continue;
    for (const t of DATA.gfTypesOf(sc.src, sc.star)) { const v = DATA.mobGfVal(DATA.gongfaId(sc.id, t.id), L);
      if (t.stat === "res" && sc.el in rEl) rEl[sc.el] += v[0] * P / 100; else if (add[t.stat] !== undefined) add[t.stat] += v[0] * P / 100; if (t.stat2 && add[t.stat2] !== undefined) add[t.stat2] += v[1] * P / 100; } }
  const ng = {}, total = {};
  for (const k of DATA.MOB_KEYS) {
    ng[k] = (base ? base[k] : 0) + (cur[k] - (pre ? pre[k] : 0) + bd[k] - (pbd ? pbd[k] : 0)) * mul;
    total[k] = ng[k] + add[k] * mul;
  }
  DATA.mobResSplit(total, rEl, mul);
  total.manaBr = cur.manaBr;   // 修为突破法力（耗法力用，按当前境界，不叠加）
  return { ng, total, realm, lay, pct, gf, mul, L: Lof(realm, lay) - 1 };
};
DATA.towerStage = (star, floor, max) => {
  const key = star + ":" + floor + ":" + max;
  if (!DATA._tower[key]) {
    const T = CFG.mobs.tower, P = DATA.towerPart(star, floor, max), crit = DATA.mobCrit("考官");
    const B = T.BOSS, boss = B[0] > 0 && floor % B[0] === 0 ? B[1] : 1, o = Object.assign({}, P.total);   // v222 逢 10 层 × BOSS
    for (const k of DATA.MOB_KEYS) o[k] *= boss;
    o.resEl = Object.fromEntries(Object.entries(P.total.resEl || {}).map(([e, v]) => [e, v * boss]));
    DATA._tower[key] = Object.assign(o, { crit, L: P.L, realm: P.realm, layer: P.lay, pct: P.pct, gf: P.gf, mul: P.mul, boss });
  }
  return DATA._tower[key];
};

// ---------- 宗门考官：star 星级（1~10），i 职务序号（1 = 内门弟子 …… 6 = 宗主） ----------
DATA.mobExam = (star, i) => { const g = DATA.mobPick(CFG.mobs.sect, star + "星", star - 1) || {}; return DATA.mobPick(g, DATA.ranks[i] && DATA.ranks[i].name, i - 1); };
