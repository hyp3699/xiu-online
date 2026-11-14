/* =====================================================================
 * 核心：游戏主体 G
 * ---------------------------------------------------------------------
 * 所有玩法都写成“模块”，放在 js/modules/ 下，用 G.module({...}) 注册：
 *
 *   G.module({
 *     id: "liandan",                 // 模块名
 *     tab: "liandan",                // （可选）底部标签对应的页面
 *     defaults: () => ({ ... }),     // （可选）新存档时该模块需要的字段
 *     tick(offline) { ... },         // （可选）每 10 秒执行一次；离线也会补算
 *     view() { return "<html>"; },   // （可选）页面内容
 *   });
 *
 * 每 10 秒 G 会依次调用所有模块的 tick()。
 * 打开网页时，会按“离开的时间 ÷ 10 秒”把 tick 全部补算一遍，
 * 所以以后加炼丹、炼器，只要写在 tick 里，离线就会自动继续进行。
 * ===================================================================== */
const G = {
  s: null,             // 当前存档（整个游戏状态都在这里，会存到服务器）
  modules: [],         // 已注册的模块
  views: {},           // 标签页 → 渲染函数
  tab: "cultivate",    // 当前底部标签
  silent: false,       // 离线补算时为 true，不刷新界面
  _ver: 0, _cache: null,
  _lastTick: 0, _lastUpload: 0, _dirtySave: false,

  /* ---------- 模块注册 ---------- */
  module(m) {
    this.modules.push(m);
    if (m.tab && m.view) this.views[m.tab] = m.view;
    if (m.api) Object.assign(this, m.api); // 模块对外的函数挂到 G 上，按钮用 G.xxx() 调用
  },

  /* ---------- 属性缓存：状态变化后调用 dirty() 让属性重新计算 ---------- */
  dirty() { this._ver++; this._cache = null; },
  calc() {
    if (!this._cache) {
      this._calcBusy = true;
      try { this._cache = { stats: this.computeStats() }; } finally { this._calcBusy = false; }   // 先算属性（计算中 ownAtk 不再回调，避免循环）
      this._cache.speed = this.computeSpeed();         // 修炼速度依赖属性（神识）
    }
    return this._cache;
  },
  stats() { return this.calc().stats; },
  speed() { return this.calc().speed; },

  /* ---------- 当前时间 ----------
   * 离线补算时返回“模拟时间”，所以按时间计算的功能（功法参悟、事务堂）
   * 写成 G.now() 而不是 Date.now()，离线就能正确补算。 */
  _simNow: 0,
  now() { return this._simNow || Date.now(); },

  /* ---------- 日志 ---------- */
  // 日志 class 白名单：全仓 log 调用只用这几个（空 = 默认色）；其它值（例如旧存档 / 战斗记录里混入的）一律回退默认色，不让任意 class 插进 innerHTML。
  // q0-q5 不当 class 用：品质色只出现在消息文本里的 <span class="qN">，由 safeLog 换回（见下）。
  LOG_CLS: ["", "sys", "good", "gold", "bad"],
  logCls(c) { return this.LOG_CLS.includes(c) ? c : ""; },
  // 日志文本转义（与 api.js toastLogs 的 safeLog 同策略）：先全转义，再把有意写的品质色 <span class="q0-q5"> 换回来；其它 HTML 一律当文本显示。
  safeLog(m) {
    return String(m == null ? "" : m).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
      .replace(/&lt;span class=&quot;(q[0-5])&quot;&gt;/g, '<span class="$1">')
      .replace(/&lt;\/span&gt;/g, "</span>");
  },
  log(m, c = "") {
    if (this.silent) return;
    this.s.log.unshift({ m, c });
    if (this.s.log.length > 60) this.s.log.length = 60;
    this.renderLog();
    // 信息栏只在修炼页显示，其他页面用浮动提示
    if (this.tab !== "cultivate") {
      const t = $("#toast"); if (!t) return;
      t.innerHTML = `<p class="${this.logCls(c)}">${this.safeLog(m)}</p>`; t.classList.remove("center"); delete t.dataset.tone; t.classList.add("show");
      clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("show"), 1800);
    }
  },

  /* ---------- 存档 ---------- */
  newSave(name) {
    let s = { v: 5, name, last: Date.now(), log: [] };
    for (const m of this.modules) if (m.defaults) Object.assign(s, m.defaults());
    s.brRandOk = 1; s.brRandV = 2;
    if (this.mobElInit) this.mobElInit(s);   // 首领 / 天将 / 星君 / 界主属性：第一次进游戏随机定死
    if (this.lgYsInit) this.lgYsInit(s);   // 灵果种子：哪些隐世宗门换哪种，第一次进游戏随机定死（world.js）
    s._nm = DATA.nmSnap();   // 新存档记下当前用的名字（config/names.js），以后改名读档时对照
    s._oreV2 = 1;   // v254 矿石表新版（见 migrate）
    s.lzB1000 = true; s.lzV3 = true;   // lzV3：灵珠 3000 / 每强化 +24（见 migrate）   // 新存档的灵珠直接按 v261 后的 1000 算（见 migrate 的补 +990：只补老存档，新存档不再补）
    return s;
  },
  // v254 矿石表：去掉仙 / 冥 / 魔特色矿石（仙霞玉髓、冥河寒晶、魔焰晶），三者都并入新的通用矿石（序号 11），神辉金及神界矿石序号 -2
  //   老存档里所有 { kind: "ore", g, name } 和收获表的 "ore|名字" 键都换成新序号、新名字（背包里同名的几格不合并，数量按名字合计照常可用）
  oreV2(s) {
    if (!s || s._oreV2) return;
    const OLD = ["铁精", "寒铁", "赤铜精", "玄冥铁", "星辰砂", "虚空石", "天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉",
      "仙霞玉髓", "冥河寒晶", "魔焰晶", "神辉金", "神陨星铁", "太初神晶", "曜日神金", "九天玄玉", "混元神石"];
    const cur = DATA.ores, mine = s._nm && Array.isArray(s._nm.ore) && s._nm.ore.length === OLD.length ? s._nm.ore : OLD;
    const nj = i => i < 11 ? i : i <= 13 ? 11 : i - 2, byName = {};
    OLD.forEach((n, i) => { byName[n] = nj(i); }); mine.forEach((n, i) => { if (typeof n === "string") byName[n] = nj(i); });
    const fix = o => { const j = typeof o.name === "string" && o.name in byName ? byName[o.name] : typeof o.g === "number" && o.g >= 0 && o.g < OLD.length ? nj(o.g) : null;
      if (j === null || cur[j] === undefined) return; o.g = j; if (typeof o.name === "string") o.name = cur[j]; };
    const seen = new Set(), walk = o => {
      if (!o || typeof o !== "object" || seen.has(o)) return; seen.add(o);
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.kind === "ore" && (typeof o.g === "number" || typeof o.name === "string")) fix(o);
      for (const k of Object.keys(o)) {
        walk(o[k]);
        if (k.startsWith("ore|")) { const v = o[k], nm = v && v.name ? v.name : (j => j === undefined ? null : cur[j])(byName[k.slice(4)]);
          if (nm && "ore|" + nm !== k) { const nk = "ore|" + nm; if (o[nk] && typeof o[nk] === "object") o[nk].n = (o[nk].n || 0) + ((v && v.n) || 0); else o[nk] = v; delete o[k]; } }
      }
    };
    walk(s);
    if (s._nm) s._nm.ore = cur.slice();
    s._oreV2 = 1;
  },
  // 存档缺字段时，用模块默认值补上（以后加新功能不会坏档）
  migrate(s) {
    this.oreV2(s);   // 要在 nmMigrate 之前：矿石序号变了
    DATA.nmMigrate(s);   // 存档里的旧名字 → config/names.js 的新名字
    { const n = ((CFG.cqzj || {}).COST || []).length;   // 出窍真诀删掉的卷（第 4、5 卷）从存档里清掉
      if (Array.isArray(s.cqZj)) s.cqZj = s.cqZj.filter(v => v >= 1 && v <= n);
      if (s.cqzjL && !(s.cqzjL.v >= 1 && s.cqzjL.v <= n)) s.cqzjL = null; }
    { const K = ["contrib", "stone", "merit"], BIG = 1e15;   // 测试模式（config/rates.js TEST）：贡献、灵石、功德随便花；打开时记下原数，关掉恢复
      // _testBak 随 s 一起落盘（服务端存的就是整份 s），所以只快照三种货币，绝不塞整份 s（整份快照会让存档体积翻倍）；
      // 关掉时恢复 = 快照值 + 测试期净赚的部分（当前值 − BIG，>0 才算），测试期挣的合法收益不再被一刀切回快照值；
      // 不恢复：修为 / 肉身 / 功法 / 装备 / 背包 / 丹方等测试期所得全部保留——测试模式不改动这些字段，无需快照，恢复它们反而会抹掉测试期进度。
      if (DATA.isTest()) { if (!s._testBak) s._testBak = Object.fromEntries(K.map(k => [k, s[k] || 0])); for (const k of K) s[k] = BIG; }
      else if (s._testBak) { for (const k of K) { const bak = s._testBak[k] || 0, gain = (s[k] || 0) - BIG; s[k] = bak + (Number.isFinite(gain) && gain > 0 ? gain : 0); } delete s._testBak; } }
    if (DATA.isTest() && this.ysEnsure) { const o = this.s; this.s = s; try { this.ysEnsure(); } finally { this.s = o; } }   // 测试模式格子全亮：先定下隐世宗门位置，才能显示在格子上
    if (+s.lingye > 0 && Array.isArray(s.bag) && this.addSm) {   // 灵液改成背包专用材料：旧存档的 s.lingye 转进背包（放不下的进传音）
      const o = this.s, n = Math.floor(+s.lingye); this.s = s; try { this.addSm("lingye", n); } finally { this.s = o; } }
    if ("lingye" in s) delete s.lingye;
    {   // v261 灵珠初始聚灵 10 → 1000：已放入的灵珠补上差值（强化部分不变），只补一次
      if (!s.lzB1000 && Array.isArray(s.lzSlot)) s.lzSlot.forEach(z => { if (z && Number.isFinite(z.v)) z.v += 990; });
      s.lzB1000 = true; }
    {   // 2026-11-12 灵珠初始 1000 → 3000、每强化 +3 → +24：已放入的按强化次数重算（老灵珠没记次数：(聚灵 − 1000) ÷ 3），只算一次
      if (!s.lzV3 && Array.isArray(s.lzSlot)) { const C = CFG.lingzhu; s.lzSlot.forEach(z => { if (!z || !Number.isFinite(z.v)) return; const n = Number.isFinite(z.n) ? z.n : Math.max(0, Math.round((z.v - 1000) / 3)); z.n = n; z.v = (C.BASE || 0) + n * (C.ENH || 0); }); }
      s.lzV3 = true; }
    {   // v259 渡劫准备格子去掉：老存档的格子记录删掉；进行中的渡劫护盾、格子冷却清掉
      delete s.tribSlots; if (s.trib) { s.trib.shield = null; delete s.trib.cd; delete s.trib.used; } }
    {   // 炼器仙炉（xqi）删掉：清掉老存档里的图纸、炉子、背包图纸 / 炉子、学习和炼制队列
      const X = o => o && (o.kind === "xqi" || o.k === "xqi");
      for (const f of ["blueprints", "furnaces", "furnaceUse"]) if (s[f]) delete s[f].xqi;
      if (Array.isArray(s.bag)) s.bag = s.bag.filter(it => !it || !((it.t === "bp" || it.t === "fu") && it.kind === "xqi"));
      if (Array.isArray(s.mailbox)) s.mailbox = s.mailbox.filter(x => !(x && x.it && (x.it.t === "bp" || x.it.t === "fu") && x.it.kind === "xqi"));   // 传音里的也清
      if (s.lq && Array.isArray(s.lq.forge)) s.lq.forge = s.lq.forge.filter(x => !X(x));
      if (X(s.forgeStudy)) s.forgeStudy = null;
      if (Array.isArray(s.forgeQueue)) s.forgeQueue = s.forgeQueue.filter(x => !X(x));
      if (X(s.forgeJob)) s.forgeJob = null;
      if (s.craftsman) delete s.craftsman.xqi; }
    for (const k of DATA.FURNACE_KINDS || []) {   // 新炉子种类（炼丹神炉 sdan）补进老存档
      if (s.blueprints && !s.blueprints[k]) s.blueprints[k] = [];
      if (s.furnaces && !s.furnaces[k]) s.furnaces[k] = [];
      if (s.furnaceUse && s.furnaceUse[k] === undefined) s.furnaceUse[k] = -1; }
    for (const m of this.modules) if (m.defaults) {
      const d = m.defaults();
      for (const k in d) if (s[k] === undefined) s[k] = d[k];
    }
    if (this.brFill) this.brFill(s);   // 突破随机属性：老存档补掷（player.js）
    if (this.mobElInit) this.mobElInit(s);   // 首领 / 天将 / 星君 / 界主属性：第一次随机定死（world.js）
    if (this.lgYsInit) this.lgYsInit(s);   // 灵果种子宗门（world.js）
    return s;
  },
  save() { /* 服务器持有唯一权威存档；禁止浏览器保存或上传状态。 */ },
  // 账号在别的设备进入了游戏：本设备停止运行和上传，点按钮重新读取服务器上的最新进度
  kicked() {
    this._stopped = true; this._lockModal = true;
    this.modal(`<h2>已在其他设备登录</h2><p>账号已在其他设备进入游戏，本设备已暂停。</p><div class="btns"><button class="primary" onclick="location.reload()">重新进入</button></div>`);
  },
  setSync(t) { const el = $("#sync"); if (el) el.textContent = t; },

  /* ---------- 每 10 秒的结算 ---------- */
  tickAll() { /* 浏览器不能执行游戏 tick；Node 服务端运行原始 tickAll。 */ },

  // 离线补算：离开多久就补多久，不封顶
  offline() { /* 离线结算由服务器根据其时钟完成。 */ },
  // 背包里每种物品的数量（按名字），用来算离线新增
  bagCount() { const m = {}; for (const it of this.s.bag) { if (!it) continue; const k = this.itemName(it); m[k] = (m[k] || 0) + (it.n || 1); } return m; },

  // 离开收益（服务器一直在结算，离线不再单独补算）：客户端在前台时每 30 秒记一次快照，
  // 打开游戏 / 切回前台时和快照比，离开超过 AWAY_MIN_SEC 秒且有变化就弹窗。
  AWAY_MIN_SEC: 60,
  awayKey() { return "xiuAway_" + ((this.s && (this.s.name || this.s.id)) || ""); },
  awaySnap() {
    const s = this.s; if (!s || typeof localStorage === "undefined") return;
    try { localStorage.setItem(this.awayKey(), JSON.stringify({ t: Date.now(), exp: s.exp || 0, stone: s.stone || 0, ling: s.ling || 0, contrib: s.contrib || 0, kills: s.kills || 0, bag: this.bagCount() })); } catch (e) {}
  },
  awayCheck() {
    const s = this.s; if (!s || typeof localStorage === "undefined") return;
    let b = null; try { b = JSON.parse(localStorage.getItem(this.awayKey()) || "null"); } catch (e) {}
    if (!b || !b.t) { this.awaySnap(); return; }   // 还没有基线：先记一条，不弹窗
    const sec = Math.floor((Date.now() - b.t) / 1000); if (sec < this.AWAY_MIN_SEC) return;   // 没离开够久：不动基线（前台每 30 秒的 awaySnap 会正常刷新它）
    const f = U.fmt, sign = v => (v >= 0 ? "+" : "-") + f(Math.abs(v)), rows = [];
    const dExp = (s.exp || 0) - b.exp, dStone = (s.stone || 0) - b.stone, dLing = (s.ling || 0) - b.ling, dContrib = (s.contrib || 0) - b.contrib, kills = (s.kills || 0) - b.kills;
    const now = this.bagCount(), gain = [];
    for (const k in now) { const d = now[k] - ((b.bag || {})[k] || 0); if (d > 0) gain.push(`${k}×${f(d)}`); }
    // 没有收益：不动基线——api.js 切回前台 20 秒超时兜底可能先于服务器推送触发，那时手里的还是旧状态；
    // 基线留给推送到达后的那次 awayCheck 再算（见 api.js 侧配合点：超时后推送到达时需再调一次 awayCheck）。
    if (!dExp && !dStone && !dLing && !dContrib && !kills && !gain.length) return;
    rows.push(`<b>总计</b>`, `修为 ${sign(dExp)}　灵石 ${sign(dStone)}　灵气 ${sign(dLing)}${s.sect || dContrib ? `　贡献 ${sign(dContrib)}` : ""}`);
    if (kills > 0) rows.push(`<b>探索</b>`, `击败 ${f(kills)} 只${s.explore ? "，自动探索仍在继续" : ""}${s.cq ? "，出窍仍在继续" : ""}`);
    if (s.explore && s.explore.step) rows.push(`当前这次已走 ${s.explore.step} 步，收获在走完后结算`);
    if (gain.length) rows.push(`<b>新增物品</b>`, gain.join("、"));
    this.log(`你离开了 ${U.dur(sec)}，期间收益：修为 ${sign(dExp)}，灵石 ${sign(dStone)}${kills > 0 ? `，击败 ${f(kills)} 只` : ""}。`, "gold");
    this.lastOffline = rows;
    try { this.modal(`<h2>离开 ${U.dur(sec)}</h2><div class="explore-log">${rows.map(r => `<p>${r}</p>`).join("")}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); } catch (e) {}
    this.awaySnap();   // 弹窗已按旧基线算完差值：这时才把基线推到当前状态，下次不再重复报同一笔收益
  },

  /* ---------- 主循环（每 0.2 秒检查一次） ---------- */
  loop() { if (!this._stopped) { this.render(); this.bars(); } },

  // 进度条：每一帧按时间直接算宽度（不用 CSS 过渡），页面每秒重绘也不会一顿一顿
  bars() {
    if (!this.s) return;
    const now = this.dispNow();   // 进度条按服务器时钟算（_lastTick 是服务器的 s.last；手机时钟快慢会让进度条没走完就重置、或开头卡几秒）
    // 进度是显示预测，不负责结算；走满后停在满格，等服务器结算推送到达再从 0 开始，保证和结算同步。
    const cycleMs = DATA.TICK * 1000, phaseMs = this.tickElapsedMs(now);
    const pct = (cycleMs > 0 ? phaseMs / cycleMs * 100 : 0) + "%";
    const tb = $("#tick-bar");
    if (tb) tb.style.width = this.isCultivating() && this.canCultivate() ? pct : "0%";
    const gb = $("#gather-bar"); // 洞府聚灵阵进度条（一直聚灵）
    if (gb) gb.style.width = pct;
    const bb = $("#body-bar"); // 肉身修炼进度条（自动修炼且能修炼时 10 秒走满）
    if (bb) bb.style.width = this.bodyActive() ? pct : "0%";
    const tl = $("#tick-left");  // 本次修炼倒计时
    if (tl) tl.textContent = (cycleMs > 0 ? Math.ceil((cycleMs - phaseMs) / 1000) : 0) + " 秒";
    // 功法页修炼倒计时：直接改文字和进度条，不走整页重绘，否则每秒重建列表、滑动被打断
    // （修炼中卡片和排队列表的 HTML 里只留空位，数值全在这里填；500ms 节流，值没变不写）
    if (this.tab === "gongfa" && now - (this._gfCdT || 0) > 500) {
      this._gfCdT = now;
      const st = this.s.gfStudy, p = st && this.gfStudyProg && this.gfStudyProg();
      const gcd = $("#gf-cd");
      if (gcd && p) { const t = this.countdownTxt(p.left); if (gcd.textContent !== t) gcd.textContent = t; }
      const gbar = $("#gf-cd-bar");
      if (gbar && p) gbar.style.width = (st.total > 0 ? Math.min(100, Math.max(0, p.done / st.total * 100)) : 0) + "%";
      if (this.gfQueueTimes) {
        const { rows, total } = this.gfQueueTimes();
        const qt = $("#gf-q-total");
        if (qt) { const t = this.countdownTxt(total); if (qt.textContent !== t) qt.textContent = t; }
        rows.forEach((r, i) => {
          const ms = $("#gf-q-" + i + "-ms"), ac = $("#gf-q-" + i + "-acc");
          if (ms) { const t = this.countdownTxt(r.ms); if (ms.textContent !== t) ms.textContent = t; }
          if (ac) { const t = this.countdownTxt(r.acc); if (ac.textContent !== t) ac.textContent = t; }
        });
      }
    }
    // 头像弹窗里的生命 / 法力：服务器每次结算恢复后实时刷新，不用关掉重开
    const oh = $("#orb-hp"), om = $("#orb-mp");   // 修炼页圆钮外圈：生命 / 法力
    if ((oh || om) && now - (this._orbT || 0) > 500) {
      this._orbT = now;
      if (oh) oh.style.setProperty("--p", this.orbPct("hp"));
      if (om) om.style.setProperty("--p", this.orbPct("mana"));
    }
    const ph = $("#pf-hp"), pm = $("#pf-mana");
    if ((ph || pm) && now - (this._pfT || 0) > 500) {
      this._pfT = now; const st = this.stats();
      const sl = `<i class="pf-sl">  /  </i>`, h = `${U.int(this.s.hp)}${sl}${U.int(st.hp)}`, m = `${U.int(this.s.mana)}${sl}${U.int(st.mana)}`;
      if (ph && ph.innerHTML !== h) ph.innerHTML = h;
      if (pm && pm.innerHTML !== m) pm.innerHTML = m;
    }
  },

  // 当前服务器结算周期内的显示时间；只绘制进度，不在浏览器执行状态结算。
  // 走满后先停在满格等服务器结算（服务器到点立即推送）；超过 3 秒还没收到（断线等）才按周期继续走。
  dispNow() { return typeof API !== "undefined" && API.now ? API.now() : Date.now(); },   // 显示用时钟（经服务器校准）
  tickElapsedMs(now = this.dispNow()) {
    const cycleMs = DATA.TICK * 1000;
    if (cycleMs <= 0) return 0;
    const elapsed = Math.max(0, now - this._lastTick);
    if (elapsed < cycleMs + 3000) return Math.min(elapsed, cycleMs);
    return elapsed % cycleMs;
  },
  tickPct() { return this.tickElapsedMs() / (DATA.TICK * 10); },

  /* ---------- 操作后统一调用：重算属性、存档、刷新 ---------- */
  after() { this.dirty(); this.render(); },

  /* ---------- 界面 ---------- */
  // 探索信息浮层：夹在最顶部花纹和底部 6 个按钮之间，不挡住它们
  exovFit() {
    const o = document.querySelector(".exov"); if (!o) return;
    const t = document.querySelector(".bar-top"), n = document.getElementById("tabs");
    o.style.top = (t ? Math.max(0, t.getBoundingClientRect().bottom) : 0) + "px";
    o.style.bottom = (n ? Math.max(0, window.innerHeight - n.getBoundingClientRect().top) : 0) + "px";
  },
  render() {
    const s = this.s; if (!s || this.silent) return;
    if (this._btHoldView()) { this._renderDeferred = true; return; }   // 战斗还没播完：页面保持战前（关闭战斗时 closeBattle 会重绘）
    $("#p-name").textContent = s.name;
    $("#p-realm").textContent = this.realmName();
    // 顶部灵石、贡献、功德：不到 1 亿显示到个位数，满 1 亿显示「1.5236亿」（保留 4 位小数，舍去不进位，用户定）
    // 三项满 1 兆（1 万亿）显示「1.5236兆」（用户定）
    const topN = v => { v = Math.floor(v || 0); return v >= 1e12 ? (Math.floor(v / 1e8) / 1e4).toFixed(4) + "兆" : v >= 1e8 ? (Math.floor(v / 1e4) / 1e4).toFixed(4) + "亿" : String(v); };
    $("#p-stone").textContent = topN(s.stone);
    $("#p-contrib").textContent = topN(s.contrib);   // v27：贡献、功德
    $("#p-merit").textContent = topN(s.merit);
    { const mb = $("#p-mailbox"); if (mb) { let n = 0; try { n = this.mailboxCount ? this.mailboxCount() : 0; } catch {} mb.textContent = n ? `(${n})` : ""; } }
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === this.tab));
    // 顶部（道号、灵石、贡献、功德）和信息栏只在修炼页显示
    const main = this.tab === "cultivate";
    $("#top").style.display = main ? "" : "none";
    $("#log-wrap").style.display = main && !this.cultView ? "" : "none";   // 神识 / 肉身 / 设置页不显示信息栏
    const v = $("#view"), top = v.scrollTop;
    // 某个页面出错时不再整页空白：显示错误信息，其它页面照常可用
    // 内容没变就不重绘：避免每秒重绘时按钮被替换、点了没反应，也省手机电量
    // 手指 / 鼠标按住时先不替换页面：否则按下和抬起之间按钮被换掉，这次点击就丢了
    if (this._pressing && v.innerHTML !== "") { this._renderDeferred = true; return; }
    // 背包储物格 / 功法列表在框内滑动（含惯性）时先不替换页面，否则滑动框被换掉、滑动中断；停下 250 毫秒后补一次重绘
    if (this._innerScrollAt && Date.now() - this._innerScrollAt < 250 && v.innerHTML !== "") { this._renderDeferred = true; clearTimeout(this._innerScrollT); this._innerScrollT = setTimeout(() => { if (this._renderDeferred) { this._renderDeferred = false; this.render(); } }, 260); return; }
    // 正在输入框里打字时也先不替换页面：否则输入框被换掉，手机输入法会自动收起
    if (this.editing(v)) { this._renderDeferred = true; return; }
    const lg0 = document.getElementById("exov-log"), lgTop = lg0 ? lg0.scrollTop : -1;
    const bg0 = document.getElementById("bag-grid"), bgTop = bg0 ? bg0.scrollTop : 0, gs0 = document.getElementById("gf-scroll"), gsTop = gs0 ? gs0.scrollTop : 0;   // 背包储物格 / 功法列表：页面固定，只有格子框内滑动，重绘后保持位置
    const mw0 = document.getElementById("mgwrap"), mwPos = mw0 ? [mw0.scrollLeft, mw0.scrollTop] : null;   // 地图格子：重绘后保持拖动位置   // 探索信息浮层：重绘后保持位置，或「跟随最新」滚到底
    try { const html = this.views[this.tab] ? this.views[this.tab].call(this) : ""; if (html !== this._viewHtml || v.innerHTML === "") { v.innerHTML = html; this._viewHtml = html;
      this._gfCdT = 0;   // 功法页倒计时/进度条是空位：重绘后同一帧立刻由 bars() 填上，否则空白最多半秒，看起来一闪一闪
      const lg = document.getElementById("exov-log"); if (lg) lg.scrollTop = this.exFollow === false && lgTop >= 0 ? lgTop : 0;
      const bg = document.getElementById("bag-grid"); if (bg && bgTop) bg.scrollTop = bgTop; const gs = document.getElementById("gf-scroll"); if (gs && gsTop) gs.scrollTop = gsTop;
      const mw = document.getElementById("mgwrap");
      if (mw) this.gridFit(mw);
      const gsd = v.querySelector(".gf-side"); if (gsd) this.gfSideFit(gsd, v);   // 功法类型侧栏：占满下面空着的高度
      if (mw) { if (mwPos) { mw.scrollLeft = mwPos[0]; mw.scrollTop = mwPos[1]; }
        else { const n = +mw.dataset.n || 9, c = +mw.dataset.c || 0, cw = mw.scrollWidth / n;   // 第一次进入：上次游历的格子放在中间
          mw.scrollLeft = (c % n + .5) * cw - mw.clientWidth / 2; mw.scrollTop = (Math.floor(c / n) + .5) * cw - mw.clientHeight / 2; } }
      this.syncLoopAnims(v); }
      this.exovFit(); }   // 最新一条在最上面
    catch (err) { console.error(err); this._viewHtml = null; v.innerHTML = `<div class="card"><h3>页面出错</h3><p class="desc">${String(err && err.message || err)}<br>如果刚改过 js/config/ 里的数值，请检查有没有写错（例如少了小数点、多了问号）。</p></div>`; }
    v.scrollTop = top;
  },
  // 服务器打完的战斗排队待播或正在播（战斗画面还在）时为 true：此时不重绘页面，免得先看到通关层数、奖励等结果
  _btHoldView() {
    if (typeof API === "undefined" || !API._battleQueue) return false;
    return API._battleQueue.length > 0 || !!(this._bp && typeof document !== "undefined" && document.querySelector("#modal-box .btv"));
  },
  // 功法殿 / 坊市 / 功德司左侧功法类型按钮：从按钮顶到页面底部（不滑动时）全部占满，按钮平分高度（用户定 2026-11-14）
  gfSideFit(sd, v) {
    const off = sd.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop, n = sd.children.length || 1;
    sd.style.height = Math.max(n * 34, v.clientHeight - off - 12) + "px";
    if (!this._gfSideRs) { this._gfSideRs = 1; window.addEventListener("resize", () => { const vv = document.getElementById("view"), d = vv && vv.querySelector(".gf-side"); if (d) { d.style.height = ""; this.gfSideFit(d, vv); } }); }
  },
  // 地图格子：竖向 9 格刚好占满可用高度，横向超出就左右拖动
  gridFit(mw) {
    const n = +mw.dataset.n || 9, h = mw.clientHeight;
    if (h > 0) mw.style.setProperty("--gcw", Math.max(28, Math.floor(h / n)) + "px");
    if (!this._gridRs) { this._gridRs = 1; window.addEventListener("resize", () => { const m = document.getElementById("mgwrap"); if (m) this.gridFit(m); }); }
  },
  // 重绘后循环动画（人物上下浮动、光环、金丹）对齐到同一条时间线：新元素接着原来的进度，不会每次服务器结算重绘就跳回起点抖一下
  syncLoopAnims(root) {
    try { if (!root.getAnimations) return;
      for (const a of root.getAnimations({ subtree: true })) { const t = a.effect && a.effect.getTiming && a.effect.getTiming(); if (t && t.iterations === Infinity) a.startTime = 0; } } catch (e) {}
  },
  editing(root) {
    const a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && root && root.contains(a));
  },
  renderLog() { $("#log").innerHTML = this.s.log.map(l => `<p class="${this.logCls(l.c)}">${this.safeLog(l.m)}</p>`).join(""); },
  // 进度条（叠在“学习中 / 剩余时间”文字下面）：left 剩余毫秒，total 总毫秒；外层元素加 class="pg"
  pgFill(left, total) { const p = total > 0 ? Math.min(100, Math.max(0, (1 - left / total) * 100)) : 0; return `<i class="pgf" style="width:${p.toFixed(1)}%"></i>`; },
  modal(html, cls) { const b = $("#modal-box"), m = $("#modal"); b.className = "modal-box" + (cls ? " " + cls : ""); m.classList.toggle("fs", cls === "fs"); b.innerHTML = html; m.classList.remove("hidden"); },   // cls = "fs"：全屏弹窗（神纹点亮图）
  // 游戏风格确认框（代替浏览器 confirm，不显示「网址为…的网页显示」）：返回 Promise<true/false>；叠在其它弹窗上面
  ask(text, title = "确认", okText = "确定") {
    if (typeof document === "undefined" || !document.body || !document.createElement) return Promise.resolve(true);
    let el = document.getElementById("ask");
    if (!el) { el = document.createElement("div"); el.id = "ask"; el.className = "modal hidden"; el.style.zIndex = 30; el.innerHTML = `<div class="modal-box" style="max-width:420px"></div>`; document.body.appendChild(el); }
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/\n/g, "<br>");
    const box = el.firstChild;
    box.innerHTML = `<h2>${esc(title)}</h2><p style="text-align:center;line-height:1.7">${esc(text)}</p><div class="btns"><button class="primary" data-a="1">${esc(okText)}</button><button data-a="0">取消</button></div>`;
    el.classList.remove("hidden");
    return new Promise(resolve => {
      const done = v => { el.classList.add("hidden"); el.onclick = null; resolve(v); };
      el.onclick = e => { const b = e.target.closest ? e.target.closest("button[data-a]") : null; if (b) { e.stopPropagation(); done(b.dataset.a === "1"); } else if (e.target === el) done(false); };
    });
  },
  closeModal() { $("#modal").classList.add("hidden"); if (this._lockModal && this._bp && !this._cfgOpen && !this._restoring && !this._stopped && !this._restartLock && !document.body.classList.contains("nologin")) this._lockModal = false; },

  /* ---------- 启动 ---------- */
  start() {
    this.dirty();
    this._lastTick = this.s.last && this.s.last <= Date.now() ? this.s.last : Date.now();   // v208 接着离线补算后的结算时间
    this.render(); this.renderLog(); this.bars();
    this.awayCheck(); clearInterval(this._awayTimer);
    this._awayTimer = setInterval(() => { if (typeof document === "undefined" || (!document.hidden && document.hasFocus())) this.awaySnap(); }, 30000);
    if (this._remoteRenderTimer) clearInterval(this._remoteRenderTimer);
    if (this._barFrame) cancelAnimationFrame(this._barFrame);
    const animateBars = () => {
      if (this._stopped || !this.s) { this._barFrame = 0; return; }
      this.bars();
      this._barFrame = requestAnimationFrame(animateBars);
    };
    this._barFrame = requestAnimationFrame(animateBars);
    this._remoteRenderTimer = setInterval(() => {
      if (this._stopped || !this.s) return;
      this.render(); this.renderLog();
      if (this.tribOpen) this.showTrib();
    }, 1000);
  },

  init() {
    const bt = document.getElementById("boot"); if (bt) bt.remove();   // v245 网页加载完：去掉「加载中」
    document.querySelectorAll("#tabs button").forEach(b => {   // 底部导航按钮名字在 config/names.js 的 tab
      const n = DATA.nmPick(CFG.names.tab, b.dataset.tab, ""), t = b.lastChild;
      if (n && t && t.nodeType === 3) t.textContent = n;
    });
    document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
      // 再点当前所在的按钮 = 返回上一级：点页面里的「返回」（右下角固定的优先）
      if (this.tab === b.dataset.tab && !document.querySelector("#modal:not(.hidden), .modal.show")) {
        // 顺序：探索信息浮层的「关闭」→ 右下角固定的「返回」→ 页面里文字以「返回」开头的按钮（返回、返回修炼、返回储物格…）
        const v = $("#view"), bk = v && (v.querySelector('.exov-tabs button[onclick^="G.setExploreOpen(false)"]')
          || [...v.querySelectorAll(".fback > button")].pop() || [...v.querySelectorAll("button")].find(x => /^返回/.test(x.textContent.trim())));
        if (bk) { bk.click(); return; }
      }
      this.tab = b.dataset.tab; $("#view").scrollTop = 0; this.render(); if (this.tab === "world" && this.wsFirst) this.wsFirst();   // 回到四界地图卷轴：定位到第一张图
    });
    // 记录是否正在按住屏幕；抬起后再补一次重绘
    const press = on => () => {
      this._pressing = on;
      if (!on && this._renderDeferred) { this._renderDeferred = false; setTimeout(() => this.render(), 0); }
    };
    document.addEventListener("scroll", e => { const t = e.target; if (t && (t.id === "bag-grid" || t.id === "gf-scroll")) this._innerScrollAt = Date.now(); }, true);
    document.addEventListener("pointerdown", press(true), true);
    ["pointerup", "pointercancel"].forEach(t => document.addEventListener(t, press(false), true));
    // 输入框失去焦点后补一次重绘
    document.addEventListener("focusout", () => setTimeout(() => {
      if (this._renderDeferred && !this._pressing && !this.editing($("#view"))) { this._renderDeferred = false; this.render(); }
    }, 0), true);
    // 点弹窗外面关闭；锁定只在真正需要时生效（登录、数据修改、恢复存档、战斗画面），别的弹窗盖掉战斗画面后不再被旧的锁卡住
    $("#modal").onclick = e => {
      if (e.target.id !== "modal" || !this.s) return;
      const lock = this._lockModal && (document.body.classList.contains("nologin") || this._cfgOpen || this._restoring || this._stopped || !!document.querySelector("#modal-box .btv"));
      if (!lock) { this._lockModal = false; this.closeModal(); }
    };
    this.showLogin(); // 见 modules/account.js
  },
};
