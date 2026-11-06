/* =====================================================================
 * 数据：境界 & 人物成长
 * ---------------------------------------------------------------------
 * 改境界名字、层数、修为需求、每层属性成长，都在这个文件里。
 * 总层序 L：境界序号 × 10 + 层(0~9)。例如 筑基期三层 = 1*10 + 2 = 12
 * ===================================================================== */
window.DATA = window.DATA || {};

// 24 个大境界（顺序即进阶顺序）
// 名字在 config/names.js 的 realm（这里是原名）
DATA.NM_DEF.realm = [
  "练气", "筑基", "金丹", "元婴", "出窍", "化神", "练虚", "合体", "洞真", "大乘", "渡劫",
  "散仙", "游仙", "地仙", "天仙", "金仙", "太乙金仙", "大罗金仙", "玄仙", "仙王", "仙君", "仙帝", "准圣", "圣人",
];
DATA.realms = DATA.nmArr(CFG.names.realm, DATA.NM_DEF.realm);
// 显示：序号 → "练气期" / "散仙"（仙人以上不加「期」）；-1 = 凡人
DATA.REALM_TEXT = { mortal: DATA.nmPick(CFG.names.realmText, "mortal", "凡人"), suffix: DATA.nmPick(CFG.names.realmText, "suffix", "") };
DATA.realmLabel = i => i < 0 ? DATA.REALM_TEXT.mortal : DATA.realms[i] + (i <= 10 ? DATA.REALM_TEXT.suffix : "");

// 每个大境界的层数
DATA.LAYERS = 10;
DATA.layerNames = DATA.nmArr(CFG.names.layer, ["一层", "二层", "三层", "四层", "五层", "六层", "七层", "八层", "九层", "十层"]);
// 法宝的境界倍率（config/forge.js 的 DMG_REALM）按境界名写：境界改名后把键换成新名
for (const k of ["DMG_REALM"]) {
  const o = ((CFG.forge || {}).fabao || {})[k];
  if (!o || Array.isArray(o)) continue;
  const ent = Object.keys(o).map(n => { const i = DATA.NM_DEF.realm.indexOf(n); return [i >= 0 ? DATA.realms[i] : n, o[n]]; });
  Object.keys(o).forEach(n => delete o[n]); ent.forEach(([n, v]) => { o[n] = v; });
}

/* 以下数值都来自 js/config/ 下的数值文件（数值设置文件），这里只做计算 */
const _R = CFG.realm, _P = CFG.player;
// 境界突破表（config/realm.js）：一行一个境界，没写的境界沿用上面最近一行；T = 要突破到的总层序（0 = 第一境界一层）
DATA.brRow = (rows, r) => { let o = null; for (const x of rows || []) if (x[0] <= r && (!o || x[0] >= o[0])) o = x; return o; };
// 突破到第 T 层需要的修为 / 气血：行 = [境界, 一层需要, 十层需要]，中间每层平均加，最后 × 总倍率 rate
DATA.brNeed = (rows, T, rate) => { T = Math.max(0, T); const x = DATA.brRow(rows, Math.floor(T / DATA.LAYERS)); return x ? Math.round((x[1] + ((x[2] || x[1]) - x[1]) / (DATA.LAYERS - 1) * (T % DATA.LAYERS)) * (rate || 1)) : 0; };
DATA.isTest = () => !!DATA._debug || (+((CFG.rates || {}).TEST) === 1 && !!DATA._admin);   // 测试模式：调试人物始终开（DATA._debug），或 config/rates.js TEST=1 时对管理员账号生效（服务器 setAdmin/setDebug，网页 API 设）
DATA.brRate = () => DATA.isTest() ? 0 : +((CFG.rates || {}).BREAK ?? 1) || 0;   // config/rates.js 突破需要总倍率（测试模式 = 0，突破不需要修为 / 气血）
DATA.needExp = L => Math.round(DATA.brNeed(_R.EXP, L + 1, _R.EXP_RATE) * DATA.brRate());   // 第 L 层 → 第 L+1 层
DATA.MORTAL_EXP = Math.round(DATA.brNeed(_R.EXP, 0, _R.EXP_RATE) * DATA.brRate());          // 凡人 → 练气一层
// 突破 n 层（第 0 ~ n-1 层）增加的属性合计（缓存）
DATA._brSum = {};
DATA.brSum = (rows, n, tag) => {
  if (_R.AUTO && +_R.AUTO.on && !DATA._autoRows[tag] && DATA._brSum[tag]) delete DATA._brSum[tag];   // 自动属性还没算出来（功法数据未加载）时不缓存
  const c = DATA._brSum[tag] || (DATA._brSum[tag] = [{}]);
  for (let T = c.length - 1; T < n; T++) {
    const o = Object.assign({}, c[T]), g = (DATA.brRow(rows, Math.floor(T / DATA.LAYERS)) || [0, {}])[1] || {};
    const FM = tag === "rs" ? _R.BODY_FIRST_MULT : _R.FIRST_MULT, ri = Math.floor(T / DATA.LAYERS);   // 大境界第一层 × FIRST_MULT（数组 = 每个境界单独设）
    const fm = T % DATA.LAYERS !== 0 || FM === undefined ? 1 : Array.isArray(FM) ? (FM.length ? +(FM[Math.min(ri, FM.length - 1)] ?? 1) : 1) : +FM;
    for (const k in g) o[k] = (o[k] || 0) + (+g[k] || 0) * (k === "cultivate" ? 1 : fm);
    c[T + 1] = o;
  }
  return c[Math.max(0, n)] || {};
};
// 突破属性自动计算（config/realm.js 的 AUTO）：返回每境界每层属性行 [[境界, {属性: 每层}]...]，算一次缓存
//   第一个境界 = 1 星宗门功法每层 × (1 + FIRST_PCT[属性]%)（可负数；也可写一个数 = 全部属性一样；没写的属性照表原值）；
//   以后各境界不再对标功法：第 r 境界 = 第一个 × (表r / 表0)^p，p 二分求出让全部境界合计 = 宗门功法 TOTAL × TOTAL_PCT%
DATA._autoRows = {};
DATA.autoRows = body => {
  const A = _R.AUTO, rows = body ? _R.BODY_GAIN : _R.GAIN; if (!A || !+A.on || !DATA.gfUnit) return rows;
  const tag = body ? "rs" : "xw"; if (DATA._autoRows[tag]) return DATA._autoRows[tag];
  const FP0 = body ? A.BODY_FIRST_PCT : A.XW_FIRST_PCT, FP = typeof FP0 === "object" && FP0 ? FP0 : new Proxy({}, { get: () => +FP0 || 0 }), TP0 = body ? A.BODY_TOTAL_PCT : A.XW_TOTAL_PCT, tpOf = k => typeof TP0 === "object" && TP0 ? +TP0[k] || 0 : +TP0 || 0;
  const TOT = (CFG.gongfa.sect || {}).TOTAL || {}, SS = (CFG.gongfa.sect || {}).STAT_STAR || [1], N = DATA.realms.length, LY = DATA.LAYERS;
  const FM = body ? _R.BODY_FIRST_MULT : _R.FIRST_MULT, fmOf = r => FM === undefined ? 1 : Array.isArray(FM) ? (FM.length ? +(FM[Math.min(r, FM.length - 1)] ?? 1) : 1) : +FM;
  const g = r => (DATA.brRow(rows, r) || [0, {}])[1] || {}, out = [];
  for (let r = 0; r < N; r++) out.push([r, {}]);
  const keys = Object.keys(g(0));
  for (const k of keys) {
    if (k === "cultivate" || (body && k === "mana") || FP[k] === undefined || !TOT[k]) { for (let r = 0; r < N; r++) if (g(r)[k] !== undefined && !(body && k === "mana")) out[r][1][k] = g(r)[k]; continue; }
    const v0 = DATA.gfUnit(k) * (SS[0] || 1) * (1 + (+FP[k] || 0) / 100), g0 = +g(0)[k] || 1, target = TOT[k] * tpOf(k) / 100;
    const ratio = []; for (let r = 0; r < N; r++) ratio.push(Math.max(1e-9, (+g(r)[k] || g0) / g0));
    const sum = p => { let t = 0; for (let r = 0; r < N; r++) t += v0 * Math.pow(ratio[r], p) * (LY - 1 + fmOf(r)); return t; };
    let lo = 0, hi = 1; while (sum(hi) < target && hi < 64) hi *= 2;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (sum(m) < target) lo = m; else hi = m; }
    const p = sum(0) >= target ? 0 : (lo + hi) / 2;
    for (let r = 0; r < N; r++) out[r][1][k] = v0 * Math.pow(ratio[r], p);
  }
  return DATA._autoRows[tag] = out;
};
// 第 T 层（总层序）突破某项属性加多少：含大境界第一层 × FIRST_MULT 和总倍率（突破随机 brRoll 用）
DATA.brLayerGain = (body, T, k) => {
  T = Math.max(0, T); const ri = Math.floor(T / DATA.LAYERS), g = (DATA.brRow(DATA.autoRows(body), ri) || [0, {}])[1] || {};
  const FM = body ? _R.BODY_FIRST_MULT : _R.FIRST_MULT, fm = k === "cultivate" || T % DATA.LAYERS !== 0 || FM === undefined ? 1 : Array.isArray(FM) ? (FM.length ? +(FM[Math.min(ri, FM.length - 1)] ?? 1) : 1) : +FM;
  return (+g[k] || 0) * fm * DATA.gainRate(body, k);
};
// 突破属性总倍率（config/realm.js GAIN_RATE / BODY_GAIN_RATE）：每层突破加的属性 × 倍率，人物、怪物、雷劫、装备参考属性全部生效；修炼速度不乘
DATA.gainRate = (body, k) => { const v = body ? _R.BODY_GAIN_RATE : _R.GAIN_RATE; return k === "cultivate" || v === undefined ? 1 : +v || 0; };
// 修为突破属性：凡人基础（player.base / RES_BASE）+ 突破到第 L 层的合计 × 倍率；L < 0 = 凡人
DATA.realmStat = (L, k) => (k === "res" ? _P.RES_BASE || 0 : _P.base[k] || 0) + (DATA.brSum(DATA.autoRows(false), L < 0 ? 0 : L + 1, "xw")[k] || 0) * DATA.gainRate(false, k);
// 肉身突破属性：突破 n 层的合计 × 倍率
DATA.bodyStat = (n, k) => (DATA.brSum(DATA.autoRows(true), n, "rs")[k] || 0) * DATA.gainRate(true, k);
DATA.plRealmStat = DATA.realmStat; DATA.plBodyStat = DATA.bodyStat;
// 按比例减免（config/battle.js FORMULA / RATIO）：L = 攻击方层序；标准值 = 该层修为突破 + 肉身突破的防御 / 抗性
DATA.ratioOn = () => (CFG.battle || {}).FORMULA === "ratio";
DATA.ratioCfg = () => Object.assign({ DEF_K: 1, RES_K: 1, DEF_CAP: 75, RES_CAP: 75, SP_DEF: 0.5 }, (CFG.battle || {}).RATIO || {});
DATA.refK = (L, k) => {
  L = Math.max(0, Math.floor(L || 0));
  if (!DATA._rk || DATA._rk.r !== CFG.realm) DATA._rk = { r: CFG.realm, m: {} };
  const key = k + L; if (DATA._rk.m[key] === undefined) DATA._rk.m[key] = Math.max(1, DATA.realmStat(L, k) + DATA.bodyStat(L + 1, k));
  return DATA._rk.m[key];
};
DATA.cutPct = (v, K, cap) => Math.min((cap === undefined ? 75 : cap) / 100, Math.max(0, v) / (Math.max(0, v) + K));
DATA.cutAtk = (p, def, L) => { const C = DATA.ratioCfg(); return p * (1 - DATA.cutPct(def, DATA.refK(L, "def") * C.DEF_K, C.DEF_CAP)); };
// 属性伤害：防御 × SP_DEF 和抗性合成一个「减伤值」，只算一次减免（不是两次相乘）
DATA.cutEl = (p, def, res, L, ign) => { const C = DATA.ratioCfg(), v = (def || 0) * C.SP_DEF + Math.max(0, (res || 0) - (ign || 0));
  return p * (1 - DATA.cutPct(v, (DATA.refK(L, "def") * C.SP_DEF + DATA.refK(L, "res")) * C.RES_K, C.RES_CAP)); };

// 人物属性：base = 凡人基础（再加修为突破合计，见 DATA.realmStat）；fixed 不随境界
DATA.playerFixed = _P.fixed;
// 命中率：见 config/battle.js 的 HIT_*（v183 按整档加减）
DATA.hitChance = (hit, dodge, k) => { const B = CFG.battle, d = Math.max(0, dodge || 0), diff = ((hit || 0) - d) / Math.max(1, d + (B.HIT_PAD || 0)) * 100;   // 相对差 = (命中 − 闪避) ÷ (闪避 + HIT_PAD)
  // v183 按整档算：高 每满 HIT_UP_STEP % +HIT_UP_ADD %；低 每满 HIT_DN_STEP % −HIT_DN_ADD %（不满一档不变）
  const add = diff >= 0 ? Math.floor(diff / B.HIT_UP_STEP + 1e-9) * B.HIT_UP_ADD : -Math.floor(-diff / B.HIT_DN_STEP + 1e-9) * B.HIT_DN_ADD;
  // v220 k：0 普通攻击 / 1 法术（+ SPELL_HIT_ADD）/ 2 法宝（+ FABAO_HIT_ADD），加完仍不超过 HIT_MAX
  const bonus = k === 1 ? (B.SPELL_HIT_ADD || 0) : k === 2 ? (B.FABAO_HIT_ADD || 0) : 0;
  return Math.min(B.HIT_MAX, Math.max(B.HIT_MIN, B.HIT_BASE + add) + bonus); };
DATA.dodgeChance = (hit, dodge, k) => 100 - DATA.hitChance(hit, dodge, k);   // 闪避几率 = 100 − 命中率
DATA.CRIT_CAP = _P.CRIT_CAP;



// 修炼节奏：每 10 秒结算一次
DATA.TICK = 10;

// v171 保底伤害：练气一层 MIN_BASE，每层 + MIN_STEP（L = 总层序，0 = 练气一层）
// 保底伤害：L = 出手方层序，D = 对方层序（不写 = 不比境界，如雷劫）；比对方每高 1 层 + MIN_HIGH，每低 1 层 − MIN_LOW，最少 MIN_FLOOR
DATA.minDmg = (L, D) => {
  const B = CFG.battle, v = (x, d) => x === undefined ? d : x; L = Math.max(0, L || 0);
  let x = v(B.MIN_BASE, 1) + v(B.MIN_STEP, 3) * L;
  if (D !== undefined) { D = Math.max(0, D || 0); x += L > D ? (L - D) * v(B.MIN_HIGH, 0) : -(D - L) * v(B.MIN_LOW, 0); }
  return Math.max(v(B.MIN_FLOOR, 1), x);
};

/* 法力消耗境界倍率：L = 层序（大境界 = floor(L / LAYERS)），取 CFG.mobs.magic.MANA_REALM[大境界]，没配 / 少写沿用最后一项 / 不写 = 1
 * 怪物法术法宝、人物法术法宝共用 */
DATA.manaRealmK = L => {
  const A = (((typeof CFG !== "undefined" && CFG.mobs) || {}).magic || {}).MANA_REALM || [];
  if (!A.length) return 1;
  const x = +A[Math.min(Math.max(0, Math.floor((L || 0) / DATA.LAYERS)), A.length - 1)];
  return isFinite(x) && x >= 0 ? x : 1;
};
