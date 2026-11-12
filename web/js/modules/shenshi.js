/* =====================================================================
 * 模块：神识（数值在 config/shenshi.js）
 * ---------------------------------------------------------------------
 * 修炼页「神识」按钮进入：上面养神（人物动画、神识强度、养神丹、养神按钮），下面灵识点。
 * 神识强度 ssPow：每养神一次 +1，每天可元婴出窍次数 = 神识强度（sect.js cqMaxRuns）。
 * 剩余灵识点 = lsMax（初始 + 用灵石买的）− 已学功法 / 秘法占用的（实时算，遗忘后归还）。
 * 功法页「遗忘」：删除攻击、防御、修炼速度、肉身修炼速度类功法。
 * 存档：lsMax 灵识点总数，ssPow 神识强度
 * ===================================================================== */
G.module({
  id: "shenshi",
  defaults: () => ({ lsMax: CFG.shenshi.INIT, ssPow: 0, ssGf: {} }),

  api: {
    // 养神：消耗养神丹，神识强度 +1
    ysNeed() { const Y = CFG.shenshi.YANGSHEN || {}, p = Math.max(0, (this.s.ssPow || 0) - (this.ssGfSum ? this.ssGfSum("pow") : 0)); return Math.floor((Y.BASE || 1) + (Y.ADD || 0) * Math.floor(p / (Y.EVERY || 10))); },   // 《凝神观想诀》加的神识强度不让养神丹变贵
    yangshen() {
      const s = this.s, need = this.ysNeed();
      if (this.smCount("yd") < need) return this.log(`${DATA.smName("yd")}不足，需要 ${need} 枚。`, "sys");
      this.takeSm("yd", need); s.ssPow = (s.ssPow || 0) + 1;
      this._ysFx = Date.now();
      this.log(`养神成功，神识强度提升至 ${s.ssPow}${s.cqLearn ? `，每天可元婴出窍 ${s.ssPow} 次` : ""}。`, "good"); this.dirty(); this.after();
    },
    lsCap() { const C = CFG.shenshi; return +C.BUY_MAX > 0 ? Math.max(C.INIT || 0, +C.BUY_MAX) : Infinity; },   // BUY_MAX 0 / 不写 = 不限   // 神识上限
    // 这本功法 / 秘法占用多少神识（不占用 = 0）
    ssCost(id) {
      const C = CFG.shenshi, g = DATA.skillInfo(id, 1); if (!g || !g.star) return 0;
      if (g.src === "yl") return 0;   // 游历功法不占灵识点；隐世宗门功法（ys）的功诀/心法/秘诀/炼体秘诀按 TYPES 占用（2026-11-06）
      if (g.sect && g.sect.src === "wdroom") return 0;   // 悟道室功法（战斗之道、修炼之道的秘诀/炼体秘诀）都不占灵识点（2026-11-06）
      const ok = g.kind === "mf" ? C.MIFA : g.kind === "gf" && (C.TYPES || []).includes(DATA.gfTypeKey(g.type.id));
      return ok ? ((C.STAR || [])[g.star - 1] || 0) : 0;
    },
    ssForgettable(id) { const g = DATA.skillInfo(id, 1); return !!g && g.kind === "gf" && g.src !== "yl" && g.src !== "ys" && !(g.sect && g.sect.src === "wdroom") && (CFG.shenshi.TYPES || []).includes(DATA.gfTypeKey(g.type.id)); },
    lsUsed() {
      const s = this.s; let n = 0;
      for (const id in s.gongfa) n += this.ssCost(id);
      if (s.gfLearn && s.gfLearn.id && !s.gongfa[s.gfLearn.id]) n += this.ssCost(s.gfLearn.id);   // 正在学习的也算
      for (const x of (s.lq && s.lq.gf) || []) if (x.id && !s.gongfa[x.id]) n += this.ssCost(x.id);   // v173 排队的也算
      return n;
    },
    lsTotal() { return (this.s.lsMax || 0) + ((this.s.wd || {}).ls || 0) + (this.oriSum ? this.oriSum("ls") : 0) + this.ssGfSum("ls"); },   // + 神识功法《灵台开识篇》   // + 出身「残魂附体」   // 总灵识点 = 买的 + 神魂之道得的
    lsLeft() { return this.lsTotal() - this.lsUsed(); },
    // 第 k 点神识要多少灵石（表里没有 = null，买不了）
    lsPrice(k) {   // BUY = [每阶段点数, 每阶段递增灵石]：第 n 阶段每点 n × 递增（兼容旧的 [[从, 到, 灵石], …] 写法）
      const C = CFG.shenshi, B = C.BUY || [], init = C.INIT || 0;
      if (Array.isArray(B[0])) { for (const [a, b, p] of B) if (k >= a && k <= b) return p; return null; }
      const n = +B[0] || 0, add = +B[1] || 0; if (!n || k <= init || k > this.lsCap()) return null;
      return (Math.floor((k - init - 1) / n) + 1) * add;
    },
    lsBuyCost(n) {
      let c = 0;
      for (let i = 1; i <= n; i++) { const p = this.lsPrice(this.s.lsMax + i); if (p === null) return null; c += p; }
      return c;
    },
    buyLingshi(n) {
      // 原来 n=0.5 时 lsBuyCost(0.5)=0（循环一次都不跑），却 lsMax += 0.5，白嫖灵识。
      const s = this.s; n = Math.min(Math.floor(+n), this.lsCap() - s.lsMax);
      if (!Number.isFinite(n)) return this.log("数量无效。", "sys");
      if (n <= 0) return this.log("灵识点已达上限。", "sys");
      const c = this.lsBuyCost(n);
      if (c === null) return this.log("灵识点已达上限。", "sys");
      if (s.stone < c) return this.log(`灵石不足，需要 ${U.fmt(c)} 灵石。`, "sys");
      s.stone -= c; s.lsMax += n;
      this.log(`消耗灵石 ${U.fmt(c)}，灵识点 +${n}（共 ${this.lsTotal()}）。`, "good"); this.dirty(); this.after();
    },
    // 学习前检查：神识不够就提示，返回 false
    lsCheck(id) {
      if (DATA.isTest()) return true;   // 测试模式不占灵识
      const need = this.ssCost(id), left = this.lsLeft();
      if (need > 0 && left < need) { this.log(`灵识点不足（需要 ${need}，剩余 ${Math.max(0, left)}），可在「修炼 → 神识」用灵石增加，或在功法页遗忘功法。`, "bad"); return false; }
      return true;
    },
    // 遗忘：删除功法（层数、属性一起删），从修炼队列里去掉，神识归还
    forgetGongfa(id) {
      const s = this.s, g = DATA.skillInfo(id, s.gongfa[id]);
      if (!g || !s.gongfa[id] || !this.ssForgettable(id)) return;
      if (!confirm(`遗忘《${g.name}》？\n第 ${g.lv} 层和加的${g.label}全部删除，归还灵识点 ${this.ssCost(id)}。`)) return;
      delete s.gongfa[id];
      s.gfQueue = s.gfQueue.filter(x => x !== id);
      if (s.gfStudy && s.gfStudy.id === id) { s.gfStudy = null; this.nextStudy(); }
      this.log(`遗忘了《${g.name}》，归还灵识点 ${this.ssCost(id)}。`, "sys");
      this.dirty(); this.after();
    },
    // ===== 神识功法（config/shenshi.js GONGFA）：s.ssGf = { id: 层数 } =====
    ssGfDef(id) { return (CFG.shenshi.GONGFA || []).find(g => g.id === id); },
    ssGfLv(id) { const v = ((this.s.ssGf || {})[id]) | 0, g = this.ssGfDef(id); return Math.max(0, g ? Math.min(v, g.MAX || 0) : v); },   // 配置把 MAX 改小时按新上限算
    // 修到 lv 层的合计效果：STEPS 每段 [层数, 每层值]，超出部分按最后一段
    //   写了 FIRST / TOTAL（不写 STEPS）：第 1 层 FIRST，每层平均递增，MAX 层合计 TOTAL；合计按层取整
    ssGfVal(g, lv) { if (!g.STEPS && g.FIRST !== undefined && g.TOTAL !== undefined) { const M = g.MAX || 1, a = +g.FIRST || 0, d = M > 1 ? 2 * ((+g.TOTAL || 0) - M * a) / (M * (M - 1)) : 0, k = Math.max(0, Math.min(lv, M)); return Math.round(k * a + d * k * (k - 1) / 2); }
      const S = g.STEPS || [[g.MAX || 0, g.PER || 0]]; let n = 0, left = lv;
      for (let i = 0; i < S.length && left > 0; i++) { const k = i === S.length - 1 ? left : Math.min(left, S[i][0] || 0); n += k * (S[i][1] || 0); left -= k; } return n; },
    ssGfSum(key) { let n = 0; for (const g of CFG.shenshi.GONGFA || []) if (g.key === key) n += this.ssGfVal(g, this.ssGfLv(g.id)); return n; },   // 某种效果合计
    // 《敛息归元诀》：每 10 秒合计只减一次（用户定）——功法修炼（含秘法、法术）先用，剩下的给修为修炼，再剩下给肉身修炼
    //   返回 { gf, exp, body } 各自分到的减少量（点 / 10 秒）；每项最多减到 0，不会多减
    lxShare() {
      const s = this.s, out = { gf: 0, exp: 0, body: 0 }; let left = this.ssGfSum("ling");
      if (left <= 0) return out;
      const st = s.gfStudy;
      if (st && st.done < st.total && !st.stalled) { const R = this.gfRoomNow ? this.gfRoomNow(DATA.skillInfo(st.id, s.gongfa[st.id] || 1)) : null; out.gf = Math.min(left, Math.max(0, (st.per || 0) * (R ? R.mul : 1) * 2)); left -= out.gf; }   // 停滞时功法基本不耗灵气，减免不给它、往下传给修为 / 肉身
      const blk = this.exBlocksCult ? this.exBlocksCult() : false;
      if (left > 0 && s.auto && this.hasMijue && this.hasMijue() && !blk) { out.exp = Math.min(left, Math.max(0, this.speed().total - this.wdRedRaw("exp"))); left -= out.exp; }
      if (left > 0 && s.bodyAuto && this.hasTijue && this.hasTijue() && !blk && !this.bodyMax()) out.body = Math.min(left, Math.max(0, this.bodySpeed().total * Math.max(0.0001, CFG.body.LING_RATE || 1) - this.wdRedRaw("body")));
      return out;
    },
    // 功法修炼每 5 秒单位灵气（减少量按每 10 秒的数字，单位是一半）；alone=true：列表里单独估算（整份减少量都给它）
    ssGfPer(per, alone) { return Math.max(0, per - (alone ? this.ssGfSum("ling") : this.lxShare().gf) / 2); },   // 功法修炼每 5 秒单位灵气（《敛息归元诀》按每 10 秒的数字减，单位是一半）
    // 第 k 层的消耗（没写 = 不要）：stone 灵石，sm 专用材料 [[键, 数量]]（养神丹 yd、元魂果 yhg、凝魂芝 nhz）
    ssGfCost(k) {
      const mk = (st, yd, yhg, nhz) => ({ stone: Math.max(0, st || 0), sm: [["yd", yd], ["yhg", yhg], ["nhz", nhz]].filter(x => x[1] > 0) });
      const T = CFG.shenshi.GF_COST || [];
      if (T.length) { for (const [a, b, st, yd, yhg, nhz] of T) if (k >= a && k <= b) return mk(st, yd, yhg, nhz); return mk(0); }
      const C = CFG.shenshi.COST || {}, f = (b, d) => (b || 0) + (d || 0) * (k - 1), h = f(C.HERB, C.HERB_ADD);
      return mk(f(C.STONE, C.STONE_ADD), f(C.YD, C.YD_ADD), h, h);
    },
    // 神识功法药材掉落（CFG.shenshi.HERB_DROP）：普通地图探索结算时几率 1 颗，秘境结算时必掉若干；直接进 loot，不乘收益倍率
    rollSsHerb(x) {
      const H = CFG.shenshi.HERB_DROP, L = x.loot; if (!H || !(H.ITEMS || []).length || x.once || x.mk) return;
      let n = 0;
      if (x.mj === undefined) { if (DATA.mapReq(x.map) >= (H.REALM ?? 3) && Math.random() * 100 < (H.MAP_PCT || 0)) n = 1; }
      else { const d = this.mjDef(x.mj); if (d && (d.realm || 0) >= (H.REALM ?? 3)) n = U.rand((H.MJ || [0, 0])[0], (H.MJ || [0, 0])[1]); }
      if (n <= 0) return;
      L.sm = L.sm || {}; for (let i = 0; i < n; i++) { const k = U.pick(H.ITEMS); L.sm[k] = (L.sm[k] || 0) + 1; }
    },
    ssGfEff(g, lv) { const v = this.ssGfVal(g, lv); return g.key === "pow" ? `神识强度 +${v}` : g.key === "cq" ? `元婴出窍收益 +${v}%` : g.key === "ls" ? `灵识点 +${v}` : g.key === "ling" ? `灵气消耗每 10 秒 −${U.fmt(v)}` : g.key === "gf" ? `功法修炼时间 −${v}%` : `法术修炼时间 −${v}%`; },
    ssGfUp(id) {
      const s = this.s, g = this.ssGfDef(String(id)); if (!g) return;
      const lv = this.ssGfLv(g.id); if (lv >= g.MAX) return this.log(`《${g.name}》已修炼圆满。`, "sys");
      if ((s.ssPow || 0) < (g.UNLOCK || 0) && !DATA.isTest()) return this.log(`神识强度达到 ${g.UNLOCK} 才能修炼《${g.name}》。`, "sys");
      const c = DATA.isTest() ? { stone: 0, sm: [] } : this.ssGfCost(lv + 1);
      if (s.stone < c.stone) return this.log(`灵石不足，需要 ${U.fmt(c.stone)}。`, "sys");
      for (const [k, n] of c.sm) if (this.smCount(k) < n) return this.log(`${DATA.smName(k)}不足，需要 ${n}。`, "sys");
      s.stone -= c.stone; for (const [k, n] of c.sm) this.takeSm(k, n);
      s.ssGf = s.ssGf || {}; s.ssGf[g.id] = lv + 1;
      const add = this.ssGfVal(g, lv + 1) - this.ssGfVal(g, lv);
      if (g.key === "pow") s.ssPow = (s.ssPow || 0) + add;   // 神识强度直接加进 ssPow（和悟道室神魂之道一样）
      this._ysFx = Date.now();
      this.log(`《${g.name}》修炼至第 ${lv + 1} 层，神识功法效果累计 ${this.ssGfEff(g, lv + 1)}。`, "gold"); this.dirty(); this.after();
    },
    openSsGf(id) {
      const g = this.ssGfDef(id); if (!g) return;
      const s = this.s, lv = this.ssGfLv(g.id), full = lv >= g.MAX, c = this.ssGfCost(lv + 1), lock = (s.ssPow || 0) < (g.UNLOCK || 0) && !DATA.isTest();
      // 消耗：和养神丹一样的图标格（图 + 拥有/需要），灵石也一格
      const cell = (img, have, need, nm) => `<div class="ys-need" title="${nm}"><img src="${img}" alt="${nm}"><b class="${have >= need ? "" : "q5"}">${U.fmt(have)}/${U.fmt(need)}</b></div>`;
      const cost = [c.stone ? cell(DATA.iconImg("stone"), s.stone, c.stone, "灵石") : "", ...c.sm.map(([k, n]) => cell(DATA.smIcon(k), this.smCount(k), n, DATA.smName(k)))].join("");
      const ok = !full && !lock && s.stone >= c.stone && c.sm.every(([k, n]) => this.smCount(k) >= n);
      this.modal(`<h2>《${g.name}》</h2><p class="desc">${g.desc}</p>
        <div class="stats"><div><span>层数</span>${lv} / ${g.MAX}</div><div><span>当前效果</span>${lv ? this.ssGfEff(g, lv) : "无"}</div></div>
        ${full ? `<p class="desc">已修炼圆满。</p>` : `<div class="row small"><span>下一层</span><span>${this.ssGfEff(g, lv + 1)}</span></div>
        ${cost ? `<div class="ssgf-cost">${cost}</div>` : ""}${lock ? `<p class="desc q5">神识强度达到 ${g.UNLOCK} 才能修炼。</p>` : ""}`}
        <div class="btns">${full ? "" : `<button class="primary" onclick="G.ssGfUp('${g.id}')" ${ok ? "" : "disabled"}>修炼</button>`}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    openShenshi(on) { this.cultView = on ? "shenshi" : ""; this.render(); },
  },
});

/* 修炼 · 神识页面（cultivate.js 调用）：养神（人物动画 + 神识强度 + 养神丹 + 养神按钮）在上，灵识点在下 */
G.shenshiView = function () {
  const s = this.s, cap = this.lsCap(), used = this.lsUsed(), left = this.lsTotal() - used, room = cap - s.lsMax;
  const need = this.ysNeed(), have = this.smCount("yd"), fx = this._ysFx && Date.now() - this._ysFx < 1500 ? " fx" : "";
  const btn = n => { n = Math.min(n, room); const c = n > 0 ? this.lsBuyCost(n) : null;
    return `<button ${c === null || s.stone < c ? "disabled" : ""} onclick="G.buyLingshi(${n})">增加 ${n > 0 ? n : ""} 点${c !== null ? `<small>${U.fmt(c)} 灵石</small>` : ""}</button>`; };
  // 神识功法光点：贴着人物，两侧从头到胸各 3 个（左 0~2，右 3~5）；坐标是人物图内的 %，跟人物一起浮动；名字、层数点开才显示
  const POS = [[30, 6], [25, 20], [22, 34], [70, 6], [75, 20], [78, 34]];
  const dots = (CFG.shenshi.GONGFA || []).slice(0, 6).map((g, i) => { const [x, y] = POS[i];
    return `<button class="ys-dot" style="left:${x}%;top:${y}%;animation-delay:${(i * 0.4).toFixed(1)}s" onclick="G.openSsGf('${g.id}')" aria-label="${g.name}"><i></i></button>`; }).join("");
  const wisps = [8, 22, 36, 64, 78, 90, 15, 85].map((x, i) => `<i style="left:${x}%;animation-delay:${(i * 0.9).toFixed(1)}s"></i>`).join("");
  return `<div class="card ys-card">
    <div class="ys-stage${fx}"><div class="ys-pow"><span>神识强度</span><b>${U.fmt(s.ssPow || 0)}</b></div>
      <div class="ys-wisps">${wisps}</div><div class="ys-aura"></div>
      <div class="ys-hbox"><img class="ys-hero" src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt=""><div class="ys-dots">${dots}</div></div></div>
    <div class="ys-need"><img src="${DATA.smIcon("yd")}" alt=""><b class="${have >= need ? "" : "q5"}">${U.fmt(have)}/${U.fmt(need)}</b></div>
    <div class="btns"><button class="primary" onclick="G.yangshen()" ${have >= need ? "" : "disabled"}>养神</button></div></div>
  <div class="card ls-card"><h3>灵识点</h3>
    <div class="stats"><div><span>剩余灵识点</span>${left < 0 ? `<b class="q5">${left}</b>` : left}</div><div><span>总灵识点</span>${this.lsTotal()}</div></div>
    <p class="desc" style="margin-top:6px">学会攻击、防御、修炼速度、肉身修炼速度类功法和宗门秘法会占用灵识点（1 星 1 点 … 10 星 10 点），灵识点不够不能学习；功法页「遗忘」可归还。已占用 ${used}。</p>
    <div class="btns">${room > 0 ? btn(1) + (room > 1 ? btn(10) : "") : `<button disabled>灵识点已达上限</button>`}
      <button onclick="G.openShenshi(false)">返回修炼</button></div></div>`;
};

/* 功法页 · 遗忘（gongfa.js 调用） */
G.forgetView = function () {
  const s = this.s, list = Object.keys(s.gongfa).filter(id => this.ssForgettable(id)).map(id => DATA.skillInfo(id, s.gongfa[id])).filter(Boolean);
  const line = g => `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》${g.star ? `<span class="tag">${g.star}星</span>` : ""}<span class="tag gf-lv">第${g.lv}层</span>
      <small>${g.label} +${this.gfValue(g, g.value)} · 占用灵识点 ${this.ssCost(g.id)}</small></div><button class="sm" onclick="G.forgetGongfa('${g.id}')">遗忘</button></div>`;
  // 和功法页一样按类别分卡片显示
  const cards = DATA.gongfaTypes.filter(t => !t.base).map(t => {
    const items = list.filter(g => (g.type.base || g.type.id) === t.id).sort((a, b) => b.star - a.star || b.lv - a.lv);
    return items.length ? `<div class="card"><h3>${t.name}<small>${t.label}</small></h3>${items.map(line).join("")}</div>` : "";
  }).join("");
  return `<div class="card"><h3>遗忘<small>剩余灵识点 ${this.lsLeft()} / ${this.lsTotal()}</small></h3>
    <p class="desc">攻击、防御、修炼速度、肉身修炼速度类功法可以遗忘。遗忘后功法删除，层数和加的属性一起删除，占用的灵识点归还。</p>
    ${list.length ? "" : `<p class="desc">没有可以遗忘的功法。</p>`}</div>${cards}`;
};
