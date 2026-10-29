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
      this._cache = { stats: this.computeStats() };   // 先算属性
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
  log(m, c = "") {
    if (this.silent) return;
    this.s.log.unshift({ m, c });
    if (this.s.log.length > 60) this.s.log.length = 60;
    this.renderLog();
    // 信息栏只在修炼页显示，其他页面用浮动提示
    if (this.tab !== "cultivate") {
      const t = $("#toast"); if (!t) return;
      t.innerHTML = `<p class="${c}">${m}</p>`; t.classList.remove("center"); delete t.dataset.tone; t.classList.add("show");
      clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("show"), 1800);
    }
  },

  /* ---------- 存档 ---------- */
  newSave(name) {
    let s = { v: 5, name, last: Date.now(), log: [] };
    for (const m of this.modules) if (m.defaults) Object.assign(s, m.defaults());
    s.brRandOk = 1; s.brRandV = 2;
    if (this.mobElInit) this.mobElInit(s);   // 首领 / 天将 / 星君 / 界主属性：第一次进游戏随机定死
    s._nm = DATA.nmSnap();   // 新存档记下当前用的名字（config/names.js），以后改名读档时对照
    return s;
  },
  // 存档缺字段时，用模块默认值补上（以后加新功能不会坏档）
  migrate(s) {
    DATA.nmMigrate(s);   // 存档里的旧名字 → config/names.js 的新名字
    { const n = ((CFG.cqzj || {}).COST || []).length;   // 出窍真诀删掉的卷（第 4、5 卷）从存档里清掉
      if (Array.isArray(s.cqZj)) s.cqZj = s.cqZj.filter(v => v >= 1 && v <= n);
      if (s.cqzjL && !(s.cqzjL.v >= 1 && s.cqzjL.v <= n)) s.cqzjL = null; }
    { const K = ["contrib", "stone", "merit"], BIG = 1e15;   // 测试模式（config/rates.js TEST）：贡献、灵石、功德随便花；打开时记下原数，关掉恢复
      if (DATA.isTest()) { if (!s._testBak) s._testBak = Object.fromEntries(K.map(k => [k, s[k] || 0])); for (const k of K) s[k] = BIG; }
      else if (s._testBak) { for (const k of K) s[k] = s._testBak[k] || 0; delete s._testBak; } }
    {   // 灵矿删掉：老存档里正在挖矿的探索 / 出窍直接停掉（不结算本次收获，功能已不存在）
      if (s.explore && s.explore.kuang) s.explore = null;
      if (s.cq && s.cq.kuang) s.cq = null; }
    {   // 炼器仙炉（xqi）删掉：清掉老存档里的图纸、炉子、背包图纸 / 炉子、学习和炼制队列
      const X = o => o && (o.kind === "xqi" || o.k === "xqi");
      for (const f of ["blueprints", "furnaces", "furnaceUse"]) if (s[f]) delete s[f].xqi;
      if (Array.isArray(s.bag)) s.bag = s.bag.filter(it => !((it.t === "bp" || it.t === "fu") && it.kind === "xqi"));
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
    return s;
  },
  save() { /* 服务器持有唯一权威存档；禁止浏览器保存或上传状态。 */ },
  async upload() { /* 兼容旧 UI 调用，不再上传客户端状态。 */ },
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
  bagCount() { const m = {}; for (const it of this.s.bag) { const k = this.itemName(it); m[k] = (m[k] || 0) + (it.n || 1); } return m; },
  // 离线收益明细：写进信息栏 + 弹窗
  offlineReport(sec, b, o) {
    const s = this.s, f = U.fmt, sign = v => (v >= 0 ? "+" : "-") + f(Math.abs(v)), rows = [];
    const dExp = s.exp - b.exp, dStone = s.stone - b.stone, dContrib = (s.contrib || 0) - b.contrib, dLing = s.ling - b.ling;
    rows.push(`<b>总计</b>`);
    rows.push(`修为 ${sign(dExp)}　灵石 ${sign(dStone)}　灵气 ${sign(dLing)}${s.sect || dContrib ? `　贡献 ${sign(dContrib)}` : ""}`);
    const items = m => Object.keys(m).map(k => `${k}×${f(m[k])}`).join("、"), kills = (s.kills || 0) - b.kills, cqOn = !!s.cq;
    if (o.learn.length) { rows.push(`<b>学会</b>`); rows.push(o.learn.join("、")); }   // v173 学了什么
    const ups = Object.keys(o.gfUp); if (ups.length) { rows.push(`<b>功法升层</b>`); rows.push(ups.map(k => `${k} 第 ${o.gfUp[k]} 层`).join("、")); }
    if (o.exRuns || (s.explore && !cqOn)) {
      rows.push(`<b>自动探索</b>`);
      rows.push(`结算 ${o.exRuns} 次${o.cq.runs ? "" : `，击败 ${f(kills)} 只`}，灵石 +${f(o.exStone)}${items(o.exItems) ? "<br>" + items(o.exItems) : ""}`);
    }
    if (o.cq.runs || cqOn) {   // v173 出窍单独显示
      rows.push(`<b>元婴出窍</b>`);
      rows.push(`探索 ${o.cq.runs} 次${o.exRuns ? "" : `，击败 ${f(kills)} 只`}，灵石 +${f(o.cq.stone)}${items(o.cq.exItems) ? "<br>" + items(o.cq.exItems) : ""}`);
    }
    if (o.exRuns && o.cq.runs) rows.push(`探索和出窍共击败 ${f(kills)} 只`);
    if (o.exLost) rows.push(`<span class="bad">背包已满，遗失 ${o.exLost} 件</span>`);
    if (s.explore && s.explore.step) rows.push(`当前这次探索已走 ${s.explore.step} 步，收获在走完后结算`);
    if (s.cq && s.cq.step) rows.push(`当前这次出窍已走 ${s.cq.step} 步，收获在走完后结算`);
    if (!s.explore && o.exRuns) rows.push(`<span class="bad">离线期间自动探索已结束（生命不足或战败）</span>`);
    if (!s.cq && o.cq.runs) rows.push(`<span class="bad">离线期间出窍已结束（次数用完、生命不足或战败）</span>`);
    if (o.afN) { rows.push(`<b>事务堂</b>`); rows.push(`完成 ${f(o.afN)} 轮，灵石 +${f(o.afStone)}，贡献 +${f(o.afContrib)}`); }
    const other = dStone - o.exStone - o.cq.stone - o.afStone;
    if (other) rows.push(`<b>其他灵石</b>`, `${sign(other)}（自动补充灵气、种田、炼制等收支）`);
    // 背包新增（探索以外：灵药园收获、炼丹、炼器出炉等）
    const now = this.bagCount(), gain = [];
    for (const k in now) { const d = now[k] - (b.bag[k] || 0) - (o.allItems[k] || 0); if (d > 0) gain.push(`${k}×${f(d)}`); }
    if (gain.length) rows.push(`<b>其他新增物品</b>`, gain.join("、"));
    const short = [`修为 ${sign(dExp)}`, `灵石 ${sign(dStone)}`]; if (o.exRuns) short.push(`探索 ${o.exRuns} 次`); if (o.cq.runs) short.push(`出窍 ${o.cq.runs} 次`); if (o.learn.length) short.push(`学会 ${o.learn.join("、")}`); if (o.afN) short.push(`事务堂 ${o.afN} 轮`);
    this.log(`你离开了 ${U.dur(sec)}，离线收益：${short.join("，")}。`, "gold");
    this.lastOffline = rows;
    try { this.modal(`<h2>离线 ${U.dur(sec)}</h2><div class="explore-log">${rows.map(r => `<p>${r}</p>`).join("")}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); } catch (e) {}
  },

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
    this.awaySnap();
    if (!b || !b.t) return;
    const sec = Math.floor((Date.now() - b.t) / 1000); if (sec < this.AWAY_MIN_SEC) return;
    const f = U.fmt, sign = v => (v >= 0 ? "+" : "-") + f(Math.abs(v)), rows = [];
    const dExp = (s.exp || 0) - b.exp, dStone = (s.stone || 0) - b.stone, dLing = (s.ling || 0) - b.ling, dContrib = (s.contrib || 0) - b.contrib, kills = (s.kills || 0) - b.kills;
    const now = this.bagCount(), gain = [];
    for (const k in now) { const d = now[k] - ((b.bag || {})[k] || 0); if (d > 0) gain.push(`${k}×${f(d)}`); }
    if (!dExp && !dStone && !dLing && !dContrib && !kills && !gain.length) return;
    rows.push(`<b>总计</b>`, `修为 ${sign(dExp)}　灵石 ${sign(dStone)}　灵气 ${sign(dLing)}${s.sect || dContrib ? `　贡献 ${sign(dContrib)}` : ""}`);
    if (kills > 0) rows.push(`<b>探索</b>`, `击败 ${f(kills)} 只${s.explore ? "，自动探索仍在继续" : ""}${s.cq ? "，出窍仍在继续" : ""}`);
    if (s.explore && s.explore.step) rows.push(`当前这次已走 ${s.explore.step} 步，收获在走完后结算`);
    if (gain.length) rows.push(`<b>新增物品</b>`, gain.join("、"));
    this.log(`你离开了 ${U.dur(sec)}，期间收益：修为 ${sign(dExp)}，灵石 ${sign(dStone)}${kills > 0 ? `，击败 ${f(kills)} 只` : ""}。`, "gold");
    this.lastOffline = rows;
    try { this.modal(`<h2>离开 ${U.dur(sec)}</h2><div class="explore-log">${rows.map(r => `<p>${r}</p>`).join("")}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); } catch (e) {}
  },

  /* ---------- 主循环（每 0.2 秒检查一次） ---------- */
  loop() { if (!this._stopped) { this.render(); this.bars(); } },

  // 进度条：每一帧按时间直接算宽度（不用 CSS 过渡），页面每秒重绘也不会一顿一顿
  bars() {
    if (!this.s) return;
    const now = Date.now();
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
      const h = `${U.full(this.s.hp)}/${U.full(st.hp)}`, m = `${U.full(this.s.mana)}/${U.full(st.mana)}`;
      if (ph && ph.textContent !== h) ph.textContent = h;
      if (pm && pm.textContent !== m) pm.textContent = m;
    }
  },

  // 当前服务器结算周期内的显示时间；只绘制进度，不在浏览器执行状态结算。
  // 走满后先停在满格等服务器结算（服务器到点立即推送）；超过 3 秒还没收到（断线等）才按周期继续走。
  tickElapsedMs(now = Date.now()) {
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
    $("#p-name").textContent = s.name;
    $("#p-realm").textContent = this.realmName();
    $("#p-stone").textContent = U.fmt(s.stone);
    $("#p-contrib").textContent = U.fmt(s.contrib || 0);   // v27：贡献、功德
    $("#p-merit").textContent = U.fmt(s.merit || 0);
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
    // 正在输入框里打字时也先不替换页面：否则输入框被换掉，手机输入法会自动收起
    if (this.editing(v)) { this._renderDeferred = true; return; }
    const lg0 = document.getElementById("exov-log"), lgTop = lg0 ? lg0.scrollTop : -1;
    const mw0 = document.getElementById("mgwrap"), mwPos = mw0 ? [mw0.scrollLeft, mw0.scrollTop] : null;   // 地图格子：重绘后保持拖动位置   // 探索信息浮层：重绘后保持位置，或「跟随最新」滚到底
    try { const html = this.views[this.tab] ? this.views[this.tab].call(this) : ""; if (html !== this._viewHtml || v.innerHTML === "") { v.innerHTML = html; this._viewHtml = html;
      const lg = document.getElementById("exov-log"); if (lg) lg.scrollTop = this.exFollow === false && lgTop >= 0 ? lgTop : 0;
      const mw = document.getElementById("mgwrap");
      if (mw) this.gridFit(mw);
      if (mw) { if (mwPos) { mw.scrollLeft = mwPos[0]; mw.scrollTop = mwPos[1]; }
        else { const n = +mw.dataset.n || 9, c = +mw.dataset.c || 0, cw = mw.scrollWidth / n;   // 第一次进入：上次游历的格子放在中间
          mw.scrollLeft = (c % n + .5) * cw - mw.clientWidth / 2; mw.scrollTop = (Math.floor(c / n) + .5) * cw - mw.clientHeight / 2; } }
      this.syncLoopAnims(v); }
      this.exovFit(); }   // 最新一条在最上面
    catch (err) { console.error(err); this._viewHtml = null; v.innerHTML = `<div class="card"><h3>页面出错</h3><p class="desc">${String(err && err.message || err)}<br>如果刚改过 js/config/ 里的数值，请检查有没有写错（例如少了小数点、多了问号）。</p></div>`; }
    v.scrollTop = top;
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
  renderLog() { $("#log").innerHTML = this.s.log.map(l => `<p class="${l.c}">${l.m}</p>`).join(""); },
  // 进度条（叠在“学习中 / 剩余时间”文字下面）：left 剩余毫秒，total 总毫秒；外层元素加 class="pg"
  pgFill(left, total) { const p = total > 0 ? Math.min(100, Math.max(0, (1 - left / total) * 100)) : 0; return `<i class="pgf" style="width:${p.toFixed(1)}%"></i>`; },
  modal(html) { $("#modal-box").innerHTML = html; $("#modal").classList.remove("hidden"); },
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
      this.tab = b.dataset.tab; $("#view").scrollTop = 0; this.render();
    });
    // 记录是否正在按住屏幕；抬起后再补一次重绘
    const press = on => () => {
      this._pressing = on;
      if (!on && this._renderDeferred) { this._renderDeferred = false; setTimeout(() => this.render(), 0); }
    };
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
