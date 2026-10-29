/* =====================================================================
 * 模块：丹方、炼丹房、炼器室
 * ---------------------------------------------------------------------
 * 丹方：在 门派 → 炼丹房 学习（消耗贡献 + 时间，一次学一个），学会后才在洞府炼丹房显示。
 *   学习星级见 config/alchemy.js 的 CAT_STAR / STAR_TIERS；凡丹 7 种属性丹 + 3 种修炼丹，仙冥魔神丹各 7 种（仙丹另有 3 种仙界修炼丹）。
 * 图纸：门派 → 宗门宝库 兑换后放进背包，在背包点「学习」才能炼制该炉子。
 * 炉子：炼丹炉、炼器炉都在 洞府 · 炼器室 炼制（必须装有炼器炉，炼器炉缩短炼制时间），
 *   炼好的炉子放进背包，在背包点「使用」后装进洞府；洞府炼丹房 / 炼器室可随时更换使用哪一个。
 *   宗门宝库「杂物」可直接兑换一阶炼丹炉、一阶炼器炉。
 * 炼丹：必须装有炼丹炉，丹阶不能高于炼丹炉阶；只消耗药材，一炉可连续炼多枚，出炉放进背包。
 * 全部数值在 js/config/ 数值文件 的 alchemy / furnace。按 G.now() 计时，离线也会继续。
 * 存档：
 *   recipes    ["atk|0", "juqi|0", ...]          已学会的丹方（类型|阶）
 *   danStudy   { key, end } | null              正在学习的丹方
 *   blueprints { dan: [阶...], qi: [阶...] }      已学会的图纸
 *   furnaces   { dan: [阶...], qi: [阶...] }      已装进洞府的炉子
 *   furnaceUse { dan: 阶|-1, qi: 阶|-1 }          正在使用的炉子
 *   forgeJob   { kind, g, end } | null           炼器室正在炼制的炉子
 *   forgeQueue [{ kind, g }]                     炼器室队列（排队时已扣材料）
 *   alchJob    { type, g, n, done, next, per } | null  正在炼的丹
 *   alchQueue  [{ type, g, n }]                   炼丹队列（排队时已扣药材）
 *   danEaten   { "atk|0": 已服用枚数 }
 *   forgeKnown ["eq:weapon:0", "ss:0", ...]      门派炼器室学会的装备图谱 / 空间石（v21）
 *   forgeStudy { key, end } | null              正在学习的炼器图谱
 *   stoneUsed  { 阶: 已使用空间石个数 }
 *   炼器室队列项 kind：dan/qi 炉子、eq 装备（slot、prev = 已扣的上一阶装备、ft = 法宝种类）、ss 空间石
 *   craftsman  { dan: { lv, exp }, qi: {...}, ling: {...} }  炼丹师 / 炼器师 / 灵植夫（config/craftsman.js）
 * 炼丹、炼器都有成功率（config/craftsman.js），失败只扣材料。
 * ===================================================================== */
G.module({
  id: "craft",

  defaults: () => ({
    recipes: [], danStudy: null,
    blueprints: { dan: [], qi: [], xdan: [], sdan: [] },
    furnaces: { dan: [], qi: [], xdan: [], sdan: [] },
    furnaceUse: { dan: -1, qi: -1, xdan: -1, sdan: -1 },   // sdan 炼丹神炉   // xdan 炼丹仙炉、xqi 炼器仙炉（v42）
    forgeJob: null,
    forgeQueue: [],
    alchJob: null,
    alchQueue: [],
    alchLog: [], forgeLog: [],   // v250 最近 30 次炼丹 / 炼器记录
    danEaten: {},
    forgeKnown: [], forgeStudy: null, stoneUsed: {},
    craftsman: { dan: { lv: 1, exp: 0 }, qi: { lv: 1, exp: 0 }, ling: { lv: 1, exp: 0 } },   // v42 起还有 xdan 炼丹仙师 / xqi 炼器仙师 / xling 仙植师（用到时自动加）
  }),

  tick() { this.craftTick(); },

  api: {
    /* ---------- 炼丹师 / 炼器师 / 灵植夫 ---------- */
    craftInfo(k) {
      const s = this.s; if (!s.craftsman) s.craftsman = {};
      if (!s.craftsman[k]) s.craftsman[k] = { lv: 1, exp: 0 };
      // 技艺统一 1~20 阶后：旧存档的炼丹仙师 / 炼器仙师 / 仙植师并进来（仙师 N 阶 = 10 + N 阶，1 阶的不算）
      const x = (k === "dan" || k === "qi" || k === "ling") && s.craftsman["x" + k];
      if (x) { const c = s.craftsman[k]; if (x.lv > 1 && 10 + x.lv > c.lv) { c.lv = 10 + x.lv; c.exp = x.exp || 0; } delete s.craftsman["x" + k]; }
      const c = s.craftsman[k], M = this.craftMax(k); if (c.lv > M) { c.lv = M; c.exp = 0; }   // 炼器仙师删掉后炼器师最高 10 星
      return c;
    },
    craftLv(k) { return this.craftInfo(k).lv; },
    craftMax(k) { const C = CFG.craftsman; return (C[k] && C[k].MAX) || (C["x" + k] ? 20 : C.MAX); },   // 炼丹师 / 炼器师 / 灵植夫 1~20 阶
    // 显示：1~10 阶叫炼丹师 / 炼器师 / 灵植夫 N 阶，11~20 阶叫炼丹仙师 / 炼器仙师 / 仙植师 (N−10) 阶
    craftTitle(k, lv) { const C = CFG.craftsman, u = this.craftUnit(k), z = n => this.cnNum(n) + u; lv = lv || this.craftLv(k); return lv > 20 && C["s" + k] ? `${C["s" + k].name} · ${z(lv - 20)}` : lv > 10 && C["x" + k] ? `${C["x" + k].name} · ${z(lv - 10)}` : `${C[k].name} · ${z(lv)}`; },   // 炼丹师 · 一阶；21~30 阶显示为炼丹神师
    cnNum(n) { const D = "零一二三四五六七八九"; return n <= 10 ? (n === 10 ? "十" : D[n]) : n < 20 ? "十" + D[n - 10] : D[Math.floor(n / 10)] + "十" + (n % 10 ? D[n % 10] : ""); },
    craftUnit(k) { return k === "qi" ? "星" : "阶"; },   // 炼器师按星显示
    // 炼丹 / 炼器一件给的经验：物品阶 ≥ 技艺阶才给，g = 物品阶序号（0 = 一阶）
    itemExp(k, g, ok) {
      const C = CFG.craftsman, K = C[k] || {};
      if (g + 1 < this.craftLv(k)) return 0;
      const e = K.ITEM_EXP ? (K.ITEM_EXP[g] ?? K.ITEM_EXP[K.ITEM_EXP.length - 1] ?? 0) : (g + 1) * (K.EXP_RATE || 0);
      return e * (ok ? 1 : (C.FAIL_EXP || 0));
    },
    // 加经验，满了升阶
    addCraftExp(k, n) {
      const C = CFG.craftsman, c = this.craftInfo(k), E = C[k].EXP || C.EXP, M = this.craftMax(k);
      if (!(n > 0) || c.lv >= M) return;
      c.exp += n;
      while (c.lv < M && c.exp >= (E[c.lv - 1] ?? (64 + 32 * (c.lv - 1)) * 13 * c.lv)) {
        c.exp -= E[c.lv - 1] ?? (64 + 32 * (c.lv - 1)) * 13 * c.lv; c.lv++;
        if (!this.silent) this.log(`晋升${this.craftTitle(k, c.lv).replace(" · ", " ")}！`, "gold");
      }
      if (c.lv >= M) c.exp = 0;
    },
    // 成功率 0~1：RATE_BASE + (技艺阶 − 物品阶) × RATE_STEP + (炉子阶 − 物品阶) × FURN_STEP + 秘法%，g = 物品阶序号（0 = 一阶）
    craftRate(k, g) {
      if (DATA.isTest()) return 1;
      const C = CFG.craftsman, m = this.mifaBonus();
      const fu = this.s.furnaceUse || {}, f = k === "xdan" && !(fu.xdan >= 0) ? fu.dan : fu[k];   // 用的炉子阶序号（没装炼器仙炉按炼器炉，没装炼丹仙炉按炼丹炉）
      const pct = C.RATE_BASE + (this.craftLv(k) - (g + 1)) * C.RATE_STEP + (f >= 0 ? (f - g) * (C.FURN_STEP || 0) : 0) + ((k === "dan" || k === "xdan" ? m.danRate : m.qiRate) || 0);
      return Math.max((C.RATE_MIN || 0) / 100, Math.min(1, pct / 100));
    },
    // 炼丹用哪种炉：仙冥魔神丹装了炼丹仙炉用仙炉，没装就用炼丹炉（低阶炉也能炼，只是成功率按阶差降低）
    danFurn(fk) { const fu = this.s.furnaceUse; if (fk === "sdan" && !(fu.sdan >= 0)) fk = "xdan"; return fk === "xdan" && !(fu.xdan >= 0) ? "dan" : fk; },   // 神丹：炼丹神炉 → 炼丹仙炉 → 炼丹炉
    /* 炼丹统一：丹药共 20 阶（凡丹 1~10 阶，仙冥魔神丹 1~10 阶 = 总 11~20 阶），只有一个炼丹师（1~20 阶）；
     * 炉子也连起来：炼丹炉 1~10 阶，炼丹仙炉 1~10 阶 = 11~20 阶。成功率 = 80 + (炼丹师阶 − 丹药总阶) × 5 + (炉子总阶 − 丹药总阶) × 5 */
    danCk() { return "dan"; },
    danTotal(type, g) { const c = DATA.danCat(type); return g + (c === 4 ? 20 : c ? 10 : 0); },   // 丹药总阶序号（0 = 一阶凡丹；仙冥魔丹 10 起，神丹 20 起）
    danFurnTier(type) { const fu = this.s.furnaceUse || {}, c = DATA.danCat(type); return c === 4 && fu.sdan >= 0 ? fu.sdan + 20 : c && fu.xdan >= 0 ? fu.xdan + 10 : fu.dan >= 0 ? fu.dan : -1; },   // 炉子总阶：炼丹神炉 21~30
    danRate(type, g) {
      if (DATA.isTest()) return 1;
      const C = CFG.craftsman, T = this.danTotal(type, g), f = this.danFurnTier(type);
      const pct = C.RATE_BASE + (this.craftLv("dan") - (T + 1)) * C.RATE_STEP + (f >= 0 ? (f - T) * (C.FURN_STEP || 0) : 0) + (this.mifaBonus().danRate || 0);
      return Math.max((C.RATE_MIN || 0) / 100, Math.min(1, pct / 100));
    },
    ratePct(r) { return `${Math.round(r * 1000) / 10}%`; },
    // 秘法缩短时间 %（有上限）
    // 时间减少 % 合计 = 炉子% + 秘法%（相加，不相乘），最多 TIME_CUT_MAX
    mifaCut(kind, add = 0) { const cap = (CFG.wudao.TIME_CUT_MAX || {})[kind]; const v = (this.mifaBonus()[kind] || 0) + add; return cap === undefined ? Math.min(100, v) : Math.min(cap, v); },
    // 技艺卡片（炼丹房、炼器室、灵药园顶部）
    craftsmanCard(k) {
      const C = CFG.craftsman, c = this.craftInfo(k), max = c.lv >= this.craftMax(k), need = (C[k].EXP || C.EXP)[c.lv - 1] || 1, pg = k === "xling" ? DATA.FAN_HERB_N : 0;
      const eff = k === "ling" || k === "xling" ? `<p class="desc">${k === "xling" ? "仙界药材" : ""}生长时间 -${U.num(this.plantCut(pg))}% · 收获 +${U.num(this.plantYieldPct(pg))}%</p>` : "";   // 炼丹、炼器的成功率显示在每样物品上
      return `<div class="card"><h3>${this.craftTitle(k)}<small>${max ? `已满${this.craftUnit(k)}` : `经验 ${U.fmt(c.exp)} / ${U.fmt(need)}`}</small></h3>
        ${max ? "" : `<div class="bar"><div style="width:${Math.min(100, c.exp / need * 100)}%"></div></div>`}${eff}${!max && C[k].ITEM_EXP && k !== "ling" ? `<p class="desc">炼成 ${c.lv} ${this.craftUnit(k)}及以上才加经验</p>` : ""}</div>`;
    },

    /* ---------- 材料 ---------- */
    countMat(kind, g) {
      if (kind === "sm") return this.smCount(g);   // 秘境专用材料（养神露）
      const name = DATA.matName(kind, g);
      return this.s.bag.reduce((a, it) => a + (it.t === "mat" && it.kind === kind && it.name === name ? it.n : 0), 0);
    },
    takeMat(kind, g, n) {
      n = Math.floor(+n); if (!(n >= 1)) return;
      if (kind === "sm") return void this.takeSm(g, n);
      const name = DATA.matName(kind, g);
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) {
        const it = this.s.bag[i];
        if (it.t !== "mat" || it.kind !== kind || it.name !== name) continue;
        const k = Math.min(n, it.n); this.removeAt(i, k); n -= k;
      }
    },
    hasMats(list, times = 1) { return list.every(m => this.countMat(m.kind, m.g) >= m.n * times); },
    matsText(list, times = 1) {
      return list.map(m => { const have = this.countMat(m.kind, m.g), need = m.n * times;
        return `<span class="${have >= need ? "" : "q5"}">${DATA.matFull(m.kind, m.g)} ${U.fmt(have)}/${U.fmt(need)}</span>`; }).join("、");
    },
    giveBack(list, times = 1) { list.forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * times)); },

    /* ---------- 定时结算（每 10 秒，离线也会补算） ---------- */
    craftTick() {
      const s = this.s, now = this.now();
      this.fixCraft();
      // 丹方学习、图谱 / 图纸学习（v173 学习队列，gongfa.js lqTick）
      this.lqTick("dan"); this.lqTick("forge");
      // 炼器室：炼好放进背包（背包满就等着），队列自动衔接
      let j, guard = 0;
      while ((j = s.forgeJob) && now >= j.end && guard++ < 1000) {
        if (!this.finishForge(j)) break;
        this.craftRec("forgeLog", { at: j.end, name: this.jobName(j), ok: j.ok ? 1 : 0 });
        s.forgeJob = null;
        const nx = s.forgeQueue.shift();
        if (nx) s.forgeJob = Object.assign({}, nx, { end: j.end + this.forgePer(nx.kind, nx.g) });
      }
      // 炼丹（一炉炼完自动开始队列里的下一炉）
      guard = 0;
      while (s.alchJob && guard++ < 1000) {
        const a = s.alchJob;
        while (a.done < a.n && now >= a.next) {
          // 每枚单独判定成功率；成功时再按秘法「丹灵」几率多出一颗
          const ok = Math.random() < this.danRate(a.type, a.g);
          if (ok) {
            if (!this.addDan(a.type, a.g, 1)) break;   // 背包满：等有空位
            a.ok = (a.ok || 0) + 1;
            if (Math.random() * 100 < (this.mifaBonus().danExtra || 0) && this.addDan(a.type, a.g, 1)) a.extra = (a.extra || 0) + 1;
          } else a.fail = (a.fail || 0) + 1;
          this.addCraftExp("dan", this.itemExp("dan", this.danTotal(a.type, a.g), ok));   // 经验按丹药总阶
          a.done++; a.next += a.per;
        }
        if (a.done < a.n) break;
        s.alchJob = null; this.craftRec("alchLog", { at: a.next - a.per, name: DATA.danName(a.type, a.g), n: a.n, ok: a.ok || 0, extra: a.extra || 0, fail: a.fail || 0 });
        this.log(`${DATA.danName(a.type, a.g)} ×${a.n} 炼制完毕：成丹 ${a.ok || 0} 枚${a.extra ? `（额外多出 ${a.extra} 枚）` : ""}${a.fail ? `，失败 ${a.fail} 枚` : ""}。`, "gold");
        const nx = s.alchQueue.shift();
        if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: a.next - a.per + per }; }
      }
    },
    // 改了配置（炉子种类、阶数、丹方）后清掉存档里无效的数据
    fixCraft() {
      const s = this.s;
      for (const k of DATA.FURNACE_KINDS) {
        if (!s.blueprints[k]) s.blueprints[k] = [];
        if (!s.furnaces[k]) s.furnaces[k] = [];
        if (s.furnaceUse[k] === undefined) s.furnaceUse[k] = -1;
        s.blueprints[k] = s.blueprints[k].filter(g => g >= 0 && g < DATA.DAN_JIE_N);
        s.furnaces[k] = s.furnaces[k].filter(g => g >= 0 && g < DATA.DAN_JIE_N);
        if (!s.furnaces[k].includes(s.furnaceUse[k])) s.furnaceUse[k] = s.furnaces[k].length ? Math.max(...s.furnaces[k]) : -1;   // v250 洞府有炉子却没在用 → 自动用最高阶
      }
      if (s.alchJob && !DATA.recipes[s.alchJob.type]) s.alchJob = null;
      if (!Array.isArray(s.alchLog)) s.alchLog = []; if (!Array.isArray(s.forgeLog)) s.forgeLog = [];
      s.alchQueue = s.alchQueue.filter(q => DATA.recipes[q.type]);
      if (s.bag.some(it => it.t === "dan" && !DATA.dans[it.type])) s.bag = s.bag.filter(it => it.t !== "dan" || DATA.dans[it.type]);
      if (!s.eqMax10) this.fixEq10();
    },
    // 装备、法宝、戒指去掉十一、十二阶（只剩一星 ~ 十星）：旧存档里的降为十星，名字跟着换；学会的十一、十二阶图谱删掉
    fixEq10() {
      const s = this.s, M = DATA.XING.length - 1;
      const fix = e => { if (!e || !(e.g > M)) return; e.g = M;
        if (e.slot === "fabao") e.name = DATA.fabaoName(e.ft, M); else if (e.slot !== "ring" && DATA.forgeNames[e.slot]) e.name = DATA.forgeNames[e.slot][M]; };
      for (const k in s.equip || {}) fix(s.equip[k]);
      (s.fabao || []).forEach(fix);
      for (const it of s.bag || []) { if (it.t === "eq") fix(it.e); else if (it.t === "rbp" && it.g > M) it.g = M; }
      const bad = key => { const p = String(key).split(":"); return (p[0] === "eq" || p[0] === "ring") && +p[p.length - 1] > M; };
      if (Array.isArray(s.forgeKnown)) s.forgeKnown = s.forgeKnown.filter(k => !bad(k));
      for (const q of [s.forgeJob, ...(s.forgeQueue || [])]) if (q && (q.kind === "eq" || q.kind === "ring") && q.g > M) { q.g = M; if (q.prev) fix(q.prev); }
      const lqBad = x => x && ((x.k === "rbp" && x.g > M) || (x.key !== undefined && bad(x.key)));
      if (lqBad(s.forgeStudy)) s.forgeStudy = null;
      if (s.lq && Array.isArray(s.lq.forge)) s.lq.forge = s.lq.forge.filter(x => !lqBad(x));
      s.eqMax10 = 1;
    },

    /* ---------- 门派炼丹房：学习丹方 ---------- */
    setDanLibTier(g) { this.danLibTier = g; this.render(); },
    learnRecipe(type, g) {
      const s = this.s, key = type + "|" + g, c = DATA.danLearnCost(type, g);
      if (s.recipes.includes(key) || !DATA.recipes[type] || !DATA.danSect(type)) return;   // 仙冥魔神丹方去四界功德司兑换
      if (!this.lqCan("dan", key)) return;   // v173 学习队列
      if (!this.sectInfo()) return this.log("尚未加入门派。", "sys");
      if (DATA.danStar(type, g) > this.sectInfo().star) return this.log(`需要 ${DATA.danStar(type, g)} 星及以上门派才能学习。`, "sys");
      if (s.contrib < c) return this.log("贡献不足。", "sys");
      s.contrib -= c; this.lqAdd("dan", { key, k: "dan", ms: DATA.danLearnTime(type, g) }); this.after();
    },

    /* ---------- 图纸、炉子（背包物品） ---------- */
    addBlueprintItem(kind, g) {
      if (this.bagFull()) { this.log("背包已满。", "bad"); return false; }
      this.s.bag.push({ t: "bp", kind, g }); return true;
    },
    addFurnaceItem(kind, g) {
      return this.bagAdd(x => x.t === "fu" && x.kind === kind && x.g === g, k => ({ t: "fu", kind, g, n: k }), 1, "背包已满，炉子无处存放，暂停出炉。");
    },
    // 背包里点图纸「学习」
    learnBlueprint(i) {
      const it = this.s.bag[i]; if (!it || it.t !== "bp") return;
      const bp = this.s.blueprints[it.kind];
      if (bp.includes(it.g)) return this.log("已学会该图纸。", "sys");
      if (it.lq) return;   // v173 学习中 / 排队中：学完才从背包消失
      const key = `bp|${it.kind}|${it.g}`; if (!this.lqCan("forge", key)) return;
      it.lq = 1; this.lqAdd("forge", { key, k: "bp", kind: it.kind, g: it.g, ms: this.bagLearnMs("BP_MIN", it.g) }); this.closeModal(); this.after();
    },
    // 背包里点炉子「使用」：装进洞府
    installFurnace(i) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "fu") return;
      if (s.furnaces[it.kind].includes(it.g)) {   // v250 洞府已有同阶：直接换用（不扣背包里这个）
        if (s.furnaceUse[it.kind] === it.g) return this.log(`${DATA.furnaceName(it.kind, it.g)}已在使用中。`, "sys");
        s.furnaceUse[it.kind] = it.g; this.log(`换用${DATA.furnaceName(it.kind, it.g)}。`, "sys"); this.closeModal(); return this.after(); }
      s.furnaces[it.kind].push(it.g); this.removeAt(i, 1);
      if (it.g > s.furnaceUse[it.kind]) s.furnaceUse[it.kind] = it.g;
      this.log(`${DATA.furnaceName(it.kind, it.g)}已装进洞府${DATA.isDanFu(it.kind) ? "炼丹房" : "炼器室"}。`, "gold"); this.closeModal(); this.after();
    },

    /* ---------- 炼器室：炉子 / 装备 / 空间石 ---------- */
    // 炼制时间（炼器炉缩短）
    forgePer(kind, g) {
      if (DATA.isTest()) return 1000;   // 测试模式每件 1 秒
      if (kind === "rf") return ((CFG.forge.refine || {}).TIME || [])[g] * 1000 || (g + 1) * 10000;   // 精炼：固定时间，不受炉子、炼器师缩短
      const base = kind === "eq" ? DATA.forgeEqTime(g) : kind === "ss" ? DATA.stoneTime(g) : kind === "ring" ? DATA.ringTime(g) : DATA.furnaceTime(kind, g);
      const ck = this.forgeCraft(kind), tc = (CFG.craftsman[ck].TIME_CUT || [])[this.craftLv(ck) - 1] || 0;   // 炉子% + 炼器师/炼器仙师% + 器火秘法% 相加
      return Math.ceil(base * (1 - this.mifaCut("qiTime", DATA.furnaceBonus("qi", this.s.furnaceUse.qi) + tc + this.servantPct("qi")) / 100));
    },
    // 秘境专用材料：空间石要空间晶核；装备 / 戒指 / 法宝要耀石（config/forge.js 的 YAOSHI）→ [{ k, ft, n }]
    //   法宝用同属性耀石（q.el），装备、戒指任意一种（ft = -1）
    jobSm(q) {
      if (q.kind === "ss") { const n = (CFG.forge.stone.special || [])[q.g] || 0; return n ? [{ k: "kj", n }] : []; }
      const out = [];
      if (q.kind === "eq" || q.kind === "ring") {
        const fb = q.slot === "fabao", J = CFG.forge.YAOSHI || {}, n = (J[q.kind === "ring" ? "ring" : fb ? "fabao" : "equip"] || [])[q.g] || 0;
        if (n) out.push({ k: "ys", ft: fb ? DATA.elIdx(q.el) : -1, n });
      }
      return out;
    },
    smHave(list) { return list.every(x => this.smCount(x.k, x.ft) >= x.n); },
    smText(list) { return list.map(x => `<span class="${this.smCount(x.k, x.ft) >= x.n ? "" : "q5"}">${DATA.li(DATA.smIcon(x.k, x.ft))}${DATA.smName(x.k, x.ft)} ${U.fmt(this.smCount(x.k, x.ft))}/${U.fmt(x.n)}</span>`).join("、"); },
    jobMats(q) { return q.kind === "rf" ? DATA.refineMats(q.item) : q.kind === "eq" ? DATA.forgeEqMats(q.g) : q.kind === "ss" ? DATA.stoneMats(q.g) : q.kind === "ring" ? DATA.ringMats(q.g) : DATA.furnaceMats(q.kind, q.g); },
    jobName(q) { return q.kind === "rf" ? "精炼" + this.itemName({ t: "eq", e: q.item }) : q.kind === "eq" ? (q.slot === "fabao" && q.ft !== undefined ? DATA.XING[q.g] + "·" + (DATA.elById[q.el] ? DATA.elById[q.el].name + "·" : "") + DATA.fabaoName(q.ft, q.g) : DATA.forgeEqName(q.slot, q.g)) : q.kind === "ss" ? DATA.stoneName(q.g) : q.kind === "ring" ? DATA.ringName(q.r, q.g) : DATA.furnaceName(q.kind, q.g); },
    // 炼好：放进背包，背包满返回 false（等有空位再出炉）
    forgeCraft() { return "qi"; },   // 炼器统一按炼器师 1~20 阶
    // 炼器：仙炉（炼丹仙炉 / 炼器仙炉）算 11~20 阶；炉子：仙炉装了炼器仙炉算 11~20 阶，否则用炼器炉 1~10 阶。可跨阶，成功率每差一阶 ±5%
    forgeTotal(kind, g) { return g; },   // 炼器只有 1~10 星：炼丹仙炉、炼丹神炉 N 阶也按 N 星算
    forgeRate(kind, g) {
      if (DATA.isTest()) return 1;
      const C = CFG.craftsman, fu = this.s.furnaceUse || {}, T = this.forgeTotal(kind, g), f = fu.qi >= 0 ? fu.qi : -1;
      const pct = C.RATE_BASE + (this.craftLv("qi") - (T + 1)) * C.RATE_STEP + (f >= 0 ? (f - T) * (C.FURN_STEP || 0) : 0) + (this.mifaBonus().qiRate || 0);
      return Math.max((C.RATE_MIN || 0) / 100, Math.min(1, pct / 100));
    },
    finishForge(j) {
      // 成功率判定（只判一次，背包满等待时不重复判定、不重复加经验）
      if (j.ok === undefined) {
        j.ok = Math.random() < this.forgeRate(j.kind, j.g);
        this.addCraftExp("qi", this.itemExp("qi", this.forgeTotal(j.kind, j.g), j.ok));
      }
      if (j.kind === "rf") {   // 精炼：成功 +1 阶；失败只扣矿石，被精炼的那件原样退回
        if (this.bagFull()) { if (!this.silent) this.log("背包已满，暂停出炉。", "bad"); return false; }
        const e = j.item; if (j.ok) e.rj = DATA.rjOf(e) + 1;
        this.addEquip(e); this.dirty();
        this.log(j.ok ? `精炼成功：<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span> 升到${DATA.rjName(e)}。` : `精炼${this.itemName({ t: "eq", e })}失败，材料已耗尽，装备仍是${DATA.rjName(e)}。`, j.ok ? "gold" : "bad");
        return true;
      }
      if (!j.ok) {
        if (j.prev) { if (this.bagFull()) { if (!this.silent) this.log("背包已满，暂停出炉。", "bad"); return false; } this.addEquip(j.prev); }
        this.log(`${this.jobName(j)}炼制失败，材料已耗尽${j.prev ? "（上一星装备已退回背包）" : ""}。`, "bad"); return true;
      }
      if (j.kind === "eq" || j.kind === "ring") {
        if (this.bagFull()) { if (!this.silent) this.log("背包已满，装备暂停出炉。", "bad"); return false; }
        // v25：升阶（有上一阶装备）→ 属性颜色不变，只是数值按新阶变大；一阶 → 随机生成
        const e = j.prev && j.prev.attrs ? DATA.upgradeForged(j.prev, j.g) : DATA.rollForged(j.kind === "ring" ? "ring" : j.slot, j.g, j.kind === "ring" ? j.r : j.ft, j.el);
        this.addEquip(e);
        this.log(`炼成 <span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>，已放进背包。`, "gold"); return true;
      }
      if (j.kind === "ss") { if (!this.addStone(j.g)) return false; this.log(`${DATA.stoneName(j.g)}炼制成功，已放进背包。`, "gold"); return true; }
      if (!this.addFurnaceItem(j.kind, j.g)) return false;
      this.log(`${DATA.furnaceName(j.kind, j.g)}炼制成功，已放进背包（点击「使用」装进洞府）。`, "gold"); return true;
    },
    // 背包里上一阶同部位的炼器装备（优先颜色最差的）
    //   v25：戒指要同种（r）；优先颜色最好的（升阶颜色不变）
    //   法宝：r = 形状序号、el = 属性（要同形状同属性）；多件时优先强化等级高的
    prevEquipIndex(slot, g, r, el) {
      let best = -1;
      const same = e => r === undefined || (slot === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
      const score = e => (e.enh || 0) * 10 + e.q + Object.values(e.fu || {}).reduce((t, n) => t + n, 0) * 1000;   // 融合过的优先拿去升星（融合效果保留）
      this.s.bag.forEach((it, i) => { if (it.t === "eq" && it.e.attrs && it.e.slot === slot && it.e.g === g - 1 && DATA.rjTop(it.e) && same(it.e) && (best < 0 || score(it.e) > score(this.s.bag[best].e))) best = i; });
      return best;
    },
    // 炼制：空闲就开始，否则加入队列（都会先扣材料）。kind = dan/qi 炉子、eq 装备/法宝（slot）、ss 空间石、ring 戒指（slot 传戒指种类序号）
    //   法宝：slot = "fabao"，ft = 形状序号，el = 属性
    craftFurnace(kind, g, slot, ft, el) {
      const s = this.s, q = s.forgeQueue, job = { kind, g };
      if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot;
      if (slot === "fabao") { if (!DATA.fabaoTypes[ft] || !DATA.elById[el]) return this.openFabaoPick(g); job.ft = +ft; job.el = el; }
      const mats = this.jobMats(job);
      if (s.furnaceUse.qi < 0) return this.log("炼器必须装有炼器炉（宗门宝库 · 杂物可兑换一星炼器炉）。", "sys");
      if (DATA.FURNACE_KINDS.includes(kind)) { if (!s.blueprints[kind].includes(g)) return this.log("尚未学会该图纸。", "sys"); }
      else {
        if (kind === "ring" ? !this.ringKnown(job.r, g) : !s.forgeKnown.includes(this.forgeKey(kind, g, slot))) return this.log(kind === "ring" ? "尚未学会这张戒指图纸（试炼塔奖励）。" : "尚未学会，去门派炼器室学习。", "sys");
      }
      if (s.forgeJob && q.length >= CFG.furnace.QUEUE) return this.log(`队列已满（最多 ${CFG.furnace.QUEUE} 个）。`, "sys");
      const sm = this.jobSm(job);
      if (!this.hasMats(mats) || !this.smHave(sm)) return this.log(sm.length && !this.smHave(sm) ? `缺少${sm.filter(x => this.smCount(x.k, x.ft) < x.n).map(x => DATA.smName(x.k, x.ft)).join("、")}（秘境、灵地掉落）。` : "材料不足。", "sys");
      let pi = -1;
      if (kind === "ring" && g < 1) return;
      if (kind === "eq" && g > 0) { pi = this.prevEquipIndex(slot, g, job.ft, job.el); if (pi < 0) return this.log(`需要一件${slot === "fabao" ? DATA.XING[g - 1] + "·" + DATA.elById[job.el].name + "·" + DATA.fabaoName(job.ft, g - 1) : DATA.forgeEqName(slot, g - 1)}（${DATA.JIE[9]}）。`, "sys"); }
      if (kind === "ring") { pi = this.prevEquipIndex("ring", g, job.r); if (pi < 0) return this.log(`需要一枚${DATA.ringName(job.r, g - 1)}（${DATA.JIE[9]}）。`, "sys"); }
      if (pi >= 0) { job.prev = s.bag[pi].e; s.bag.splice(pi, 1); }
      mats.forEach(m => this.takeMat(m.kind, m.g, m.n));
      job.sm = []; sm.forEach(x => { const got = this.takeSm(x.k, x.n, x.ft); if (got) job.sm.push(...got); });   // 记下实际扣的（取消时按这个退）
      if (s.forgeJob) { q.push(job); this.log(`${this.jobName(job)}加入队列。`, "sys"); }
      else { s.forgeJob = Object.assign(job, { end: this.now() + this.forgePer(kind, g) }); this.log(`开始炼制${this.jobName(job)}。`, "good"); }
      if (slot === "fabao") this.closeModal();
      this.after();
    },
    // v248 炼制数量窗口（炼丹、炼器共用）：加减按钮 / 输入框选数量，确定后炼制
    cardRow(a, b) { return `<div class="card-row">${a}${b}</div>`; },
    qtyModal(title, info, max, call) {
      this._qty = { max, call, n: Math.min(max, this._qty && this._qty.title === title ? this._qty.n : 1), title };
      const step = [[-10, "-10"], [-1, "-"], [1, "+"], [10, "+10"]];
      this.modal(`<h2>${title}</h2>${info}
        <div class="qty-box">${step.slice(0, 2).map(([d, t]) => `<button onclick="G.qtyAdd(${d})">${t}</button>`).join("")}
          <input id="qty-n" type="number" min="1" max="${max}" value="${this._qty.n}" oninput="G.qtySet(this.value,1)">
          ${step.slice(2).map(([d, t]) => `<button onclick="G.qtyAdd(${d})">${t}</button>`).join("")}</div>
        <p class="desc" style="text-align:center">最多可炼 ${U.fmt(max)}　<a href="javascript:void 0" onclick="G.qtySet(${max})">最大</a></p>
        <div class="btns"><button class="primary" onclick="G.qtyOk()">炼制</button><button onclick="G.closeModal()">取消</button></div>`);
    },
    qtySet(v, typing) { const q = this._qty; if (!q) return; v = Math.floor(+v || 0); q.n = Math.max(1, Math.min(q.max, v));
      const el = document.getElementById("qty-n"); if (el && (!typing || v > q.max)) el.value = q.n; },
    qtyAdd(d) { const q = this._qty; if (q) this.qtySet(q.n + d); },
    qtyOk() { const q = this._qty; if (!q) return; const n = q.n, call = q.call; this._qty = null; this.closeModal(); call(n); },
    // 炼丹数量：最多 = 药材够炼几枚（一炉上限 MAX_BATCH）
    openAlchN(type, g) {
      const rec = DATA.danRecipe(type, g); let max = CFG.alchemy.MAX_BATCH;
      for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      if (max <= 0) return this.log("药材不足。", "sys");
      this.qtyModal(`炼制${DATA.danName(type, g)}`, `<p class="desc">每枚：${this.matsText(rec)} · ${U.dur(this.danPer(type, g) / 1000)}${this.s.alchJob ? " · 丹炉正忙，会加入队列" : ""}</p>`, max, n => this.startAlch(type, g, n));
    },
    // 炼器数量：每件单独排队，最多 = 队列空位 和 材料（含上一阶装备、专用材料）够几件
    forgeMax(kind, g, slot, ft, el) {
      const s = this.s, job = { kind, g }; if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot; if (slot === "fabao") { job.ft = +ft; job.el = el; }
      let max = (s.forgeJob ? 0 : 1) + CFG.furnace.QUEUE - s.forgeQueue.length;
      for (const m of this.jobMats(job)) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      for (const x of this.jobSm(job)) max = Math.min(max, Math.floor(this.smCount(x.k, x.ft) / x.n));
      if ((kind === "eq" && g > 0) || kind === "ring") {
        const ps = kind === "ring" ? "ring" : slot, r = kind === "ring" ? job.r : job.ft;
        const same = e => r === undefined || (ps === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
        max = Math.min(max, s.bag.filter(it => it.t === "eq" && it.e.attrs && it.e.slot === ps && it.e.g === g - 1 && DATA.rjTop(it.e) && same(it.e)).length);
      }
      return Math.max(0, max);
    },
    openForgeN(kind, g, slot, ft, el) {
      const job = { kind, g }; if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot; if (slot === "fabao") { job.ft = +ft; job.el = el; }
      const max = this.forgeMax(kind, g, slot, ft, el);
      if (max <= 0) return this.craftFurnace(kind, g, slot, ft, el);   // 炼不了：让炼制自己提示原因
      const sm = this.jobSm(job);
      this.qtyModal(`炼制${this.jobName(job)}`, `<p class="desc">每件：${this.matsText(this.jobMats(job))}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer(kind, g) / 1000)}${this.s.forgeJob ? " · 炼器炉正忙，会加入队列" : ""}</p>`, max,
        n => this.craftFurnaceN(n, kind, g, slot, ft, el));
    },
    // 连续炼制 n 件（每件一个队列位）
    craftFurnaceN(n, kind, g, slot, ft, el) {
      n = Math.max(1, Math.min(Math.floor(+n) || 1, (CFG.furnace.QUEUE || 5) + 1));
      for (let i = 0; i < n; i++) {
        const before = (this.s.forgeJob ? 1 : 0) + this.s.forgeQueue.length;
        this.craftFurnace(kind, g, slot, ft, el);
        if ((this.s.forgeJob ? 1 : 0) + this.s.forgeQueue.length === before) break;
      }
    },
    // 法宝：先选属性（上面一排），再选形状炼制（7 种）
    setFabaoEl(g, el) { this._fbEl = el; this.openFabaoPick(g); },
    openFabaoPick(g) {
      const s = this.s, mats = DATA.forgeEqMats(g), full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE;
      const el = DATA.elById[this._fbEl] ? this._fbEl : DATA.elements[0].id, ok0 = s.furnaceUse.qi >= 0 && this.hasMats(mats) && !full;
      const sm = this.jobSm({ kind: "eq", g, slot: "fabao", el }), smOK = this.smHave(sm);
      const els = `<div class="room-grid five">${DATA.elements.map((x, i) => `<button class="${x.id === el ? "active" : ""}" onclick="G.setFabaoEl(${g},'${x.id}')">${DATA.li(DATA.smIcon("ys", i))}${x.name} ${U.fmt(this.smCount("ys", i))}</button>`).join("")}</div>`;
      this.modal(`<h2>炼制${DATA.XING[g]}法宝</h2>${els}<p class="desc">${g ? `${DATA.XING[g - 1]}${DATA.JIE[9]}同形状同属性法宝 ×1、` : ""}${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${this.ratePct(this.craftRate("qi", g))}</p>` +
        DATA.fabaoTypes.map((T, ft) => {
          const prevOK = g === 0 || this.prevEquipIndex("fabao", g, ft, el) >= 0;
          return `<div class="line"><div>${DATA.eqTierIco(DATA.iconImg("fbs" + ft + "_" + DATA.elIdx(el)), g)}${DATA.XING[g]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g)}
            <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.XING[g - 1]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g - 1)}·${DATA.JIE[9]} ×1</span>` : ""}</small></div>
            <button class="sm" onclick="G.openForgeN('eq',${g},'fabao',${ft},'${el}')" ${ok0 && smOK && prevOK ? "" : "disabled"}>炼制</button></div>`;
        }).join("") +
        `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 背包里有没有能炼这一阶法宝的底子：一阶不需要，二阶起 = 任意一件上一阶法宝
    fabaoAnyBase(g) { return g === 0 || this.prevEquipIndex("fabao", g) >= 0; },
    // 退回：按开始时实际扣的专用材料 q.sm
    refundJob(q) { this.giveBack(this.jobMats(q)); (q.sm || []).forEach(x => this.addSm(x.k, x.n, x.ft)); if (q.prev) this.addEquip(q.prev); if (q.item) this.addEquip(q.item); if (q.mat) this.addEquip(q.mat); },
    // 取消队列中的一项，退回材料
    cancelForgeQ(i) {
      const q = this.s.forgeQueue[i]; if (!q) return;
      this.s.forgeQueue.splice(i, 1); this.refundJob(q);
      this.log(`取消${this.jobName(q)}，材料已退回。`, "sys"); this.after();
    },
    // 停止正在炼制的，退回材料，队列下一个马上开始
    stopForge() {
      const s = this.s, j = s.forgeJob; if (!j) return;
      this.refundJob(j); s.forgeJob = null;
      const nx = s.forgeQueue.shift();
      if (nx) s.forgeJob = Object.assign({}, nx, { end: this.now() + this.forgePer(nx.kind, nx.g) });
      this.log(`停止炼制${this.jobName(j)}，材料已退回。`, "sys"); this.after();
    },
    setForgeTier(g) { this.forgeTier = g; this.render(); },
    setForgeMode(m) { this.forgeMode = m; this.render(); },
    // ---------- 精炼：装备 / 法宝 / 戒指每次 +1 阶（一阶 ~ 十阶），只消耗炼制该星的三种矿石；必定成功、立即完成 ----------
    //   同类：装备同部位；戒指同种；法宝同形状同属性。材料件优先用阶低、强化低、颜色差的；材料件本身的阶不影响
    refineSame(a, b) { return a !== b && b && b.attrs && b.slot === a.slot && b.g === a.g && (a.slot === "ring" ? b.r === a.r : a.slot === "fabao" ? b.ft === a.ft && b.el === a.el : true); },
    refineMatIndex(e) {
      let best = -1; const score = x => DATA.rjOf(x) * 1e4 + (x.enh || 0) * 10 + (x.q || 0);
      this.s.bag.forEach((it, i) => { if (it.t === "eq" && this.refineSame(e, it.e) && (best < 0 || score(it.e) < score(this.s.bag[best].e))) best = i; });
      return best;
    },
    refineEq(i) {
      const s = this.s, it = s.bag[+i]; if (!it || it.t !== "eq" || !it.e.attrs) return;
      const e = it.e;
      if (DATA.rjTop(e)) return this.log("已精炼到" + DATA.JIE[DATA.RJ_MAX - 1] + "。", "sys");
      if (s.furnaceUse.qi < 0) return this.log("炼器必须装有炼器炉（宗门宝库 · 杂物可兑换一星炼器炉）。", "sys");
      if (s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE) return this.log(`队列已满（最多 ${CFG.furnace.QUEUE} 个）。`, "sys");
      const mats = DATA.refineMats(e);   // 精炼只要这件法宝 / 装备 + 三种矿石，不需要另一件同星同类的
      if (!this.hasMats(mats)) return this.log("矿石不足。", "sys");
      mats.forEach(m => this.takeMat(m.kind, m.g, m.n));
      s.bag.splice(+i, 1);
      const job = { kind: "rf", g: e.g, item: e };
      if (s.forgeJob) { s.forgeQueue.push(job); this.log(`${this.jobName(job)}加入队列。`, "sys"); }
      else { s.forgeJob = Object.assign(job, { end: this.now() + this.forgePer("rf", e.g) }); this.log(`开始${this.jobName(job)}。`, "good"); }
      this.after();
    },
    // 精炼页：背包里所有装备 / 法宝 / 戒指
    refineRows() {
      const s = this.s, list = [];
      s.bag.forEach((it, i) => { if (it.t === "eq" && it.e.attrs) list.push([i, it.e]); });
      if (!list.length) return `<p class="desc">背包里没有装备、法宝、戒指。</p>`;
      const full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE, has = s.furnaceUse.qi >= 0;
      return list.map(([i, e]) => {
        const top = DATA.rjTop(e), mats = DATA.refineMats(e), img = DATA.eqIcon(e);
        return `<div class="line"><div>${img ? DATA.eqTierIco(img, e.g) : ""}<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span><span class="tag">${DATA.rjName(e)}</span>
          <small>${top ? "已满阶" : `${this.matsText(mats)} · ${U.dur(this.forgePer("rf", e.g) / 1000)} · 成功率 ${this.ratePct(this.forgeRate("eq", e.g))}`}</small></div>
          <button class="sm" onclick="G.refineEq(${i})" ${top || full || !has ? "disabled" : ""}>精炼</button></div>`;
      }).join("");
    },

    /* ---------- 门派炼器室：学习装备图谱 / 空间石 ---------- */
    // 戒指图纸 key：v26 起 ring:种类:阶（v25 的 ring:阶 = 该阶所有种类）
    forgeKey(kind, g, slot) { return kind === "lz" ? `lz:${slot}` : kind === "eq" ? `eq:${slot}:${g}` : kind === "ring" ? (slot === undefined ? `ring:${g}` : `ring:${slot}:${g}`) : `ss:${g}`; },
    forgeKeyName(key) { const p = key.split(":"), k = p[0]; return k === "lz" ? DATA.smName("lz", +p[1]) + "图纸" : k === "eq" ? DATA.forgeEqName(p[1], +p[2]) + "图谱" : k === "ring" ? (p.length > 2 ? DATA.ringBpName(+p[2], +p[1]) : DATA.ringBpName(+p[1])) : DATA.stoneName(+p[1]) + "炼法"; },
    ringKnown(r, g) { const K = this.s.forgeKnown; return K.includes(`ring:${r}:${g}`) || K.includes(`ring:${g}`); },
    // v25：使用戒指图纸（试炼塔奖励）→ 学会该阶 9 种戒指的炼法
    learnRingBp(i) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "rbp") return;
      const key = this.forgeKey("ring", it.g, it.r);
      if (it.r === undefined ? s.forgeKnown.includes(key) : this.ringKnown(it.r, it.g)) return this.log("已学会这张图纸。", "sys");
      if (it.lq || !this.lqCan("forge", key)) return;   // v173 学习队列：学完才从背包消失
      it.lq = 1; this.lqAdd("forge", { key, k: "rbp", g: it.g, r: it.r, ms: this.bagLearnMs("RBP_MIN", it.g) }); this.closeModal(); this.after();
    },
    // v173 背包图纸学习时间（毫秒）：config/gongfa.js LEARN_Q 的 BP_MIN / RBP_MIN，不写 = 同阶装备图谱学习时间
    bagLearnMs(k, g) { const a = (CFG.gongfa.LEARN_Q || {})[k], T = CFG.forge.equip.learnTime; const v = a && a[g] !== undefined ? a[g] : T[Math.min(T.length - 1, Math.max(0, g))]; return (v || 0) * 60000; },
    setForgeLibTier(g) { this.forgeLibTier = g; this.render(); },
    // 学习花费 { c 贡献, min 分钟 }（灵珠图纸不分阶，见 config/array.js 的 CFG.lingzhu）
    forgeLearnOf(kind, g) { if (kind === "lz") return { c: CFG.lingzhu.LEARN_COST, min: CFG.lingzhu.LEARN_TIME }; const C = kind === "eq" ? CFG.forge.equip : CFG.forge.stone; return { c: C.learnCost[g], min: C.learnTime[g] }; },
    learnForge(kind, g, slot) {
      const s = this.s, key = this.forgeKey(kind, g, slot), L = this.forgeLearnOf(kind, g), c = L.c;
      if (s.forgeKnown.includes(key)) return;
      if (!this.lqCan("forge", key)) return;   // v173 学习队列
      if (kind !== "lz" && !this.sectInfo()) return this.log("尚未加入门派。", "sys");
      if (kind !== "lz" && g >= this.sectInfo().star) return this.log(`需要 ${g + 1} 星及以上门派才能学习。`, "sys");
      if (s.contrib < c) return this.log("贡献不足。", "sys");
      s.contrib -= c; this.lqAdd("forge", { key, k: "forge", ms: L.min * 60000 }); this.after();
    },
    /* ---------- 灵珠：洞府炼器室炼制（三种矿石 + 对应灵晶，立即炼成放进背包） ---------- */
    lzMats() { return DATA.parseMats(CFG.lingzhu.ORE); },
    craftLz(ft) {
      const C = CFG.lingzhu, mats = this.lzMats();
      if (!this.s.forgeKnown.includes(this.forgeKey("lz", 0, ft))) return;
      if (!this.hasMats(mats) || this.smCount("lj", ft) < C.JING) return this.log("材料不足。", "sys");
      if (!this.addSm("lz", 1, ft)) return;
      mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); this.takeSm("lj", C.JING, ft);
      this.log(`炼成${DATA.smName("lz", ft)}，放进聚灵阵的灵珠格可增加聚灵。`, "gold"); this.after();
    },

    /* ---------- 空间石 ---------- */
    addStone(g, n = 1) {
      return this.bagAdd(x => x.t === "ss" && x.g === g, k => ({ t: "ss", g, n: k }), n, `背包已满，${DATA.SS}暂停出炉。`);
    },
    stoneLeft(g) { return CFG.forge.stone.MAX_USE - ((this.s.stoneUsed || {})[g] || 0); },
    useStone(i, n) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "ss") return;
      n = Math.min(Math.floor(+n), it.n, this.stoneLeft(it.g));
      if (n <= 0) return this.log(`${DATA.stoneName(it.g)}已达使用上限（每阶 ${CFG.forge.stone.MAX_USE} 个）。`, "sys");
      s.stoneUsed[it.g] = (s.stoneUsed[it.g] || 0) + n; s.bagCap += n;
      this.log(`使用${DATA.stoneName(it.g)} ×${n}，储物格 +${n}（共 ${s.bagCap} 格）。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    useFurnace(kind, g) {
      if (!this.s.furnaces[kind].includes(g)) return;
      this.s.furnaceUse[kind] = g; this.log(`换用${DATA.furnaceName(kind, g)}。`, "sys"); this.closeModal(); this.after();
    },
    // 更换炉子弹窗
    openFurnacePick(kind) {
      const s = this.s, own = s.furnaces[kind].slice().sort((a, b) => a - b);
      if (!own.length) return this.log(`洞府里还没有${DATA.furnaceKinds[kind]}。`, "sys");
      this.modal(`<h2>更换${DATA.furnaceKinds[kind]}</h2>` + own.map(g => `<div class="line"><div>${DATA.li(DATA.furnaceIcon(kind))}${DATA.furnaceName(kind, g)}<small>${this.furnaceDesc(kind, g)}</small></div>
        ${s.furnaceUse[kind] === g ? `<button class="sm on" disabled>使用中</button>` : `<button class="sm" onclick="G.useFurnace('${kind}',${g})">使用</button>`}</div>`).join("") +
        `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },

    /* ---------- 炼丹 ---------- */
    danPer(type, g) { if (DATA.isTest()) return 1000; const fk = this.danFurn(DATA.danFu(type)), ck = this.danCk(type), tc = (CFG.craftsman[ck].TIME_CUT || [])[this.craftLv(ck) - 1] || 0;   // 炉子% + 炼丹仙师% + 丹火秘法% 相加
      return Math.ceil(DATA.danTime(type, g) * (1 - this.mifaCut("danTime", DATA.furnaceBonus(fk, this.s.furnaceUse[fk]) + tc + this.servantPct("dan")) / 100)); },
    setDanTier(g) { this.danTier = g; this.render(); },
    // 丹药分类（config/alchemy.js 的 CATS）：0 = 现有丹方，其余暂时没有丹方
    setDanCat(k, c) { this[k] = c; this.render(); },
    danCatBar(k) { const cur = this[k] || 0, C = CFG.alchemy.CATS || []; return C.length > 1 ? `<div class="room-grid five">${C.map((n, c) => `<button class="${cur === c ? "active" : ""}" onclick="G.setDanCat('${k}',${c})">${n}</button>`).join("")}</div>` : ""; },
    // 炼丹：丹炉空闲就开炉，否则加入队列（都会先扣药材）
    startAlch(type, g, n) {
      const s = this.s, rec = DATA.danRecipe(type, g);
      if (s.alchJob && s.alchQueue.length >= CFG.alchemy.QUEUE) return this.log(`炼丹队列已满（最多 ${CFG.alchemy.QUEUE} 个）。`, "sys");
      if (!s.recipes.includes(type + "|" + g)) return this.log("尚未学会该丹方。", "sys");
      const fk = this.danFurn(DATA.danFu(type)), fn = DATA.furnaceKinds[fk];
      if (s.furnaceUse[fk] < 0) return this.log(`炼丹必须装有炼丹炉。`, "sys");
      // n = 0 表示用现有药材能炼多少炼多少（这个 0 哨兵要保留，不能一刀切成 n>=1）
      let max = CFG.alchemy.MAX_BATCH;
      for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      n = Math.floor(+n || 0); if (n < 0) return this.log("药材不足。", "sys");
      n = n ? Math.min(n, max) : max;
      if (n <= 0) return this.log("药材不足。", "sys");
      rec.forEach(m => this.takeMat(m.kind, m.g, m.n * n));
      if (s.alchJob) { s.alchQueue.push({ type, g, n }); this.log(`${DATA.danName(type, g)} ×${n} 加入炼丹队列。`, "sys"); return this.after(); }
      const per = this.danPer(type, g);
      s.alchJob = { type, g, n, done: 0, per, next: this.now() + per };
      this.log(`开炉炼制${DATA.danName(type, g)} ×${n}。`, "good"); this.after();
    },
    // 停炉：退还没炼的药材，队列里的下一炉马上开始
    stopAlch() {
      const s = this.s, a = s.alchJob; if (!a) return;
      const left = a.n - a.done;
      DATA.danRecipe(a.type, a.g).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * left));
      s.alchJob = null; this.craftRec("alchLog", { at: this.now(), name: DATA.danName(a.type, a.g), n: a.done, ok: a.ok || 0, extra: a.extra || 0, fail: a.fail || 0, stop: 1 });
      const nx = s.alchQueue.shift();
      if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: this.now() + per }; }
      this.log(`停炉，退回 ${left} 枚的药材。`, "sys"); this.after();
    },
    // 取消队列中的一项，退回药材
    cancelAlchQ(i) {
      const q = this.s.alchQueue[i]; if (!q) return;
      this.s.alchQueue.splice(i, 1);
      DATA.danRecipe(q.type, q.g).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * q.n));
      this.log(`取消${DATA.danName(q.type, q.g)} ×${q.n}，药材已退回。`, "sys"); this.after();
    },

    /* ---------- 属性丹：背包、服用 ---------- */
    addDan(type, g, n = 1, sg) {
      if (DATA.recipeItem(type)) return this.addSm(DATA.recipeItem(type), n);   // 养神丹 → 专用材料
      if (DATA.isSpeedRecipe(type)) return this.addPill(type, DATA.pillGrade(type, g), n); // 修炼速度丹 → 背包修炼丹（品质 = 阶，仙界修炼丹 + REALM0）
      return this.bagAdd(x => x.t === "dan" && x.type === type && x.g === g && !x.sg === !sg, k => sg ? { t: "dan", type, g, n: k, sg: 1 } : { t: "dan", type, g, n: k }, n, "背包已满，丹药无处存放，暂停出炉。");
    },
    danLeft(type, g) { return DATA.danLimit(type, g) - (this.s.danEaten[type + "|" + g] || 0); },
    eatDan(i, n) {
      const it = this.s.bag[i]; if (!it || it.t !== "dan") return;
      n = Math.min(Math.floor(+n), it.n, this.danLeft(it.type, it.g));
      if (n <= 0) return this.log(`${DATA.danName(it.type, it.g, it.sg)}已达服用上限。`, "sys");
      const key = it.type + "|" + it.g, d = DATA.dans[it.type];
      this.s.danEaten[key] = (this.s.danEaten[key] || 0) + n;
      this.log(`服下${DATA.danName(it.type, it.g, it.sg)} ×${n}，${d.label} +${U.num(DATA.danVal(it.type, it.g) * n)}。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    // 所有已服用丹药的属性总和（computeStats 里用）
    danBonus() {
      const b = { atk: 0, def: 0, hp: 0, mana: 0, hit: 0, dodge: 0, crit: 0, speed: 0, res: 0 };   // speed、res（六系抗性）是 v41 魔丹 / 冥丹加的
      b.resEl = {};   // 六系抗性丹（stat res_属性）：只加这一系抗性
      for (const key in this.s.danEaten) { const [t, g] = key.split("|"), k = DATA.danStat(t); if (!DATA.dans[t]) continue;
        const v = (DATA.danVal(t, +g) || 0) * this.s.danEaten[key];
        if (k in b) b[k] += v; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + v; }
      const q = this.qlBonus ? this.qlBonus() : {}; for (const k in q) if (k in b) b[k] += q[k];   // v213 宗主清灵丹
      const jd = this.jdBonus ? this.jdBonus() : {}; for (const k in jd) if (k in b) b[k] += jd[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + jd[k];   // 讲道室听讲加的属性
      const yb = this.ybBonus ? this.ybBonus() : {}; for (const k in yb) if (k in b) b[k] += yb[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + yb[k];   // 游历宝物（world.js）
      const yst = this.ysStBonus ? this.ysStBonus() : {}; for (const k in yst) if (k in b) b[k] += yst[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + yst[k];   // 隐世宗门神通（world.js）
      const ysd = this.ysDanBonus ? this.ysDanBonus() : {}; for (const k in ysd) if (k in b) b[k] += ysd[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + ysd[k];   // 隐世宗门炼丹房丹药（world.js）
      const jm = this.jmBonus ? this.jmBonus() : {}; for (const k in jm) if (k in b) b[k] += jm[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + jm[k];   // 经脉（jingmai.js）
      return b;
    },

    /* ---------- 页面：炉子卡片（炼丹房、炼器室共用，可更换） ---------- */
    furnaceDesc(kind, g) { const d = DATA.isDanFu(kind); return `${d ? "炼丹" : "炼器"}时间 -${DATA.furnaceBonus(kind, g)}%`; },
    // v251 正在炼丹 / 正在炼器 框（k = alch / forge）：左边信息，右边三个按钮一个一行
    jobCard(k, info) {
      const s = this.s, dan = k === "alch", busy = dan ? s.alchJob : s.forgeJob, q = dan ? s.alchQueue : s.forgeQueue, Q = dan ? CFG.alchemy.QUEUE : CFG.furnace.QUEUE, w = dan ? "炼丹" : "炼器";
      if (!info && !busy && !q.length) return "";   // 炉子空闲、队列也空：不显示这个框
      return `<div class="card job-card"><div class="job-info">${info || `<b>${dan ? "丹炉" : "炼器炉"}空闲</b>`}</div>
        <div class="job-btns" style="justify-content:space-around"><button class="sm" onclick="G.openCraftQueue('${k}')">${w}队列 ${q.length}/${Q}</button>
          ${busy ? `<button class="sm on" onclick="G.askStopJob('${k}')">正在${w}</button>` : `<button class="sm" disabled>尚未${w}</button>`}</div></div>`;
    },
    // v252 停炉确认：游戏风格弹窗（不用浏览器 confirm）
    askStopJob(k) {
      const s = this.s, dan = k === "alch", j = dan ? s.alchJob : s.forgeJob; if (!j) return;
      const name = dan ? `${DATA.danName(j.type, j.g)} ×${j.n}（已炼 ${j.done}）` : this.jobName(j);
      this.modal(`<h2>${dan ? "停炉" : "停止炼器"}</h2><p class="desc" style="text-align:center">${name}</p>
        <p style="text-align:center">${dan ? "停炉后没炼的药材会退回，已出炉的丹药保留。" : "停止后材料会退回。"}</p>
        <div class="btns"><button class="primary" onclick="G.closeModal();G.${dan ? "stopAlch" : "stopForge"}()">确定</button><button onclick="G.closeModal()">取消</button></div>`);
    },
    // 炼丹 / 炼器队列弹窗：可以取消（退回材料）
    openCraftQueue(k) {
      const s = this.s, dan = k === "alch", job = dan ? s.alchJob : s.forgeJob, q = dan ? s.alchQueue : s.forgeQueue, Q = dan ? CFG.alchemy.QUEUE : CFG.furnace.QUEUE;
      let acc = !job ? 0 : dan ? Math.max(0, job.next - Date.now()) + Math.max(0, job.n - job.done - 1) * job.per : Math.max(0, job.end - Date.now());
      const rows = q.map((x, i) => { const ms = dan ? this.danPer(x.type, x.g) * x.n : this.forgePer(x.kind, x.g); acc += ms;
        return `<div class="line"><div>${i + 1}. ${dan ? `${DATA.danName(x.type, x.g)} ×${x.n}` : this.jobName(x)}<small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后完成</small></div>
          <button class="sm" onclick="G.${dan ? "cancelAlchQ" : "cancelForgeQ"}(${i})">取消</button></div>`; }).join("");
      this.modal(`<h2>${dan ? "炼丹" : "炼器"}队列<small> ${q.length} / ${Q}</small></h2><div class="craft-log">${rows || `<p class="desc">队列是空的。</p>`}</div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // v250 炼丹 / 炼器记录：最近 30 次
    craftRec(k, r) { const s = this.s; if (!Array.isArray(s[k])) s[k] = []; s[k].unshift(r); if (s[k].length > 30) s[k].length = 30; },
    openCraftLog(k) {
      const L = this.s[k] || [], dan = k === "alchLog", tm = t => { const d = new Date(t), z = n => String(n).padStart(2, "0"); return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
      this.modal(`<h2>${dan ? "炼丹" : "炼器"}记录<small> 最近 30 次</small></h2><div class="craft-log">` + (L.length ? L.map(r => `<div class="line"><div>${r.name}${dan ? ` ×${r.n}` : ""}${r.stop ? `<span class="tag">停炉</span>` : ""}
          <small>${tm(r.at)}${dan ? ` · 成丹 ${r.ok}${r.extra ? `（额外 +${r.extra}）` : ""} · 失败 ${r.fail}` : ""}</small></div>${dan ? "" : `<span class="${r.ok ? "c-green" : "q5"}">${r.ok ? "成功" : "失败"}</span>`}</div>`).join("") : `<p class="desc">还没有记录。</p>`) +
        `</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // v249 炼丹房 / 炼器室顶部：技艺、炉子缩成小卡片，点开弹窗看经验条、炉子缩短时间、更换炉子
    craftsmanMini(k) { const c = this.craftInfo(k); return `<div class="card mini" onclick="G.openCraftsman('${k}')"><h3>${this.craftTitle(k)}<small>详情 ›</small></h3></div>`; },
    furnaceMini(kind) { const cur = this.s.furnaceUse[kind];
      return `<div class="card mini" onclick="G.openFurnaceInfo('${kind}')"><h3>${cur >= 0 ? DATA.furnaceName(kind, cur) : `未装${DATA.furnaceKinds[kind]}`}<small>详情 ›</small></h3></div>`; },
    openCraftsman(k) {
      const C = CFG.craftsman, c = this.craftInfo(k), max = c.lv >= this.craftMax(k), need = (C[k].EXP || C.EXP)[c.lv - 1] || 1, tc = (C[k].TIME_CUT || [])[c.lv - 1] || 0;
      this.modal(`<h2>${this.craftTitle(k)}</h2>
        <div class="line"><div>${max ? `已满${this.craftUnit(k)}` : `经验 ${U.fmt(c.exp)} / ${U.fmt(need)}`}${tc ? `<small>炼制时间 -${U.num(tc)}%</small>` : ""}</div></div>
        ${max ? "" : `<div class="bar"><div style="width:${Math.min(100, c.exp / need * 100)}%"></div></div>`}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    openFurnaceInfo(kind) {
      const s = this.s, cur = s.furnaceUse[kind], n = s.furnaces[kind].length;
      this.modal(`<h2>${DATA.furnaceKinds[kind]}<small> 洞府已有 ${n} 个</small></h2>
        <div class="line"><div>${DATA.li(DATA.furnaceIcon(kind))}${cur >= 0 ? `使用中：${DATA.furnaceName(kind, cur)}<small>${this.furnaceDesc(kind, cur)}</small>` : `尚未装${DATA.furnaceKinds[kind]}`}</div></div>
        <div class="btns"><button class="primary" onclick="G.openFurnacePick('${kind}')" ${n ? "" : "disabled"}>更换</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    furnaceCard(kind) {
      const s = this.s, cur = s.furnaceUse[kind], n = s.furnaces[kind].length;
      return `<div class="card"><h3>${DATA.furnaceKinds[kind]}<small>洞府已有 ${n} 个</small></h3>
        <div class="line"><div>${DATA.li(DATA.furnaceIcon(kind))}${cur >= 0 ? `使用中：${DATA.furnaceName(kind, cur)}` : `尚未装${DATA.furnaceKinds[kind]}`}
          <small>${cur >= 0 ? this.furnaceDesc(kind, cur) : kind === "xdan" ? "没装时用炼丹炉炼仙丹、冥丹、魔丹；仙炉可在宗门宝库兑换图纸，在炼器室炼制" : kind === "sdan" ? "炼神丹用；没装时用炼丹仙炉（再没有用炼丹炉）。9、10 星宗门宝库兑换图纸，在炼器室炼制" : kind === "xqi" ? "装有后缩短炼制仙炉的时间：宗门宝库兑换图纸，在炼器室炼制" : `${kind === "dan" ? "炼丹" : "炼器"}必须装有${DATA.furnaceKinds[kind]}：宗门宝库 · 杂物兑换，或在炼器室炼制，放进背包后点「使用」`}</small></div>
          <button class="sm" onclick="G.openFurnacePick('${kind}')" ${n ? "" : "disabled"}>更换</button></div></div>`;
    },
  },
});

/* ---------- 炼丹房 / 炼器室：顶部按钮（炼丹 · 炼丹记录 · 隐藏丹方；炼器 · 精炼 · 记录 · 隐藏），先「开始炼丹 / 炼器」选配方，再开炉 ----------
 * 隐藏的丹方 / 配方只是界面显示偏好，存在本机 localStorage（xiu_hide_dan / xiu_hide_qi） */
Object.assign(G, {
  hideList(k) { try { return JSON.parse(localStorage.getItem("xiu_hide_" + k) || "[]"); } catch { return []; } },
  isHidden(k, key) { return this.hideList(k).includes(key); },
  toggleHide(k, key) {
    const L = this.hideList(k), i = L.indexOf(key); if (i >= 0) L.splice(i, 1); else L.push(key);
    try { localStorage.setItem("xiu_hide_" + k, JSON.stringify(L)); } catch {}
    this.render();
  },
  craftStartBtn(call, txt) { return `<div class="craft-start"><button class="primary" onclick="${call}">${txt}</button></div>`; },
  roomBtns(list, cur) { return `<div class="room-grid" style="grid-template-columns:repeat(${list.length},1fr)">${list.map(([k, n, call]) => `<button class="${cur === k ? "active" : ""}" onclick="${call}">${n}</button>`).join("")}</div>`; },
  setAlchMode(m) { this.alchMode = m; this.render(); },
  // 已学丹方（按 凡丹→神丹、一阶→十阶 排好）
  danKnown() {
    return this.s.recipes.map(k => { const [t, g] = k.split("|"); return { t, g: +g, key: k }; })
      .filter(x => DATA.recipes[x.t] && DATA.recipeHas(x.t, x.g))
      .sort((x, y) => DATA.danCat(x.t) - DATA.danCat(y.t) || x.g - y.g);
  },
  danEatTxt(t, g) { return DATA.dans[t] ? `已服 ${DATA.danLimit(t, g) - this.danLeft(t, g)}/${DATA.danLimit(t, g)}` : ""; },
  danInfo(t, g) {
    const rec = DATA.danRecipe(t, g), e = this.danEatTxt(t, g);
    return `<div>${DATA.danImg(DATA.danIcon(t), DATA.danCls(t, g), "li")}${DATA.danName(t, g)}<span class="tag">${DATA.recipeEffect(t, g)}</span>
      <small>${this.matsText(rec)} · 每枚 ${U.dur(this.danPer(t, g) / 1000)} · 成功率 ${this.ratePct(this.danRate(t, g))}${e ? " · " + e : ""}</small></div>`;
  },
  danCanMake(t, g) { const s = this.s; return s.furnaceUse[this.danFurn(DATA.danFu(t))] >= 0 && this.hasMats(DATA.danRecipe(t, g)) && !(s.alchJob && s.alchQueue.length >= CFG.alchemy.QUEUE); },
  // 开始炼丹：弹出全部已学丹方（隐藏的不显示），选一个
  openAlchList() {
    const L = this.danKnown().filter(x => !this.isHidden("dan", x.key));
    this.modal(`<h2>选择丹方<small> ${L.length} 个</small></h2><div class="craft-log">${L.length ? L.map(x => `<div class="line">${this.danInfo(x.t, x.g)}<button class="sm" onclick="G.openAlchN('${x.t}',${x.g})" ${this.danCanMake(x.t, x.g) ? "" : "disabled"}>选择</button></div>`).join("")
      : `<p class="desc">没有可选的丹方：在门派 → 炼丹房、四界功德司学习，或到「隐藏丹方」取消隐藏。</p>`}</div>
      <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
  },
  pickAlch(t, g) { this.alchPick = { t, g }; this.closeModal(); this.render(); },
  // 炼器配方：所有星级里已学会能炼的东西
  forgeItems() {
    const s = this.s, j = s.forgeJob, has = s.furnaceUse.qi >= 0, full = !!(j && s.forgeQueue.length >= CFG.furnace.QUEUE), out = [];
    const add = (key, info, ok, call, btn) => out.push({ key, info, ok: has && !full && ok, call, btn: btn || "炼制" });
    for (let g = 0; g < DATA.XING.length; g++) {
      const rate = this.ratePct(this.craftRate("qi", g));
      for (const k of DATA.FURNACE_KINDS) if ((s.blueprints[k] || []).includes(g)) {
        const mats = DATA.furnaceMats(k, g);
        add(`f:${k}:${g}`, `<div>${DATA.li(DATA.furnaceIcon(k))}${DATA.furnaceName(k, g)}<span class="tag">-${DATA.furnaceBonus(k, g)}%</span>
          <small>${this.matsText(mats)} · ${U.dur(this.forgePer(k, g) / 1000)} · 成功率 ${this.ratePct(this.forgeRate(k, g))}</small></div>`, this.hasMats(mats), `G.openForgeN('${k}',${g})`);
      }
      for (const sl of DATA.forgeSlots) if (s.forgeKnown.includes(this.forgeKey("eq", g, sl))) {
        const mats = DATA.forgeEqMats(g);
        if (sl === "fabao") {
          const prevOK = this.fabaoAnyBase(g), yn = ((CFG.forge.YAOSHI || {}).fabao || [])[g] || 0;
          add(`eq:fabao:${g}`, `<div>${DATA.eqTierIco(DATA.iconImg("fbs0_0"), g)}${DATA.XING[g]}法宝<span class="tag">${DATA.fabaoTypes.length} 种</span>
            <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.XING[g - 1]}${DATA.JIE[9]}同形状同属性法宝 ×1</span>、` : ""}${this.matsText(mats)}${yn ? `、同属性${DATA.smName("ys")} ×${U.fmt(yn)}` : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>`,
            prevOK && this.hasMats(mats), `G.openFabaoPick(${g})`, "选择");
          continue;
        }
        const prevOK = g === 0 || this.prevEquipIndex(sl, g) >= 0, esm = this.jobSm({ kind: "eq", g, slot: sl });
        add(`eq:${sl}:${g}`, `<div>${DATA.eqTierIco(DATA.iconImg("eq_" + sl), g)}${DATA.forgeEqName(sl, g)}<span class="tag">${DATA.slots[sl]}</span>
          <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.forgeEqName(sl, g - 1)}·${DATA.JIE[9]} ×1</span>、` : ""}${this.matsText(mats)}${esm.length ? "、" + this.smText(esm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>`,
          prevOK && this.hasMats(mats) && this.smHave(esm), `G.openForgeN('eq',${g},'${sl}')`);
      }
      if (g > 0) {
        const mats = DATA.ringMats(g);
        DATA.ringNames.forEach((n, r) => {
          if (!this.ringKnown(r, g)) return;
          const prevOK = this.prevEquipIndex("ring", g, r) >= 0, rsm = this.jobSm({ kind: "ring", g, r });
          add(`ring:${r}:${g}`, `<div>${DATA.li(DATA.iconImg("eq_ring"))}${DATA.ringName(r, g)}<span class="tag">戒指</span>
            <small><span class="${prevOK ? "" : "q5"}">${DATA.ringName(r, g - 1)}·${DATA.JIE[9]} ×1</span>、${this.matsText(mats)}${rsm.length ? "、" + this.smText(rsm) : ""} · ${U.dur(this.forgePer("ring", g) / 1000)} · 成功率 ${rate}</small></div>`,
            prevOK && this.hasMats(mats) && this.smHave(rsm), `G.openForgeN('ring',${g},${r})`);
        });
      }
      if (s.forgeKnown.includes(this.forgeKey("ss", g))) {
        const mats = DATA.stoneMats(g), sm = this.jobSm({ kind: "ss", g });
        add(`ss:${g}`, `<div>${DATA.li(DATA.iconImg("ss"))}${DATA.stoneName(g)}<span class="tag">储物格+1</span>
          <small>${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("ss", g) / 1000)} · 成功率 ${rate} · 已用 ${CFG.forge.stone.MAX_USE - this.stoneLeft(g)}/${CFG.forge.stone.MAX_USE}</small></div>`,
          this.hasMats(mats) && this.smHave(sm), `G.openForgeN('ss',${g})`);
      }
    }
    // 灵珠（立即炼成，不占炼器队列）
    const LZ = CFG.lingzhu, lzMats = this.lzMats();
    LZ.NAMES.forEach((n, ft) => { if (!s.forgeKnown.includes(this.forgeKey("lz", 0, ft))) return;
      const ok = this.hasMats(lzMats) && this.smCount("lj", ft) >= LZ.JING;
      out.push({ key: `lz:${ft}`, info: `<div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<span class="tag">聚灵+${U.fmt(LZ.BASE)}</span>
        <small>${this.matsText(lzMats)}、<span class="${this.smCount("lj", ft) >= LZ.JING ? "" : "q5"}">${DATA.li(DATA.smIcon("lj", ft))}${DATA.smName("lj", ft)} ${U.fmt(this.smCount("lj", ft))}/${LZ.JING}</span></small></div>`, ok, call: `G.craftLz(${ft})`, btn: "炼制" }); });
    return out;
  },
  openForgeList() {
    const L = this.forgeItems().filter(x => !this.isHidden("qi", x.key));
    this.modal(`<h2>选择配方<small> ${L.length} 个</small></h2><div class="craft-log">${L.length ? L.map(x => `<div class="line">${x.info}<button class="sm" onclick="${x.call}" ${x.ok ? "" : "disabled"}>选择</button></div>`).join("")
      : `<p class="desc">没有可选的配方：炉子图纸在门派宝库兑换，装备图谱、空间石、灵珠在门派炼器室学习，或到「隐藏」取消隐藏。</p>`}</div>
      <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
  },
  pickForge(key) { this.forgePickKey = key; this.closeModal(); this.render(); },
});

/* 洞府 · 炼丹房 */
G.caveViews.alchemy = function () {
  const s = this.s, a = s.alchJob, mode = this.alchMode === "hide" ? "hide" : "make";
  let h = this.cardRow(this.craftsmanMini("dan"), this.furnaceMini(this.danFurn("dan")));
  h += this.roomBtns([["make", "炼丹", "G.setAlchMode('make')"], ["log", "炼丹记录", "G.openCraftLog('alchLog')"], ["hide", "隐藏丹方", "G.setAlchMode('hide')"]], mode);
  if (mode === "hide") {
    const L = this.danKnown();
    return h + `<div class="card"><h3>已学丹方<small>${L.length} 个 · 隐藏后「开始炼丹」里不显示</small></h3>` + (L.length ? L.map(x => { const hid = this.isHidden("dan", x.key), e = this.danEatTxt(x.t, x.g);
      return `<div class="line"><div>${DATA.danImg(DATA.danIcon(x.t), DATA.danCls(x.t, x.g), "li")}${DATA.danName(x.t, x.g)}<span class="tag">${DATA.recipeEffect(x.t, x.g)}</span><small>${e || "不可服用"}</small></div>
        <button class="sm ${hid ? "on" : ""}" onclick="G.toggleHide('dan','${x.key}')">${hid ? "已隐藏" : "隐藏"}</button></div>`; }).join("") : `<p class="desc">还没有学会丹方。</p>`) + `</div>`;
  }
  // 炼丹信息（正在炼 + 排队）都在「开始炼丹」这个框里，按钮在信息下面；没有信息时按钮在页面中部
  const now = Date.now(); let acc = a ? Math.max(0, a.next - now) + Math.max(0, a.n - a.done - 1) * a.per : 0;
  const rows = (a ? [`<div class="line job-row"><div><b>${DATA.danName(a.type, a.g)}</b> ×${a.n}<span class="tag c-green">炼制中</span>
      <div class="pg">${this.pgFill(Math.max(0, a.next - now), a.per)}<span>${a.done} / ${a.n} · 下一枚 ${U.cd(Math.max(0, a.next - now) / 1000 + 59)}</span></div>
      <small>成丹 ${a.ok || 0}${a.extra ? `（+${a.extra}）` : ""} · 失败 ${a.fail || 0} · 成功率 ${this.ratePct(this.danRate(a.type, a.g))} · 约 ${U.cd(acc / 1000 + 59)} 后炼完</small></div>
      <button class="sm on" onclick="G.askStopJob('alch')">停炉</button></div>`] : [])
    .concat(s.alchQueue.map((x, i) => { const ms = this.danPer(x.type, x.g) * x.n; acc += ms;
      return `<div class="line job-row"><div><b>${DATA.danName(x.type, x.g)}</b> ×${x.n}<span class="tag">排队</span><small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后炼完</small></div>
        <button class="sm" onclick="G.cancelAlchQ(${i})">取消</button></div>`; })).join("");
  const full = a && s.alchQueue.length >= CFG.alchemy.QUEUE;
  h += rows ? `<div class="card"><h3>炼丹<small>排队 ${s.alchQueue.length} / ${CFG.alchemy.QUEUE}</small></h3>${rows}
    <div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.openAlchList()" ${full ? "disabled" : ""}>${full ? "炼丹队列已满" : "开始炼丹"}</button></div></div>`
    : this.craftStartBtn("G.openAlchList()", "开始炼丹");
  return h;
};

/* 洞府 · 炼器室 */
G.caveViews.forge = function () {
  const s = this.s, j = s.forgeJob, mode = ["refine", "hide"].includes(this.forgeMode) ? this.forgeMode : "make";
  let h = this.cardRow(this.craftsmanMini("qi"), this.furnaceMini("qi"));
  h += this.roomBtns([["make", "炼器", "G.setForgeMode('make')"], ["refine", "精炼", "G.setForgeMode('refine')"], ["log", "记录", "G.openCraftLog('forgeLog')"], ["hide", "隐藏", "G.setForgeMode('hide')"]], mode);
  if (mode === "refine") return h + `<div class="card"><h3>精炼<small>只需三种矿石</small></h3>${this.refineRows()}</div>`;
  const items = this.forgeItems();
  if (mode === "hide") {
    return h + `<div class="card"><h3>已学配方<small>${items.length} 个 · 隐藏后「开始炼器」里不显示</small></h3>` + (items.length ? items.map(x => { const hid = this.isHidden("qi", x.key);
      return `<div class="line">${x.info}<button class="sm ${hid ? "on" : ""}" onclick="G.toggleHide('qi','${x.key}')">${hid ? "已隐藏" : "隐藏"}</button></div>`; }).join("") : `<p class="desc">还没有学会配方。</p>`) + `</div>`;
  }
  // 炼器信息（正在炼 + 排队）都在「开始炼器」这个框里，按钮在信息下面；没有信息时按钮在页面中部
  const now = Date.now(); let acc = j ? Math.max(0, j.end - now) : 0;
  const rows = (j ? [`<div class="line job-row"><div><b>${this.jobName(j)}</b><span class="tag c-green">炼制中</span>
      <div class="pg">${this.pgFill(Math.max(0, j.end - now), this.forgePer(j.kind, j.g))}<span>剩余 ${U.cd(Math.max(0, j.end - now) / 1000 + 59)}</span></div>
      <small>成功率 ${this.ratePct(this.forgeRate(j.kind, j.g))}</small></div>
      <button class="sm on" onclick="G.askStopJob('forge')">停止</button></div>`] : [])
    .concat(s.forgeQueue.map((x, i) => { const ms = this.forgePer(x.kind, x.g); acc += ms;
      return `<div class="line job-row"><div><b>${this.jobName(x)}</b><span class="tag">排队</span><small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后完成</small></div>
        <button class="sm" onclick="G.cancelForgeQ(${i})">取消</button></div>`; })).join("");
  const full = j && s.forgeQueue.length >= CFG.furnace.QUEUE;
  h += rows ? `<div class="card"><h3>炼器<small>排队 ${s.forgeQueue.length} / ${CFG.furnace.QUEUE}</small></h3>${rows}
    <div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.openForgeList()" ${full ? "disabled" : ""}>${full ? "炼器队列已满" : "开始炼器"}</button></div></div>`
    : this.craftStartBtn("G.openForgeList()", "开始炼器");
  return h;
};

/* 门派 · 炼器室：学习装备图谱、空间石（sect.js 调用） */
G.sectForgeView = function () {
  const s = this.s, star = this.sectInfo().star;
  let h = "";
  h += this.lqCard("forge");   // v173 学习队列
  const cards = [];
  // N 星宗门显示一阶~N 阶图谱（不再分阶按钮）
  for (let g = 0; g < Math.min(star, DATA.DAN_JIE_N); g++) {
  const lock = false;
  const line = (kind, sl, name, tag, desc) => {
    const key = this.forgeKey(kind, g, sl), has = s.forgeKnown.includes(key), C = kind === "eq" ? CFG.forge.equip : CFG.forge.stone, c = C.learnCost[g];
    const img = kind === "ss" ? DATA.iconImg("ss") : DATA.iconImg(sl === "fabao" ? "fbs0_0" : "eq_" + sl);
    return [has, `<div class="line"><div>${kind === "eq" ? DATA.eqTierIco(img, g) : DATA.li(img)}${name}<span class="tag">${tag}</span><small>${kind === "ss" ? desc + "<br>" : ""}${U.fmt(c)} 贡献 · 学习 ${U.dur(C.learnTime[g] * 60)}</small></div>
      ${has || lock ? `<button class="sm" disabled>${has ? "已学会" : `${g + 1}星宗门可学习`}</button>` : this.lqBtn("forge", key, `G.learnForge('${kind}',${g}${sl ? `,'${sl}'` : ""})`, s.contrib < c)}</div>`];
  };
  cards.push({ head: `<h3>${DATA.nmPick(CFG.names.sectHall, "forge", "炼器室")} · ${DATA.XING[g]}图谱</h3>`, rows:
    DATA.forgeSlots.map(sl => line("eq", sl, DATA.forgeEqName(sl, g), DATA.slots[sl],
      (sl === "fabao" ? (g ? `升星图谱：把${DATA.XING[g - 1]}法宝升为${DATA.XING[g]}（${DATA.fabaoTypes.length} 种通用，颜色不变）` : `炼制图谱：用耀石炼成一星法宝（${DATA.fabaoTypes.map(t => t.name).join(" ")}，属性自选）`) : `主属性 ${CFG.forge.attr.main[sl].map(k => DATA.attrNames[k]).join("、")} + 1~5 条附加属性`) + (g ? ` · 需上一星${DATA.JIE[9]}${DATA.slots[sl]}` : ""))).concat([
    line("ss", null, DATA.stoneName(g), DATA.SS, `使用一个储物格 +1，每阶最多 ${CFG.forge.stone.MAX_USE} 个；炼制要空间晶核（秘境掉落）`)]) });
  }
  // 灵珠图纸：不分阶，每个星级都能学
  const LZ = CFG.lingzhu, lzc = LZ.LEARN_COST;
  cards.push({ head: `<h3>灵珠图纸</h3>`, rows: LZ.NAMES.map((n, ft) => { const has = s.forgeKnown.includes(this.forgeKey("lz", 0, ft));
    return [has, `<div class="line"><div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<small>${U.fmt(lzc)} 贡献 · 学习 ${U.dur(LZ.LEARN_TIME * 60)}</small></div>
      ${has ? `<button class="sm" disabled>已学会</button>` : this.lqBtn("forge", this.forgeKey("lz", 0, ft), `G.learnForge('lz',0,${ft})`, s.contrib < lzc)}</div>`]; }) });
  h += U.doneCards(cards);
  return h;
};

/* 门派 · 炼丹房：学习凡丹丹方（sect.js 调用）。1~5 星宗门每星两阶，6~10 星宗门全部凡丹丹方（DATA.danStar）；仙冥魔神丹方在四界功德司 */
G.sectAlchemyView = function () {
  const s = this.s, star = this.sectInfo().star;
  let h = this.lqCard("dan");   // v173 学习队列
  const hall = DATA.nmPick(CFG.names.sectHall, "alchemy", "炼丹房"), types = Object.keys(DATA.recipes).filter(t => !DATA.danCat(t));
  const cards = [];
  for (let g = 0; g < DATA.DAN_JIE_N; g++) {
    const rows = types.filter(t => DATA.recipeHas(t, g) && DATA.danStar(t, g) <= star).map(t => {
      const key = t + "|" + g, has = s.recipes.includes(key), c = DATA.danLearnCost(t, g);
      return [has, `<div class="line"><div>${DATA.danImg(DATA.danIcon(t), DATA.danCls(t, g), "li")}《${DATA.danName(t, g)}》<span class="tag">${DATA.recipeEffect(t, g)}</span>
        <small>${U.fmt(c)} 贡献 · 学习 ${U.dur(DATA.danLearnTime(t, g) / 1000)}</small></div>
        ${has ? `<button class="sm" disabled>已学会</button>` : this.lqBtn("dan", key, `G.learnRecipe('${t}',${g})`, s.contrib < c)}</div>`];
    });
    if (rows.length) cards.push({ head: `<h3>${hall} · ${DATA.JIE[g]}丹方</h3>`, rows });
  }
  return h + U.doneCards(cards) + `<p class="desc">仙丹、冥丹、魔丹、神丹的丹方在四界各地图的功德司用功德兑换。</p>`;
};
