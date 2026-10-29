/* =====================================================================
 * 数据：炼器（装备、空间石）（v21）
 * ---------------------------------------------------------------------
 * 数值在 js/config/forge.js，这里是名字和计算。
 * 炼制的装备在背包里是 { t: "eq", e: { slot, g: 阶, name, q: 最好的颜色品质, attrs: [{ k, c, r, m }] } }
 *   attrs：k 属性、c 颜色(0 白 1 绿 2 紫 3 金)、r 随机系数、m 1 = 主属性 / 0 = 附加属性
 *   数值按 config 实时计算，改了 config 已有装备也会跟着变
 * 空间石在背包里是 { t: "ss", g: 阶, n: 数量 }
 * ===================================================================== */
const _FG = CFG.forge;

// 每星每部位一种装备（一星 ~ 十星）
DATA.forgeNames = {
  helmet:  ["青铜盔", "玄铁盔", "赤炎冠", "寒玉冠", "紫金冠", "星辰冠", "太虚冠", "混元冠", "鸿蒙冠", "道源冠"],
  armor:   ["青铜甲", "玄铁甲", "赤炎袍", "寒玉衣", "紫金甲", "星辰战衣", "太虚道袍", "混元宝甲", "鸿蒙仙衣", "道源圣衣"],
  weapon:  ["青铜剑", "玄铁剑", "赤炎刀", "寒玉剑", "紫金锏", "星辰剑", "太虚剑", "混元戟", "鸿蒙剑", "道源剑"],
  legs:    ["青铜护腿", "玄铁护腿", "赤炎护膝", "寒玉腿甲", "紫金腿甲", "星辰护腿", "太虚护腿", "混元腿甲", "鸿蒙护腿", "道源护腿"],
  boots:   ["青铜靴", "玄铁靴", "赤炎靴", "寒玉靴", "紫金靴", "星辰靴", "太虚靴", "混元靴", "鸿蒙靴", "道源靴"],
  pendant: ["青铜坠", "玄铁坠", "赤炎佩", "寒玉佩", "紫金坠", "星辰佩", "太虚佩", "混元坠", "鸿蒙佩", "道源佩"],
};
// 名字在 config/names.js 的 forge（上面是原名，读档对照用）
DATA.NM_DEF.forge = JSON.parse(JSON.stringify(DATA.forgeNames));
for (const k in DATA.forgeNames) DATA.forgeNames[k] = DATA.nmArr((CFG.names.forge || {})[k], DATA.forgeNames[k]);
DATA.forgeSlots = Object.keys(DATA.forgeNames);            // 能炼的部位
DATA.attrNames = { hp: "生命", atk: "攻击", def: "防御", mana: "法力", speed: "速度", hit: "命中", dodge: "闪避", crit: "暴击%" };
for (const k in DATA.attrNames) DATA.attrNames[k] = DATA.nmPick(CFG.names.attr, k, DATA.attrNames[k]);
DATA.COLOR_Q = [0, 1, 3, 4];                                // 颜色 → 品质样式（白 绿 紫 金）

DATA.forgeEqName = (slot, g) => DATA.XING[g] + "·" + DATA.forgeNames[slot][g];
DATA.forgeEqMats = g => DATA.parseMats(_FG.equip.mats[g]);
// 精炼阶（装备 / 法宝 / 戒指的 e.rj，0 = 一阶 … 9 = 十阶）：刚炼出、升星后都是一阶；升星要上一星十阶的同类
DATA.RJ_MAX = 10;
DATA.rjOf = e => Math.max(0, Math.min(DATA.RJ_MAX - 1, (e && e.rj) || 0));
DATA.rjName = e => DATA.JIE[DATA.rjOf(e)];
DATA.rjTop = e => DATA.rjOf(e) >= DATA.RJ_MAX - 1;
// 精炼材料：炼制这一星时的三种矿石（数量相同）
DATA.refineMats = e => e.slot === "ring" ? DATA.ringMats(e.g) : DATA.forgeEqMats(e.g);
DATA.forgeEqTime = g => _FG.equip.time[g] * 60000;
DATA.stoneName = g => DATA.JIE[g] + DATA.SS;
DATA.stoneMats = g => DATA.parseMats(_FG.stone.mats[g]);
DATA.stoneTime = g => _FG.stone.time[g] * 60000;

// 法宝：7 种形状（config/forge.js 的 fabao.types：剑 刀 锤 环 盾 鼎 印），属性炼制时自己选，显示如 一阶·火·剑
//   法宝在存档里：ft = 形状序号、el = 属性
DATA.fabaoTypes = _FG.fabao.types;
DATA.forgeNames.fabao = DATA.XING.map(() => DATA.slots.fabao);        // 门派炼器室图谱名：一阶·法宝
DATA.elIdx = el => Math.max(0, DATA.elements.findIndex(x => x.id === el));   // 属性序号（金木水火土雷 = 0~5）
// 法宝名字（config/names.js 的 fabaoName[形状][阶]），没写就用形状名
DATA.fabaoName = (ft, g, def) => { const L = (CFG.names.fabaoName || {})[ft]; return (L && L[g]) || def || (DATA.fabaoTypes[ft] || {}).name || "法宝"; };
// 秘境专用材料（config/mijing.js 的 items）：背包里 { t: "sm", k, ft, n }，k = kj 空间晶核 / lu 养神露 / ys 耀石（ft = 属性序号 0~5）
//   ft = -1 表示「任意一种耀石」（装备、戒指炼制和强化用；扣的时候先扣最多的那种）
//   lj 灵晶、lz 灵珠也分属性（ft = 0~4 金木水火土）；灵珠的设置在 config/array.js 的 CFG.lingzhu
if (CFG.lingzhu) CFG.mijing.items.lz = { name: "灵珠", names: CFG.lingzhu.NAMES, sell: CFG.lingzhu.SELL, desc: CFG.lingzhu.DESC };
if (!CFG.mijing.items.ly) CFG.mijing.items.ly = { name: "灵元", names: ["金灵元", "木灵元", "水灵元", "火灵元", "土灵元", "雷灵元"], sell: 5, desc: "升级道童、灵根的材料。" };   // 管理员改过 mijing.js 也有
DATA.SM_GRADED = ["ys", "lj", "lz", "ly"];
// 等比数列：第 i 次（0 起，共 n 次）= first × (last / first)^(i / (n − 1))，每次涨的倍率相同（道童、灵根升级用）
DATA.geoStep = (first, last, i, n) => n <= 1 || first <= 0 ? last : Math.round(first * Math.pow(last / first, Math.min(Math.max(i, 0), n - 1) / (n - 1)));
DATA.smName = (k, ft) => {
  const I = CFG.mijing.items;
  if (DATA.SM_GRADED.includes(k) && I[k]) return ft >= 0 ? ((I[k].names || [])[ft] || DATA.elements[ft].name + I[k].name) : I[k].name;
  return (I[k] || {}).name || k;
};
// 按名字找专用材料：「耀石」（每个随机一种属性）「火耀石」……
DATA.smByName = name => {
  const I = CFG.mijing.items;
  for (const k of DATA.SM_GRADED) if (I[k]) { if (name === I[k].name) return { k }; const f = (I[k].names || []).indexOf(name); if (f >= 0) return { k, ft: f }; }
  for (const k in I) if (!DATA.SM_GRADED.includes(k) && I[k].name === name) return { k };
  return null;
};
DATA.smIcon = (k, ft) => DATA.SM_GRADED.includes(k) ? DATA.iconImg("sm_" + k + Math.max(0, ft || 0)) : DATA.iconImg("sm_" + k);
// 掉落记账的键：k / k:ft
DATA.smKey = (k, ft) => k + (ft === undefined ? "" : ":" + ft);
DATA.smParse = key => { const [k, f] = key.split(":"); return { k, ft: f === undefined ? undefined : +f }; };
DATA.forgeSlots = Object.keys(DATA.forgeNames);            // 能炼的部位（含法宝）
DATA.eqSlots6 = DATA.forgeSlots.filter(x => x !== "fabao"); // 头盔 ~ 吊坠
// v25：戒指 9 种（主属性见 config/forge.js 的 forge.ring.main）
DATA.ringNames = ["破军戒", "磐石戒", "长生戒", "灵犀戒", "疾风戒", "鹰眼戒", "幻影戒", "烈阳戒", "玄武戒"];
DATA.NM_DEF.ring = DATA.ringNames.slice();                  // 原名（读档对照用）；名字在 config/names.js 的 ring
DATA.ringNames = DATA.nmArr(CFG.names.ring, DATA.ringNames);
DATA.ringName = (r, g) => DATA.XING[g] + "·" + DATA.ringNames[r];
DATA.ringMats = g => DATA.parseMats(_FG.ring.mats[g]);
DATA.ringTime = g => _FG.ring.time[g] * 60000;
DATA.ringBpName = (g, r) => DATA.XING[g] + (DATA.ringNames[r] || "戒指") + "图纸";   // v26：图纸分戒指种类（r）
// 法宝属性名（额外伤害 elDmg 带一个属性 el）
DATA.fbAttrNames = { uses: "祭出次数", pct: "伤害", elDmg: "额外伤害", ignRes: "无视抗性", manaCut: "法力消耗减少%",
  sAtk: "攻击", dSAtk: "攻击", sHit: "命中", sCrit: "暴击%", sCritDmg: "暴击伤害%", sMana: "本法宝法力消耗减少%", sDing: "降低属性", sYin: "眩晕几率%",
  shHpMain: "护盾值", shDef: "防御", shHp: "增加护盾值", dmgRed: "受到伤害减少%" };
for (const k in DATA.fbAttrNames) DATA.fbAttrNames[k] = DATA.nmPick(CFG.names.fbAttr, k, DATA.fbAttrNames[k]);
// v108 法宝一条属性的比例 %：按颜色在 [最小, 最大] 里，位置 p（0~1），保留一位小数
DATA.fbRange = k => { const F = _FG.fabao; return (F.MAIN || {})[k] || (F.AFFIX || {})[k] || (F.SPECIAL || {})[k]; };
DATA.fbPct = a => { const R = DATA.fbRange(a.k), r = R && (R[a.c] || R[R.length - 1]), q = a.k === "shHpMain" || a.k === "shDef" ? 100 : 10;   // v167 盾主属性比例保留两位小数
  return r ? Math.round((r[0] + (r[1] - r[0]) * (a.p || 0)) * q) / q : 0; };
DATA.fbRj = (k, e) => (((_FG.fabao.REFINE || {})[k]) || 0) * DATA.rjOf(e);   // 法宝精炼加的百分点
// 比例 × 哪个参考属性（不写 = 本身就是 %）
DATA.FB_REF_OF = { shHpMain: "hp", shHp: "hp", sAtk: "atk", dSAtk: "atk", sHit: "hit" };

// 颜色 c 在第 g 阶的数值范围 [最小, 最大]（config/forge.js 的 attr.RANGE）
DATA.colorRange = (c, g) => _FG.attr.RANGE[c][g];
// 属性在范围里的位置 0~1
DATA.attrPos = a => a.p || 0;
DATA.rangeMult = (a, g) => { const [lo, hi] = DATA.colorRange(a.c, g); return lo + (hi - lo) * DATA.attrPos(a); };
// 强化：整件 e.enh 级（config/forge.js 的 forge.enhance.equip / fabao；法宝见 DATA.fbEnh，装备 / 戒指见 DATA.eqEnh）
DATA.enhCfg = e => CFG.forge.enhance[e && e.slot === "fabao" ? "fabao" : "equip"];
// 装备 / 戒指：强化后这条主属性加多少（固定数值）；不是主属性、PER 里没写（暴击）= 0
DATA.eqEnhPer = (e, k) => (((CFG.forge.enhance.equip.PER || {})[k]) || [])[e.g] || 0;
DATA.eqEnh = (a, e) => e && e.slot !== "fabao" && a.m ? (e.enh || 0) * DATA.eqEnhPer(e, a.k) : 0;
// 一条属性的数值（e = 整件装备，用来区分法宝 / 戒指），含强化
DATA.attrVal = (a, g, e) => DATA.attrBase(a, g, e);   // v156 强化属性单独算（DATA.eqEnhStats），不并进属性条，洗练不影响
// v156 装备 / 戒指强化属性：{ 属性: 数值 }，按主属性种类 × 强化等级，只随升阶（每级数值）变化
DATA.eqEnhStats = e => { const o = {}; if (!e || !e.attrs || e.slot === "fabao" || !e.enh) return o;
  for (const a of e.attrs) if (a.m && !(a.k in o)) { const v = e.enh * DATA.eqEnhPer(e, a.k); if (v > 0) o[a.k] = v; } return o; };
// 一条属性没强化时的数值
// 装备 / 戒指：REF[阶] 境界的修为突破 + 肉身突破属性 × PCT[颜色]%（暴击除外）
DATA._eqRef = {};
DATA.eqRef = g => DATA._eqRef[g] || (DATA._eqRef[g] = (() => { const r = (_FG.attr.REF || [])[g] || [2 * g + 1, 10]; return DATA.mobStats([r[0], r[1], 0, [1, 0, 0], [2, 0, 0], [3, 0, 0], 1]); })());
DATA.eqPctOK = a => a.k !== "crit";
DATA.eqPct = a => { const R = _FG.attr.PCT, r = R[a.c] || R[R.length - 1]; return Math.round((r[0] + (r[1] - r[0]) * DATA.attrPos(a)) * 100) / 100; };
DATA.attrBase = (a, g, e) => {
  const A = _FG.attr, fb = e && e.slot === "fabao" && e.attrs;
  if (!fb && DATA.eqPctOK(a)) return (DATA.eqRef(g)[a.k] || 0) * (DATA.eqPct(a) + (a.m && e ? DATA.rjOf(e) * ((CFG.forge.refine || {}).PCT || 0) : 0)) / 100 * (e && e.slot === "ring" ? (_FG.ring.MULT || 1) : 1);
  // 附加暴击单独设置了「每阶金色最高值」（AFFIX_TOP，装备 / 戒指）
  const TOP = !a.m && !fb && A.AFFIX_TOP;
  if (TOP && TOP[a.k] && TOP[a.k][g] !== undefined) {
    const last = DATA.colorRange(A.colors.length - 1, g)[1] || 1;
    return TOP[a.k][g] * DATA.rangeMult(a, g) / last;
  }
  if (fb) {   // v108 法宝：比例 %（按颜色随机）；FB_REF_OF 里的 = 参考属性 × %，盾 = 参考生命 / 防御 × SHIELD_MULT × %；鼎 = 回合数
    if (a.k === "sDing") return (_FG.fabao.DING_ROUNDS || [])[a.c] || 1;
    const v = DATA.fbPct(a) + DATA.fbRj(a.k, e), ref = DATA.fbRef(g);
    // v165 盾（方案 A，同攻击法宝）：基数 = 自己修为 + 肉身（不超过参考值）+ 功法
    // v167 盾主属性：法宝对应境界（参考）生命 / 防御 × SHIELD_MULT（3.8）× %
    const SM = _FG.fabao.SHIELD_MULT || 1;
    if (a.k === "shHpMain") return ref.hp * SM * v / 100;
    if (a.k === "shDef") return ref.def * SM * v / 100;
    if (a.k === "shHp") { let m = 0; for (const b of e.attrs) if (b.k === "shHpMain") m += ref.hp * SM * (DATA.fbPct(b) + DATA.fbRj(b.k, e)) / 100; return m * v / 100; }   // v170 附加护盾值 = 盾主属性护盾值 × %（不算强化）
    return DATA.FB_REF_OF[a.k] ? ref[DATA.FB_REF_OF[a.k]] * v / 100 : v;
  }
  // 主属性暴击%：base.crit × 阶数 × 颜色范围倍率（附加暴击都在上面 AFFIX_TOP）
  return (A.base[a.k] || 0) * (g + 1) * DATA.rangeMult(a, g) * (e && e.slot === "ring" ? (_FG.ring.MULT || 1) : 1);
};
DATA.bestQ = attrs => DATA.COLOR_Q[Math.max(...attrs.map(a => a.c))];
// 随机一条属性（颜色 + 位置）；w = 颜色权重（不填 = attr.colors 的 weight）
DATA.rollAttr = (k, m, el, w) => { const a = { k, c: U.weighted(w || _FG.attr.colors.map(c => c.weight)), p: Math.random(), m }; if (el) a.el = el; return a; };
// 法宝颜色权重：新得到的最高 NEW_COLOR_MAX（默认绿），洗练用 reset.WASH_WEIGHT
DATA.fabaoNewW = () => { const mx = _FG.fabao.NEW_COLOR_MAX === undefined ? 1 : _FG.fabao.NEW_COLOR_MAX; return _FG.attr.colors.map((c, i) => i <= mx ? c.weight : 0); };
DATA.fabaoWashW = () => _FG.reset.WASH_WEIGHT || _FG.attr.colors.map(c => c.weight);
// v53：新得到的装备 / 戒指颜色权重，最高 attr.NEW_COLOR_MAX（默认绿）；紫、金只能洗练
DATA.equipNewW = () => { const mx = _FG.attr.NEW_COLOR_MAX === undefined ? 1 : _FG.attr.NEW_COLOR_MAX; return _FG.attr.colors.map((c, i) => i <= mx ? c.weight : 0); };
// 法宝附加属性：附加伤害、无视抗性带属性（金木水火土雷随机，和法宝属性一样才生效）
DATA.fbAffix = (k, W) => DATA.rollAttr(k, 0, k === "elDmg" || k === "ignRes" ? U.pick(DATA.elements).id : undefined, W);
// 随机生成一件装备 / 戒指（r = 戒指种类）/ 法宝
DATA.fbPool = T => T && T.shield ? _FG.fabao.SHIELD_POOL : _FG.fabao.pool;   // 法宝附加属性池（盾单独一组）
// v164 祭出次数（uses）一件法宝最多一条：已经有了就不再随机出来
DATA.fbPoolLeft = (pool, attrs) => attrs.some(a => a.k === "uses") ? pool.filter(k => k !== "uses") : pool;
// 祭出次数那一条的序号（没有 = -1）
DATA.fbUsesIdx = e => (e.attrs || []).findIndex(a => a.k === "uses");
// 装备 / 法宝的持久唯一标识：渡劫格子、法宝融合等按 uid 找法宝。
// 以前这里不生成 uid，客户端弹窗里现生成的 uid 进不了服务端存档，
// 服务端同步后格子里的法宝就变成「已失效」。
DATA.newUid = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
DATA.rollForged = (slot, g, r, el) => {
  const A = _FG.attr;
  if (slot === "fabao") {   // r = 形状序号、el = 属性（不填就随机）
    const F = _FG.fabao, ft = r === undefined ? Math.floor(Math.random() * DATA.fabaoTypes.length) : r, T = DATA.fabaoTypes[ft];
    const elv = el && DATA.elById[el] ? el : U.pick(DATA.elements).id;
    const W = DATA.fabaoNewW(), attrs = (T.shield ? ["shHpMain", "shDef"] : ["pct"]).map(k => DATA.rollAttr(k, 1, undefined, W));
    for (const k of T.special || []) attrs.push(DATA.rollAttr(k, 2, undefined, W));
    const n = DATA.affixRollN(F.AFFIX_COUNT, g), pool = DATA.fbPool(T);
    for (let i = 0; i < n; i++) attrs.push(DATA.fbAffix(U.pick(DATA.fbPoolLeft(pool, attrs)), W));   // v164 祭出次数最多一条
    return { slot, g, ft, el: elv, name: DATA.fabaoName(ft, g), enh: 0, q: DATA.bestQ(attrs), attrs, uid: DATA.newUid() };
  }
  if (slot === "ring" && r === undefined) r = Math.floor(Math.random() * DATA.ringNames.length);
  const main = (slot === "ring" ? _FG.ring.main[r] : A.main[slot] || []).slice(0, 2), W = DATA.equipNewW(), attrs = main.map(k => DATA.rollAttr(k, 1, undefined, W));
  const pool = A.pool.filter(k => !main.includes(k)), n = Math.min(pool.length, DATA.affixRollN(A.AFFIX_COUNT, g));
  for (let i = 0; i < n; i++) { const j = Math.floor(Math.random() * pool.length); attrs.push(DATA.rollAttr(pool.splice(j, 1)[0], 0, undefined, W)); }
  const e = { slot, g, name: slot === "ring" ? DATA.ringNames[r] : DATA.forgeNames[slot][g], q: DATA.bestQ(attrs), attrs, uid: DATA.newUid() };
  if (slot === "ring") e.r = r;
  return e;
};
// 升阶：颜色、位置都不变，只改阶和名字（数值按新阶自动变大）
DATA.upgradeForged = (prev, g) => {
  const e = JSON.parse(JSON.stringify(prev));
  if (!e.uid) e.uid = DATA.newUid();
  if (e.enh > 0) { const E = DATA.enhCfg(e); e.enh = Math.max(0, e.enh - Math.max(E.DOWN_MIN === undefined ? 1 : E.DOWN_MIN, Math.floor(e.enh * (E.DOWN_PCT || 0) / 100))); }   // v152 法宝升阶：强化等级 −20%，最少 −1
  e.g = g; e.rj = 0;   // 升星后回到一阶
  e.name = e.slot === "ring" ? DATA.ringNames[e.r] : e.slot === "fabao" ? DATA.fabaoName(e.ft, g) : DATA.forgeNames[e.slot][g];
  return e;
};
// 火髓洗练：locks = 锁定的属性序号；没锁的重新随机
DATA.resetCost = (e, nLock) => { const R = _FG.reset, b = R.FIRE[e.g] || R.FIRE[R.FIRE.length - 1] || 1;   // v224 每锁一条 + 基础 × LOCK_ADD
  return Math.ceil(b * (1 + nLock * (R.LOCK_ADD === undefined ? 1 : R.LOCK_ADD))); };
// v224 附加属性上限（按物品阶）：reset.AFFIX_MAX 可写一个数或按阶的数组
DATA.affixMax = g => { const M = _FG.reset.AFFIX_MAX; return Array.isArray(M) ? (M[g] !== undefined ? M[g] : M[M.length - 1]) : (M || 5); };
// 新物品附加属性条数：按权重随机，超过上限的不算（权重第 1 个 = 1 条）
DATA.affixRollN = (W, g) => { const mx = DATA.affixMax(g), w = W.slice(0, Math.max(1, mx)); return U.weighted(w.some(x => x > 0) ? w : w.map(() => 1)) + 1; };
// v44：没锁的附加属性重新随机条数 —— 锁定的附加属性 + 新随机的 ≤ 附加属性上限（v224 按阶，DATA.affixMax），新随机的至少 1 条（锁满了就 0 条）
//   新条数在 [1, AFFIX_MAX − 锁定的附加属性] 里按 reset.COUNT_WEIGHT 随机
DATA.washRange = (e, locks) => {
  const MX = DATA.affixMax(e.g), lockedAff = e.attrs.filter((a, i) => !a.m && locks.includes(i)).length;
  const hi = Math.max(0, MX - lockedAff); return [Math.min(1, hi), hi];
};
DATA.rerollForged = (e, locks) => {
  const A = _FG.attr, fb = e.slot === "fabao", W = fb ? DATA.fabaoWashW() : A.colors.map(c => c.weight);   // 法宝洗练颜色权重单独设置
  const used = e.attrs.filter((a, i) => locks.includes(i) || a.m).map(a => a.k);
  const [lo, hi] = DATA.washRange(e, locks), CW = _FG.reset.COUNT_WEIGHT || [1, 1, 1, 1, 1];
  let w = []; for (let c = lo; c <= hi; c++) w.push(CW[c - 1] || 0);
  if (!w.some(x => x > 0)) w = w.map(() => 1);
  const n = hi <= 0 ? 0 : lo + U.weighted(w);
  const have = e.attrs.filter((a, i) => locks.includes(i));   // v164 已有的（锁定的 + 新洗出来的），祭出次数最多一条
  const roll = () => {
    let k;
    if (fb) { k = U.pick(DATA.fbPoolLeft(DATA.fbPool(DATA.fabaoTypes[e.ft]), have)); have.push({ k }); }
    else { const pool = A.pool.filter(x => !used.includes(x)); if (!pool.length) return null; k = U.pick(pool); used.push(k); }
    return fb ? DATA.fbAffix(k, W) : DATA.rollAttr(k, 0, undefined, W);
  };
  let made = 0;
  const out = [];
  e.attrs.forEach((a, i) => {
    if (locks.includes(i)) return out.push(a);
    if (a.m) { a.c = U.weighted(W); a.p = Math.random(); return out.push(a); }
    if (made < n) { const x = roll(); if (x) { out.push(x); made++; } }   // 原来的位置换成新属性，多出来的格子去掉
  });
  while (made < n) { const x = roll(); if (!x) break; out.push(x); made++; }
  e.attrs = out;
  e.q = DATA.bestQ(e.attrs);
};
// 一条属性的文字
DATA.attrText = (a, e) => {
  const v = U.num(DATA.attrVal(a, e.g, e)), col = (_FG.attr.colors[a.c] || {}).name || "";
  if (e.slot === "fabao") {
    const el = DATA.elById[a.el] ? DATA.elById[a.el].name : "", p = Math.round(DATA.attrVal(a, e.g, e) * 10) / 10, F = _FG.fabao;   // % 类保留一位小数
    const t = { pct: `伤害 攻击×${p}%`, elDmg: `${el}属性伤害 ${p}%`, ignRes: `攻击时无视${el}抗 ${p}%`, manaCut: `法力消耗 -${p}%`,
      sAtk: `法宝攻击时额外增加攻击 +${v}`, dSAtk: `法宝攻击时额外增加攻击 +${v}`, sHit: `法宝攻击时额外增加命中 +${v}`, sCrit: `法宝攻击时额外增加暴击 +${p}%`, sCritDmg: `暴击伤害 ${p}%`, sMana: `本法宝法力消耗 -${p}%`,
      sDing: `击中后降低对方属性 ${v} 回合`, sYin: `眩晕几率 ${p}%（${(F.YIN_ROUNDS || [])[a.c] || 1} 回合）`,
      shHpMain: `护盾值 ${v}`, shDef: `防御 ${v}`, shHp: `护盾值 +${v}`, dmgRed: `受到伤害 -${p}%`, uses: `每场战斗祭出次数 +${Math.round(p)}` }[a.k] || DATA.fbAttrNames[a.k] || a.k;
    const txt = `${a.m === 2 ? "专属 " : a.m ? "" : a.k === "elDmg" ? "附加伤害 " : "附加 "}${t}（${col}）`;
    // v157 属性和法宝不同的附加伤害 / 无视抗性不生效：红字标出
    return (a.k === "elDmg" || a.k === "ignRes") && a.el !== e.el ? `<span class="fb-bad">${txt} 与法宝属性不合</span>` : txt;
  }
  return `${a.m ? "" : "附加 "}${DATA.attrNames[a.k]} +${v}（${col}）`;
};
// v107 法宝第 g 阶的参考属性：config/forge.js 的 fabao.REF[阶] 那个境界的人物属性（修为突破 + 肉身突破，不算功法），含 manaBr
DATA._fbRef = {};
// v152 法宝强化：盾 = 增加护盾值，其他 = 附加伤害（固定数字）
DATA.fbEnhPer = e => { const E = CFG.forge.enhance.fabao, T = DATA.fabaoTypes[e.ft] || {}; return ((T.shield ? E.SHIELD : E.DMG) || [])[e.g] || 0; };
DATA.fbEnh = e => (e.enh || 0) * DATA.fbEnhPer(e);
DATA.fbRef = g => DATA._fbRef[g] || (DATA._fbRef[g] = (() => { const r = (_FG.fabao.REF || [])[g] || [2 * g + 1, 10]; return DATA.mobStats([r[0], r[1], 0, [1, 0, 0], [2, 0, 0], [3, 0, 0], 1]); })());
// 法宝攻击 = 自己修为 + 肉身攻击（不超过参考攻击）+ 功法攻击（own 不写 = 玩家自己的，见 data/gongfa.js 的 DATA.capAtk）
// 法宝战斗数值（atk 已含剑 / 刀的专属攻击；hit、critAdd = 刀 / 锤攻击时额外命中、暴击%）：{ el, atk, pct, mana, ign, cutPct, extra: [{ el, pct }], crit（锤暴击伤害%）, shield, ding, yin }
DATA.fabaoInfo = (e, own) => {
  const F = _FG.fabao, T = DATA.fabaoTypes[e.ft] || {}, ref = DATA.fbRef(e.g);
  const o = { name: DATA.fabaoName(e.ft, e.g, e.name), el: e.el, ft: e.ft, atk: DATA.capAtk(ref.atk, own), pct: 0, ign: 0, cutPct: 0, extra: [], fuPct: DATA.fusePct ? DATA.fusePct(e.fu) : 0 };   // fuPct 融合：伤害结果 +%
  let shHp = 0, shDef = 0, red = 0, ding = 0, yin = 0, yinC = 0;
  o.uses = F.USES === undefined ? 1 : F.USES;   // 每场战斗最多祭出几次
  if (T.shield) shHp += DATA.fbEnh(e); else o.addDmg = DATA.fbEnh(e);   // 强化：护盾值 / 附加伤害
  for (const a of e.attrs) {
    const v = DATA.attrVal(a, e.g, e);
    if (a.k === "pct") o.pct += v; else if (a.k === "ignRes") { if (a.el === e.el) o.ign += v; }   // 无视抗性、附加伤害：属性和法宝一样才生效
    else if (a.k === "elDmg") { if (a.el === e.el) o.extra.push({ el: a.el, pct: v }); }
    else if (a.k === "manaCut" || a.k === "sMana") o.cutPct += v;
    else if (a.k === "sAtk" || a.k === "dSAtk") o.atk += v;   // 专属：只在这件法宝攻击时生效
    else if (a.k === "sHit") o.hit = (o.hit || 0) + v;
    else if (a.k === "sCrit") o.critAdd = (o.critAdd || 0) + v;
    else if (a.k === "sCritDmg") o.crit = (o.crit || 0) + v;
    else if (a.k === "shHpMain" || a.k === "shHp") shHp += v; else if (a.k === "shDef") shDef += v; else if (a.k === "dmgRed") red += v;
    else if (a.k === "sDing") ding = Math.max(ding, v);
    else if (a.k === "sYin") { yin += v; yinC = Math.max(yinC, a.c); }
  }
  const ui = DATA.fbUsesIdx(e); if (ui >= 0) o.uses += Math.round(DATA.attrVal(e.attrs[ui], e.g, e));   // v164 祭出次数一件法宝最多一条
  const CAP = F.CAP || {}, at = (arr, d) => { const x = (arr || [])[e.g]; return x === undefined ? d : x; };
  o.pct *= (T.mul === undefined ? 1 : T.mul) * (F.DMG_MUL === undefined ? 1 : F.DMG_MUL);   // 形状倍率、DMG_MUL（不显示）
  if (T.shield) o.shield = { def: shDef, hp: shHp, red: Math.min(CAP.dmgRed === undefined ? 100 : CAP.dmgRed, red) };   // 盾
  if (T.ding) { const D = F.DING || {}; o.ding = { speed: at(D.SPEED, 0), hit: at(D.HIT, 0), dodge: at(D.DODGE, 0), rounds: ding || 1 }; }   // 鼎
  if (T.yin) o.yin = { chance: yin, rounds: (F.YIN_ROUNDS || [])[yinC] || 1 };   // 印
  o.cutPct = Math.min(CAP.manaCut === undefined ? 80 : CAP.manaCut, o.cutPct);
  o.ign = ref.res * Math.min(CAP.ignRes === undefined ? 100 : CAP.ignRes, o.ign) / 100;   // 无视抗性 = 参考抗性 × %
  // 人物大境界倍率（同法术）
  const R = typeof G !== "undefined" && G.s && !G.s.mortal ? Math.min(Math.floor(G.s.L / DATA.LAYERS), 23) : 0;
  const rv = a => { if (!a) return 1; const x = Array.isArray(a) ? a[R] : a[DATA.realms[R]]; return x === undefined ? 1 : x; };   // 按境界名取倍率
  o.pct *= rv(F.DMG_REALM);
  // 法力 = 该阶对应境界的修为突破法力 × MANA_PCT[主属性颜色]%；颜色只看第一条主属性
  const main = e.attrs.find(a => a.m === 1) || {};
  o.mana = Math.max(0, ref.manaBr * (((F.MANA_PCT || [])[main.c || 0] || 0) + DATA.fbRj("mana", e)) / 100 * (1 - o.cutPct / 100) * DATA.manaRealmK(R * DATA.LAYERS)   // × 法力境界倍率（config/mobs.js magic.MANA_REALM，按人物当前大境界，与怪物共用）
    * (1 + (typeof G !== "undefined" && G.s && G.s.lingen ? G.s.lingen[e.el] || 0 : 0) * ((CFG.gongfa || {}).MANA_LINGEN || 0)));   // × 灵根倍率（config/gongfa.js MANA_LINGEN，法宝属性那一系灵根，与法术共用）
  return o;
};

/* ---------- 图片 ----------
 * 浏览器缓存 30 天（nginx 设置）；换了图片把 IMG_V 加 1，玩家就会重新下载
 *   img/mats/herb0.png ……  药材、矿石（按 config/items.js 里的顺序）
 *   img/icons/eq_部位.png  装备、戒指；fb_属性.png 法宝；gf_属性.png 功法；sp_属性.png 法术
 *   img/icons/pill_丹药id.png 修炼丹、dan_类型.png 属性丹、fu_dan / fu_qi.png 炉子、ss.png 空间石
 *   fbs形状_属性.png 法宝（7 种形状 × 6 种属性）、sm_ys属性.png 耀石、mifa.png 秘法、seed.png 种子、stone.png 灵石、cu_misc.png 自定义物品
 *   hx.png 火髓、bp.png 图纸 */
DATA.IMG_V = 40;
DATA.matImg = (kind, g) => `img/mats/${kind}${g}.png?v=${DATA.IMG_V}`;
DATA.iconImg = n => `img/icons/${n}.png?v=${DATA.IMG_V}`;
DATA.ICON_EQ = ["helmet", "armor", "weapon", "legs", "boots", "pendant", "ring"];
// 自定义物品的图片：content/items.js 里写了 img（图片路径）就用它，没写用 cu_misc.png
DATA.cuIcon = d => d && d.img || DATA.iconImg("cu_misc");
// 装备 / 法宝的图片
DATA.eqIcon = e => {
  if (!e) return "";
  if (e.slot === "fabao") return DATA.iconImg("fbs" + e.ft + "_" + DATA.elIdx(e.el));   // 炼制法宝按形状 + 属性
  return DATA.ICON_EQ.includes(e.slot) ? DATA.iconImg("eq_" + e.slot) : "";
};
DATA.PILL_ICONS = ["juqi", "juling", "peiyuan", "taixu", "jiuxuan", "hongmeng"];
DATA.pillIcon = type => DATA.iconImg("pill_" + (DATA.PILL_ICONS.includes(type) ? type : DATA.PILL_ICONS[Math.max(0, Object.keys(DATA.pills).indexOf(type)) % 3]));
// 属性丹（修炼速度丹用修炼丹的图）、炉子
DATA.danIcon = type => DATA.recipeItem(type) ? DATA.smIcon(DATA.recipeItem(type)) : DATA.isSpeedRecipe(type) ? DATA.pillIcon(type) : DATA.iconImg("dan_" + type);
DATA.furnaceIcon = kind => DATA.iconImg("fu_" + kind);
// 列表里的小图：DATA.li(图片地址)
DATA.li = (src, cls) => src ? `<img class="li${cls ? " " + cls : ""}" src="${src}" alt="" loading="lazy">` : "";
// 功法 / 法术：按属性选图，按阶（黄玄地天）换边框；秘法统一一张卷轴
DATA.skillIcon = g => g.kind === "mf" || g.noEl ? DATA.iconImg("mifa") : DATA.iconImg((g.kind === "sp" ? "sp_" : "gf_") + g.el.id);
DATA.skillIco = g => `<span class="ico ${g.kind === "mf" ? "t-mifa" : "t-gf"}"><img src="${DATA.skillIcon(g)}" alt="" loading="lazy">${g.kind === "mf" ? `<b>秘</b>` : ""}</span>`;
// 炼制物品（装备 / 戒指 / 法宝）的小图标：按阶换边框
// 炼制装备 / 法宝按阶（一阶~十阶）加外观：越高阶越亮、光晕越强，高阶有流光（css/style.css 的 .eqt0 ~ .eqt9）
DATA.eqCls = e => e && e.attrs ? ` eqt eqt${Math.max(0, Math.min(11, e.g || 0))}${e.slot === "fabao" && e.el ? ` fbel fb-${e.el}` : ""}` : "";   // 法宝按金木水火土雷显示颜色
DATA.fbElCls = e => e && e.slot === "fabao" && e.el ? ` fb-${e.el}` : "";
// 炼器室列表（宗门、洞府）用：按第 g 阶显示同样的外观
DATA.eqTierIco = (src, g) => `<span class="ico j${g} eqt eqt${Math.max(0, Math.min(11, g))}"><img src="${src}" alt="" loading="lazy"><b>${g + 1}</b></span>`;
