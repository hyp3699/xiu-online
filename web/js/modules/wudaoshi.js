/* =====================================================================
 * 模块：洞府 · 悟道室（数值在 config/wudaoshi.js）
 * ---------------------------------------------------------------------
 * 修炼之道：每天一次，消耗悟道果，得修为（当前境界升级需要的 2%~5%），按阶段给悟道秘诀（进背包）。
 * 神魂之道：每天一次，消耗悟道果，按阶段给神识强度，永久减修炼灵气消耗（wd.red），阶段最后一次给灵识点（wd.ls）。
 * 战斗之道：每天一次，消耗悟道果，每次在攻击 / 防御 / 生命 / 六系抗性共 9 种里随机加一种（wd.bat，各 1/9）；页面上不显示累计，悟道后弹框里显示这次加的属性和得到的功法；
 *   加多少 = 基础（当前境界修为突破合计 + 肉身突破合计，不含功法 / 丹药 / 装备 / 炼体池）× PCT 区间随机 % × 阶段倍率（每阶段 +25%，最高 +240%）。
 *   每阶段给功法（wz阶段_序号:类别，来源在 DATA.wzSrc 现算，类型、抗性属性由序号哈希定，效果 = 同星级 × 1.5，不占灵识点）：
 *   给功法间隔按 BOOK_STEPS 表（1–2 阶段每 10 次，3–4 阶段每 13 次，5–6 阶段每 16 次，7–8 阶段每 20 次，9–10 阶段每 25 次，11–20 阶段每 50 次，21 阶段以后每阶段最后一次给 1 本）；星级 = 阶段（最高 15 星）。
 * 悟道秘诀 id "wd阶段_序号:mijue|tijue"（序号 0~9），来源在 DATA.wdSrc 现算。
 * 存档：wd = { n: { 道id: 已悟道次数 }, day: { 道id: 上次悟道的日期 }, red: { exp, body } 减少的灵气消耗, ls 得到的灵识点,
 *   bat: { atk, def, hp, res: { 系: 值 } } 战斗之道随机属性累计 }
 * ===================================================================== */
const _WR = CFG.wudaoRoom;
// 第 k 阶段（从 1 起）的次数、悟道果；dao = 道 id（默认修炼之道）
const _WC = dao => _WR[dao] || _WR.xiulian;
DATA.wdStageTimes = (k, dao) => _WC(dao).TIMES + _WC(dao).ADD * (k - 1);
DATA.wdStageFruit = (k, dao) => _WC(dao).FRUIT + _WC(dao).FRUIT_ADD * (k - 1);
DATA.wdEvery = (k, dao, per) => Math.max(1, Math.floor(DATA.wdStageTimes(k, dao) / (per || 10)));
// 已悟道 n 次 → { k 第几阶段, t 本阶段已悟道次数, N 本阶段总次数 }
DATA.wdStage = (n, dao) => { let k = 1; while (n >= DATA.wdStageTimes(k, dao)) { n -= DATA.wdStageTimes(k, dao); k++; } return { k, t: n, N: DATA.wdStageTimes(k, dao) }; };
DATA.cnNum = n => { const d = "零一二三四五六七八九"; if (n < 10) return d[n]; if (n < 20) return "十" + (n % 10 ? d[n % 10] : "");
  if (n < 100) return d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : ""); return String(n); };
// 悟道给功法间隔：第 k 阶段每几次给 1 本（BOOK_STEPS 表查；超出表则间隔 = 阶段次数，即每阶段最后一次给 1 本）
DATA.wdBookInterval = (k, dao) => {
  for (const [maxK, iv] of (_WR.BOOK_STEPS || [])) if (k <= maxK) return iv;
  return DATA.wdStageTimes(k, dao);
};
// 修炼之道第 k 阶段给几本秘诀（阶段次数 ÷ 功法间隔，多出的几次不给）；第 k 阶段开始前已用掉的卷号数（每 2 本一卷，单本也占一卷，避免跨阶段重卷）
DATA.wdBooksCount = k => Math.floor(DATA.wdStageTimes(k, "xiulian") / DATA.wdBookInterval(k, "xiulian"));
DATA.wdVolsBefore = k => { const T = _WR.xiulian.TYPES.length; let s = 0; for (let i = 1; i < k; i++) s += Math.ceil(DATA.wdBooksCount(i) / T); return s; };
// 悟道秘诀来源（现算 + 缓存）：wd阶段_序号
DATA._wdSrc = {};
DATA.wdSrc = sid => {
  if (DATA._wdSrc[sid]) return DATA._wdSrc[sid];
  const m = /^wd(\d+)_(\d+)$/.exec(sid || ""); if (!m) return null;
  const k = +m[1], j = +m[2], X = _WR.xiulian, T = X.TYPES;
  if (k < 1 || j < 0 || j >= 20) return null;   // 序号上限 20：只防乱序号，现规则每阶段最多 10 本，历版规则最多 13 本，老书都不失效
  return DATA._wdSrc[sid] = { id: sid, src: "wdroom", star: Math.min(k, X.MAX_STAR), stage: k, idx: j, type: T[j % T.length],
    juan: DATA.wdVolsBefore(k) + Math.floor(j / T.length) + 1, mult: X.BOOK_MULT, el: "jin", prefix: "", name: "悟道室", reqRealm: -1 };   // 倍率固定 BOOK_MULT（原来是 MULT 区间随机）
};
DATA.wdBookId = (k, j) => { const o = DATA.wdSrc(`wd${k}_${j}`); return o ? `${o.id}:${o.type}` : null; };
// 本阶段开始前已悟道的累计次数（战斗功法序号 j 用：本阶段第几本）
DATA.wdStageStart = (k, dao) => { let s = 0; for (let i = 1; i < k; i++) s += DATA.wdStageTimes(i, dao); return s; };
// 第 k 阶段开始前已给过的战斗功法本数（各阶段间隔按 BOOK_STEPS 表，所以要逐阶段算）
DATA.wzBooksBefore = k => { let s = 0; for (let i = 1; i < k; i++) s += Math.floor(DATA.wdStageTimes(i, "zhandou") / DATA.wdBookInterval(i, "zhandou")); return s; };
// 战斗功法来源（现算 + 缓存）：wz阶段_序号；类型、抗性属性由序号哈希定（发功法时按同一规则显示名字，不用另存）
DATA._wzSrc = {};
DATA.wzSrc = sid => {
  if (DATA._wzSrc[sid]) return DATA._wzSrc[sid];
  const m = /^wz(\d+)_(\d+)$/.exec(sid || ""); if (!m) return null;
  const k = +m[1], j = +m[2], H = _WR.zhandou;
  if (k < 1 || j < 0) return null;
  let h = 2166136261; for (const c of sid) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  // 9 本里随机 1 本：攻击 / 防御 / 生命功法 + 六系抗性功法（哈希取余，均匀分布）
  const idx = h % 9;
  let type, els;
  if (idx < 3) type = ["gongjue", "xinfa", "zhenjing"][idx];
  else { type = "zhenjue"; els = { zhenjue: DATA.elements[idx - 3].id }; }
  const juan = DATA.wzBooksBefore(k) + j + 1;   // 第几本（全部阶段累计，卷号全局递增）
  return DATA._wzSrc[sid] = { id: sid, src: "wdroom", dao: "zhandou", star: Math.min(k, H.MAX_STAR), stage: k, idx: j, type, juan, mult: H.BOOK_MULT, el: "jin", els, prefix: "", name: "悟道室", reqRealm: -1 };
};
DATA.gfSources.wdroom = { name: "悟道室", cfg: () => Object.assign({}, CFG.gongfa.sect, { learn: 0 }) };

G.module({
  id: "wudaoshi",
  defaults: () => ({ wd: { n: {}, day: {}, red: { exp: 0, body: 0 }, ls: 0, bat: { atk: 0, def: 0, hp: 0, res: {} } } }),

  api: {
    // 神魂之道减掉的每次修炼灵气消耗（kind: exp 修为 / body 肉身）
    wdRed(kind) { return ((this.s.wd || {}).red || {})[kind] || 0; },
    // 战斗之道随机属性累计（player.js computeStats 里加进属性）
    wdBat() { const b = ((this.s.wd || {}).bat || {}); return { atk: b.atk || 0, def: b.def || 0, hp: b.hp || 0, res: Object.assign({}, b.res || {}) }; },
    wdLeft(dao) { const w = this.s.wd || {}; return (w.day || {})[dao] === this.today() ? 0 : 1; },   // 每条道每天 1 次
    setWdDao(id) { this.wdDao = id; this.render(); },
    // 功德司：买悟道果
    wdFruitCost(a) { const w = (DATA.maps[a] || {}).w; return w === "shen" && _WR.FRUIT_MERIT_SHEN !== undefined ? _WR.FRUIT_MERIT_SHEN : _WR.FRUIT_MERIT; },   // 神界功德司单独价格
    // 点「购买」：弹窗选数量（纯界面），确定后再买
    openWdFruit(a) {
      const c = this.wdFruitCost(a), max = Math.min(99999, Math.floor((this.s.merit || 0) / c));
      if (max <= 0) return this.log("功德不足。", "sys");
      this.qtyModal(`购买${DATA.smName("wdg")}`, `<p class="desc">每个 ${U.fmt(c)} 功德 · 现有功德 ${U.fmt(this.s.merit || 0)}</p>`, max, n => this.buyWdFruit(n, a), { max: "最多可买", ok: "购买" });
    },
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
      if (this.wdLeft(dao) <= 0) return this.log(`${D0.name}今天已经悟过了。`, "sys"), null;
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
      if (dao === "zhandou") return this.wdZhandou(D0, st);
      if (dao === "shenhun") return this.wdShenhun(D0, st);
      const P = _WR.xiulian.EXP_PCT, pct = P[0] + Math.random() * (P[1] - P[0]), gain = Math.max(1, Math.round(this.needExp() * pct / 100));
      s.exp += gain;
      let msg = `${D0.name}悟道一次，修为 +${U.fmt(gain)}`, book = "";
      const t = st.t + 1, interval = DATA.wdBookInterval(st.k, "xiulian");   // 功法间隔按 BOOK_STEPS 表
      const j = t / interval - 1;
      if (t % interval === 0 && j < DATA.wdBooksCount(st.k)) {
        const id = DATA.wdBookId(st.k, j), nm = `《${DATA.gongfaInfo(id, 1).name}》`;
        { const where = this.bagPutOrMail({ t: "gfb", id, n: 1 }); book = `悟得${nm}（已放入${where === "mail" ? "传音暂存" : "背包"}）`; }
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
    // 战斗之道结算：st = 悟道前的阶段，t = 本阶段第几次悟道；每次随机加一项属性，每阶段按间隔给一本战斗功法
    wdZhandou(D0, st) {
      const s = this.s, w = s.wd, H = _WR.zhandou, k = st.k, t = st.t + 1, rows = [], msg = [];
      const bat = w.bat || (w.bat = { atk: 0, def: 0, hp: 0, res: {} });
      // 基础 = 当前境界修为突破合计（不含凡人基础）+ 肉身突破合计；功法 / 丹药 / 装备 / 炼体池都不算；凡人按练气一层算
      const L = s.mortal ? 0 : s.L, n = (s.bodyL === undefined ? -1 : s.bodyL) + 1;
      const baseOf = key => {
        const bk = key === "res" ? (CFG.player.RES_BASE || 0) : ((CFG.player.base || {})[key] || 0);
        return Math.max(0, (DATA.plRealmStat(L, key) || 0) - bk + (DATA.plBodyStat(n, key) || 0));
      };
      const pool = ["atk", "def", "hp", ...DATA.elements.map(e => "res:" + e.id)], pick = pool[Math.floor(Math.random() * pool.length)];
      const el = pick.startsWith("res:") ? pick.slice(4) : "";   // 9 种里随机一种：攻击 / 防御 / 生命 / 六系抗性（各 1/9）
      const pct = H.PCT[0] + Math.random() * (H.PCT[1] - H.PCT[0]);   // PCT 区间内随机 %（0.8% ~ 1.2%）
      const mult = Math.min(1 + H.STAGE_CAP / 100, 1 + H.STAGE_ADD / 100 * (k - 1));   // 阶段倍率：每阶段 +25%，最高 +240%
      const grant = Math.round(baseOf(el ? "res" : pick) * pct / 100 * mult * 10) / 10;
      if (el) { bat.res[el] = (bat.res[el] || 0) + grant; rows.push([`${DATA.elById[el].name}抗性`, `+${U.dec(grant)}`]); msg.push(`${DATA.elById[el].name}抗性 +${U.dec(grant)}`); }
      else { bat[pick] = (bat[pick] || 0) + grant; const nm = { atk: "攻击", def: "防御", hp: "生命" }[pick]; rows.push([nm, `+${U.dec(grant)}`]); msg.push(`${nm} +${U.dec(grant)}`); }
      // 功法：本阶段按 BOOK_STEPS 表间隔给一本（21 阶段以后每阶段最后一次给一本）
      const interval = DATA.wdBookInterval(k, "zhandou");
      let book = "";
      if (t % interval === 0) {
        const j = t / interval - 1;
        const id = `wz${k}_${j}:${DATA.wzSrc(`wz${k}_${j}`).type}`, nm = `《${DATA.gongfaInfo(id, 1).name}》`;
        { const where = this.bagPutOrMail({ t: "gfb", id, n: 1 }); book = `悟得${nm}（已放入${where === "mail" ? "传音暂存" : "背包"}）`; }
        msg.push(book);
      }
      this._wdFx = Date.now();
      this.log(`${D0.name}悟道一次，${msg.join("，")}。`, "gold"); this.dirty(); this.after();
      this.wdModal(D0, rows.map(([a, b]) => `<div class="line"><div>${a}</div><b class="q4">${b}</b></div>`).join("") + (book ? `<div class="line"><div>${book}</div></div>` : ""));
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
