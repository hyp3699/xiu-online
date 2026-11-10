/* ===================================================================
 * 阵法室（配置 config/zhenfa.js，阵法参数都在那里）
 * 主动阵法：升级花灵石，受到本系属性伤害时：减伤 = min(本次伤害, RED)，耗灵气 = 减伤 × 3.6（灵气不够时按剩余灵气比例减伤），
 *   战斗 / 雷劫里受到本系属性伤害直接减、克制系直接加（world.js lgR、trib.js 调 zfDmg）。
 * 属性阵法：7 种 × 12 阶，每阶单独升到 36 级（花灵石，升的是属性上限）；修炼一次 5 秒，开始扣灵气，
 *   结束加 13~49 点到上限为止，存 s.zf.v，进 craft.js danBonus（zfBonus）。
 * 存档 s.zf = { a: { 阵id: 等级 }, on: { 阵id: 1 }, t: { "属性:阶": 等级 }, v: { "属性:阶": 已修炼属性 }, bp: { "属性:阶": 1 学会图纸 }, job: { k, t, end } | null }
 * 本模块没有 tick（fastsim 按有 tick 的模块列表判断），结算放在 cave.js tick。
 * =================================================================== */
G.module({
  id: "formation",
  defaults: () => ({ zf: { a: {}, on: {}, t: {}, v: {}, bp: {}, job: null } }),

  api: {
    zfC() { return CFG.zhenfa || {}; },
    zfS() { const s = this.s; s.zf = s.zf && typeof s.zf === "object" ? s.zf : {}; const z = s.zf; z.a = z.a || {}; z.on = z.on || {}; z.t = z.t || {}; z.v = z.v || {}; z.bp = z.bp || {}; if (z.job === undefined) z.job = null; return z; },
    zfMax() { return Math.max(1, +this.zfC().MAX || 36); },
    zfStatZh(k) { return { atk: "攻击", def: "防御", speed: "速度", hp: "生命", mana: "法力", hit: "命中", dodge: "闪避" }[k] || k; },
    zfTName(f, t) { return this.zfTierZh(t) + (f ? f.name : "阵法"); },   // 一阶淬元阵
    zfTierZh(t) { const N = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"]; return (N[t] || t) + "阶"; },

    /* ---------- 主动阵法 ---------- */
    zfAct(id) { return (this.zfC().ACTIVE || []).find(x => x.id === String(id)); },
    zfALv(id) { return Math.max(0, Math.min(this.zfMax(), ((this.zfS().a)[id]) | 0)); },
    // 主动阵法第 lv 级的数值：P = [1 级, 满级]（旧配置写单个数 = 每级）
    zfAVal(P, lv) {
      if (!lv) return 0; if (!Array.isArray(P)) return (+P || 0) * lv;
      const a = +P[0] || 0, b = +P[1] || 0, M = this.zfMax();
      return M > 1 ? Math.round(a + (b - a) * (lv - 1) / (M - 1)) : a;
    },
    zfARed(lv) { return this.zfAVal((this.zfC().ACT || {}).RED, lv); },
    zfAAdd(lv) { return this.zfAVal((this.zfC().ACT || {}).ADD, lv); },
    zfAOpen(id) { return !!(this.zfS().bp || {})[id + ":0"]; },   // 学会主动阵法图纸（阶记 0）
    zfAOn(id) { return !!this.zfS().on[id] && this.zfALv(id) > 0; },
    // 从第 lv 级升级的花费：{ mats: [{kind,g,n}], stone }；band = 用哪一界矿石（0 凡 1 仙 2 神）
    // lv = 当前级（0 = 布阵，按 1 级升 2 级 × SET_K）；idx = 阵法序号，决定从矿石池第几种开始取（轮流取，用得平均）
    zfCost(P, lv, band, idx) {
      const C = this.zfC(), pool = (C.ORES || [])[Math.min(2, band)] || [], k = Math.min(pool.length, Math.max(1, +C.PER || 3)), st = ((Math.floor(+idx) || 0) % (pool.length || 1) + (pool.length || 1)) % (pool.length || 1);
      const names = [...Array(k).keys()].map(j => pool[(st + j) % pool.length]), n = Math.round((+P.ORE || 0) * (lv || 1) * (lv ? 1 : (+C.SET_K || 1)));
      return { mats: DATA.parseMats(names.map(x => [x, n])), stone: Math.round(n * (+C.STONE_K || 0)) };
    },
    zfBand(B, x) { const i = (B || []).findIndex(v => x <= v); return i < 0 ? 2 : i; },
    zfACost(lv, id) { const C = this.zfC(), A = C.ACT || {}; return this.zfCost(A, lv, this.zfBand(A.BAND, lv + 1), (C.ACTIVE || []).findIndex(f => f.id === id)); },
    // 属性阵每界 28 个阵位（7 种 × 4 阶），各取连续 3 种矿石；起始序号按此表轮流，
    // 保证每种矿石恰好出现 14 次（28×3÷6）。不用 n%6：28÷6 余 4，前 4 种起始会多
    // 出现一次，中间两种矿石会多用约 15%（16/17/18 之差）。
    zfTStart(n) { const T = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 3, 4]; return T[((Math.floor(+n) || 0) % 28 + 28) % 28]; },
    zfTCost(t, lv, k) { const C = this.zfC(), T = C.ST || {}; return this.zfCost(T, lv, this.zfBand(T.BAND, t), this.zfTStart(Math.max(0, (C.STAT || []).findIndex(f => f.id === k)) * 4 + ((+t - 1) % 4))); },
    zfPay(c) {   // 扣升级花费，不够返回 false
      if (DATA.isTest()) return true;
      if (this.s.stone < c.stone) { this.log(`灵石不足，需要 ${U.fmt(c.stone)}。`, "sys"); return false; }
      if (!this.hasMats(c.mats)) { this.log("矿石不足。", "sys"); return false; }
      this.s.stone -= c.stone; c.mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); return true;
    },
    zfCostHtml(c, title = "升级消耗") {
      const cell = (src, have, need, name) => `<div class="cpk-mat${have >= need ? "" : " lack"}"><img src="${src}" alt=""><b>${name}</b><span>${U.fmt(have)}/${U.fmt(need)}</span></div>`;
      return `<p class="zf-cost-t">${title}</p><div class="cpk-mats zf-cost">${c.mats.map(m => cell(DATA.matImg(m.kind, m.g), this.countMat(m.kind, m.g), m.n, DATA.matFull(m.kind, m.g))).join("")}${cell(DATA.iconImg("stone"), this.s.stone, c.stone, "灵石")}</div>`;
    },
    zfCanPay(c) { return DATA.isTest() || (this.s.stone >= c.stone && this.hasMats(c.mats)); },
    zfARate() { return +((this.zfC().ACT || {}).RATE ?? 3.6) || 0; },   // 每减 1 点伤害扣多少灵气
    zfAUp(id) {
      const f = this.zfAct(id); if (!f) return;
      const s = this.s, z = this.zfS(), lv = this.zfALv(f.id);
      if (!this.zfAOpen(f.id)) return this.log(`还没有学会${f.name}图纸。`, "sys");
      if (lv >= this.zfMax()) return this.log(`${f.name}已满级。`, "sys");
      if (!this.zfPay(this.zfACost(lv, f.id))) return;   // 布阵（0→1 级）= 1 升 2 消耗 × SET_K
      z.a[f.id] = lv + 1;
      this.log(`${f.name}${lv ? "升至" : "布阵成功，"}第 ${lv + 1} 级。`, "good"); this.dirty(); this.after();
    },
    zfAToggle(id) {
      const f = this.zfAct(id); if (!f) return;
      const z = this.zfS();
      if (!this.zfALv(f.id)) return this.log(`还没有布置${f.name}。`, "sys");
      if (z.on[f.id]) { delete z.on[f.id]; this.log(`${f.name}已停止运转。`, "sys"); }
      else { z.on[f.id] = 1; this.log(`${f.name}开始运转。`, "good"); }
      this.dirty(); this.after();
    },
    // 每 10 秒：只结算属性阵修炼到时（主动阵不再按时间扣维持费，改成每次受击扣费，见 zfDmg）
    zfTick() {
      this.zfDone(true);
    },
    // 受到 el 属性伤害的固定修正：正数 = 减少，负数 = 增加（开着的阵法合计，不乘任何倍率）
    // d = 本次伤害（已算完其他倍率、未减阵法）；noPay 时不扣费，供实力测试用。
    // 本系阵：减伤 = min(d, RED 上限)，耗灵气 = 减伤 × RATE（1 点伤害扣 3.6 点灵气）；
    // 灵气不够时按剩余灵气比例减伤（减伤 = 灵气 / RATE，灵气扣光），阵保持开启。克制系加伤不收费。
    zfDmg(el, d, noPay) {
      const id = el && el.id || el; if (!id) return 0;
      const A = this.zfC().ACT || {}; let r = 0;
      const D = (typeof d === "number" && isFinite(d)) ? d : Infinity;   // 没传 d 时按满额减伤（老行为）
      for (const f of this.zfC().ACTIVE || []) {
        if (!this.zfAOn(f.id)) continue; const lv = this.zfALv(f.id);
        if (f.el === id) {
          const want = Math.floor(Math.max(0, Math.min(D, this.zfARed(lv))));   // 取整，灵气按整数扣
          if (noPay) { r += want; continue; }
          const rate = this.zfARate();
          const got = rate > 0 ? Math.floor(Math.max(0, Math.min(want, this.s.ling / rate))) : want;
          if (got > 0) { this.s.ling = Math.max(0, this.s.ling - Math.round(got * rate)); r += got; }
        }
        if (f.ke === id) r -= this.zfAAdd(lv);
      }
      return r;
    },

    /* ---------- 属性阵法 ---------- */
    zfStat(k) { return (this.zfC().STAT || []).find(x => x.id === String(k)); },
    zfTiers() { return Math.max(1, +(this.zfC().ST || {}).TIERS || 12); },
    zfTLv(k, t) { return Math.max(0, Math.min(this.zfMax(), ((this.zfS().t)[k + ":" + t]) | 0)); },
    // 第 t 阶每级加的属性
    zfTVal(k, t) {
      const ST = this.zfC().ST || {}, T = ((CFG.gongfa || {}).sect || {}).TOTAL || {}, n = this.zfTiers(), W = n * (n + 1) / 2;
      return Math.max(1, Math.round((+T[k] || 0) * (+ST.PCT || 0) / 100 * t / (this.zfMax() * W)));
    },
    zfTLing(t) { return Math.round((+(this.zfC().ST || {}).LING || 0) * t); },   // 修炼一次的灵气
    zfTCap(k, t) { return this.zfTVal(k, t) * this.zfTLv(k, t); },   // 当前属性上限
    zfTGot(k, t) { return Math.max(0, +((this.zfS().v || {})[k + ":" + t]) || 0); },   // 已修炼加到人物身上的
    zfTOpen(k, t) { return !!(this.zfS().bp || {})[k + ":" + t]; },   // 学会这一阶的图纸才出现
    /* ---------- 阵法图纸 ---------- */
    zfBpC() { return this.zfC().BP || {}; },
    // t = 0：主动阵法图纸（没有阶）
    zfBpStar(t) { const B = this.zfBpC(); return t ? +((B.STAR || [])[t - 1]) || 1 : +B.ACT_STAR || 1; },
    zfBpCost(t) { const B = this.zfBpC(); return t ? Math.round((+B.CONTRIB || 0) + (+B.CONTRIB_ADD || 0) * (t - 1)) : Math.round(+B.ACT_CONTRIB || 0); },
    zfBpMs(t) { const B = this.zfBpC(); return Math.round((t ? (+B.LEARN_MIN || 0) * t : +B.ACT_LEARN_MIN || 0) * 60000); },
    zfBpName(k, t) { if (!t) { const a = this.zfAct(k); return `${a ? a.name : "阵法"}图纸`; } const f = this.zfStat(k); return `${this.zfTName(f, t)}图纸`; },
    zfBpInBag(k, t) { return (this.s.bag || []).some(it => it && it.t === "zfbp" && it.kind === k && it.g === t); },
    zfImg(k) { const f = this.zfStat(k) || this.zfAct(k); return f && f.img || DATA.iconImg("bp"); },
    // 宗门宝库兑换
    exchangeZfBp(k, t) {
      t = Math.floor(+t); const f = t === 0 ? this.zfAct(k) : this.zfStat(k); if (!f || !(t >= 0 && t <= this.zfTiers()) || !this.s.sect) return;
      const c = this.zfBpCost(t);
      if (this.zfBpStar(t) > this.sectInfo().star) return this.log(`${this.zfBpStar(t)}星宗门才能兑换。`, "sys");
      if (t ? this.zfTOpen(f.id, t) : this.zfAOpen(f.id)) return this.log("已学会这张图纸。", "sys");
      if (this.zfBpInBag(f.id, t)) return this.log("背包里已有这张图纸。", "sys");
      if (this.s.contrib < c) return this.log("贡献不足。", "sys");
      this.bagPutOrMail({ t: "zfbp", kind: f.id, g: t });
      this.s.contrib -= c;
      this.log(`获得${this.zfBpName(f.id, t)}，贡献 -${U.fmt(c)}。`, "gold"); this.after();
    },
    // 背包里点「学习」（炼器学习队列）
    learnZfBp(i) {
      const it = this.s.bag[i]; if (!it || it.t !== "zfbp" || it.lq) return;
      if (it.g ? this.zfTOpen(it.kind, it.g) : this.zfAOpen(it.kind)) return this.log("已学会这张图纸。", "sys");
      const key = `zfbp|${it.kind}|${it.g}`; if (!this.lqCan("forge", key)) return;
      it.lq = 1; this.lqAdd("forge", { key, k: "zfbp", kind: it.kind, g: it.g, ms: this.zfBpMs(it.g) }); this.closeModal(); this.after();
    },
    // 宗门宝库「图纸」页：属性阵法图纸（只列本宗门星级能兑换的阶）
    //   未学会的放前面（zfShopHtml），已学会的统一放到所有图纸最后（zfShopDoneHtml）
    zfShopParts() {
      const x = this.sectInfo() || { star: 1 }, s = this.s;   // 未入宗门时 sectInfo() 为空，默认 1 星防崩（宝库页只对已入宗门开放）
      const act = (this.zfC().ACTIVE || []).length && this.zfBpStar(0) <= x.star ? [{ head: `<h3>主动阵法图纸<small>战斗、度雷劫时生效</small></h3>`, rows: (this.zfC().ACTIVE || []).map(f => {
        const c = this.zfBpCost(0), known = this.zfAOpen(f.id), bag = this.zfBpInBag(f.id, 0);
        return [known, `<div class="line"><div>${DATA.li(DATA.iconImg("bp"))}${this.zfBpName(f.id, 0)}<small>${U.fmt(c)} 贡献 · 学习 ${U.dur(this.zfBpMs(0) / 1000)}</small></div>
          <button class="sm" onclick="G.exchangeZfBp('${f.id}',0)" ${known || bag || s.contrib < c ? "disabled" : ""}>${known ? "已学会" : bag ? "在背包" : "兑换"}</button></div>`]; }) }] : [];
      const cards = [...act, ...(this.zfC().STAT || []).map(f => ({ head: `<h3>${f.name}图纸<small>${this.zfStatZh(f.id)}</small></h3>`,
        rows: [...Array(this.zfTiers()).keys()].map(i => i + 1).filter(t => this.zfBpStar(t) <= x.star).map(t => {
          const c = this.zfBpCost(t), known = this.zfTOpen(f.id, t), bag = this.zfBpInBag(f.id, t);
          return [known, `<div class="line"><div>${DATA.li(DATA.iconImg("bp"))}${this.zfBpName(f.id, t)}<small>${U.fmt(c)} 贡献 · 学习 ${U.dur(this.zfBpMs(t) / 1000)}</small></div>
            <button class="sm" onclick="G.exchangeZfBp('${f.id}',${t})" ${known || bag || s.contrib < c ? "disabled" : ""}>${known ? "已学会" : bag ? "在背包" : "兑换"}</button></div>`]; }) }))].filter(c => c.rows.length);
      const todo = [], done = [];
      for (const c of cards) {
        const t = c.rows.filter(r => !r[0]);
        c.rows.forEach(r => { if (r[0]) done.push(r); });
        if (t.length) todo.push(`<div class="card">${c.head}${t.map(r => r[1]).join("")}</div>`);
      }
      return { todo: todo.join(""), done };
    },
    zfShopHtml(p) { return (p || this.zfShopParts()).todo; },   // 未学会的阵法图纸（p 由宝库页一次算好传进来）
    zfShopDoneHtml() {   // 已学会的阵法图纸：放所有图纸最后
      const done = this.zfShopParts().done;
      return done.length ? `<div class="card"><h3>已学会<small>${done.length} 项</small></h3>${U.doneLast(done)}</div>` : "";
    },
    zfBpLearned(c) { const z = this.zfS(); z.bp = z.bp || {}; z.bp[c.kind + ":" + c.g] = 1; },
    zfBonus() {
      const b = {}, V = this.zfS().v || {};
      for (const key in V) { const k = key.split(":")[0]; if (this.zfStat(k)) b[k] = (b[k] || 0) + (+V[key] || 0); }
      return b;
    },
    zfTUp(k, t) {
      const f = this.zfStat(k); t = Math.floor(+t); if (!f || !(t >= 1 && t <= this.zfTiers())) return;
      const s = this.s, z = this.zfS(), name = this.zfTName(f, t), lv = this.zfTLv(f.id, t);
      if (!this.zfTOpen(f.id, t)) return this.log(`还没有学会${name}图纸。`, "sys");
      if (lv >= this.zfMax()) return this.log(`${name}已满级。`, "sys");
      if (!this.zfPay(this.zfTCost(t, lv, f.id))) return;   // 布阵（0→1 级）= 1 升 2 消耗 × SET_K
      z.t[f.id + ":" + t] = lv + 1;
      this.log(`${name}${lv ? "升至" : "布阵成功，"}第 ${lv + 1} 级，${this.zfStatZh(f.id)}上限 ${U.fmt(this.zfTCap(f.id, t))}。`, "good"); this.dirty(); this.after();
    },
    zfTrain(k, t) {
      const f = this.zfStat(k); t = Math.floor(+t); if (!f || !(t >= 1 && t <= this.zfTiers())) return;
      const s = this.s, z = this.zfS(); this.zfDone(true);
      const name = this.zfTName(f, t);
      if (z.job) return this.log("正在阵中修炼，请稍候。", "sys");
      if (!this.zfTLv(f.id, t)) return this.log(`${name}还没有布阵。`, "sys");
      if (this.zfTGot(f.id, t) >= this.zfTCap(f.id, t)) return this.log(`${name}的属性已修炼到上限，升级阵法后才能继续。`, "sys");
      const c = this.zfTLing(t), test = DATA.isTest();
      if (!test && s.ling < c) return this.log(`灵气不足，需要 ${U.fmt(c)}。`, "sys");
      if (!test) s.ling -= c;
      z.job = { k: f.id, t, end: this.now() + Math.max(1, +(this.zfC().ST || {}).SEC || 5) * 1000 };
      this.dirty(); this.after();
    },
    // 修炼到时间就结算（客户端 5 秒后调；cave tick 兜底）：+GAIN 随机点，到上限为止
    zfDone(quiet) {
      const z = this.zfS(), j = z.job; if (!j) return;
      if (this.now() < j.end - 500) return;
      const f = this.zfStat(j.k); z.job = null;
      if (f) { const key = f.id + ":" + j.t, g = (this.zfC().ST || {}).GAIN || [13, 49], a = Math.floor(+g[0] || 0), b = Math.max(a, Math.floor(+g[1] || 0));
        z.v = z.v || {}; const had = this.zfTGot(f.id, j.t), add = Math.max(0, Math.min(a + Math.floor(Math.random() * (b - a + 1)), this.zfTCap(f.id, j.t) - had));
        z.v[key] = had + add;
        if (!this.silent) this.log(`${this.zfTName(f, j.t)}修炼完成，${this.zfStatZh(f.id)} +${U.fmt(add)}。`, "good"); }
      if (quiet) this.dirty(); else this.after();
    },
    // 界面按钮：开始修炼，5 秒后自动结算（只在浏览器里用，不进白名单）
    zfStart(k, t) {
      const r = this.zfTrain(k, t), ms = Math.max(1, +(this.zfC().ST || {}).SEC || 5) * 1000 + 300;
      if (typeof setTimeout === "function") setTimeout(() => { const j = this.s && this.s.zf && this.s.zf.job; if (j) this.zfDone(); }, ms);
      return r;
    },
    // 弹窗：主动阵法
    openZfAct(id) {
      const f = this.zfAct(id); if (!f) return;
      const A = this.zfC().ACT || {}, s = this.s, lv = this.zfALv(f.id), MX = this.zfMax(), on = this.zfAOn(f.id), full = lv >= MX, c = this.zfACost(lv, f.id), EN = e => (DATA.elById[e] || {}).name || e;
      this.modal(`<div class="zf-mhead"><img class="zf-mimg" src="${this.zfImg(f.id)}" alt=""><div><h2>${f.name}</h2><p class="desc">${lv} 级${on ? ` · <span class="c-green">运转中</span>` : ""}</p></div></div>
        ${lv ? `<div class="stats"><div><span>受到${EN(f.el)}属性伤害</span>-${U.fmt(this.zfARed(lv))}</div><div><span>受到${EN(f.ke)}属性伤害</span>+${U.fmt(this.zfAAdd(lv))}</div><div><span>每减 1 点伤害消耗灵气</span>${this.zfARate()}</div></div>${full ? "" : this.zfCostHtml(c)}` : this.zfCostHtml(c, "布阵消耗")}
        <div class="btns">${!lv ? `<button class="primary" onclick="G.zfAUp('${f.id}')" ${this.zfCanPay(c) ? "" : "disabled"}>布阵</button>` : `${full ? "" : `<button class="primary" onclick="G.zfAUp('${f.id}')" ${this.zfCanPay(c) ? "" : "disabled"}>升级</button>`}<button onclick="G.zfAToggle('${f.id}')">${on ? "关闭" : "开启"}</button>`}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 弹窗：属性阵法
    openZfStat(k, t) {
      const f = this.zfStat(k); t = Math.floor(+t); if (!f || !this.zfTOpen(f.id, t)) return;
      const s = this.s, z = this.zfS(), lv = this.zfTLv(f.id, t), MX = this.zfMax(), full = lv >= MX, v = this.zfTVal(f.id, t), cap = v * lv, got = this.zfTGot(f.id, t);
      const cu = this.zfTCost(t, lv, f.id), cl = this.zfTLing(t), j = z.job, me = j && j.k === f.id && j.t === t && this.now() < j.end, busy = j && this.now() < j.end, zh = this.zfStatZh(f.id), G2 = (this.zfC().ST || {}).GAIN || [13, 49];
      this.modal(`<div class="zf-mhead"><img class="zf-mimg" src="${this.zfImg(f.id)}" alt=""><div><h2>${this.zfTName(f, t)}</h2><p class="desc">${lv} 级</p></div></div>
        ${lv ? `<div class="stats"><div><span>增加${zh}</span>${U.fmt(got)}</div><div><span>修炼消耗灵气</span>${U.fmt(cl)}</div></div>${full ? "" : this.zfCostHtml(cu)}` : this.zfCostHtml(cu, "布阵消耗")}
        <div class="btns">${!lv ? `<button class="primary" onclick="G.zfTUp('${f.id}',${t})" ${this.zfCanPay(cu) ? "" : "disabled"}>布阵</button>` : `${full ? "" : `<button onclick="G.zfTUp('${f.id}',${t})" ${this.zfCanPay(cu) ? "" : "disabled"}>升级</button>`}<button class="primary" onclick="G.zfStart('${f.id}',${t})" ${busy || got >= cap || (s.ling < cl && !DATA.isTest()) ? "disabled" : ""}>${me ? "修炼中" : "修炼"}</button>`}<button onclick="G.closeModal()">关闭</button></div>`);
    },
  },
});

/* 洞府 · 阵法室：一页，主动、属性阵法每行 3 个；没学会的不显示 */
G.caveViews.formation = function () {
  const C = this.zfC(), MX = this.zfMax(), z = this.zfS(), now = this.now(), EN = id => (DATA.elById[id] || {}).name || id, A = C.ACT || {};
  const cell = (on, img, name, sub, val, cls) => `<div class="zf-cell${cls || ""}" onclick="${on}"><b class="zf-nm">${name}</b><img src="${img}" alt="">${sub}${val}</div>`;
  const act = (C.ACTIVE || []).filter(f => this.zfAOpen(f.id)).map(f => {
    const lv = this.zfALv(f.id), on = this.zfAOn(f.id);
    if (!lv) return cell(`G.openZfAct('${f.id}')`, this.zfImg(f.id), f.name, `<small>未布阵</small>`, "", " zf-off");
    return cell(`G.openZfAct('${f.id}')`, this.zfImg(f.id), f.name, `<small>${lv}级${on ? ` · <i class="c-green">运转</i>` : ""}</small>`, "", on ? " zf-on" : "");
  }).join("");
  const j = z.job, stat = [];
  for (const f of C.STAT || []) for (let t = 1; t <= this.zfTiers(); t++) {
    if (!this.zfTOpen(f.id, t)) continue;
    const lv = this.zfTLv(f.id, t), me = j && j.k === f.id && j.t === t && now < j.end;
    stat.push(!lv ? cell(`G.openZfStat('${f.id}',${t})`, this.zfImg(f.id), this.zfTName(f, t), `<small>未布阵</small>`, "", " zf-off")
      : cell(`G.openZfStat('${f.id}',${t})`, this.zfImg(f.id), this.zfTName(f, t), `<small>${lv}级${me ? " · 修炼中" : ""}</small>`, `<small class="zf-v">${this.zfStatZh(f.id)} ${U.fmt(this.zfTGot(f.id, t))}/${U.fmt(this.zfTCap(f.id, t))}</small>`, me ? " zf-on" : ""));
  }
  const tot = this.zfBonus(), totH = (C.STAT || []).filter(f => tot[f.id]).map(f => `<span>${this.zfStatZh(f.id)} ${U.fmt(tot[f.id])}</span>`).join("");
  const none = "";
  return `<div class="card"><h3>主动阵法</h3>${act ? `<div class="zf-grid">${act}</div>` : none}</div>
    <div class="card"><h3>属性阵法<small>灵气 ${U.fmt(this.s.ling)}</small></h3>${stat.length ? `<div class="zf-grid">${stat.join("")}</div>` : none}${totH ? `<div class="zf-tot">${totH}</div>` : ""}</div>`;
};
