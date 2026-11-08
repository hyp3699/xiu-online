/* =====================================================================
 * 模块：丹方、炼丹房、炼器室
 * ---------------------------------------------------------------------
 * 丹方：在 门派 → 炼丹房 学习（消耗贡献 + 时间，一次学一个），学会后才在洞府炼丹房显示。
 *   学习星级见 config/alchemy.js 的 CAT_STAR / STAR_TIERS；凡丹 7 种属性丹 + 3 种修炼丹，仙冥魔神丹各 7 种（仙丹另有 3 种仙界修炼丹）。
 * 图纸：门派 → 宗门宝库 兑换后放进背包，在背包点「学习」才能炼制该炉子。
 * 炉子：炼丹炉、炼器炉都在 洞府 · 炼器室 炼制（必须装有炼器炉，炼器炉缩短炼制时间），
 *   炼好的炉子放进背包，在背包点「使用」后装进洞府；洞府炼丹房 / 炼器室可随时更换使用哪一个。
 *   宗门宝库「杂物」可直接兑换一阶炼丹炉、一阶炼器炉。
 * 炼丹：必须装有炼丹炉，低阶炉也能炼高阶丹（成功率按炉阶差降低，见 craftRate）；只消耗药材，一炉可连续炼多枚，出炉放进背包。
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
 * 炼丹、炼器都有成功率（config/craftsman.js），失败扣材料（矿石、耀石），上一星装备 / 法宝退回。
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
      const c = s.craftsman[k], M = this.craftMax(k); if (c.lv > M) { c.lv = M; c.exp = 0; }   // 炼器仙师删掉后炼器师最高 12 星（存档超出的降到最高星）
      return c;
    },
    craftLv(k) { return this.craftInfo(k).lv; },
    craftMax(k) { const C = CFG.craftsman; return (C[k] && C[k].MAX) || (C["x" + k] ? 20 : C.MAX); },   // 炼丹师 / 炼器师 / 灵植夫 1~20 阶
    // 显示：1~10 阶叫炼丹师 / 炼器师 / 灵植夫 N 阶，11~20 阶叫炼丹仙师 / 炼器仙师 / 仙植师 (N−10) 阶
    craftTitle(k, lv) { const C = CFG.craftsman, u = this.craftUnit(k), z = n => this.cnNum(n) + u; lv = lv || this.craftLv(k); return lv > 20 && C["s" + k] ? `${C["s" + k].name} · ${z(lv - 20)}` : lv > 10 && C["x" + k] ? `${C["x" + k].name} · ${z(lv - 10)}` : `${C[k].name} · ${z(lv)}`; },   // 炼丹师 · 一阶；21~30 阶显示为炼丹神师
    cnNum(n) { const D = "零一二三四五六七八九"; return n <= 10 ? (n === 10 ? "十" : D[n]) : n < 20 ? "十" + D[n - 10] : D[Math.floor(n / 10)] + "十" + (n % 10 ? D[n % 10] : ""); },
    craftUnit(k) { return k === "qi" ? "星" : "阶"; },   // 炼器师按星显示
    // 炼丹 / 炼器一件给的经验：g = 物品阶序号（0 = 一阶），任何阶都给；再 × 对应经验总倍率（DAN_EXP_MULT / QI_EXP_MULT，初始 1）
    itemExp(k, g, ok) {
      const C = CFG.craftsman, K = C[k] || {};
      const e = K.ITEM_EXP ? (K.ITEM_EXP[g] ?? K.ITEM_EXP[K.ITEM_EXP.length - 1] ?? 0) : (g + 1) * (K.EXP_RATE || 0);
      const m = k === "dan" ? (C.DAN_EXP_MULT ?? 1) : k === "qi" ? (C.QI_EXP_MULT ?? 1) : 1;
      return e * (ok ? 1 : (C.FAIL_EXP || 0)) * m;
    },
    // 第 lv 阶升下一阶要的经验 = EXP[lv−1] × 各自升级总倍率（DAN_NEED_MULT / QI_NEED_MULT / LING_NEED_MULT，初始 1；xling 等别名归到本系，取表和倍率都用归一化后的 kk）
    craftNeed(k, lv) { const C = CFG.craftsman,
      kk = k === "xdan" || k === "sdan" ? "dan" : k === "xling" || k === "sling" ? "ling" : k,
      E = (C[kk] || {}).EXP || C.EXP || [];
      const km = kk === "dan" ? (C.DAN_NEED_MULT ?? 1) : kk === "qi" ? (C.QI_NEED_MULT ?? 1) : kk === "ling" ? (C.LING_NEED_MULT ?? 1) : 1;
      return Math.max(1, Math.round((E[lv - 1] ?? (64 + 32 * (lv - 1)) * 13 * lv) * km)); },
    // 加经验，满了升阶
    addCraftExp(k, n) {
      const c = this.craftInfo(k), M = this.craftMax(k);
      if (!(n > 0) || c.lv >= M) return;
      c.exp += n;
      while (c.lv < M && c.exp >= this.craftNeed(k, c.lv)) {
        c.exp -= this.craftNeed(k, c.lv); c.lv++;
        if (!this.silent) this.log(`晋升${this.craftTitle(k, c.lv).replace(" · ", " ")}！`, "gold");
      }
      if (c.lv >= M) c.exp = 0;
    },
    // 成功率 0~1：RATE_BASE + (技艺阶 − 物品阶) × RATE_STEP + (炉子阶 − 物品阶) × FURN_STEP + 秘法%，g = 物品阶序号（0 = 一阶）
    craftRate(k, g) {
      if (DATA.isTest()) return 1;
      const C = CFG.craftsman, m = this.mifaBonus();
      const fu = this.s.furnaceUse || {}, f = k === "xdan" && !(fu.xdan >= 0) ? fu.dan : fu[k];   // 用的炉子阶序号（仙丹没装仙炉按炼丹炉；炼器没有仙炉一说，按炼器炉）
      const pct = C.RATE_BASE + (this.craftLv(k) - (g + 1)) * C.RATE_STEP + (f >= 0 ? (f - g) * (C.FURN_STEP || 0) : 0) + ((k === "dan" || k === "xdan" ? m.danRate : m.qiRate) || 0);
      return Math.max((C.RATE_MIN || 0) / 100, Math.min(1, pct / 100));
    },
    // 炼丹用哪种炉：仙冥魔神丹装了炼丹仙炉用仙炉，没装就用炼丹炉（低阶炉也能炼，只是成功率按阶差降低）
    danFurn(fk) { const fu = this.s.furnaceUse; if (fk === "sdan" && !(fu.sdan >= 0)) fk = "xdan"; return fk === "xdan" && !(fu.xdan >= 0) ? "dan" : fk; },   // 神丹：炼丹神炉 → 炼丹仙炉 → 炼丹炉
    /* 炼丹统一：丹药共 20 阶（凡丹 1~10 阶，仙冥魔神丹 1~10 阶 = 总 11~20 阶），只有一个炼丹师（1~20 阶）；
     * 炉子也连起来：炼丹炉 1~10 阶，炼丹仙炉 1~10 阶 = 11~20 阶。成功率 = 86 + (炼丹师阶 − 丹药总阶) × 5 + (炉子总阶 − 丹药总阶) × 5 */
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
    // 秘法缩短时间 %（TIME_CUT_MAX 有值时才封顶，现为空对象即不封顶）
    // 时间减少 % 合计 = 炉子% + 秘法%（相加，不相乘）
    mifaCut(kind, add = 0) { const cap = (CFG.wudao.TIME_CUT_MAX || {})[kind]; const v = (this.mifaBonus()[kind] || 0) + add; return cap === undefined ? v : Math.min(cap, v); },   // 速度合计（没上限）
    spdDiv(p) { return 1 + Math.max(0, p) / 100; },   // 时间 ÷ (1 + 速度%)
    danSpd(fk) { const ck = "dan", tc = (CFG.craftsman[ck].TIME_CUT || [])[this.craftLv(ck) - 1] || 0; return this.mifaCut("danTime", DATA.furnaceBonus(fk, this.s.furnaceUse[fk]) + tc + this.servantPct("dan") + (this.xdSpeed ? this.xdSpeed("dan") : 0)); },
    qiSpd() { const tc = (CFG.craftsman.qi.TIME_CUT || [])[this.craftLv("qi") - 1] || 0; return this.mifaCut("qiTime", DATA.furnaceBonus("qi", this.s.furnaceUse.qi) + tc + this.servantPct("qi") + (this.xdSpeed ? this.xdSpeed("qi") : 0)); },
    // 技艺卡片（炼丹房、炼器室、灵药园顶部）
    craftsmanCard(k) {
      const C = CFG.craftsman, c = this.craftInfo(k), max = c.lv >= this.craftMax(k), need = this.craftNeed(k, c.lv), pg = k === "xling" ? DATA.FAN_HERB_N : 0;
      const xs = (k === "dan" || k === "qi") && this.xdSpeed ? this.xdSpeed(k) : 0;
      const eff = k === "ling" || k === "xling" ? `<p class="desc">${k === "xling" ? "仙界药材" : ""}种植速度 +${U.num(this.plantCut(pg))}% · 收获 +${U.num(this.plantYieldPct(pg))}%</p>` : k === "dan" || k === "qi" ? `<p class="desc">${k === "qi" ? "炼器" : "炼丹"}速度 +${U.num(k === "qi" ? this.qiSpd() : this.danSpd(this.danFurn("sdan")))}%${xs ? `（含心得 ${xs}%）` : ""}</p>` : "";   // 炼丹、炼器的成功率显示在每样物品上
      return `<div class="card"><h3>${this.craftTitle(k)}<small>${max ? `已满${this.craftUnit(k)}` : `经验 ${U.fmt(c.exp)} / ${U.fmt(need)}`}</small></h3>
        ${max ? "" : `<div class="bar"><div style="width:${Math.min(100, c.exp / need * 100)}%"></div></div>`}${eff}</div>`;
    },

    /* ---------- 材料 ---------- */
    // free = true：不算加锁的格子（宗门兑换用，加锁的物品不能拿去换）
    countMat(kind, g, free) {
      if (kind === "sm") return this.smCount(g);   // 秘境专用材料（养神露）
      if (kind === "cu") return this.s.bag.reduce((a, it) => a + (it && it.t === "cu" && it.name === g ? it.n : 0), 0);   // 自定义物品，g = 物品名
      const name = DATA.matName(kind, g);
      return this.s.bag.reduce((a, it) => a + (it && it.t === "mat" && it.kind === kind && it.name === name && !(free && it.lk) ? it.n : 0), 0);
    },
    takeMat(kind, g, n, free) {
      n = Math.floor(+n); if (!(n >= 1)) return;
      if (kind === "sm") return void this.takeSm(g, n);
      if (kind === "cu") {   // 自定义物品按名字扣
        for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) {
          const it = this.s.bag[i];
          if (!it || it.t !== "cu" || it.name !== g) continue;
          const k = Math.min(n, it.n); this.removeAt(i, k); n -= k;
        }
        return;
      }
      const name = DATA.matName(kind, g);
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) {
        const it = this.s.bag[i];
        if (!it || it.t !== "mat" || it.kind !== kind || it.name !== name || (free && it.lk)) continue;
        const k = Math.min(n, it.n); this.removeAt(i, k); n -= k;
      }
    },
    // 测试模式（调试人物）：炼器、精炼、炼丹、灵珠、本命法宝都不消耗材料（够不够一律算够，也不扣、不退）
    craftFree() { return DATA.isTest(); },
    hasMats(list, times = 1) { return this.craftFree() || list.every(m => this.countMat(m.kind, m.g) >= m.n * times); },
    matsText(list, times = 1) {
      return list.map(m => { const have = this.countMat(m.kind, m.g), need = m.n * times;
        return `<span class="${have >= need ? "" : "q5"}">${DATA.matFull(m.kind, m.g)} ${U.fmt(have)}/${U.fmt(need)}</span>`; }).join("、");
    },
    giveBack(list, times = 1) { list.forEach(m => m.kind === "sm" ? this.addSm(m.g, m.n * times, m.ft) : this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * times)); },   // 秘境材料走 addSm 才能保留 ft（分属性），否则退回的分属性材料会混成一堆

    /* ---------- 定时结算（每 10 秒，离线也会补算） ---------- */
    craftTick() {
      const s = this.s, now = this.now();
      this.fixCraft();
      // 丹方学习、图谱 / 图纸学习（v173 学习队列，gongfa.js lqTick）
      this.lqTick("dan"); this.lqTick("forge");
      if (this.bmTick) this.bmTick();   // 本命法宝炼制（bag.js）
      // 炼器室：炼好放进背包（背包满就等着），队列自动衔接
      let j, guard = 0;
      while ((j = s.forgeJob) && now >= j.end && guard++ < 1000) {
        if (j.kind === "rf" && !j.worn && !j.stop && (j.n || 1) - (j.done || 0) > 1 && this.rfStep(j)) continue;   // 连续精炼：中间各次就地结算，接着炼
        if (!this.finishForge(j)) break;
        if (!j.stop) this.craftRec("forgeLog", { at: j.end, name: this.jobName(j), ok: j.ok ? 1 : 0 });
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
            this.addDan(a.type, a.g, 1);   // 背包满时进传音暂存，不再暂停出炉
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
        if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: a.next - a.per + per, mats: nx.mats }; }
      }
    },
    // 改了配置（炉子种类、阶数、丹方）后清掉存档里无效的数据
    fixCraft() {
      const s = this.s;
      for (const k of DATA.FURNACE_KINDS) {
        if (!s.blueprints[k]) s.blueprints[k] = [];
        if (!s.furnaces[k]) s.furnaces[k] = [];
        if (s.furnaceUse[k] === undefined) s.furnaceUse[k] = -1;
        const N = DATA.furnaceN(k);   // 炼器炉十二星，其他炉十阶
        s.blueprints[k] = s.blueprints[k].filter(g => g >= 0 && g < N);
        s.furnaces[k] = s.furnaces[k].filter(g => g >= 0 && g < N);
        if (!s.furnaces[k].includes(s.furnaceUse[k])) s.furnaceUse[k] = s.furnaces[k].length ? Math.max(...s.furnaces[k]) : -1;   // v250 洞府有炉子却没在用 → 自动用最高阶
      }
      if (s.alchJob && !DATA.recipes[s.alchJob.type]) {
        const a = s.alchJob, left = a.n - (a.done || 0);
        if (a.mats && !this.craftFree()) a.mats.forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * left));
        else if (!this.silent) this.log(`丹方已删除，未炼的 ${left} 枚药材无法按原配方退回。`, "bad");   // 配方已删时 danName 会抛错（recipes[type] 不存在），只记“配方已删除”，不拼丹名
        s.alchJob = null;
      }
      if (!Array.isArray(s.alchLog)) s.alchLog = []; if (!Array.isArray(s.forgeLog)) s.forgeLog = [];
      s.alchQueue = s.alchQueue.filter(q => { if (DATA.recipes[q.type]) return true; if (q.mats && !this.craftFree()) q.mats.forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * q.n)); else if (!this.silent) this.log(`丹方已删除，队列里 ×${q.n} 的药材无法按原配方退回。`, "bad"); return false; });   // 配方已删时 danName 会抛错，只记“配方已删除”，不拼丹名
      if (s.bag.some(it => it && it.t === "dan" && !DATA.dans[it.type])) s.bag = s.bag.filter(it => !it || it.t !== "dan" || DATA.dans[it.type]);
      if (!s.eqMax10) this.fixEq10();
    },
    // 装备、法宝、戒指超过最高星（DATA.XING）的降为最高星，名字跟着换；超出的图谱删掉（只跑一次，eqMax10 标记）
    fixEq10() {
      const s = this.s, M = DATA.XING.length - 1;
      const fix = e => { if (!e || !(e.g > M)) return; e.g = M;
        if (e.slot === "fabao") e.name = DATA.fabaoName(e.ft, M); else if (e.slot !== "ring" && DATA.forgeNames[e.slot]) e.name = DATA.forgeNames[e.slot][M]; };
      for (const k in s.equip || {}) fix(s.equip[k]);
      (s.fabao || []).forEach(fix);
      for (const it of s.bag || []) { if (!it) continue; if (it.t === "eq") fix(it.e); else if (it.t === "rbp" && it.g > M) it.g = M; }
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
      this.bagPutOrMail({ t: "bp", kind, g });
      return true;
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
      if (kind === "rf") return Math.ceil(this.forgePer("eq", g) * ((CFG.forge.refine || {}).TIME_PCT ?? 20) / 100);   // 精炼：同星级装备炼制时间 × 20%（吃炼器速度）
      const base = kind === "eq" ? DATA.forgeEqTime(g) : kind === "ss" ? DATA.stoneTime(g) : kind === "ring" ? DATA.ringTime(g) : DATA.furnaceTime(kind, g);
      return Math.ceil(base / this.spdDiv(this.qiSpd()));   // 炼器速度 = 炉子 + 炼器师 + 器火秘法 + 道童 + 心得（没上限）
    },
    // 秘境专用材料：空间石要空间晶核；装备 / 戒指 / 法宝要耀石（config/forge.js 的 YAOSHI）→ [{ k, ft, n }]
    //   法宝用同属性耀石（q.el），装备、戒指任意一种（ft = -1）
    jobSm(q) {
      if (q.kind === "ss") { const n = (CFG.forge.stone.special || [])[q.g] || 0; return n ? [{ k: "kj", n }] : []; }
      const out = [];
      if (q.kind === "eq" || q.kind === "ring") {
        const fb = q.slot === "fabao", J = CFG.forge.YAOSHI || {}, n = (J[q.kind === "ring" ? "ring" : fb ? "fabao" : "equip"] || [])[q.g] || 0;
        if (n) out.push({ k: "ys", ft: fb ? DATA.elIdx(q.el) : q.ys >= 0 ? q.ys : -1, n });   // 装备 / 戒指：q.ys = 玩家选的耀石（-1 / 不写 = 自动，先扣最多的那种）
        const sp = q.kind === "ring" && DATA.ringSp(q.r), sn = sp ? DATA.ringSmNeed(q.g) : 0;   // 灵犀 / 烈阳 / 玄武戒：专用材料
        if (sn > 0) out.push({ k: sp.sm, n: sn });
      }
      return out;
    },
    smHave(list) { return this.craftFree() || list.every(x => this.smCount(x.k, x.ft) >= x.n); },
    smText(list) { return list.map(x => `<span class="${this.smCount(x.k, x.ft) >= x.n ? "" : "q5"}">${DATA.li(DATA.smIcon(x.k, x.ft))}${DATA.smName(x.k, x.ft)} ${U.fmt(this.smCount(x.k, x.ft))}/${U.fmt(x.n)}</span>`).join("、"); },
    jobMats(q) { return q.kind === "rf" ? DATA.refineMats(q.item) : q.kind === "eq" ? DATA.forgeEqMats(q.g) : q.kind === "ss" ? DATA.stoneMats(q.g) : q.kind === "ring" ? DATA.ringMatsFor(q.r, q.g) : DATA.furnaceMats(q.kind, q.g); },
    // 炼器队列每项的小图（正在炼 / 排队列表用）
    jobIco(q) { const k = q.kind, src = k === "rf" ? DATA.eqIcon(q.item) : k === "eq" ? (q.slot === "fabao" ? DATA.eqIcon({ slot: "fabao", ft: q.ft >= 0 ? q.ft : 0, g: q.g }) : DATA.eqIcon({ slot: q.slot }))
        : k === "ring" ? DATA.eqIcon({ slot: "ring", r: q.r, g: q.g }) : k === "ss" ? DATA.iconImg("ss") : DATA.FURNACE_KINDS.includes(k) ? DATA.furnaceIcon(k) : "";
      return src ? `<img class="job-ico" src="${src}" alt="" loading="lazy">` : ""; },
    jobName(q) { return q.kind === "rf" ? "精炼" + this.itemName({ t: "eq", e: q.item }) + ((q.n || 1) > 1 ? `（第 ${Math.min(q.n, (q.done || 0) + 1)}/${q.n} 次）` : "") : q.kind === "eq" ? (q.slot === "fabao" && q.ft !== undefined ? DATA.XING[q.g] + "·" + (DATA.elById[q.el] ? DATA.elById[q.el].name + "·" : "") + DATA.fabaoName(q.ft, q.g) : DATA.forgeEqName(q.slot, q.g)) : q.kind === "ss" ? DATA.stoneName(q.g) : q.kind === "ring" ? DATA.ringName(q.r, q.g) : DATA.furnaceName(q.kind, q.g); },
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
    // 连续精炼（job.n 次）的中间一次：判定、加精炼次数、记录，再扣下一次的材料接着炼；满了或材料不够就停（j.stop，出炉时只把那件退回）
    rfStep(j) {
      if (j.ok === undefined) { j.ok = Math.random() < this.forgeRate(j.kind, j.g); this.addCraftExp("qi", this.itemExp("qi", this.forgeTotal(j.kind, j.g), j.ok)); }
      const e = j.item, nm = () => this.itemName({ t: "eq", e });
      if (j.ok) e.rj = Math.min(DATA.rjCap(e), DATA.rjCount(e) + 1);
      this.log(j.ok ? `精炼成功：<span class="q${e.q}">${nm()}</span> ${DATA.rjName(e)}。` : `精炼${nm()}失败，材料已耗尽，仍是${DATA.rjName(e)}。`, j.ok ? "gold" : "bad");
      this.craftRec("forgeLog", { at: j.end, name: "精炼" + nm(), ok: j.ok ? 1 : 0 });
      j.done = (j.done || 0) + 1; j.ok = undefined; this.dirty();
      let go = !DATA.rjTop(e);
      if (go && !j.free) { const mats = DATA.refineMats(e), sm = DATA.refineSm(e);
        if (this.hasMats(mats) && this.smHave(sm)) { const got = []; mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); sm.forEach(x => { const g2 = this.takeSm(x.k, x.n, x.ft); if (g2) got.push(...g2); }); j.sm = got; }
        else { go = false; this.log(`材料不足，${nm()}的连续精炼停止。`, "sys"); } }
      if (!go) { j.stop = 1; return false; }
      j.end += this.forgePer("rf", e.g); return true;
    },
    finishForge(j) {
      if (j.stop) { const e = j.item; if (!this.rfLive(e.uid)) this.addEquip(e); this.dirty(); return true; }   // 连续精炼提前停：只退回那件
      // 成功率判定（只判一次，背包满等待时不重复判定、不重复加经验）
      if (j.ok === undefined) {
        j.ok = Math.random() < this.forgeRate(j.kind, j.g);
        this.addCraftExp("qi", this.itemExp("qi", this.forgeTotal(j.kind, j.g), j.ok));
      }
      if (j.kind === "rf" && j.worn) {   // 精炼身上穿着的：那件一直留在身上，出炉时按 uid 找到它就地 +1 次
        const live = this.rfLive(j.uid || (j.item && j.item.uid)), nm = this.itemName({ t: "eq", e: live || j.item });   // 旧存档才有 worn（现在精炼都把那件拿进炉里）
        if (!live) { this.log(`精炼${nm}作废：那件已不在（出售、分解或炼掉了），材料不退。`, "bad"); return true; }
        if (j.ok) live.rj = Math.min(DATA.rjCap(live), DATA.rjCount(live) + 1);
        this.dirty();
        this.log(j.ok ? `精炼成功：<span class="q${live.q}">${nm}</span> ${DATA.rjName(live)}。` : `精炼${nm}失败，材料已耗尽，仍是${DATA.rjName(live)}。`, j.ok ? "gold" : "bad");
        return true;
      }
      if (j.kind === "rf") {   // 精炼：成功 +1 次；失败只扣材料，被精炼的那件原样退回
        const e = j.item;
        // 去重兜底：原物若已在背包里（旧存档、入炉未删干净等），只就地改精炼次数，不再新塞一件；
        // 同一引用或同一 uid 都算同一件，避免出炉时复制。
        // 身上、法宝栏也查（现在身上的也能精炼）
        const de = this.rfLive(e.uid) || ((this.s.bag.find(x => x && x.t === "eq" && x.e === e) || {}).e);
        if (de) {
          if (j.ok) de.rj = Math.min(DATA.rjCap(de), DATA.rjCount(de) + 1);
          this.dirty();
          this.log(j.ok ? `精炼成功：<span class="q${de.q}">${this.itemName({ t: "eq", e: de })}</span> ${DATA.rjName(de)}。` : `精炼${this.itemName({ t: "eq", e: de })}失败，材料已耗尽，仍是${DATA.rjName(de)}。`, j.ok ? "gold" : "bad");
          return true;
        }
        if (j.ok) e.rj = DATA.rjCount(e) + 1;
        this.addEquip(e); this.dirty();
        this.log(j.ok ? `精炼成功：<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span> ${DATA.rjName(e)}。` : `精炼${this.itemName({ t: "eq", e })}失败，材料已耗尽，仍是${DATA.rjName(e)}。`, j.ok ? "gold" : "bad");
        return true;
      }
      if (!j.ok) {   // 失败：矿石、耀石扣掉，上一星装备 / 法宝退回（2026-11-08 起法宝也一样，不再全退）
        if (j.prev) this.addEquipOnce(j.prev);
        this.log(`${this.jobName(j)}炼制失败，材料已耗尽${j.prev ? `（上一星${j.slot === "fabao" ? "法宝" : "装备"}已退回）` : ""}。`, "bad"); return true;
      }
      if (j.kind === "eq" || j.kind === "ring") {
        // v25：升阶（有上一阶装备）→ 属性颜色不变，只是数值按新阶变大；一阶 → 随机生成
        const e = j.prev && j.prev.attrs ? DATA.upgradeForged(j.prev, j.g) : DATA.rollForged(j.kind === "ring" ? "ring" : j.slot, j.g, j.kind === "ring" ? j.r : j.ft, j.el);
        this.addEquip(e);
        this.log(`炼成 <span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>。`, "gold"); return true;
      }
      if (j.kind === "ss") { if (!this.addStone(j.g)) return false; this.log(`${DATA.stoneName(j.g)}炼制成功。`, "gold"); return true; }
      if (!this.addFurnaceItem(j.kind, j.g)) return false;
      this.log(`${DATA.furnaceName(j.kind, j.g)}炼制成功。`, "gold"); return true;
    },
    // 背包里上一阶同部位的炼器装备（优先颜色最差的）
    //   v25：戒指要同种（r）；优先颜色最好的（升阶颜色不变）
    //   法宝：r = 形状序号、el = 属性（要同形状同属性）；多件时优先强化等级高的
    prevEquipIndex(slot, g, r, el) {
      let best = -1;
      const same = e => r === undefined || (slot === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
      const score = e => (e.enh || 0) * 10 + e.q;
      this.s.bag.forEach((it, i) => { if (it && it.t === "eq" && it.e.attrs && it.e.slot === slot && it.e.g === g - 1 && same(it.e) && (best < 0 || score(it.e) > score(this.s.bag[best].e))) best = i; });   // 升星不看精炼次数
      return best;
    },
    // 升星可选的上一星：身上穿的、法宝栏、背包里的全部列出 [[e, 位置]]；本命法宝不算
    prevList(slot, g, r, el) {
      const s = this.s, list = [], same = e => r === undefined || r === null || (slot === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
      const ok = e => e && e.attrs && !e.bm && e.slot === slot && e.g === g - 1 && same(e);
      for (const k of DATA.equipSlots) { const e = (s.equip || {})[k]; if (ok(e)) list.push([e, "已装备"]); }
      (s.fabao || []).forEach(e => { if (ok(e)) list.push([e, "法宝栏"]); });
      s.bag.forEach(it => { if (it && it.t === "eq" && ok(it.e)) list.push([it.e, ""]); });
      return list;
    },
    // 炼制：空闲就开始，否则加入队列（都会先扣材料）。kind = dan/qi 炉子、eq 装备/法宝（slot）、ss 空间石、ring 戒指（slot 传戒指种类序号）
    //   法宝：slot = "fabao"，ft = 形状序号，el = 属性
    // 装备 / 戒指用哪种耀石：ys 0~5 = 指定那种，其它 = 自动（法宝不看这个，固定同属性）
    ysArg(ys) { const n = ((CFG.mijing.items.ys || {}).names || []).length; ys = Number(ys); return Number.isInteger(ys) && ys >= 0 && ys < n ? ys : -1; },
    craftFurnace(kind, g, slot, ft, el, uid, ys) {
      const s = this.s, q = s.forgeQueue, job = { kind, g };
      if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot;
      if ((kind === "ring" || kind === "eq") && slot !== "fabao" && this.ysArg(ys) >= 0) job.ys = this.ysArg(ys);
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
      if (kind === "ring" && !DATA.ringOK(job.r)) return this.log("这种戒指已经不能炼制了。", "sys");
      if (kind === "ring" && g < 1 && !DATA.ringSp(job.r)) return;   // 一星戒指不能炼（灵犀 / 烈阳 / 玄武戒除外）
      let pe = null;   // uid = 玩家在列表里选的那件（身上、法宝栏、背包都行）；不传按旧规则从背包自动挑
      if (uid && (kind === "eq" || kind === "ring") && g > 0) {
        pe = this.rfLive(uid);
        if (!pe || !this.prevList(kind === "ring" ? "ring" : slot, g, kind === "ring" ? job.r : job.ft, job.el).some(([x]) => x === pe)) return this.log("选的那件已不在，或不能用来炼制。", "sys");
      }
      else if (kind === "eq" && g > 0) { pi = this.prevEquipIndex(slot, g, job.ft, job.el); if (pi < 0) return this.log(`需要一件${slot === "fabao" ? DATA.XING[g - 1] + "·" + DATA.elById[job.el].name + "·" + DATA.fabaoName(job.ft, g - 1) : DATA.forgeEqName(slot, g - 1)}。`, "sys"); }
      else if (kind === "ring" && g > 0) { pi = this.prevEquipIndex("ring", g, job.r); if (pi < 0) return this.log(`需要一枚${DATA.ringName(job.r, g - 1)}。`, "sys"); }
      if (pi >= 0) { job.prev = s.bag[pi].e; s.bag[pi] = null; }   // 固定格子：上一阶装备拿走后该格留空，不往前挪
      else if (pe) { job.prev = pe; this.rfTake(pe); this._cache = null; }   // 选的那件（含身上穿的）拿走；出炉、失败、取消都放回背包
      job.sm = []; if (this.craftFree()) job.free = 1; else { mats.forEach(m => this.takeMat(m.kind, m.g, m.n));
        sm.forEach(x => { const got = this.takeSm(x.k, x.n, x.ft); if (got) job.sm.push(...got); }); }   // 记下实际扣的（取消时按这个退）
      if (s.forgeJob) { q.push(job); this.log(`${this.jobName(job)}加入队列。`, "sys"); }
      else { s.forgeJob = Object.assign(job, { end: this.now() + this.forgePer(kind, g) }); this.log(`开始炼制${this.jobName(job)}。`, "good"); }
      if (slot === "fabao") this.closeModal();
      this.after();
    },
    // v248 炼制数量窗口（炼丹、炼器共用）：加减按钮 / 输入框选数量，确定后炼制
    cardRow(a, b) { return `<div class="card-row">${a}${b}</div>`; },
    qtyModal(title, info, max, call, o) {   // o = { max: "最多可买", ok: "购买" }，不传按炼制显示
      o = o || {};
      this._qty = { max, call, n: Math.min(max, this._qty && this._qty.title === title ? this._qty.n : 1), title };
      const step = [[-10, "-10"], [-1, "-"], [1, "+"], [10, "+10"]];
      this.modal(`<h2>${title}</h2>${info}
        <div class="qty-box">${step.slice(0, 2).map(([d, t]) => `<button onclick="G.qtyAdd(${d})">${t}</button>`).join("")}
          <input id="qty-n" type="number" min="1" max="${max}" value="${this._qty.n}" oninput="G.qtySet(this.value,1)">
          ${step.slice(2).map(([d, t]) => `<button onclick="G.qtyAdd(${d})">${t}</button>`).join("")}</div>
        <p class="desc" style="text-align:center">${o.max || "最多可炼"} ${U.fmt(max)}　<a href="javascript:void 0" onclick="G.qtySet(${max})">最大</a></p>
        <div class="btns"><button class="primary" onclick="G.qtyOk()">${o.ok || "炼制"}</button><button onclick="G.closeModal()">取消</button></div>`);
    },
    qtySet(v, typing) { const q = this._qty; if (!q) return; v = Math.floor(+v || 0); q.n = Math.max(1, Math.min(q.max, v));
      const el = document.getElementById("qty-n"); if (el && (!typing || v > q.max)) el.value = q.n; },
    qtyAdd(d) { const q = this._qty; if (q) this.qtySet(q.n + d); },
    qtyOk() { const q = this._qty; if (!q) return; const n = q.n, call = q.call; this._qty = null; this.closeModal(); call(n); },
    // 炼丹数量：最多 = 药材够炼几枚（一炉上限 MAX_BATCH）
    openAlchN(type, g) {
      const rec = DATA.danRecipe(type, g); let max = CFG.alchemy.MAX_BATCH;
      if (!this.craftFree()) for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      if (max <= 0) return this.log("药材不足。", "sys");
      this.qtyModal(`炼制${DATA.danName(type, g)}`, `<p class="desc">每枚：${this.matsText(rec)} · ${U.dur(this.danPer(type, g) / 1000)}</p>`, max, n => this.startAlch(type, g, n));
    },
    // 炼器数量：每件单独排队，最多 = 队列空位 和 材料（含上一阶装备、专用材料）够几件
    forgeMax(kind, g, slot, ft, el, ys) {
      const s = this.s, job = { kind, g }; if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot; if (slot === "fabao") { job.ft = +ft; job.el = el; } else if (this.ysArg(ys) >= 0) job.ys = this.ysArg(ys);
      let max = (s.forgeJob ? 0 : 1) + CFG.furnace.QUEUE - s.forgeQueue.length;
      if (!this.craftFree()) { for (const m of this.jobMats(job)) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
        for (const x of this.jobSm(job)) max = Math.min(max, Math.floor(this.smCount(x.k, x.ft) / x.n)); }
      if (kind === "ring" && (!DATA.ringOK(job.r) || (g < 1 && !DATA.ringSp(job.r)))) return 0;
      if ((kind === "eq" || kind === "ring") && g > 0) {
        const ps = kind === "ring" ? "ring" : slot, r = kind === "ring" ? job.r : job.ft;
        const same = e => r === undefined || (ps === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
        max = Math.min(max, s.bag.filter(it => it && it.t === "eq" && it.e.attrs && it.e.slot === ps && it.e.g === g - 1 && same(it.e)).length);
      }
      return Math.max(0, max);
    },
    // 装备 / 戒指耀石选择（只在界面记，不存档）：-1 = 自动（先扣最多的那种）
    ysKey(kind) { return kind === "ring" || kind === "enh" ? kind : "eq"; },   // eq 装备炼制 / ring 戒指炼制 / enh 强化，各记各的
    ysSel(kind) { const v = (this._ysSel || {})[this.ysKey(kind)]; return v >= 0 ? v : -1; },
    setYs(kind, v) { this._ysSel = this._ysSel || {}; this._ysSel[this.ysKey(kind)] = this.ysArg(v);
      if (kind === "enh") return this.drawEnhance(); if (this._cpShown === "qi" && document.querySelector("#modal-box .cpk")) return this.openForgeList(); const a = this._forgeArgs; if (a) this.openForgeN(...a); },
    ysRow(kind, n, noAuto) {   // noAuto：升星选择装备时不给「自动」，必须手动选一种耀石
      if (!n) return ""; const cur = this.ysSel(kind), names = (CFG.mijing.items.ys || {}).names || [];
      const b = (v, label) => `<button class="${v === cur ? "active" : ""}" onclick="G.setYs('${kind}',${v})">${label}</button>`;
      return `<p class="desc">耀石（${kind === "enh" ? "每次" : "每件"} ${U.fmt(n)}）：</p><div class="room-grid ys-row" style="grid-template-columns:repeat(${names.length + (noAuto ? 0 : 1)},1fr)">${noAuto ? "" : b(-1, `自动<br>${U.fmt(this.smCount("ys", -1))}`)}${names.map((_, i) => b(i, `${DATA.smName("ys", i).replace(DATA.smName("ys"), "") || DATA.smName("ys", i)}${DATA.li(DATA.smIcon("ys", i))}${U.fmt(this.smCount("ys", i))}`)).join("")}</div>`;
    },
    openForgeN(kind, g, slot, ft, el) {
      const job = { kind, g }; if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot; if (slot === "fabao") { job.ft = +ft; job.el = el; }
      const fb = slot === "fabao", ys = fb ? -1 : this.ysSel(kind); if (ys >= 0) job.ys = ys;
      this._forgeArgs = [kind, g, slot, ft, el];
      if ((kind === "eq" || kind === "ring") && g > 0) return this.openPrevPick(kind, g, slot, ft, el);   // 升星：列出全部上一星让玩家选
      const sm = this.jobSm(job), yn = (sm.find(x => x.k === "ys") || {}).n || 0, row = (kind === "eq" || kind === "ring") && !fb ? this.ysRow(kind, yn) : "";
      const max = this.forgeMax(kind, g, slot, ft, el, ys);
      if (max <= 0 && !row) return this.craftFurnace(kind, g, slot, ft, el);   // 炼不了：让炼制自己提示原因
      if (max <= 0) return this.modal(`<h2>炼制${this.jobName(job)}</h2>${row}<p class="desc">每件：${this.matsText(this.jobMats(job))}、${this.smText(sm)}<br><span class="q5">材料或所选耀石不足。</span></p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
      this.qtyModal(`炼制${this.jobName(job)}`, `${row}<p class="desc mats-desc">每件：${this.matsText(this.jobMats(job))}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer(kind, g) / 1000)}</p>`, max,
        n => this.craftFurnaceN(n, kind, g, slot, ft, el, ys >= 0 ? ys : undefined));
    },
    // 升星选择：身上、法宝栏、背包里所有上一星都列出来，点哪件就用哪件炼（每点一次排一个），弹窗不关可以继续选
    openPrevPick(kind, g, slot, ft, el) {
      const s = this.s, job = { kind, g }; if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot; if (slot === "fabao") { job.ft = +ft; job.el = el; }
      const ys = slot === "fabao" ? -1 : this.ysSel(kind); if (ys >= 0) job.ys = ys; this._forgeArgs = [kind, g, slot, ft, el];
      const ps = kind === "ring" ? "ring" : slot, list = this.prevList(ps, g, kind === "ring" ? job.r : job.ft, job.el);
      list.forEach(([e]) => { if (!e.uid) e.uid = DATA.newUid(); });
      const mats = this.jobMats(job), sm = this.jobSm(job), full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE;
      const yn = slot === "fabao" ? 0 : (sm.find(x => x.k === "ys") || {}).n || 0;
      const can = s.furnaceUse.qi >= 0 && !full && (!yn || ys >= 0) && (this.craftFree() || (this.hasMats(mats) && this.smHave(sm)));
      this._prevPick = [kind, g, slot, ft, el, ys];
      this.modal(`<h2>炼制${this.jobName(job)}</h2>${this.ysRow(kind, yn, true)}<p class="desc mats-desc">${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer(kind, g) / 1000)}${full ? " · 队列已满" : ""}</p>
        <div class="craft-log">${list.length ? list.map(([e, where]) => { const img = DATA.eqIcon(e);
          return `<div class="line"><div>${img ? DATA.eqTierIco(img, e.g, e.slot === "ring") : ""}<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>${where ? `<span class="tag c-green">${where}</span>` : ""}${DATA.rjCount(e) ? `<span class="tag">${DATA.rjName(e)}</span>` : ""}</div>
            <button class="sm" onclick="G.pickPrev('${e.uid}')" ${can ? "" : "disabled"}>选择</button></div>`; }).join("") : `<p class="desc">身上和背包里都没有上一星的。</p>`}</div>
        <div class="btns"><button onclick="G.openForgeList()">关闭</button></div>`);
    },
    // 连续炼制 n 件（每件一个队列位）
    craftFurnaceN(n, kind, g, slot, ft, el, ys) {
      n = Math.max(1, Math.min(Math.floor(+n) || 1, (CFG.furnace.QUEUE || 5) + 1));
      for (let i = 0; i < n; i++) {
        const before = (this.s.forgeJob ? 1 : 0) + this.s.forgeQueue.length;
        this.craftFurnace(kind, g, slot, ft, el, undefined, ys);
        if ((this.s.forgeJob ? 1 : 0) + this.s.forgeQueue.length === before) break;
      }
    },
    // 法宝：先选属性（上面一排），再选形状炼制（7 种）
    setFabaoEl(g, el) { this._fbEl = el; this.openFabaoPick(g); },
    openFabaoPick(g) {
      const s = this.s, mats = DATA.forgeEqMats(g), full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE;
      // 2 星起只列有上一星法宝的属性和形状
      const elsOK = g === 0 ? DATA.elements : DATA.elements.filter(x => this.prevList("fabao", g, null, x.id).some(([e]) => e.el === x.id));
      if (!elsOK.length) return this.log(`没有${DATA.XING[g - 1]}法宝。`, "sys");
      const el = elsOK.some(x => x.id === this._fbEl) ? this._fbEl : elsOK[0].id, ok0 = s.furnaceUse.qi >= 0 && this.hasMats(mats) && !full;
      const sm = this.jobSm({ kind: "eq", g, slot: "fabao", el }), smOK = this.smHave(sm);
      const els = `<div class="room-grid ys-row" style="grid-template-columns:repeat(${elsOK.length},1fr)">${elsOK.map(x => { const i = DATA.elements.indexOf(x); return `<button class="${x.id === el ? "active" : ""}" onclick="G.setFabaoEl(${g},'${x.id}')">${x.name}${DATA.li(DATA.smIcon("ys", i))}${U.fmt(this.smCount("ys", i))}</button>`; }).join("")}</div>`;
      this.modal(`<h2>炼制${DATA.XING[g]}法宝</h2>${els}<p class="desc mats-desc">${g ? `${DATA.XING[g - 1]}同形状同属性法宝 ×1、` : ""}${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${this.ratePct(this.craftRate("qi", g))}</p>` +
        DATA.fabaoTypes.map((T, ft) => {
          const ico = DATA.eqTierIco(DATA.iconImg("fb" + ft + "s" + Math.min(10, g + 1)), g), nm = `${DATA.XING[g]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g)}`;
          if (g === 0) return `<div class="line"><div>${ico}${nm}</div>
            <button class="sm" onclick="G.craftFurnace('eq',0,'fabao',${ft},'${el}')" ${ok0 && smOK ? "" : "disabled"}>炼制</button></div>`;
          // 2 星起：背包、法宝栏、身上符合的上一星全部列出来，每件一行，点「炼制」就用那件直接开炼
          return this.prevList("fabao", g, ft, el).map(([e, where]) => { if (!e.uid) e.uid = DATA.newUid();
            return `<div class="line"><div>${ico}${nm}
            <small>${DATA.XING[g - 1]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g - 1)} ×1${where ? `<span class="tag c-green">${where}</span>` : ""}<span class="tag">${DATA.rjName(e)}</span></small></div>
            <button class="sm" onclick="G.pickFb('${e.uid}',${g},${ft},'${el}')" ${ok0 && smOK ? "" : "disabled"}>炼制</button></div>`; }).join("");
        }).join("") +
        `<div class="btns"><button onclick="G.openForgeList()">关闭</button></div>`);
    },
    // 背包里有没有能炼这一阶法宝的底子：一阶不需要，二阶起 = 任意一件上一阶法宝
    // 法宝选择窗口：点哪件上一星就用哪件直接开炼，窗口不关
    pickFb(uid, g, ft, el) { this.craftFurnace("eq", g, "fabao", +ft, el, uid); },
    fabaoAnyBase(g) { return g === 0 || this.prevList("fabao", g).length > 0; },
    // 退回：按开始时实际扣的专用材料 q.sm
    // free = 测试模式免材料，不退材料（法宝、装备照退）
    refundJob(q) { if (!q.free) { this.giveBack(this.jobMats(q)); (q.sm || []).forEach(x => this.addSm(x.k, x.n, x.ft)); } if (q.prev) this.addEquipOnce(q.prev); if (q.item && !q.worn) this.addEquipOnce(q.item); if (q.mat) this.addEquipOnce(q.mat); },
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
    // ---------- 精炼：装备 / 法宝 / 戒指每次 +1 次（每星上限 星 × 10 次，每次主属性 +0.5%，附加属性和暴击不加）；材料 = 炼制同星的材料（法宝另加同属性耀石） ----------
    //   同类：装备同部位；戒指同种；法宝同形状同属性。材料件优先用阶低、强化低、颜色差的；材料件本身的阶不影响
    refineSame(a, b) { return a !== b && b && b.attrs && b.slot === a.slot && b.g === a.g && (a.slot === "ring" ? b.r === a.r : a.slot === "fabao" ? b.ft === a.ft && b.el === a.el : true); },
    refineMatIndex(e) {
      let best = -1; const score = x => DATA.rjCount(x) * 1e4 + (x.enh || 0) * 10 + (x.q || 0);
      this.s.bag.forEach((it, i) => { if (it && it.t === "eq" && this.refineSame(e, it.e) && (best < 0 || score(it.e) < score(this.s.bag[best].e))) best = i; });
      return best;
    },
    // 精炼可选：身上穿的装备 / 戒指、法宝栏的法宝、背包里的；和以前一样，精炼时那件拿走，出炉放回背包
    //   按物品 uid 选中（不按格子序号，背包整理、出售后序号会变）；拿走时按 uid 把原格清空，出炉 / 取消前先查身上、法宝栏、背包，已在就不再放一件
    rfLive(uid) {
      if (!uid) return null; const s = this.s, hit = e => e && e.attrs && e.uid === uid;
      for (const k in s.equip || {}) if (hit(s.equip[k])) return s.equip[k];
      for (const e of s.fabao || []) if (hit(e)) return e;
      const b = s.bag.find(x => x && x.t === "eq" && hit(x.e)); return b ? b.e : null;
    },
    // 把这件从原来的格子拿走（身上 / 法宝栏 / 背包，各处同 uid 的都清掉），返回是否拿到
    rfTake(e) {
      const s = this.s, same = x => x && (x === e || (e.uid && x.uid === e.uid)); let got = false;
      for (const k in s.equip || {}) if (same(s.equip[k])) { s.equip[k] = null; got = true; }
      (s.fabao || []).forEach((x, i) => { if (same(x)) { s.fabao[i] = null; got = true; } });
      s.bag.forEach((x, i) => { if (x && x.t === "eq" && same(x.e)) { s.bag[i] = null; got = true; } });   // 固定格子：拿走后该格留空，不往前挪
      return got;
    },
    refineEq(uid, n) {   // n：连续精炼次数（只占一个队列位，每次出炉后再扣下一次的材料）
      const s = this.s, e = this.rfLive(uid);
      if (!e) return this.log("精炼失败：那件已不在。", "sys");
      if (DATA.rjTop(e)) return this.log(`已精炼到上限（${DATA.rjCap(e)}次）。`, "sys");
      if (s.furnaceUse.qi < 0) return this.log("炼器必须装有炼器炉（宗门宝库 · 杂物可兑换一星炼器炉）。", "sys");
      if (s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE) return this.log(`队列已满（最多 ${CFG.furnace.QUEUE} 个）。`, "sys");
      const mats = DATA.refineMats(e);   // 精炼只要这件 + 炼制同星的材料（法宝另加同属性耀石）；不需要另一件同星同类的
      const sm = DATA.refineSm(e);
      if (!this.hasMats(mats)) return this.log("矿石不足。", "sys");
      if (!this.smHave(sm)) return this.log(`缺少${sm.filter(x => this.smCount(x.k, x.ft) < x.n).map(x => DATA.smName(x.k, x.ft)).join("、")}（秘境、灵地掉落）。`, "sys");
      const free = this.craftFree(), gotSm = [];
      if (!free) { mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); sm.forEach(x => { const got = this.takeSm(x.k, x.n, x.ft); if (got) gotSm.push(...got); }); }
      if (!this.rfTake(e)) {   // 扣完材料后再按 uid 拿走；拿不到就不建炉、退回材料
        if (!free) { this.giveBack(mats); gotSm.forEach(x => this.addSm(x.k, x.n, x.ft)); }
        return this.log("精炼失败：那件已不在，材料已退回。", "sys");
      }
      this.dirty();
      const job = { kind: "rf", g: e.g, item: e, sm: gotSm }; if (free) job.free = 1;
      n = Math.max(1, Math.min(Math.floor(+n) || 1, DATA.rjCap(e) - DATA.rjCount(e))); if (n > 1) { job.n = n; job.done = 0; }
      if (s.forgeJob) { s.forgeQueue.push(job); this.log(`${this.jobName(job)}加入队列。`, "sys"); }
      else { s.forgeJob = Object.assign(job, { end: this.now() + this.forgePer("rf", e.g) }); this.log(`开始${this.jobName(job)}。`, "good"); }
      this.after();
    },
    // 精炼页：身上穿的装备 / 戒指、法宝栏的法宝，再加背包里所有装备 / 法宝 / 戒指
    refineRows() {
      const s = this.s, list = [];
      for (const k of DATA.equipSlots) { const e = (s.equip || {})[k]; if (e && e.attrs) list.push([e, "已装备"]); }
      (s.fabao || []).forEach(e => { if (e && e.attrs) list.push([e, "法宝栏"]); });
      s.bag.forEach(it => { if (it && it.t === "eq" && it.e.attrs) list.push([it.e, ""]); });
      list.forEach(([e]) => { if (!e.uid) e.uid = DATA.newUid(); });   // 旧存档补 uid，按 uid 选中
      if (!list.length) return `<p class="desc">身上和背包里都没有装备、法宝、戒指。</p>`;
      const full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE, has = s.furnaceUse.qi >= 0;
      return list.map(([e, where]) => {
        const top = DATA.rjTop(e), mats = DATA.refineMats(e), sm = DATA.refineSm(e), img = DATA.eqIcon(e);
        return `<div class="line"><div>${img ? DATA.eqTierIco(img, e.g, e.slot === "ring") : ""}<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>${where ? `<span class="tag c-green">${where}</span>` : ""}<span class="tag">${DATA.rjName(e)}</span>
          <small>${top ? "已精炼满" : `${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("rf", e.g) / 1000)} · 成功率 ${this.ratePct(this.forgeRate("eq", e.g))}`}</small></div>
          <button class="sm" onclick="G.pickRefine('${e.uid}')" ${top || full || !has ? "disabled" : ""}>选择</button></div>`;
      }).join("");
    },

    /* ---------- 门派炼器室：学习装备图谱 / 空间石 ---------- */
    // 戒指图纸 key：v26 起 ring:种类:阶（v25 的 ring:阶 = 该阶所有种类）
    forgeKey(kind, g, slot) { return kind === "lz" ? `lz:${slot}` : kind === "eq" ? `eq:${slot}:${g}` : kind === "ring" ? (slot === undefined ? `ring:${g}` : `ring:${slot}:${g}`) : `ss:${g}`; },
    forgeKeyName(key) { const p = key.split(":"), k = p[0]; return k === "lz" ? DATA.smName("lz", +p[1]) + "图纸" : k === "eq" ? DATA.forgeEqName(p[1], +p[2]) + "图谱" : k === "ring" ? (p.length > 2 ? DATA.ringBpName(+p[2], +p[1]) : DATA.ringBpName(+p[1])) : DATA.stoneName(+p[1]) + "炼法"; },
    ringKnown(r, g) { const K = this.s.forgeKnown; return K.includes(`ring:${r}:${g}`) || K.includes(`ring:${g}`); },
    /* ---------- 灵犀 / 烈阳 / 玄武戒：图纸、专用材料兑换（config/forge.js 的 ring.SPECIAL）
     *   src "sect"：宗门宝库，贡献（宗门星级 ≥ STAR）；src "ys"：隐世宗门 ys 的炼器室，好感度（ysId 要对得上） */
    ringShopOK(r, ysId) {
      const S = DATA.ringSp(r), s = this.s; if (!S || !DATA.ringOK(r)) return false;
      if (S.src === "sect") return !ysId && !!s.sect && !!this.sectInfo() && this.sectInfo().star >= (S.STAR || 1);
      return S.src === "ys" && ysId === S.ys && !!this.ysById && !!this.ysById(ysId);
    },
    ringPayHave(r) { const S = DATA.ringSp(r); return S.src === "sect" ? this.s.contrib || 0 : this.ysFav(S.ys); },
    ringPay(r, c) { const S = DATA.ringSp(r); if (S.src === "sect") this.s.contrib -= c; else this.ysFavPay(S.ys, c); },   // 测试模式不扣好感
    ringPayName(r) { return DATA.ringSp(r).src === "sect" ? "贡献" : "好感度"; },
    // 这张图纸的状态：0 可兑换 / 1 已学会 / 2 背包里有或在学
    ringBpState(r, g) { const key = this.forgeKey("ring", g, r);
      if (this.ringKnown(r, g)) return 1;
      return this.s.bag.some(it => it && it.t === "rbp" && it.r === r && it.g === g) || (this.lqHas && this.lqHas("forge", key)) ? 2 : 0; },
    buyRingBp(r, g, ysId) {
      r = +r; g = +g; if (!(g >= 0 && g < 10) || !this.ringShopOK(r, ysId || undefined)) return;
      const st = this.ringBpState(r, g); if (st) return this.log(st === 1 ? "已学会这张图纸。" : "背包里已有这张图纸。", "sys");
      const c = DATA.ringBpCost(r, g); if (this.ringPayHave(r) < c) return this.log(`${this.ringPayName(r)}不足，需要 ${U.fmt(c)}。`, "sys");
      this.ringPay(r, c); const where = this.bagPutOrMail({ t: "rbp", r, g });
      this.log(`${this.ringPayName(r)} −${U.fmt(c)}，获得${DATA.ringBpName(g, r)}，已放进${where === "mail" ? "传音暂存" : "背包"}（点「学习」）。`, "gold"); this.after();
    },
    buyRingSm(r, n, ysId) {
      r = +r; n = Math.floor(+n || 0); if (n <= 0 || n > 100000 || !this.ringShopOK(r, ysId || undefined)) return;
      const S = DATA.ringSp(r), c = S.SM_COST * n; if (this.ringPayHave(r) < c) return this.log(`${this.ringPayName(r)}不足，需要 ${U.fmt(c)}。`, "sys");
      if (!this.addSm(S.sm, n)) return;
      this.ringPay(r, c);
      this.log(`${this.ringPayName(r)} −${U.fmt(c)}，获得${DATA.smName(S.sm)} ×${U.fmt(n)}。`, "good"); this.after();
    },
    // 兑换列表（宗门宝库 / 隐世宗门炼器室共用）：ysId 不填 = 宗门宝库
    ringShopHtml(ysId) {
      const rs = DATA.ringList().filter(r => this.ringShopOK(r, ysId)); if (!rs.length) return "";
      return rs.map(r => { const S = DATA.ringSp(r), have = this.ringPayHave(r), pn = this.ringPayName(r), q = ysId ? `'${ysId}'` : "''", bn = DATA.ringBonus(r);
        const smRow = `<div class="line"><div>${DATA.li(DATA.smIcon(S.sm))}${DATA.smName(S.sm)}<small>${U.fmt(S.SM_COST)} ${pn}/个 · 已有 ${U.fmt(this.smCount(S.sm))} · 炼制每件要 ${DATA.ringSmNeed(0)}~${DATA.ringSmNeed(DATA.XING.length - 1)} 个</small></div>
          <div><button class="sm" onclick="G.buyRingSm(${r},1,${q})" ${have < S.SM_COST ? "disabled" : ""}>×1</button><button class="sm" onclick="G.buyRingSm(${r},10,${q})" ${have < S.SM_COST * 10 ? "disabled" : ""}>×10</button><button class="sm" onclick="G.buyRingSm(${r},100,${q})" ${have < S.SM_COST * 100 ? "disabled" : ""}>×100</button></div></div>`;
        const bpRows = DATA.XING.slice(0, 10).map((x, g) => { const st = this.ringBpState(r, g), c = DATA.ringBpCost(r, g);
          return `<div class="line"><div>${DATA.li(DATA.iconImg("bp"))}${DATA.ringBpName(g, r)}<small>${U.fmt(c)} ${pn}${g ? ` · 炼制要${DATA.ringName(r, g - 1)}` : ""}</small></div>
            <button class="sm" onclick="G.buyRingBp(${r},${g},${q})" ${st || have < c ? "disabled" : ""}>${st === 1 ? "已学会" : st === 2 ? "已拥有" : "兑换"}</button></div>`; }).join("");
        return `<div class="card"><h3>${DATA.ringNames[r]}<small>主属性 ${(CFG.forge.ring.main[r] || []).map(k => DATA.attrNames[k] || k).join("、")}${bn ? ` · 额外 +${bn}%` : ""}</small></h3>${smRow}${bpRows}</div>`; }).join("");
    },
    /* ---------- 十一、十二星图谱 / 图纸：神界隐世宗门炼器室，好感度兑换（config/forge.js 的 YS_BP） ----------
     *   kind：eq 装备 / 法宝图谱（sub = 部位）、ss 空间石炼法、ring 戒指图纸（sub = 戒指种类）、fu 炼器炉图纸 */
    ysBpTiers(ysId) { const Y = CFG.forge.YS_BP || {}; return Object.keys(Y).map(Number).filter(g => g < DATA.XING.length && (Y[g].ys || []).includes(ysId)).sort((a, b) => a - b); },
    ysBpCost(g) { return ((CFG.forge.YS_BP || {})[g] || {}).COST || 0; },
    // 0 可兑换 / 1 已学会 / 2 背包里有或在学
    ysBpState(kind, g, sub) {
      const s = this.s;
      if (kind === "ring") return this.ringBpState(sub, g);
      if (kind === "fu") return (s.blueprints.qi || []).includes(g) ? 1 : s.bag.some(it => it && it.t === "bp" && it.kind === "qi" && it.g === g) ? 2 : 0;
      const key = this.forgeKey(kind, g, sub); return s.forgeKnown.includes(key) ? 1 : this.lqHas("forge", key) ? 2 : 0;
    },
    buyYsBp(ysId, kind, g, sub) {
      g = +g; if (kind === "ring") sub = +sub;
      if (!this.ysById(ysId) || !this.ysFound(ysId) || !this.ysBpTiers(ysId).includes(g)) return;   // 和 ysTask / ysGf / ysDan 一样先查宗门已发现
      if (kind === "eq" && !DATA.forgeSlots.includes(sub)) return; if (kind === "ring" && !DATA.ringOK(sub)) return; if (!["eq", "ss", "ring", "fu"].includes(kind)) return;
      const st = this.ysBpState(kind, g, sub); if (st) return this.log(st === 1 ? "已学会。" : "已在背包或学习中。", "sys");
      const c = this.ysBpCost(g); if (this.ysFav(ysId) < c) return this.log(`好感度不足，需要 ${U.fmt(c)}。`, "sys");
      if (kind === "eq" || kind === "ss") {
        const key = this.forgeKey(kind, g, sub); if (!this.lqCan("forge", key)) return;
        this.ysFavPay(ysId, c); this.lqAdd("forge", { key, k: "forge", ms: (kind === "eq" ? CFG.forge.equip : CFG.forge.stone).learnTime[g] * 60000 });
        this.log(`好感度 −${U.fmt(c)}，开始学习${this.forgeKeyName(key)}。`, "good");
      } else {
        const it = kind === "ring" ? { t: "rbp", r: sub, g } : { t: "bp", kind: "qi", g };
        this.ysFavPay(ysId, c); const where = this.bagPutOrMail(it);
        this.log(`好感度 −${U.fmt(c)}，获得${kind === "ring" ? DATA.ringBpName(g, sub) : DATA.furnaceName("qi", g) + "图纸"}，已放进${where === "mail" ? "传音暂存" : "背包"}（点「学习」）。`, "gold");
      }
      this.after(); this.openYsPlace(ysId, "qi");
    },
    ysBpHtml(ysId) {
      const fav = this.ysFav(ysId);
      return this.ysBpTiers(ysId).map(g => {
        const c = this.ysBpCost(g), btn = (kind, sub) => { const st = this.ysBpState(kind, g, sub);
          return `<button class="sm" onclick="G.buyYsBp('${ysId}','${kind}',${g},${sub === undefined ? "undefined" : typeof sub === "string" ? `'${sub}'` : sub})" ${st || fav < c ? "disabled" : ""}>${st === 1 ? "已学会" : st === 2 ? "已拥有" : "兑换"}</button>`; };
        const row = (ico, name, tag, kind, sub) => `<div class="line"><div>${ico}${name}${tag ? `<span class="tag">${tag}</span>` : ""}<small>${U.fmt(c)} 好感度</small></div>${btn(kind, sub)}</div>`;
        const rows = [
          ...DATA.forgeSlots.map(sl => row(DATA.eqTierIco(DATA.iconImg(sl === "fabao" ? "fbs0_0" : "eq_" + sl), g), DATA.forgeEqName(sl, g) + "图谱", DATA.slots[sl], "eq", sl)),
          ...DATA.ringList().map(r => row(DATA.eqTierIco(DATA.eqIcon({ slot: "ring", r, g }), g, true), DATA.ringBpName(g, r), "戒指", "ring", r)),
          row(DATA.li(DATA.iconImg("ss")), DATA.stoneName(g) + "炼法", DATA.SS, "ss"),
          row(DATA.li(DATA.furnaceIcon("qi")), DATA.furnaceName("qi", g) + "图纸", "炉子", "fu"),
        ].join("");
        return `<div class="card"><h3>${DATA.XING[g]}图谱 · 图纸<small>图谱兑换后直接学习</small></h3>${rows}</div>`;
      }).join("");
    },
    // v25：使用戒指图纸（试炼塔奖励）→ 学会这种戒指这一星的炼法
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
      if (!this.hasMats(mats) || (!this.craftFree() && this.smCount("lj", ft) < C.JING)) return this.log("材料不足。", "sys");
      if (!this.addSm("lz", 1, ft)) return;
      if (!this.craftFree()) { mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); this.takeSm("lj", C.JING, ft); }
      this.log(`炼成${DATA.smName("lz", ft)}，放进聚灵阵的灵珠格可增加聚灵。`, "gold"); this.after();
    },

    /* ---------- 空间石 ---------- */
    addStone(g, n = 1) {
      return this.bagAdd(x => x.t === "ss" && x.g === g, k => ({ t: "ss", g, n: k }), n, `背包已满，${DATA.SS}暂停出炉。`);
    },
    stoneLeft(g) { return CFG.forge.stone.MAX_USE - ((this.s.stoneUsed || {})[g] || 0); },
    useStone(i, n) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "ss") return;
      n = Math.min(Math.floor(+n) || 1, it.n, this.stoneLeft(it.g));   // 与 eatLg（garden.js）/ useCxp（bag.js）同款兜底：NaN / 0 按 1 算，负数或仍不是 ≥1 由下一行拦住，不让 NaN 毒化 stoneUsed / bagCap
      if (!(n >= 1)) return this.log(`${DATA.stoneName(it.g)}已达使用上限（每阶 ${CFG.forge.stone.MAX_USE} 个）。`, "sys");
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
    danPer(type, g) { if (DATA.isTest()) return 1000; return Math.ceil(DATA.danTime(type, g) / this.spdDiv(this.danSpd(this.danFurn(DATA.danFu(type))))); },   // 炼丹速度 = 炉子 + 炼丹师 + 丹火秘法 + 道童 + 心得（没上限）
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
      if (!this.craftFree()) for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      n = Math.floor(+n || 0); if (n < 0) return this.log("药材不足。", "sys");
      n = n ? Math.min(n, max) : max;
      if (n <= 0) return this.log("药材不足。", "sys");
      if (!this.craftFree()) rec.forEach(m => this.takeMat(m.kind, m.g, m.n * n));
      if (s.alchJob) { s.alchQueue.push({ type, g, n, mats: rec }); this.log(`${DATA.danName(type, g)} ×${n} 加入炼丹队列。`, "sys"); return this.after(); }
      const per = this.danPer(type, g);
      s.alchJob = { type, g, n, done: 0, per, next: this.now() + per, mats: rec };
      this.log(`开炉炼制${DATA.danName(type, g)} ×${n}。`, "good"); this.after();
    },
    // 停炉：退还没炼的药材，队列里的下一炉马上开始
    stopAlch() {
      const s = this.s, a = s.alchJob; if (!a) return;
      const left = a.n - a.done;
      if (!this.craftFree()) (a.mats || DATA.danRecipe(a.type, a.g)).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * left));
      s.alchJob = null; this.craftRec("alchLog", { at: this.now(), name: DATA.danName(a.type, a.g), n: a.done, ok: a.ok || 0, extra: a.extra || 0, fail: a.fail || 0, stop: 1 });
      const nx = s.alchQueue.shift();
      if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: this.now() + per, mats: nx.mats }; }
      this.log(`停炉，退回 ${left} 枚的药材。`, "sys"); this.after();
    },
    // 取消队列中的一项，退回药材
    cancelAlchQ(i) {
      const q = this.s.alchQueue[i]; if (!q) return;
      this.s.alchQueue.splice(i, 1);
      if (!this.craftFree()) (q.mats || DATA.danRecipe(q.type, q.g)).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * q.n));
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
      if (this.tribBusy && this.tribBusy()) return this.log("渡劫中不能服用丹药。", "sys");   // v259
      const it = this.s.bag[i]; if (!it || it.t !== "dan") return;
      n = Math.min(Math.floor(+n) || 1, it.n, this.danLeft(it.type, it.g));   // 与 eatLg（garden.js）/ useCxp（bag.js）同款兜底：NaN / 0 按 1 算，负数或仍不是 ≥1 由下一行拦住，不让 NaN 毒化 danEaten
      if (!(n >= 1)) return this.log(`${DATA.danName(it.type, it.g, it.sg)}已达服用上限。`, "sys");
      const key = it.type + "|" + it.g, d = DATA.dans[it.type];
      this.s.danEaten[key] = (this.s.danEaten[key] || 0) + n;
      this.log(`服下${DATA.danName(it.type, it.g, it.sg)} ×${n}，${d.label} +${U.num(DATA.danVal(it.type, it.g) * n)}。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    // 悟真丹：效果不叠加（pct 固定 120%），时间可叠加——生效中再服，结束时间 += 360 分钟
    eatWuzhen(i) {
      if (this.tribBusy && this.tribBusy()) return this.log("渡劫中不能服用丹药。", "sys");   // v259
      const it = this.s.bag[i]; if (!it || it.t !== "dan" || it.type !== "wuzhen") return;
      const R = CFG.alchemy.recipes.wuzhen || {}, pct = R.studyPct || 120, mins = R.studyMin || 360, now = this.now();
      const wasOn = !!(this.s.studyBuff && this.s.studyBuff.end > now);
      const from = wasOn ? this.s.studyBuff.end : now;
      this.s.studyBuff = { pct, end: from + mins * 60000, min: mins };
      this.log(`服下悟真丹，功法/法术/秘法修炼时间 -${pct}%，持续 ${mins} 分钟`, "good");
      this.removeAt(i, 1); this.closeModal(); this.after();
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
      const lg = this.lgBonus ? this.lgBonus() : null; if (lg) { for (const k of ["atk", "def", "hp", "mana"]) b[k] += lg[k] || 0; }   // 灵果（garden.js）
      const jm = this.jmBonus ? this.jmBonus() : {}; for (const k in jm) if (k in b) b[k] += jm[k]; else if (k.startsWith("res_")) b.resEl[k.slice(4)] = (b.resEl[k.slice(4)] || 0) + jm[k];   // 经脉（jingmai.js）
      return b;
    },

    /* ---------- 页面：炉子卡片（炼丹房、炼器室共用，可更换） ---------- */
    furnaceDesc(kind, g) { const d = DATA.isDanFu(kind); return `${d ? "炼丹" : "炼器"}速度 +${DATA.furnaceBonus(kind, g)}%`; },
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
      let acc = !job ? 0 : dan ? Math.max(0, job.next - API.now()) + Math.max(0, job.n - job.done - 1) * job.per : Math.max(0, job.end - API.now());
      const rows = q.map((x, i) => { const ms = dan ? this.danPer(x.type, x.g) * x.n : this.forgePer(x.kind, x.g); acc += ms;
        return `<div class="line"><div>${i + 1}. ${dan ? `${DATA.danName(x.type, x.g)} ×${x.n}` : this.jobName(x)}<small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后完成</small></div>
          <button class="sm" onclick="G.${dan ? "cancelAlchQ" : "cancelForgeQ"}(${i})">取消</button></div>`; }).join("");
      this.modal(`<h2>${dan ? "炼丹" : "炼器"}队列<small> ${q.length} / ${Q}</small></h2><div class="craft-log">${rows || `<p class="desc">队列是空的。</p>`}</div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // v250 炼丹 / 炼器记录：最近 30 次
    craftRec(k, r) { const s = this.s; if (!Array.isArray(s[k])) s[k] = []; s[k].unshift(r); if (s[k].length > 30) s[k].length = 30; },
    // 记录直接显示在页面里（「记录」按钮切到 log 模式，不弹窗）
    craftLogCard(k) {
      const L = this.s[k] || [], dan = k === "alchLog", tm = t => { const d = new Date(t), z = n => String(n).padStart(2, "0"); return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
      return `<div class="card"><h3>${dan ? "炼丹" : "炼器"}记录<small>最近 30 次</small></h3><div class="craft-log">` + (L.length ? L.map(r => `<div class="line"><div>${r.name}${dan ? ` ×${r.n}` : ""}${r.stop ? `<span class="tag">停炉</span>` : ""}
          <small>${tm(r.at)}${dan ? ` · 成丹 ${r.ok}${r.extra ? `（额外 +${r.extra}）` : ""} · 失败 ${r.fail}` : ""}</small></div>${dan ? "" : `<span class="${r.ok ? "c-green" : "q5"}">${r.ok ? "成功" : "失败"}</span>`}</div>`).join("") : `<p class="desc">还没有记录。</p>`) + `</div></div>`;
    },
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
      const C = CFG.craftsman, c = this.craftInfo(k), max = c.lv >= this.craftMax(k), need = this.craftNeed(k, c.lv), tc = (C[k].TIME_CUT || [])[c.lv - 1] || 0;
      this.modal(`<h2>${this.craftTitle(k)}</h2>
        <div class="line"><div>${max ? `已满${this.craftUnit(k)}` : `经验 ${U.fmt(c.exp)} / ${U.fmt(need)}`}${tc ? `<small>${k === "ling" ? "种植" : k === "qi" ? "炼器" : "炼丹"}速度 +${U.num(tc)}%</small>` : ""}</div></div>
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
          <small>${cur >= 0 ? this.furnaceDesc(kind, cur) : kind === "xdan" ? "没装时用炼丹炉炼仙丹、冥丹、魔丹；仙炉可在宗门宝库兑换图纸，在炼器室炼制" : kind === "sdan" ? "炼神丹用；没装时用炼丹仙炉（再没有用炼丹炉）。9、10 星宗门宝库兑换图纸，在炼器室炼制" : kind === "xqi" ? "装有后缩短炼制仙炉的时间：宗门宝库兑换图纸，在炼器室炼制" : `${kind === "dan" ? "炼丹" : "炼器"}必须装有${DATA.furnaceKinds[kind]}：宗门宝库 · 杂物兑换，或在炼器室炼制`}</small></div>
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
  danEatTxt(t, g) { return DATA.dans[t] && DATA.danLimit(t, g) > 0 ? `已服 ${DATA.danLimit(t, g) - this.danLeft(t, g)}/${DATA.danLimit(t, g)}` : ""; },   // 无服用上限的丹（悟真丹）不显示“已服 0/0”
  danInfo(t, g) {
    const rec = DATA.danRecipe(t, g), e = this.danEatTxt(t, g);
    return `<div>${DATA.danImg(DATA.danIcon(t), DATA.danCls(t, g), "li")}${DATA.danName(t, g)}<span class="tag">${DATA.recipeEffect(t, g)}</span>
      <small>${this.matsText(rec)} · 每枚 ${U.dur(this.danPer(t, g) / 1000)} · 成功率 ${this.ratePct(this.danRate(t, g))}${e ? " · " + e : ""}</small></div>`;
  },
  danCanMake(t, g) { const s = this.s; return s.furnaceUse[this.danFurn(DATA.danFu(t))] >= 0 && this.hasMats(DATA.danRecipe(t, g)) && !(s.alchJob && s.alchQueue.length >= CFG.alchemy.QUEUE); },
  // 开始炼丹：选择窗口（上面丹方格子，下面所需材料、成功率、数量、消耗时间、开始炼丹），见 cpView
  openAlchList() {
    const s = this.s, full = !!(s.alchJob && s.alchQueue.length >= CFG.alchemy.QUEUE);
    const L = this.danKnown().filter(x => !this.isHidden("dan", x.key)).map(x => {
      const rec = DATA.danRecipe(x.t, x.g), furn = s.furnaceUse[this.danFurn(DATA.danFu(x.t))] >= 0, e = this.danEatTxt(x.t, x.g);
      let max = full || !furn ? 0 : CFG.alchemy.MAX_BATCH;
      if (!this.craftFree()) for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      return { key: x.key, tag: DATA.JIE[x.g], name: DATA.danName(x.t, x.g).replace(DATA.JIE[x.g], "") || DATA.danName(x.t, x.g), sub: e.replace("已服 ", ""), icon: DATA.danImg(DATA.danIcon(x.t), DATA.danCls(x.t, x.g), "li"),
        full: DATA.dans[x.t] && DATA.danLimit(x.t, x.g) > 0 && this.danLeft(x.t, x.g) <= 0,   // 已达服用上限：格子里标红色斜体「已满」
        desc: DATA.recipeEffect(x.t, x.g), mats: rec, sm: [], per: this.danPer(x.t, x.g), rate: this.danRate(x.t, x.g), max, run: n => this.startAlch(x.t, x.g, n),
        note: full ? "炼丹队列已满" : !furn ? "没有装对应的丹炉" : "" };
    });
    this.cpView("dan", "选择丹方", L, "开始炼丹", "没有可选的丹方：在门派 → 炼丹房、四界功德司学习，或到「隐藏丹方」取消隐藏。");
  },
  pickAlch(t, g) { this.alchPick = { t, g }; this.closeModal(); this.render(); },
  // 炼器配方：所有星级里已学会能炼的东西
  forgeItems() {
    const s = this.s, j = s.forgeJob, has = s.furnaceUse.qi >= 0, full = !!(j && s.forgeQueue.length >= CFG.furnace.QUEUE), out = [];
    // d：「开始炼器」选择窗口用的结构化信息（名、图、材料、时间、成功率、数量上限、开炼调用）
    const add = (key, info, ok, call, btn, d) => out.push(Object.assign({ key, info, ok: has && !full && ok, call, btn: btn || "炼制" }, d || {}));
    for (let g = 0; g < DATA.XING.length; g++) {
      const rate = this.ratePct(this.craftRate("qi", g));
      for (const k of DATA.FURNACE_KINDS) if ((s.blueprints[k] || []).includes(g)) {
        const mats = DATA.furnaceMats(k, g);
        add(`f:${k}:${g}`, `<div>${DATA.li(DATA.furnaceIcon(k))}${DATA.furnaceName(k, g)}<span class="tag">+${DATA.furnaceBonus(k, g)}%</span>
          <small>${this.matsText(mats)} · ${U.dur(this.forgePer(k, g) / 1000)} · 成功率 ${this.ratePct(this.forgeRate(k, g))}</small></div>`, this.hasMats(mats), `G.openForgeN('${k}',${g})`, "",
          { tag: DATA.XING[g], name: DATA.furnaceName(k, g), sub: `+${DATA.furnaceBonus(k, g)}%`, icon: DATA.li(DATA.furnaceIcon(k)), mats, sm: [], per: this.forgePer(k, g), rate: this.forgeRate(k, g), fa: [k, g] });
      }
      for (const sl of DATA.forgeSlots) if (s.forgeKnown.includes(this.forgeKey("eq", g, sl))) {
        const mats = DATA.forgeEqMats(g);
        if (sl === "fabao") {
          const prevOK = this.fabaoAnyBase(g), yn = ((CFG.forge.YAOSHI || {}).fabao || [])[g] || 0;
          add(`eq:fabao:${g}`, `<div>${DATA.eqTierIco(DATA.iconImg("fbs0_0"), g)}${DATA.XING[g]}法宝<span class="tag">${DATA.fabaoTypes.length} 种</span>
            <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.XING[g - 1]}同形状同属性法宝 ×1</span>、` : ""}${this.matsText(mats)}${yn ? `、同属性${DATA.smName("ys")} ×${U.fmt(yn)}` : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>`,
            prevOK && this.hasMats(mats), `G.openFabaoPick(${g})`, "选择",
            { tag: DATA.XING[g], name: `${DATA.XING[g]}法宝`, sub: "", icon: DATA.eqTierIco(DATA.iconImg("fbs0_0"), g), mats, sm: yn ? [{ k: "ys", n: yn, ft: -1, txt: `同属性${DATA.smName("ys")}` }] : [], per: this.forgePer("eq", g), rate: this.craftRate("qi", g),
              pre: g ? `<span class="${prevOK ? "" : "q5"}">${DATA.XING[g - 1]}同形状同属性法宝 ×1</span>` : "", next: "选择法宝" });
          continue;
        }
        const prevOK = g === 0 || this.prevList(sl, g).length > 0, esm = this.jobSm({ kind: "eq", g, slot: sl });
        add(`eq:${sl}:${g}`, `<div>${DATA.eqTierIco(DATA.iconImg("eq_" + sl), g)}${DATA.forgeEqName(sl, g)}<span class="tag">${DATA.slots[sl]}</span>
          <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.forgeEqName(sl, g - 1)} ×1</span>、` : ""}${this.matsText(mats)}${esm.length ? "、" + this.smText(esm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>`,
          prevOK && this.hasMats(mats) && this.smHave(esm), `G.openForgeN('eq',${g},'${sl}')`, "",
          { tag: DATA.XING[g], name: DATA.forgeEqName(sl, g), sub: DATA.slots[sl], icon: DATA.eqTierIco(DATA.iconImg("eq_" + sl), g), mats, sm: esm, per: this.forgePer("eq", g), rate: this.craftRate("qi", g), fa: ["eq", g, sl], ys: "eq",
            pre: g ? `<span class="${prevOK ? "" : "q5"}">${DATA.forgeEqName(sl, g - 1)} ×1</span>` : "", next: g ? "选择装备" : "" });
      }
      {
        DATA.ringList().forEach(r => {
          if (!this.ringKnown(r, g) || (g < 1 && !DATA.ringSp(r))) return;
          const mats = DATA.ringMatsFor(r, g);
          const prevOK = g < 1 || this.prevList("ring", g, r).length > 0, rsm = this.jobSm({ kind: "ring", g, r }), bn = DATA.ringBonus(r);
          add(`ring:${r}:${g}`, `<div>${DATA.eqTierIco(DATA.eqIcon({ slot: "ring", r, g }), g, true)}${DATA.ringName(r, g)}<span class="tag">戒指</span>${bn ? `<span class="tag">主属性 +${bn}%</span>` : ""}
            <small>${g > 0 ? `<span class="${prevOK ? "" : "q5"}">${DATA.ringName(r, g - 1)} ×1</span>、` : ""}${this.matsText(mats)}${rsm.length ? "、" + this.smText(rsm) : ""} · ${U.dur(this.forgePer("ring", g) / 1000)} · 成功率 ${rate}</small></div>`,
            prevOK && this.hasMats(mats) && this.smHave(rsm), `G.openForgeN('ring',${g},${r})`, "",
            { tag: DATA.XING[g], name: DATA.ringName(r, g), sub: bn ? `主属性 +${bn}%` : "戒指", icon: DATA.eqTierIco(DATA.eqIcon({ slot: "ring", r, g }), g, true), mats, sm: rsm, per: this.forgePer("ring", g), rate: this.craftRate("qi", g), fa: ["ring", g, r], ys: "ring",
              pre: g > 0 ? `<span class="${prevOK ? "" : "q5"}">${DATA.ringName(r, g - 1)} ×1</span>` : "", next: g > 0 ? "选择装备" : "" });
        });
      }
      if (s.forgeKnown.includes(this.forgeKey("ss", g))) {
        const mats = DATA.stoneMats(g), sm = this.jobSm({ kind: "ss", g });
        add(`ss:${g}`, `<div>${DATA.li(DATA.iconImg("ss"))}${DATA.stoneName(g)}<span class="tag">储物格+1</span>
          <small>${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("ss", g) / 1000)} · 成功率 ${rate} · 已用 ${CFG.forge.stone.MAX_USE - this.stoneLeft(g)}/${CFG.forge.stone.MAX_USE}</small></div>`,
          this.hasMats(mats) && this.smHave(sm), `G.openForgeN('ss',${g})`, "",
          { tag: DATA.JIE[g] || DATA.XING[g], name: DATA.stoneName(g), sub: `已用 ${CFG.forge.stone.MAX_USE - this.stoneLeft(g)}/${CFG.forge.stone.MAX_USE}`, icon: DATA.li(DATA.iconImg("ss")), mats, sm, per: this.forgePer("ss", g), rate: this.craftRate("qi", g), fa: ["ss", g] });
      }
    }
    // 灵珠（立即炼成，不占炼器队列）
    const LZ = CFG.lingzhu, lzMats = this.lzMats();
    LZ.NAMES.forEach((n, ft) => { if (!s.forgeKnown.includes(this.forgeKey("lz", 0, ft))) return;
      const ok = this.hasMats(lzMats) && this.smCount("lj", ft) >= LZ.JING;
      out.push({ key: `lz:${ft}`, info: `<div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<span class="tag">聚灵+${U.fmt(LZ.BASE)}</span>
        <small>${this.matsText(lzMats)}、<span class="${this.smCount("lj", ft) >= LZ.JING ? "" : "q5"}">${DATA.li(DATA.smIcon("lj", ft))}${DATA.smName("lj", ft)} ${U.fmt(this.smCount("lj", ft))}/${LZ.JING}</span></small></div>`, ok, call: `G.craftLz(${ft})`, btn: "炼制",
      tag: "灵珠", name: DATA.smName("lz", ft), sub: `聚灵+${U.fmt(LZ.BASE)}`, icon: DATA.li(DATA.smIcon("lz", ft), "lz-glow"), mats: lzMats, sm: [{ k: "lj", n: LZ.JING, ft }], rate: 1, note: "立即炼成，不占炼器队列" }); });
    return out;
  },
  openForgeList() {
    const s = this.s, full = !!(s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE), has = s.furnaceUse.qi >= 0;
    const L = this.forgeItems().filter(x => !this.isHidden("qi", x.key)).map(x => {
      if (x.next) return Object.assign(x, { max: x.ok ? 1 : 0, noQty: 1, run: () => this.cpCall(x.call) });
      if (x.key.startsWith("lz:")) return Object.assign(x, { max: x.ok ? 1 : 0, noQty: 1, run: () => this.cpCall(x.call) });
      const [k, g, sl] = x.fa, ys = x.ys ? this.ysSel(x.ys) : -1;
      const max = has && !full ? this.forgeMax(k, g, sl, undefined, undefined, ys) : 0;
      const yn = x.ys ? ((x.sm || []).find(m => m.k === "ys") || {}).n || 0 : 0;
      return Object.assign(x, { max, extra: yn ? this.ysRow(x.ys, yn) : "", run: n => this.craftFurnaceN(n, k, g, sl, undefined, undefined, ys >= 0 ? ys : undefined) });
    }).map(x => Object.assign(x, { note: x.note || (!has ? "没有装炼器炉" : full ? "炼器队列已满" : "") }));
    this.cpView("qi", "选择配方", L, "开始炼器", "没有可选的配方：炉子图纸在门派宝库兑换，装备图谱、空间石、灵珠在门派炼器室学习，或到「隐藏」取消隐藏。");
  },
  // 开始精炼：身上、法宝栏、背包的装备 / 法宝 / 戒指做成格子，选中后在下面开始（或排队）精炼
  openRefineList() {
    const s = this.s, list = [], full = !!(s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE), has = s.furnaceUse.qi >= 0;
    for (const k of DATA.equipSlots) { const e = (s.equip || {})[k]; if (e && e.attrs) list.push([e, "已装备"]); }
    (s.fabao || []).forEach(e => { if (e && e.attrs) list.push([e, "法宝栏"]); });
    s.bag.forEach(it => { if (it && it.t === "eq" && it.e.attrs) list.push([it.e, ""]); });
    list.forEach(([e]) => { if (!e.uid) e.uid = DATA.newUid(); });
    const L = list.map(([e, where]) => { const top = DATA.rjTop(e), mats = DATA.refineMats(e), sm = DATA.refineSm(e), img = DATA.eqIcon(e);
      const ok = !top && has && !full && this.hasMats(mats) && this.smHave(sm);
      return { key: e.uid, tag: DATA.XING[e.g], name: `<span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>`, sub: `${where || "背包"} · ${DATA.rjName(e)}`, icon: img ? DATA.eqTierIco(img, e.g, e.slot === "ring") : "",
        mats: top ? [] : mats, sm: top ? [] : sm, per: this.forgePer("rf", e.g), rate: this.forgeRate("eq", e.g), max: ok ? this.rfMax(e, mats, sm) : 0, run: n => this.refineEq(e.uid, n),
        note: top ? "已精炼满" : !has ? "没有装炼器炉" : full ? "炼器队列已满" : "" }; });
    this.cpView("rf", "选择精炼物品", L, "开始精炼", "身上和背包里都没有装备、法宝、戒指。");
  },
  /* ---------- 炼丹 / 炼器 / 精炼 选择窗口（上：2 列格子；下：所需材料、成功率、数量、消耗时间、开始按钮）
   * 选中项与数量只在界面记（this._cp），炼完弹窗自动刷新（open* 由 api.js 记录） */
  cpOpen(kind) { return kind === "dan" ? "openAlchList" : kind === "qi" ? "openForgeList" : "openRefineList"; },
  cpView(kind, title, L, btn, empty) {
    const st = this._cp && this._cp.kind === kind ? this._cp : (this._cp = { kind, key: null, n: 1 });
    this._cpList = L;
    let cur = L.find(x => x.key === st.key) || L.find(x => x.max > 0) || L[0];
    if (cur) st.key = cur.key;
    const max = cur ? Math.max(0, cur.max) : 0; st.n = Math.max(1, Math.min(st.n || 1, max || 1));
    const gEl = document.querySelector("#modal-box .cpk-grid"), top = gEl && this._cpShown === kind ? gEl.scrollTop : 0;
    // 格子一行：【四星】磐石戒（名字前面重复的星级 / 阶去掉）
    const short = x => String(x.name).replace(new RegExp("^(<span[^>]*>)?" + x.tag + "·?"), "$1") || x.name;
    const tile = x => `<div class="cpk-tile${cur && x.key === cur.key ? " on" : ""}${x.max > 0 ? "" : " off"}" onclick="G.cpSel('${x.key}')"><span class="cpk-tag">【${x.tag}】</span><span class="cpk-nm">${short(x)}</span>${x.full ? `<span class="cpk-full">已满</span>` : ""}</div>`;
    const mat = (src, have, need, name) => `<div class="cpk-mat${have >= need ? "" : " lack"}">${src ? `<img src="${src}" alt="" loading="lazy">` : ""}<b>${name}</b><span>${U.fmt(have)}/${U.fmt(need)}</span></div>`;
    let foot = "";
    if (cur) {
      const n = cur.noQty ? 1 : st.n, mats = (cur.mats || []).map(m => mat(m.kind === "sm" ? DATA.smIcon(m.g, m.ft) : DATA.matImg(m.kind, m.g), this.countMat(m.kind, m.g), m.n * n, DATA.matFull(m.kind, m.g)))
        .concat((cur.sm || []).map(x => mat(DATA.smIcon(x.k, x.ft), this.smCount(x.k, x.ft), x.n * n, x.txt || DATA.smName(x.k, x.ft))));
      // 下方：第一行 名字（框外） | 成功率；第二行 图片框（图居中）| 材料…开始按钮（图片框上下和右栏对齐）
      foot = `<div class="cpk-foot"><b class="cpk-name">${cur.name}</b><p class="cpk-rate">成功率：${this.ratePct(cur.rate)}</p>
        <div class="cpk-sel"><div class="cpk-ico">${cur.icon || ""}</div>${cur.sub || cur.desc ? `<div class="cpk-sub">${cur.sub ? `<small>${cur.sub}</small>` : ""}${cur.desc ? `<span class="tag">${cur.desc}</span>` : ""}</div>` : ""}</div>
        <div class="cpk-r">
          <div class="cpk-mats">${mats.join("") || `<p class="desc">不需要材料</p>`}</div>${cur.extra || ""}
          ${cur.noQty ? "" : `<div class="cpk-qty"><button onclick="G.cpAdd(-10)">-10</button><button onclick="G.cpAdd(-1)">−</button><span>${max ? n : 0}/${U.fmt(max)}</span><button onclick="G.cpAdd(1)">+</button><button onclick="G.cpAdd(10)">+10</button></div>`}
          ${cur.per ? `<p class="cpk-time">消耗时间：${U.dur(cur.per * n / 1000)}</p>` : ""}${cur.note ? `<p class="desc cpk-note">${cur.note}</p>` : ""}
          <button class="primary cpk-go" onclick="G.cpGo()" ${max > 0 ? "" : "disabled"}>${cur.next || btn}</button></div></div>`;
    }
    this.modal(`<div class="cpk"><h2>${title}</h2>
      <div class="cpk-grid">${L.length ? L.map(tile).join("") : `<p class="desc">${empty}</p>`}</div>${foot}
      <div class="btns"><button onclick="G.closeModal()">关闭</button></div></div>`);
    this._cpShown = kind; const g2 = document.querySelector("#modal-box .cpk-grid"); if (g2 && top) g2.scrollTop = top;
  },
  cpSel(key) { if (!this._cp) return; this._cp.key = key; this._cp.n = 1; this[this.cpOpen(this._cp.kind)](); },
  cpAdd(d) { const c = this._cp, L = this._cpList || []; if (!c) return; const x = L.find(y => y.key === c.key); if (!x) return;
    c.n = Math.max(1, Math.min(Math.max(1, x.max), (c.n || 1) + d)); this[this.cpOpen(c.kind)](); },
  cpGo() { const c = this._cp, x = c && (this._cpList || []).find(y => y.key === c.key); if (!x || !(x.max > 0)) return;
    const n = Math.min(c.n || 1, x.max); x.run(n); if (!x.noQty) c.n = 1;
    if (!x.next && ["dan", "qi", "rf"].includes(c.kind)) return this.closeModal();   // 开始炼丹 / 炼器 / 精炼后关掉列表框
    const md = document.getElementById("modal"); if (!x.next && md && !md.classList.contains("hidden")) this[this.cpOpen(c.kind)](); },
  cpCall(code) { new Function("G", code.replace(/^G\./, "return G."))(G); },
  // 连续精炼最多几次：剩余可精炼次数，和当前这档材料够几次
  rfMax(e, mats, sm) { let m = DATA.rjCap(e) - DATA.rjCount(e);
    if (!this.craftFree()) { for (const x of mats) m = Math.min(m, Math.floor(this.countMat(x.kind, x.g) / x.n)); for (const x of sm) m = Math.min(m, Math.floor(this.smCount(x.k, x.ft) / x.n)); }
    return Math.max(0, m); },
  pickRefine(uid) { this.closeModal(); this.refineEq(uid); },
  pickPrev(uid) { const p = this._prevPick; this.closeModal(); if (p) this.craftFurnace(p[0], p[1], p[2], p[3], p[4], uid, p[5] >= 0 ? p[5] : undefined); },
  pickForge(key) { this.forgePickKey = key; this.closeModal(); this.render(); },
});

/* 洞府 · 炼丹房 */
G.caveViews.alchemy = function () {
  const s = this.s, a = s.alchJob, mode = ["hide", "log"].includes(this.alchMode) ? this.alchMode : "make";
  let h = this.cardRow(this.craftsmanMini("dan"), this.furnaceMini(this.danFurn("dan")));
  h += this.roomBtns([["make", "炼丹", "G.setAlchMode('make')"], ["log", "炼丹记录", "G.setAlchMode('log')"], ["hide", "隐藏丹方", "G.setAlchMode('hide')"]], mode);
  if (mode === "log") return h + this.craftLogCard("alchLog");
  if (mode === "hide") {
    // 隐藏的丹方自动排到最后（同组内仍按 凡丹→神丹、一阶→十阶）；服用已满的丹药，已服数用红色显示
    const L = this.danKnown().sort((a, b) => (this.isHidden("dan", a.key) ? 1 : 0) - (this.isHidden("dan", b.key) ? 1 : 0));
    return h + `<div class="card"><h3>已学丹方<small>${L.length} 个 · 隐藏后「开始炼丹」里不显示</small></h3>` + (L.length ? L.map(x => { const hid = this.isHidden("dan", x.key), e = this.danEatTxt(x.t, x.g), full = DATA.danLimit(x.t, x.g) > 0 && this.danLeft(x.t, x.g) <= 0;
      return `<div class="line"><div>${DATA.danImg(DATA.danIcon(x.t), DATA.danCls(x.t, x.g), "li")}${DATA.danName(x.t, x.g)}<span class="tag">${DATA.recipeEffect(x.t, x.g)}</span><small>${full ? `<span class="c-red">${e}</span>` : (e || "不可服用")}</small></div>
        <button class="sm ${hid ? "on" : ""}" onclick="G.toggleHide('dan','${x.key}')">${hid ? "已隐藏" : "隐藏"}</button></div>`; }).join("") : `<p class="desc">还没有学会丹方。</p>`) + `</div>`;
  }
  // 炼丹信息（正在炼 + 排队）都在「开始炼丹」这个框里，按钮在信息下面；没有信息时按钮在页面中部
  const now = API.now(); let acc = a ? Math.max(0, a.next - now) + Math.max(0, a.n - a.done - 1) * a.per : 0;
  const rows = (a ? [`<div class="line job-row"><div><img class="job-ico" src="${DATA.danIcon(a.type)}" alt="" loading="lazy"><b>${DATA.danName(a.type, a.g)}</b> ×${a.n}<span class="tag c-green">炼制中</span>
      <div class="pg">${this.pgFill(Math.max(0, a.next - now), a.per)}<span>${a.done} / ${a.n} · 下一枚 ${U.cd(Math.max(0, a.next - now) / 1000 + 59)}</span></div>
      <small>成丹 ${a.ok || 0}${a.extra ? `（+${a.extra}）` : ""} · 失败 ${a.fail || 0} · 成功率 ${this.ratePct(this.danRate(a.type, a.g))} · 约 ${U.cd(acc / 1000 + 59)} 后炼完</small></div>
      <button class="sm on" onclick="G.askStopJob('alch')">停炉</button></div>`] : [])
    .concat(s.alchQueue.map((x, i) => { const ms = this.danPer(x.type, x.g) * x.n; acc += ms;
      return `<div class="line job-row"><div><img class="job-ico" src="${DATA.danIcon(x.type)}" alt="" loading="lazy"><b>${DATA.danName(x.type, x.g)}</b> ×${x.n}<span class="tag">排队</span><small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后炼完</small></div>
        <button class="sm" onclick="G.cancelAlchQ(${i})">取消</button></div>`; })).join("");
  const full = a && s.alchQueue.length >= CFG.alchemy.QUEUE;
  h += rows ? `<div class="card"><h3>炼丹<small>排队 ${s.alchQueue.length} / ${CFG.alchemy.QUEUE}</small></h3>${rows}
    <div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.openAlchList()" ${full ? "disabled" : ""}>${full ? "炼丹队列已满" : "开始炼丹"}</button></div></div>`
    : this.craftStartBtn("G.openAlchList()", "开始炼丹");
  return h;
};

/* 洞府 · 炼器室 */
G.caveViews.forge = function () {
  const s = this.s, j = s.forgeJob, mode = ["refine", "hide", "log"].includes(this.forgeMode) ? this.forgeMode : "make";
  let h = this.cardRow(this.craftsmanMini("qi"), this.furnaceMini("qi"));
  h += this.roomBtns([["make", "炼器", "G.setForgeMode('make')"], ["refine", "精炼", "G.setForgeMode('refine')"], ["log", "记录", "G.setForgeMode('log')"], ["hide", "隐藏", "G.setForgeMode('hide')"]], mode);
  if (mode === "log") return h + this.craftLogCard("forgeLog");
  // 炼器信息（正在炼 + 排队）：炼器、精炼共用一个炉子和队列，精炼的进度只在「精炼」页显示，其余在「炼器」页
  const now = API.now(), isRf = x => x.kind === "rf", left = x => Math.max(1, (x.n || 1) - (x.done || 0)), jobRows = rf => { let acc = j ? Math.max(0, j.end - now) + (left(j) - 1) * this.forgePer(j.kind, j.g) : 0; const out = [];
    if (j && isRf(j) === rf) out.push(`<div class="line job-row"><div>${this.jobIco(j)}<b>${this.jobName(j)}</b><span class="tag c-green">${rf ? "精炼中" : "炼制中"}</span>
      <div class="pg">${this.pgFill(Math.max(0, j.end - now), this.forgePer(j.kind, j.g))}<span>剩余 ${U.cd(Math.max(0, j.end - now) / 1000 + 59)}</span></div>
      <small>成功率 ${this.ratePct(this.forgeRate(j.kind, j.g))}</small></div>
      <button class="sm on" onclick="G.askStopJob('forge')">停止</button></div>`);
    s.forgeQueue.forEach((x, i) => { const ms = this.forgePer(x.kind, x.g) * left(x); acc += ms; if (isRf(x) !== rf) return;
      out.push(`<div class="line job-row"><div>${this.jobIco(x)}<b>${this.jobName(x)}</b><span class="tag">排队</span><small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(acc / 1000 + 59)} 后完成</small></div>
        <button class="sm" onclick="G.cancelForgeQ(${i})">取消</button></div>`); });
    return out.join(""); };
  // 精炼页和炼器页一样：有进度时进度 + 「开始精炼」按钮在一个框里，没有时按钮在页面中部；点「开始精炼」才弹出物品选择
  if (mode === "refine") { const rr = jobRows(true), full = j && s.forgeQueue.length >= CFG.furnace.QUEUE;
    return h + (rr ? `<div class="card"><h3>精炼<small>排队 ${s.forgeQueue.length} / ${CFG.furnace.QUEUE}</small></h3>${rr}
      <div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.openRefineList()" ${full ? "disabled" : ""}>${full ? "炼器队列已满" : "开始精炼"}</button></div></div>`
      : this.craftStartBtn("G.openRefineList()", "开始精炼")); }
  const items = this.forgeItems();
  if (mode === "hide") {
    // 隐藏的配方自动排到最后（同组内保持原顺序），和炼丹房一样
    const L = items.slice().sort((a, b) => (this.isHidden("qi", a.key) ? 1 : 0) - (this.isHidden("qi", b.key) ? 1 : 0));
    return h + `<div class="card"><h3>已学配方<small>${items.length} 个 · 隐藏后「开始炼器」里不显示</small></h3>` + (L.length ? L.map(x => { const hid = this.isHidden("qi", x.key);
      return `<div class="line">${x.info}<button class="sm ${hid ? "on" : ""}" onclick="G.toggleHide('qi','${x.key}')">${hid ? "已隐藏" : "隐藏"}</button></div>`; }).join("") : `<p class="desc">还没有学会配方。</p>`) + `</div>`;
  }
  // 炼器信息（正在炼 + 排队）都在「开始炼器」这个框里，按钮在信息下面；没有信息时按钮在页面中部
  const rows = jobRows(false);
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
      (sl === "fabao" ? (g ? `升星图谱：把${DATA.XING[g - 1]}法宝升为${DATA.XING[g]}（${DATA.fabaoTypes.length} 种通用，颜色不变）` : `炼制图谱：用耀石炼成一星法宝（${DATA.fabaoTypes.map(t => t.name).join(" ")}，属性自选）`) : `主属性 ${CFG.forge.attr.main[sl].map(k => DATA.attrNames[k]).join("、")} + 1~5 条附加属性`) + (g ? ` · 需上一星${DATA.slots[sl]}` : ""))).concat([
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

/* 门派 · 炼丹房：学习凡丹丹方 + 仙冥魔丹的命中/速度/闪避/生命/法力丹方（6~10 星，DATA.danSectX）（sect.js 调用）。1~5 星宗门每星两阶，6~10 星宗门全部凡丹丹方（DATA.danStar）；仙冥魔神丹方在四界功德司 */
G.sectAlchemyView = function () {
  const s = this.s, star = this.sectInfo().star;
  let h = this.lqCard("dan");   // v173 学习队列
  const hall = DATA.nmPick(CFG.names.sectHall, "alchemy", "炼丹房"), types = Object.keys(DATA.recipes).filter(t => DATA.danSect(t));
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
  return h + U.doneCards(cards) + `<p class="desc">仙丹、冥丹、魔丹的命中、速度、闪避、生命、法力丹方在 6~10 星宗门学习；其余仙丹、冥丹、魔丹、神丹丹方在四界各地图的功德司用功德兑换。</p>`;
};
