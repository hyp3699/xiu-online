/* =====================================================================
 * 模块：洞府 · 悟道室（数值在 config/wudaoshi.js）
 * ---------------------------------------------------------------------
 * 修炼之道：每天一次，消耗悟道果，得修为（当前境界升级需要的 2%~5%），按阶段给悟道秘诀（进背包）。
 * 神魂之道：每天一次，消耗悟道果，按阶段给神识强度，永久减修炼灵气消耗（wd.red），阶段最后一次给灵识点（wd.ls）。
 * 战斗之道：暂未开放。
 * 悟道秘诀 id "wd阶段_序号:mijue|tijue"（序号 0~9），来源在 DATA.wdSrc 现算。
 * 存档：wd = { n: { 道id: 已悟道次数 }, day: { 道id: 上次悟道的日期 }, red: { exp, body } 减少的灵气消耗, ls 得到的灵识点 }
 * ===================================================================== */
const _WR = CFG.wudaoRoom;
// 第 k 阶段（从 1 起）的次数、悟道果；dao = 道 id（默认修炼之道）
const _WC = dao => _WR[dao] || _WR.xiulian;
DATA.wdStageTimes = (k, dao) => _WC(dao).TIMES + _WC(dao).ADD * (k - 1);
DATA.wdStageFruit = (k, dao) => _WC(dao).FRUIT + _WC(dao).FRUIT_ADD * (k - 1);
DATA.wdEvery = (k, dao, per) => Math.max(1, Math.floor(DATA.wdStageTimes(k, dao) / (per || _WR.xiulian.BOOKS)));
// 已悟道 n 次 → { k 第几阶段, t 本阶段已悟道次数, N 本阶段总次数 }
DATA.wdStage = (n, dao) => { let k = 1; while (n >= DATA.wdStageTimes(k, dao)) { n -= DATA.wdStageTimes(k, dao); k++; } return { k, t: n, N: DATA.wdStageTimes(k, dao) }; };
DATA.cnNum = n => { const d = "零一二三四五六七八九"; if (n < 10) return d[n]; if (n < 20) return "十" + (n % 10 ? d[n % 10] : "");
  if (n < 100) return d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : ""); return String(n); };
// 悟道秘诀来源（现算 + 缓存）：wd阶段_序号
DATA._wdSrc = {};
DATA.wdSrc = sid => {
  if (DATA._wdSrc[sid]) return DATA._wdSrc[sid];
  const m = /^wd(\d+)_(\d+)$/.exec(sid || ""); if (!m) return null;
  const k = +m[1], j = +m[2], X = _WR.xiulian, T = X.TYPES, per = X.BOOKS / T.length;
  if (k < 1 || j < 0 || j >= X.BOOKS) return null;
  let h = 2166136261; for (const c of sid) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return DATA._wdSrc[sid] = { id: sid, src: "wdroom", star: Math.min(k, X.MAX_STAR), stage: k, idx: j, type: T[j % T.length],
    juan: (k - 1) * per + Math.floor(j / T.length) + 1, mult: X.MULT[0] + (X.MULT[1] - X.MULT[0]) * ((h % 10001) / 10000), el: "jin", prefix: "", name: "悟道室", reqRealm: -1 };
};
DATA.wdBookId = (k, j) => { const o = DATA.wdSrc(`wd${k}_${j}`); return o ? `${o.id}:${o.type}` : null; };
DATA.gfSources.wdroom = { name: "悟道室", cfg: () => Object.assign({}, CFG.gongfa.sect, { learn: 0 }) };

G.module({
  id: "wudaoshi",
  defaults: () => ({ wd: { n: {}, day: {}, red: { exp: 0, body: 0 }, ls: 0 } }),

  api: {
    // 神魂之道减掉的每次修炼灵气消耗（kind: exp 修为 / body 肉身）
    wdRed(kind) { return ((this.s.wd || {}).red || {})[kind] || 0; },
    wdLeft(dao) { const w = this.s.wd || {}; return (w.day || {})[dao] === this.today() ? 0 : 1; },   // 每条道每天 1 次
    setWdDao(id) { this.wdDao = id; this.render(); },
    // 功德司：买悟道果
    wdFruitCost(a) { const w = (DATA.maps[a] || {}).w; return w === "shen" && _WR.FRUIT_MERIT_SHEN !== undefined ? _WR.FRUIT_MERIT_SHEN : _WR.FRUIT_MERIT; },   // 神界功德司单独价格
    buyWdFruit(n, a) {
      const s = this.s, c = this.wdFruitCost(a); n = Math.min(Math.floor(+n), Math.floor((s.merit || 0) / c));
      if (n <= 0) return this.log("功德不足。", "sys");
      if (!this.addSm("wdg", n)) return;
      s.merit -= c * n; this.log(`购得${DATA.smName("wdg")} ×${n}。`, "good"); this.after();
    },
    // 点「开始悟道」：读条 TIME 秒，结束后结算并弹出结果
    wdCheck(dao) {
      const s = this.s, D0 = _WR.daos.find(d => d.id === dao); if (!D0) return null;
      if (!D0.open) return this.log(`${D0.name}暂未开放。`, "sys"), null;
      if (this.wdLeft(dao) <= 0) return this.log(`${D0.name}今天已经悟过了，明天再来。`, "sys"), null;
      const need = DATA.wdStageFruit(DATA.wdStage(((s.wd || {}).n || {})[dao] || 0, dao).k, dao);
      if (this.smCount("wdg") < need) return this.log(`${DATA.smName("wdg")}不足，需要 ${need} 个。`, "sys"), null;
      return { D0, need };
    },
    wudao(dao) {
      if (this._wdRun || !this.wdCheck(dao)) return;
      const ms = (_WR.TIME || 0) * 1000;
      this._wdRun = { dao, end: Date.now() + ms }; this.render();
      setTimeout(() => { this._wdRun = null; this.wudaoDone(dao); }, ms);
    },
    wudaoDone(dao) {
      const s = this.s, c = this.wdCheck(dao); if (!c) return this.render();
      const D0 = c.D0, need = c.need, w = s.wd || (s.wd = { n: {}, day: {} }), n = w.n[dao] || 0, st = DATA.wdStage(n, dao);
      this.takeSm("wdg", need);
      w.n[dao] = n + 1; w.day[dao] = this.today();
      if (dao === "shenhun") return this.wdShenhun(D0, st);
      const P = _WR.xiulian.EXP_PCT, pct = P[0] + Math.random() * (P[1] - P[0]), gain = Math.max(1, Math.round(this.needExp() * pct / 100));
      s.exp += gain;
      let msg = `${D0.name}悟道一次，修为 +${U.fmt(gain)}`, book = "";
      const t = st.t + 1, ev = DATA.wdEvery(st.k);
      if (t % ev === 0 && t / ev <= _WR.xiulian.BOOKS) {
        const id = DATA.wdBookId(st.k, t / ev - 1), nm = `《${DATA.gongfaInfo(id, 1).name}》`;
        if (this.bagFull()) book = `悟得${nm}（背包已满，未能放入）`;
        else { s.bag.push({ t: "gfb", id, n: 1 }); book = `悟得${nm}（已放入背包）`; }
        msg += "，" + book;
      }
      this._wdFx = Date.now();
      this.log(msg + "。", "gold"); this.dirty(); this.after();
      this.wdModal(D0, `<div class="line"><div>修为</div><b class="q4">+${U.fmt(gain)}</b></div>${book ? `<div class="line"><div>${book}</div></div>` : ""}`);
    },
    // 神魂之道结算：st = 悟道前的阶段
    wdShenhun(D0, st) {
      const s = this.s, w = s.wd, H = _WR.shenhun, k = st.k, t = st.t + 1, rows = [], msg = [];
      w.red = w.red || { exp: 0, body: 0 };
      const ev = DATA.wdEvery(k, "shenhun", H.SS);
      if (t % ev === 0 && t / ev <= H.SS) { s.ssPow = (s.ssPow || 0) + H.SS_N; rows.push(["神识强度", "+" + H.SS_N]); msg.push(`神识强度 +${H.SS_N}`); }
      const kind = H.RED_TYPES[st.t % H.RED_TYPES.length], red = H.RED + H.RED_ADD * (k - 1), kn = kind === "body" ? "肉身修炼灵气消耗" : "修为修炼灵气消耗";
      w.red[kind] = (w.red[kind] || 0) + red; rows.push([kn, "−" + red]); msg.push(`${kn} −${red}`);
      if (t === st.N) { const ls = H.LS + H.LS_ADD * (k - 1); w.ls = (w.ls || 0) + ls; rows.push(["灵识点", "+" + ls]); msg.push(`灵识点 +${ls}`); }
      this._wdFx = Date.now();
      this.log(`${D0.name}悟道一次，${msg.join("，")}。`, "gold"); this.dirty(); this.after();
      this.wdModal(D0, rows.map(([a, b]) => `<div class="line"><div>${a}</div><b class="q4">${b}</b></div>`).join(""));
    },
    wdModal(D0, rows) {
      if (this._autoQuiet) return;   // 自动任务悟道不弹窗
      const T = _WR.TEXTS || [];
      this.modal(`<h2>${D0.name}</h2><p class="desc wd-tip">${T.length ? T[Math.floor(Math.random() * T.length)] : ""}</p>${rows}
        <div class="btns"><button class="primary" onclick="G.closeModal()">确定</button></div>`);
    },
  },
});

/* 洞府 · 悟道室页面 */
G.caveViews.wudao = function () {
  const s = this.s, w = s.wd || { n: {}, day: {} }, cur = _WR.daos.find(d => d.id === this.wdDao) || _WR.daos[0];
  const fx = this._wdRun || (this._wdFx && Date.now() - this._wdFx < 1500) ? " fx" : "";
  const daoBtn = d => `<button class="wd-dao${cur.id === d.id ? " on" : ""}${d.open ? "" : " off"}" onclick="G.setWdDao('${d.id}')"><b>${d.name}</b>
      <small>${d.open ? `剩余 ${this.wdLeft(d.id)} 次` : "暂未开放"}</small></button>`;
  let body;
  if (!cur.open) body = `<p class="desc wd-tip">${cur.desc}</p><p class="desc wd-tip">暂未开放，敬请期待。</p><div class="btns"><button disabled>开始悟道</button></div>`;
  else {
    const st = DATA.wdStage(w.n[cur.id] || 0, cur.id), need = DATA.wdStageFruit(st.k, cur.id), have = this.smCount("wdg"), left = this.wdLeft(cur.id), run = this._wdRun;
    body = `<div class="ys-need"><img src="${DATA.smIcon("wdg")}" alt=""><b class="${have >= need ? "" : "q5"}">${U.fmt(have)}/${need}</b></div>
      <p class="desc wd-tip">${cur.desc}</p>${cur.id === "shenhun" ? `<div class="stats"><div><span>修为灵气消耗</span>−${U.fmt(this.wdRed("exp"))}</div><div><span>肉身灵气消耗</span>−${U.fmt(this.wdRed("body"))}</div></div>` : ""}
      ${run ? `<div class="bar wd-run"><div style="animation-duration:${_WR.TIME}s;animation-delay:-${Math.max(0, _WR.TIME - (run.end - Date.now()) / 1000).toFixed(2)}s"></div></div><div class="btns"><button class="primary" disabled>悟道中……</button></div>`
        : `<div class="btns"><button class="primary" onclick="G.wudao('${cur.id}')" ${left > 0 && have >= need ? "" : "disabled"}>开始悟道</button></div>`}`;
  }
  return `<div class="card wd-card"><h3>${DATA.caveName("wudao")}</h3><p class="desc">${_WR.DESC}</p>
    <div class="ys-stage wd-stage${fx}"><div class="ys-aura"></div><img class="ys-hero" src="${this.heroImg("wd")}?v=${DATA.IMG_V}" alt=""></div>
    <div class="wd-daos">${_WR.daos.map(daoBtn).join("")}</div></div>
    <div class="card"><h3>${cur.name}</h3>${body}</div>`;
};
