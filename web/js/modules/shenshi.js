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
  defaults: () => ({ lsMax: CFG.shenshi.INIT, ssPow: 0 }),

  api: {
    // 养神：消耗养神丹，神识强度 +1
    ysNeed() { const Y = CFG.shenshi.YANGSHEN || {}; return Math.floor((Y.BASE || 1) + (Y.ADD || 0) * Math.floor((this.s.ssPow || 0) / (Y.EVERY || 10))); },
    yangshen() {
      const s = this.s, need = this.ysNeed();
      if (this.smCount("yd") < need) return this.log(`${DATA.smName("yd")}不足，需要 ${need} 枚。`, "sys");
      this.takeSm("yd", need); s.ssPow = (s.ssPow || 0) + 1;
      this._ysFx = Date.now();
      this.log(`养神成功，神识强度提升至 ${s.ssPow}${s.cqLearn ? `，每天可元婴出窍 ${s.ssPow} 次` : ""}。`, "good"); this.dirty(); this.after();
    },
    lsCap() { const C = CFG.shenshi, B = C.BUY || []; return B.length ? Math.max(C.INIT, B[B.length - 1][1]) : C.INIT; },   // 神识上限
    // 这本功法 / 秘法占用多少神识（不占用 = 0）
    ssCost(id) {
      const C = CFG.shenshi, g = DATA.skillInfo(id, 1); if (!g || !g.star) return 0;
      if (g.src === "yl") return 0;   // 游历功法不占灵识点
      const ok = g.kind === "mf" ? C.MIFA : g.kind === "gf" && (C.TYPES || []).includes(DATA.gfTypeKey(g.type.id));
      return ok ? ((C.STAR || [])[g.star - 1] || 0) : 0;
    },
    ssForgettable(id) { const g = DATA.skillInfo(id, 1); return !!g && g.kind === "gf" && g.src !== "yl" && (CFG.shenshi.TYPES || []).includes(DATA.gfTypeKey(g.type.id)); },
    lsUsed() {
      const s = this.s; let n = 0;
      for (const id in s.gongfa) n += this.ssCost(id);
      if (s.gfLearn && s.gfLearn.id && !s.gongfa[s.gfLearn.id]) n += this.ssCost(s.gfLearn.id);   // 正在学习的也算
      for (const x of (s.lq && s.lq.gf) || []) if (x.id && !s.gongfa[x.id]) n += this.ssCost(x.id);   // v173 排队的也算
      return n;
    },
    lsTotal() { return (this.s.lsMax || 0) + ((this.s.wd || {}).ls || 0) + (this.oriSum ? this.oriSum("ls") : 0); },   // + 出身「残魂附体」   // 总灵识点 = 买的 + 神魂之道得的
    lsLeft() { return this.lsTotal() - this.lsUsed(); },
    // 第 k 点神识要多少灵石（表里没有 = null，买不了）
    lsPrice(k) { for (const [a, b, p] of CFG.shenshi.BUY || []) if (k >= a && k <= b) return p; return null; },
    lsBuyCost(n) {
      let c = 0;
      for (let i = 1; i <= n; i++) { const p = this.lsPrice(this.s.lsMax + i); if (p === null) return null; c += p; }
      return c;
    },
    buyLingshi(n) {
      const s = this.s; n = Math.min(n, this.lsCap() - s.lsMax);
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
    openShenshi(on) { this.cultView = on ? "shenshi" : ""; this.render(); },
  },
});

/* 修炼 · 神识页面（cultivate.js 调用）：养神（人物动画 + 神识强度 + 养神丹 + 养神按钮）在上，灵识点在下 */
G.shenshiView = function () {
  const s = this.s, cap = this.lsCap(), used = this.lsUsed(), left = this.lsTotal() - used, room = cap - s.lsMax;
  const need = this.ysNeed(), have = this.smCount("yd"), fx = this._ysFx && Date.now() - this._ysFx < 1500 ? " fx" : "";
  const btn = n => { n = Math.min(n, room); const c = n > 0 ? this.lsBuyCost(n) : null;
    return `<button ${c === null || s.stone < c ? "disabled" : ""} onclick="G.buyLingshi(${n})">增加 ${n > 0 ? n : ""} 点${c !== null ? `<small>${U.fmt(c)} 灵石</small>` : ""}</button>`; };
  const next = room > 0 ? this.lsPrice(s.lsMax + 1) : null;
  const wisps = [8, 22, 36, 64, 78, 90, 15, 85].map((x, i) => `<i style="left:${x}%;animation-delay:${(i * 0.9).toFixed(1)}s"></i>`).join("");
  return `<div class="card ys-card">
    <div class="ys-stage${fx}"><div class="ys-pow"><span>神识强度</span><b>${U.fmt(s.ssPow || 0)}</b></div>
      <div class="ys-wisps">${wisps}</div><div class="ys-aura"></div>
      <img class="ys-hero" src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt=""></div>
    <div class="ys-need"><img src="${DATA.smIcon("yd")}" alt=""><b class="${have >= need ? "" : "q5"}">${U.fmt(have)}/${U.fmt(need)}</b></div>
    <div class="btns"><button class="primary" onclick="G.yangshen()" ${have >= need ? "" : "disabled"}>养神</button></div></div>
  <div class="card ls-card"><h3>灵识点</h3>
    <div class="stats"><div><span>剩余灵识点</span>${left < 0 ? `<b class="q5">${left}</b>` : left}</div><div><span>总灵识点</span>${this.lsTotal()}</div></div>
    <p class="desc" style="margin-top:6px">学会攻击、防御、修炼速度、肉身修炼速度类功法和宗门秘法会占用灵识点（1 星 1 点 … 10 星 10 点），灵识点不够不能学习；功法页「遗忘」可归还。已占用 ${used}。</p>
    <div class="row small" style="margin-top:6px"><span>下一点灵识点</span><span>${next === null ? "已达上限" : `${U.fmt(next)} 灵石`}</span></div>
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
