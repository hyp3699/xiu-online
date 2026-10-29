/* =====================================================================
 * 模块：经脉（数值在 config/jingmai.js）
 * ---------------------------------------------------------------------
 * 修炼页人物身前光球进入：人体上 6 条主脉 × 6 个光点；点光点进入光点页，10 个穴位各 10 层，加生命 法力 攻击 防御 六系抗性
 * （craft.js danBonus 里加 jmBonus）。
 * 存档：jmv[光点序号 × 10 + 穴位序号] = 层数；灵液 lingye；冲脉丹是秘境专用材料 cmd（bag.js smCount）
 * ===================================================================== */
G.module({
  id: "jingmai",
  defaults: () => ({ jmv: [], lingye: 0 }),

  api: {
    jmList() { return (CFG.jingmai || {}).LIST || []; },
    jmLy() { return Math.max(1, +(CFG.jingmai || {}).LAYERS || 1); },
    jmNodes() { const r = []; this.jmList().forEach((m, i) => (m.nodes || []).forEach((n, j) => r.push({ m, i, j, n }))); return r; },   // 36 个光点
    jmXN() { return 10; },   // 每个光点 10 个穴位（LIST 的 xue）
    jmXue(node, x) { const d = this.jmNodes()[node], X = d && (d.n.xue || [])[x]; return Array.isArray(X) ? X : [X || "", ""]; },   // [穴位名, 属性]
    jmGet(node, x) { return Math.max(0, Math.min(this.jmLy(), +((this.s.jmv || [])[node * this.jmXN() + x]) || 0)); },
    jmCur(node) { const n = this.jmXN(), ly = this.jmLy(); for (let x = 0; x < n; x++) if (this.jmGet(node, x) < ly) return x; return n; },   // 正在冲的穴位
    jmDone() { return (this.s.jmv || []).reduce((t, v) => t + (+v || 0), 0); },   // 总共已冲层数
    jmStarted(node) { for (let x = 0; x < this.jmXN(); x++) if (this.jmGet(node, x)) return true; return false; },
    jmUsed() { let c = 0; const N = this.jmNodes().length; for (let i = 0; i < N; i++) if (this.jmStarted(i)) c++; return c; },
    jmReq(node) { const d = this.jmNodes()[node], a = d && d.m.realm; return Array.isArray(a) && a[d.j] !== undefined ? +a[d.j] : -1; },   // 开启需要的境界，-1 = 不限
    jmCutOf(node) { const d = this.jmNodes()[node], a = d && d.m.gfCut; return Array.isArray(a) ? +a[d.j] || 0 : +a || 0; },   // 冲满后功法修炼时间 −%
    jmGfCut() { const N = this.jmNodes().length; let t = 0; for (let i = 0; i < N; i++) if (this.jmCur(i) >= this.jmXN()) t += this.jmCutOf(i); return t; },   // 已冲满光点合计
    jmElOf(node, key) { const d = this.jmNodes()[node], a = d && d.m[key], e = Array.isArray(a) ? a[d.j] : null; return Array.isArray(e) && e[0] ? [e[0], +e[1] || 0] : null; },   // [属性, %]
    jmEl(key) { const r = {}, N = this.jmNodes().length; for (let i = 0; i < N; i++) { const e = this.jmElOf(i, key); if (e && this.jmCur(i) >= this.jmXN()) r[e[0]] = (r[e[0]] || 0) + e[1]; } return r; },
    jmElDmg(el) { return el ? this.jmEl("elDmg")[el] || 0 : 0; },   // 自己该系属性伤害 +%
    jmElCut(el) { return el ? Math.min(100, this.jmEl("elCut")[el] || 0) : 0; },   // 受到该系属性伤害 −%
    jmCap() { const C = CFG.jingmai || {}, r = this.s.mortal ? -1 : this.r(), st = +C.UNLOCK_REALM || 0; return r < st ? 0 : (r - st + 1) * (+C.UNLOCK_PER || 0); },   // 当前境界可开几个光点
    // 每种属性 36 个光点合计：STAT_TOTAL 或 宗门功法 TOTAL × STAT_PCT%（六系抗性按 res）
    jmStatTotal(k) { const C = CFG.jingmai || {}, T = C.STAT_TOTAL || {}; if (T[k] !== undefined) return +T[k] || 0;
      const G = ((CFG.gongfa || {}).sect || {}).TOTAL || {}; const r = k.startsWith("res_"); return (+G[r ? "res" : k] || 0) / (r ? 6 : 1) * (+C.STAT_PCT || 0) / 100; },   // 功法 res 是六系合计，每系 ÷ 6
    jmW(node) { const N = this.jmNodes().length, R = Math.max(1, +(CFG.jingmai || {}).NODE_RATIO || 1); return Math.pow(R, N > 1 ? node / (N - 1) : 0); },
    jmWSum() { const N = this.jmNodes().length; let t = 0; for (let i = 0; i < N; i++) t += this.jmW(i); return t || 1; },
    jmVal(node, x) { const k = this.jmXue(node, x)[1]; if (!k) return 0; return Math.max(1, Math.round(this.jmStatTotal(k) * this.jmW(node) / this.jmWSum() / this.jmLy())); },   // 每层加多少
    jmStatName(k) { return k === "hp" ? "生命" : (DATA.MOB_RAND_ZH[k] || k).replace("抗性", "抗"); },
    jmBonus() { const b = {}, N = this.jmNodes().length;
      for (let i = 0; i < N; i++) for (let x = 0; x < this.jmXN(); x++) { const lv = this.jmGet(i, x); if (lv) { const k = this.jmXue(i, x)[1]; if (k) b[k] = (b[k] || 0) + lv * this.jmVal(i, x); } }
      return b; },
    // 穴位冲满额外：修炼速度、练体速度各随机 FULL_MIN~FULL_MAX，平均 FULL_AVG（三角分布）
    jmRollFull() { const C = CFG.jingmai || {}, a = +C.FULL_MIN || 0, b = Math.max(a, +C.FULL_MAX || 0), avg = +C.FULL_AVG || (a + b) / 2;
      if (b <= a) return Math.round(a); const m = Math.max(a, Math.min(b, 3 * avg - a - b)), u = Math.random(), f = (m - a) / (b - a);
      return Math.round(u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m))); },
    jmFull() { const X = this.s.jmx || {}, r = { cult: 0, body: 0 }; for (const k in X) { const v = X[k] || []; r.cult += +v[0] || 0; r.body += +v[1] || 0; } return r; },
    jmDan(n) { const C = CFG.jingmai || {}; n = n === undefined ? this.jmDone() : n; return Math.min(+C.DAN_MAX || 1, (+C.DAN_MIN || 0) + Math.floor(n / Math.max(1, +C.DAN_STEP || 1))); },
    jmLyNeed(n) { const C = CFG.jingmai || {}, a = +C.LY_FIRST || 0, z = +C.LY_LAST || 0, N = this.jmNodes().length * this.jmXN() * this.jmLy(); n = n === undefined ? this.jmDone() : n;
      if (N <= 1 || a <= 0 || z <= 0) return Math.round(a); return Math.round(a * Math.pow(z / a, Math.min(1, n / (N - 1)))); },
    // 冲穴：光点 node 的第 x 个穴位冲一层（只能冲当前那个）
    jmOpen(node, x) {
      const s = this.s, d = this.jmNodes()[node]; if (!d) return;
      const ly = this.jmLy(), cur = this.jmCur(node), nm = this.jmXue(node, x)[0];
      if (cur >= this.jmXN()) return this.log(`${d.n.name}已全部冲满。`, "sys");
      if (x !== cur) return this.log(x < cur ? `「${nm}」已冲满 ${ly} 层。` : `需先冲满「${this.jmXue(node, cur)[0]}」。`, "sys");
      const rq = this.jmReq(node);
      if (!this.jmStarted(node) && rq >= 0 && (this.s.mortal ? -1 : this.r()) < rq) return this.log(`${d.n.name}需要${DATA.realmLabel(rq)}才能开启。`, "sys");
      if (!this.jmStarted(node) && this.jmUsed() >= this.jmCap()) { const C = CFG.jingmai || {};
        return this.log(this.jmCap() ? `当前境界最多开启 ${this.jmCap()} 个光点，突破后可再开 ${+C.UNLOCK_PER || 0} 个。` : `${DATA.realmLabel(+C.UNLOCK_REALM || 0)}才能开启。`, "sys"); }
      const dan = this.jmDan(), lq = this.jmLyNeed();
      if (this.smCount("cmd") < dan) return this.log(`${DATA.smName("cmd")}不足，这一层需要 ${dan} 颗。`, "sys");
      if ((s.lingye || 0) < lq) return this.log(`灵液不足，这一层需要 ${U.fmt(lq)} 灵液。`, "sys");
      if (dan) this.takeSm("cmd", dan); s.lingye = (s.lingye || 0) - lq;
      if (!Array.isArray(s.jmv)) s.jmv = []; const k = node * this.jmXN() + x; s.jmv[k] = (+s.jmv[k] || 0) + 1; this._jmFx = Date.now();
      let ex = "";
      if (s.jmv[k] >= ly) { const c = this.jmRollFull(), b = this.jmRollFull(); (s.jmx = s.jmx || {})[k] = [c, b]; ex = `，额外修炼速度 +${U.fmt(c)}、练体速度 +${U.fmt(b)}`; }
      this.log(`「${nm}」冲至第 ${s.jmv[k]} 层${ex}。`, s.jmv[k] >= ly ? "gold" : "good");
      this.dirty(); this.after();
    },
    // 灵液兑换：药材 → 灵液；n = -1 全部（只有 -1 是哨兵，-999、-0.5 都不再算全部）
    jmSwap(name, n) {
      const r = +((CFG.jingmai || {}).LY_RATE || {})[name] || 0, m = DATA.matByName[name];
      if (!r || !m || m.kind !== "herb") return this.log("这种药材不能兑换灵液。", "sys");
      const have = this.countMat("herb", m.g); n = n === -1 ? have : Math.min(Math.floor(+n || 0), have);
      if (n <= 0) return this.log(`${name}不足。`, "sys");
      this.takeMat("herb", m.g, n); this.s.lingye = (this.s.lingye || 0) + n * r;
      this.log(`${name} ×${U.fmt(n)} 兑换灵液 ${U.fmt(n * r)}。`, "good"); this.dirty(); this.after();
      if (this._jmSwapOn) this.openJmSwap();
    },
    openJmSwap() {
      const R = (CFG.jingmai || {}).LY_RATE || {}; this._jmSwapOn = true;
      const rows = Object.keys(R).filter(n => DATA.matByName[n] && DATA.matByName[n].kind === "herb").map(n => { const g = DATA.matByName[n].g, h = this.countMat("herb", g);
        return `<div class="line${h ? "" : " dimrow"}"><div>${n}<small>拥有 ${U.fmt(h)} · 每个 ${R[n]} 灵液</small></div><div>${(CFG.jingmai.SWAP_N || [1, 100, 1000]).map(k => `<button class="sm" onclick="G.jmSwap('${n}',${k})" ${h ? "" : "disabled"}>${U.fmt(k)}</button>`).join(" ")}</div></div>`; });
      this.modal(`<h2>灵液兑换</h2><p class="desc" style="text-align:center">当前灵液 <b>${U.fmt(this.s.lingye || 0)}</b></p><div class="runlist">${rows.join("")}</div>
        <div class="btns"><button onclick="G._jmSwapOn=false;G.closeModal()">关闭</button></div>`);
    },
    openJingmai(on) { this.cultView = on ? "jingmai" : ""; this.jmNode = null; this.render(); },
    openJmNode(i) { this.jmNode = i === null || i === undefined ? null : i; this.render(); },
  },
});

const JM_DEFS = `<defs><filter id="jmGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const JM_IMG = `<image href="img/jm_body.webp?v=4" x="0" y="-132" width="400" height="800"/>`;

/* 修炼 · 经脉页面：人体 + 6 条主脉 36 个光点；点光点进光点页 */
G.jingmaiView = function () {
  if (this.jmNode !== null && this.jmNode !== undefined && this.jmNodes()[this.jmNode]) return this.jmNodeView(this.jmNode);
  const ly = this.jmLy(), xn = this.jmXN(), lines = [], dots = []; let k = 0;
  this.jmList().forEach(m => { const N = m.nodes || [];
    N.forEach((n, j) => { const id = k++; let sum = 0; for (let x = 0; x < xn; x++) sum += this.jmGet(id, x);
      const f = sum / (xn * ly), on = sum > 0;
      if (j > 0) { const q = N[j - 1]; lines.push(`<line x1="${q.x}" y1="${q.y}" x2="${n.x}" y2="${n.y}" stroke="${m.color}" stroke-opacity="0.5" stroke-width="1.6" filter="url(#jmGlow)"/>`); }
      dots.push(`<g class="jm-pt" onclick="G.openJmNode(${id})"><circle cx="${n.x}" cy="${n.y}" r="12" fill="transparent"/>
        <circle cx="${n.x}" cy="${n.y}" r="${4.5 + f * 1.5}" fill="${on ? m.color : "#2a2018"}" fill-opacity="${on ? 0.55 + f * 0.45 : 0.9}" stroke="${m.color}" stroke-width="1.4" filter="url(#jmGlow)"/></g>`); }); });
  return `<div class="jm-card"><div class="jm-stage"><svg viewBox="25 -50 350 700" preserveAspectRatio="xMidYMid slice" class="jm-svg">${JM_DEFS}${JM_IMG}<g>${lines.join("")}</g><g>${dots.join("")}</g></svg>
    <button class="sm jm-swap" onclick="G.openJmSwap()">灵液兑换</button>
    ${this.jmCostBar()}</div>
    ${this.jmSumTxt()}
    <div class="btns jm-btns"><button onclick="G.openJingmai(false)">返回</button></div></div>`;
};

/* 修炼页身前光球里的小经脉人体（冲过的光点亮起） */
G.jmMini = function () {
  const xn = this.jmXN(), ly = this.jmLy(), L = [], D = []; let k = 0;
  this.jmList().forEach(m => { const N = m.nodes || []; N.forEach((n, j) => { const id = k++; let sum = 0; for (let x = 0; x < xn; x++) sum += this.jmGet(id, x);
    if (j > 0) L.push(`<line x1="${N[j - 1].x}" y1="${N[j - 1].y}" x2="${n.x}" y2="${n.y}" stroke="${m.color}" stroke-width="4" stroke-opacity=".7"/>`);
    D.push(`<circle cx="${n.x}" cy="${n.y}" r="9" fill="${sum ? m.color : "#fff3c8"}" fill-opacity="${sum ? 1 : .55}"/>`); }); });
  return `<svg class="cult-jm" viewBox="20 20 360 430" preserveAspectRatio="xMidYMid meet">${JM_IMG}${L.join("")}${D.join("")}</svg>`;
};

G.jmCostBar = function () {
  const dan = this.jmDan(), lq = this.jmLyNeed(), hd = this.smCount("cmd"), hl = this.s.lingye || 0;
  return `<div class="jm-cost"><span><img src="${DATA.smIcon("cmd")}" alt="">${DATA.smName("cmd")} <b class="${hd >= dan ? "" : "q5"}">${U.fmt(hd)}/${dan}</b></span><span><img src="${DATA.iconImg("sm_lingye")}" alt="">灵液 <b class="${hl >= lq ? "" : "q5"}">${U.fmt(hl)}/${U.fmt(lq)}</b></span></div>`;
};

G.jmSumTxt = function () {
  const en = id => (DATA.elById[id] || {}).name || id, t = [], c = this.jmGfCut(), d = this.jmEl("elDmg"), r = this.jmEl("elCut");
  if (c) t.push(`功法修炼时间 -${U.num(c)}%`);
  for (const k in d) t.push(`${en(k)}伤害 +${U.num(d[k])}%`);
  for (const k in r) t.push(`受${en(k)}伤害 -${U.num(Math.min(100, r[k]))}%`);
  return t.length ? `<p class="desc jm-info" style="text-align:center">经脉：${t.join(" · ")}</p>` : "";
};

G.jmNodeInfo = function (node) {
  const rq = this.jmReq(node), cut = this.jmCutOf(node), full = this.jmCur(node) >= this.jmXN(), r = this.s.mortal ? -1 : this.r(), t = [];
  if (rq >= 0) t.push(`开启需要 <b class="${r >= rq || this.jmStarted(node) ? "" : "q5"}">${DATA.realmLabel(rq)}</b>`);
  if (cut) t.push(`全部冲满：功法修炼时间 -${U.num(cut)}%${full ? "（已生效）" : ""}`);
  const en = id => (DATA.elById[id] || {}).name || id, ed = this.jmElOf(node, "elDmg"), ec = this.jmElOf(node, "elCut");
  if (ed) t.push(`全部冲满：${en(ed[0])}属性伤害 +${U.num(ed[1])}%${full ? "（已生效）" : ""}`);
  if (ec) t.push(`全部冲满：受到${en(ec[0])}属性伤害 -${U.num(ec[1])}%${full ? "（已生效）" : ""}`);
  return t.length ? `<p class="desc jm-info" style="text-align:center">${t.join(" · ")}</p>` : "";
};

/* 光点页：10 个穴位围成一圈，点穴位冲穴（不显示每个穴位加什么属性） */
G.jmNodeView = function (node) {
  const d = this.jmNodes()[node], ly = this.jmLy(), xn = this.jmXN(), cur = this.jmCur(node), col = d.m.color;
  const pts = []; for (let x = 0; x < xn; x++) { const a = -Math.PI / 2 + x * 2 * Math.PI / xn; pts.push([200 + 140 * Math.cos(a), 200 + 140 * Math.sin(a)]); }
  const lines = [], dots = [];
  for (let x = 0; x < xn; x++) { const [px, py] = pts[x], nm = this.jmXue(node, x)[0], lv = this.jmGet(node, x), on = lv >= ly, nx = x === cur;
    if (x > 0) { const [qx, qy] = pts[x - 1], lit = this.jmGet(node, x - 1) >= ly && lv > 0;
      lines.push(`<line x1="${qx}" y1="${qy}" x2="${px}" y2="${py}" stroke="${lit ? col : "#c8a878"}" stroke-opacity="${lit ? 1 : 0.25}" stroke-width="${lit ? 3 : 1.5}"${lit ? ` filter="url(#jmGlow)"` : ""}/>`); }
    dots.push(`<g class="jm-pt${nx ? " nx" : ""}" onclick="G.jmOpen(${node},${x})"><circle cx="${px}" cy="${py}" r="26" fill="transparent"/>
      <circle cx="${px}" cy="${py}" r="${nx ? 13 : 11}" fill="${on || lv ? col : "#3a3028"}" fill-opacity="${on ? 1 : lv ? 0.4 + lv / ly * 0.5 : 1}" stroke="${on || nx ? "#fff" : "#a89070"}" stroke-width="${nx ? 2 : 1.2}"${on || nx || lv ? ` filter="url(#jmGlow)"` : ""}/>
      <text x="${px}" y="${py + 30}" class="jm-xn">${nm}</text><text x="${px}" y="${py + 46}" class="jm-xs">${lv}/${ly}</text></g>`); }
  return `<div class="jm-card"><div class="jm-stage${this._jmFx && Date.now() - this._jmFx < 1000 ? " fx" : ""}">
    <svg viewBox="-10 20 420 420" preserveAspectRatio="xMidYMid meet" class="jm-svg">${JM_DEFS}
      <circle cx="200" cy="215" r="70" fill="${col}" fill-opacity="0.12" filter="url(#jmGlow)"/><text x="200" y="210" class="jm-cn">${d.n.name}</text><text x="200" y="236" class="jm-xs">${d.m.name}</text>
      <g transform="translate(0,15)">${lines.join("")}${dots.join("")}</g></svg>
    <div class="ys-pow"><span>${d.m.name}</span><b>${d.n.name}</b></div>
    <button class="sm jm-swap" onclick="G.openJmSwap()">灵液兑换</button>
    ${this.jmCostBar()}</div>
    ${this.jmNodeInfo(node)}
    <div class="btns jm-btns"><button onclick="G.openJmNode(null)">返回</button></div></div>`;
};
