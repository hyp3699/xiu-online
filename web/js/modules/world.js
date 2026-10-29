/* =====================================================================
 * 模块：世界（六界：凡界 仙界 魔界 冥界 神界 天外天，目前只开放凡界）
 * 凡界内：9 张地图（练气 → 渡劫），每张分 东 西 南 北 四个区域；坊市、设置
 * ---------------------------------------------------------------------
 * 每个区域的 普通怪 / 精英怪 / 首领 属性在 js/config/ 数值文件 的 config/mobs.js 单独设置。
 * 历练：和自动探索一样走 100 步，但只走一次；走完且没战败 = 通过，解锁该区域的自动探索。
 * 自动探索：每次 TIME 步，每步 STEP_SEC 秒（config/explore.js）；固定遇到 10 个普通怪、3 个精英怪、灵药 5~10 次、矿石 5~10 次，
 *   最后一步遇到首领，其余无事发生（顺序随机）。怪物掉 灵石、药材、矿石（不掉丹药、装备）。
 *   历练、自动探索期间都不能修炼。
 * 战斗：速度高者先手，判闪避、暴击；法术栏法术轮流施放（耗法力），不足时普通攻击；战败遗失部分灵石。
 *   法术 / 法宝伤害 = 威力 − (对方防御 × RES_RATE + 对方该系抗性 × RES_EL_RATE)；普通攻击只算 防御 × DEF_RATE（v235）。
 *   怪物也有法力、六系抗性、法术和法宝（见 config/mobs.js 的 mobs.magic）。
 *   一次探索中获得的东西先记下，走完后一起放进背包；
 *   生命够（≥ 三成）就继续下一次，不够就原地休养到满血再自动继续（v186）；探索时不能修炼；离线也继续。
 *   探索信息栏显示每一步发生的事，每秒刷新。
 * 秘境（config/mijing.js）：历练探索时有几率发现；每处每天进一次，先历练通过才能自动探索；探索中 x.mj = 秘境序号、x.queue = 一键探索还没走的秘境。
 * 灵地（config/lingdi.js）：和秘境共用同一套（mjXxx 函数多一个参数 k = "ld"）；探索中 x.mk = "ld"、x.mj = 灵地序号；存档 s.ld。
 * 数值全部在 js/config/ 下的数值文件 的 monster / explore / mijing 部分。
 * ===================================================================== */
G.module({
  id: "world",
  tab: "world",

  /* explore：历练 / 自动探索中
   *   { map 地图序号, reg 区域序号(0东 1西 2南 3北), once 是否历练, start 本次开始时间, step 已走步数, count 已完成次数,
   *     loot 本次收获 { stone, mats: { "herb|名字": {kind,name,g,n} } }（秘境另有 hx、sm，自定义物品 cu）,
   *     ev 本次事件列表（最新在前）, last 上一次结算文字 } */
  // trainedR：已历练通过的区域（地图序号 × 4 + 区域序号）
  // mj：秘境 { found 已发现, trained 已历练通过, day 日期, used { 秘境序号: 今天已进次数 } }；ld：灵地，格式同 mj
  defaults: () => ({ explore: null, trainedR: [], lastRun: null, mj: { found: [], trained: [], day: "", used: {} }, ld: { found: [], trained: [], day: "", used: {} }, grids: {}, gridDay: null, ybEaten: {} }),

  // 每 10 秒（以及在线时每秒）推进探索
  tick() { this.advanceExplore(); },

  api: {
    setWorldTab(t) { this.worldTab = t; this.render(); },
    openAdmin(on) {
      this.adminPage = !!on; this.giftPage = false; this.accPage = false;
      if (on) API.adminInfo().then(j => { this.adminInfo = j; this.render(); }).catch(() => {});
      this.render();
    },

    setHall(h) { this.hallSel = h; this.render(); },
    setWHall(h) { this.hallSel = h; this.render(); this.viewScroll(!h && this.mapRev(this.worldId || "fan") ? -1 : 0); },   // 地图卷轴左下角的 灵地 / 悟道碑
    // 一张地图的东西南北四域（历练 / 探索 / 出窍）
    regionsCard(sel, noTitle) {
      const s = this.s, map = DATA.maps[sel], lock = !this.realmOK(DATA.mapReq(sel)), unl = this.mapUnlocked(sel), tile = true;   // 凡界、四界都用图片格子
      const RG = ["dong", "xi", "nan", "bei"];   // 东西南北四域图 img/map/rg_*.webp
      // 出窍不在这里开：统一用六界图左上「元婴出窍」（openRunList）；这里只显示历练 / 探索
      const rows = DATA.regionDirs.map((d, r) => {
        const R = DATA.region(sel, r), ok = this.isTrained(sel, r), x = s.explore && s.explore.map === sel && (s.explore.reg || 0) === r ? s.explore : null, q = s.cq && s.cq.map === sel && (s.cq.reg || 0) === r ? s.cq : null;
        const btns = lock ? `<button class="sm" disabled>需${DATA.realmLabel(DATA.mapReq(sel))}</button>` : !unl || !this.regionOpen(sel, r) ? `<button class="sm" disabled>未开启</button>` : `<div><button class="sm ${x && x.once ? "on" : ""}" onclick="G.toggleExplore(${sel},${r},true)">${x && x.once ? "停止" : "历练"}</button>
              <button class="sm ${x && !x.once ? "on" : ""}" onclick="G.toggleExplore(${sel},${r})" ${ok ? "" : "disabled"}>${x && !x.once ? "停止" : "探索"}</button></div>`;
        const info = `${ok ? "已通过历练" : "未历练"}${q ? " · 出窍中" : ""}`;   // 不显示首领名
        const gk = this.gridOpen(sel, r) ? ` class="rg-go" onclick="G.openGrid(${sel},${r})"` : "";   // 点区域图进地图格子（独立玩法）
        return tile ? `<div class="rgt${x || q ? " cur" : ""}"><img${gk} src="img/map/rg_${map.w === "fan" ? "" : map.w + "_"}${RG[r] || "dong"}.webp" alt=""><b>${d}域</b><small>${info}</small>${btns}</div>`
          : `<div class="line"><div>${d}域<small>${info}</small></div>${btns}</div>`;
      }).join("");
      return `<div class="card${tile ? " rgcard" : ""}">${noTitle ? "" : `<h3>${map.name}</h3>`}${tile ? `<div class="rggrid">${rows}</div>` : rows}${map.w === "fan" && this.kuangOn() ? this.kuangLine(sel) : ""}</div>`;
    },
    /* ---------- 地图格子（config/youli.js）：每域一张 N×N 格子图，和历练 / 探索 / 出窍无关
     * 点任意格子 = 游历一次（可重复点同一格），每天共 DAILY 次（北京时间 0 点重置），每次按 W 几率得一种：灵石、本图药材、本图矿石、火髓、宝物、游历功法
     * 存档 s.grids["地图_区域"] = { p 上次游历的格子, v 已点亮 }；s.gridDay = { day 日期, n 今日已游历次数, last 上次收获文字, rec 已获机缘（只记宝物、功法） }
     * 宝物服用：s.ybEaten["种类|级"] = 已服个数（data/youli.js）
     * 以后格子里放宗门遗迹、古修洞府 ---------- */
    gridCfg() { return CFG.youli || {}; },
    gridN() { return Math.max(4, Math.min(30, this.gridCfg().N || 9)); },
    gridDaily() { const d = this.gridCfg().DAILY; return d === undefined ? 30 : d; },
    gridOpen(a, r) { return !!DATA.maps[a] && r >= 0 && r < DATA.regionCount && this.realmOK(DATA.mapReq(a)) && this.mapUnlocked(a) && this.regionOpen(a, r); },
    gridToday() {
      const s = this.s, day = this.bjDay();
      if (!s.gridDay || s.gridDay.day !== day) s.gridDay = { day, n: 0, last: "", rec: [] };
      return s.gridDay;
    },
    // 游历：点格子 i（服务器动作）
    gridYouli(a, r, i) {
      a = Number(a); r = Number(r); i = Number(i);
      const N = this.gridN();
      if (!Number.isInteger(a) || !Number.isInteger(r) || !Number.isInteger(i) || i < 0 || i >= N * N) throw new Error("格子不存在");
      if (!this.gridOpen(a, r)) throw new Error("该区域尚未开启");
      const d = this.gridToday();
      if (d.n >= this.gridDaily()) { this.log(`今日游历次数已用完（${this.gridDaily()} 次），明天再来。`, "sys"); return; }
      d.n++;
      d.last = this.gridOnce(a, r, i);
      this.log(`游历${DATA.regionName(a, r)}，获得${d.last}。`, "gold");
      this.dirty(); this.render();
    },
    // 快速游历：一次用完今日剩余次数，优先点亮还黑着的格子（都亮了就随机）
    gridQuick(a, r) {
      a = Number(a); r = Number(r);
      if (!Number.isInteger(a) || !Number.isInteger(r) || !this.gridOpen(a, r)) throw new Error("该区域尚未开启");
      const d = this.gridToday(), left = this.gridDaily() - d.n, N = this.gridN();
      if (left <= 0) { this.log(`今日游历次数已用完（${this.gridDaily()} 次），明天再来。`, "sys"); return; }
      const got = [];
      for (let k = 0; k < left; k++) {
        const g = (this.s.grids || {})[a + "_" + r], lit = new Set(g && Array.isArray(g.v) ? g.v : []);
        const dark = []; for (let i = 0; i < N * N; i++) if (!lit.has(i)) dark.push(i);
        d.n++; got.push(this.gridOnce(a, r, dark.length ? U.pick(dark) : U.rand(0, N * N - 1)));
      }
      d.last = got.join("、");
      this.log(`快速游历${DATA.regionName(a, r)} ${left} 次，获得${d.last}。`, "gold");
      this.dirty(); this.render();
    },
    // 游历一格：点亮格子、发奖励、记进今日「已获机缘」，返回收获文字（不扣次数）
    gridOnce(a, r, i) {
      const loot = this.newLoot();
      const s = this.s, N = this.gridN(), C = this.gridCfg();
      if (!s.grids || typeof s.grids !== "object") s.grids = {};
      const gk = a + "_" + r, g0 = s.grids[gk] && typeof s.grids[gk] === "object" ? s.grids[gk] : {};
      const lit = Array.isArray(g0.v) ? g0.v.filter(n => Number.isInteger(n) && n >= 0 && n < N * N) : (Number.isInteger(g0.p) ? [g0.p] : []);
      if (!lit.includes(i)) lit.push(i);
      s.grids[gk] = { p: i, v: lit };   // v = 已点亮（游历过）的格子
      const R = (v, lo, hi) => Array.isArray(v) ? U.rand(v[0], v[1]) : v === undefined ? U.rand(lo, hi) : v;
      const pool = DATA.mapPool(a);
      // 每次只随机得一种（按 config/youli.js 的 W 几率）：灵石 / 本图药材 / 本图矿石 / 火髓 / 宝物 / 游历功法
      const W = C.W || {}, w = (k, d) => Math.max(0, W[k] === undefined ? d : +W[k] || 0);
      const gfIds = DATA.ylGfIds(a, r).filter(id => !this.ylGfOwned(id)), grades = DATA.ybGradesOf(a);
      const opts = [["stone", w("stone", 47)], ["herb", pool.herb && pool.herb.length ? w("herb", 16) : 0], ["ore", pool.ore && pool.ore.length ? w("ore", 16) : 0],
        ["hx", w("hx", 10)], ["yb", DATA.YB.length && grades.length ? w("yb", 8) : 0], ["gf", gfIds.length ? w("gf", 3) : 0]];
      let roll = Math.random() * opts.reduce((t, o) => t + o[1], 0), k = "stone";
      for (const [kk, ww] of opts) { if (ww <= 0) continue; if (roll < ww) { k = kk; break; } roll -= ww; }
      let txt, rec = false;
      if (k === "yb") { rec = true; const kind = U.rand(0, DATA.YB.length - 1), g = U.pick(grades), nm = DATA.ybName(kind, g);
        txt = this.bagAdd(x => x.t === "ylb" && x.k === kind && x.g === g, n => ({ t: "ylb", k: kind, g, n }), 1, `背包已满，${nm}遗失了。`) ? nm : `${nm}（背包已满，遗失）`; }
      else if (k === "gf") { rec = true; const id = U.pick(gfIds), nm = `《${DATA.gongfaInfo(id, 1).name}》`;
        if (this.bagFull()) txt = `${nm}（背包已满，遗失）`; else { s.bag.push({ t: "gfb", id, n: 1 }); txt = nm; } }
      else {
        if (k === "stone") loot.stone = R(C.STONE, 1000, 3000);
        else if (k === "herb") this.lootAdd(loot, U.pick(pool.herb), R(C.HERB, 50, 100));
        else if (k === "ore") this.lootAdd(loot, U.pick(pool.ore), R(C.ORE, 50, 100));
        else this.lootAdd(loot, DATA.HX, R(C.HX, 5, 20));
        txt = this.giveLoot(loot);
      }
      if (rec) { const d = this.gridToday(); if (!Array.isArray(d.rec)) d.rec = [];   // 已获机缘：只记宝物、功法
        d.rec.unshift({ w: DATA.regionName(a, r), m: txt }); if (d.rec.length > 60) d.rec.length = 60; }
      return txt;
    },
    // 游历功法已学会 / 正在学 / 排队 / 背包里有了：不再掉
    ylGfOwned(id) { return !!(this.s.gongfa[id] || (this.lqHas && this.lqHas("gf", id)) || this.s.bag.some(x => x.t === "gfb" && x.id === id)); },
    // 游历宝物：已服个数、还能服几个、属性合计（craft.js danBonus 里加）
    ybUsed(k, g) { return ((this.s.ybEaten || {})[k + "|" + g]) || 0; },
    ybLeft(k, g) { return Math.max(0, DATA.YB_MAX - this.ybUsed(k, g)); },
    ybBonus() {
      const b = {}, E = this.s.ybEaten || {};
      for (const key in E) { const [k, g] = key.split("|").map(Number), y = DATA.YB[k]; if (!y || !(E[key] > 0)) continue;
        b[y.stat] = (b[y.stat] || 0) + DATA.ybVal(k, g) * E[key]; }
      return b;
    },
    eatYb(i, n) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "ylb" || !DATA.YB[it.k]) return;
      n = Math.min(Math.floor(+n || 1), it.n || 1, this.ybLeft(it.k, it.g));
      if (n <= 0) return this.log(`${DATA.ybName(it.k, it.g)}已达服用上限（每阶 ${DATA.YB_MAX} 个）。`, "sys");
      if (!s.ybEaten || typeof s.ybEaten !== "object") s.ybEaten = {};
      const key = it.k + "|" + it.g, nm = DATA.ybName(it.k, it.g), add = DATA.ybVal(it.k, it.g) * n;
      s.ybEaten[key] = (s.ybEaten[key] || 0) + n;
      this.log(`服下${nm} ×${n}，${DATA.ybLabel(it.k)}永久 +${U.num(add)}。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    // 点格子：先显示「游历中」1.5 秒，再真正游历（纯界面，结算在 gridYouli）
    gridTap(a, r, i) {
      if (this._glRun) return;
      const d = this.s.gridDay;
      if (d && d.day === this.bjDay() && d.n >= this.gridDaily()) return this.gridYouli(a, r, i);
      this._glRun = { a, r, i }; this.render();
      setTimeout(() => { this._glRun = null; try { this.gridYouli(a, r, i); } finally { this.render(); } }, 1500);
    },
    // 已获机缘：今日游历收获（纯界面）
    openGridRec() {
      const d = this.s.gridDay && this.s.gridDay.day === this.bjDay() ? this.s.gridDay : { rec: [] }, rec = Array.isArray(d.rec) ? d.rec : [];
      this.modal(`<h2>已获机缘</h2><div class="explore-log">${rec.length ? rec.map(x => `<p>${x.w}：${x.m}</p>`).join("") : "<p>今日尚未获得宝物或功法。</p>"}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 打开 / 关闭格子页（纯界面）
    openGrid(a, r) { this.gridSel = a === undefined || a === null ? null : { a: Number(a), r: Number(r) }; this.render(); this.viewScroll(0); },
    gridView(a, r, wid) {
      const s = this.s, N = this.gridN(), g = (s.grids || {})[a + "_" + r], d = s.gridDay && s.gridDay.day === this.bjDay() ? s.gridDay : { n: 0, last: "" };
      const D = this.gridDaily(), full = d.n >= D, cells = [];
      const lit = new Set(g ? (Array.isArray(g.v) ? g.v : Number.isInteger(g.p) ? [g.p] : []) : []), cur = g && Number.isInteger(g.p) ? g.p : Math.floor(N * N / 2);
      for (let i = 0; i < N * N; i++) { const on = lit.has(i);
        const run = this._glRun && this._glRun.a === a && this._glRun.r === r && this._glRun.i === i;
        cells.push(`<button class="gc${on ? " on" : ""}${g && g.p === i ? " me" : ""}${run ? " run" : ""}" onclick="G.gridTap(${a},${r},${i})" ${full ? "disabled" : ""}>${run ? "<span>游历中</span>" : ""}</button>`); }
      return `<div class="gridbar gt"><span>今日游历 ${d.n} / ${D} 次</span></div>
        <div id="mgwrap" class="mgwrap" data-c="${cur}" data-n="${N}"><div class="mgrid${this._glRun ? " busy" : ""}" style="background-image:url(img/map/grid_${wid || "fan"}.webp);grid-template-columns:repeat(${N},var(--gcw));grid-template-rows:repeat(${N},var(--gcw))">${cells.join("")}</div></div>`;
    },

    /* ---------- 凡界灵矿（config/explore.js 的 KUANG）：不用历练，不遇怪，只挖灵石；探索中 x.kuang = 1、x.reg = -1 ---------- */
    kuangOn() { return CFG.explore.KUANG.ON !== 0; },   // config/explore.js KUANG.ON
    kuangName(a) { return (CFG.explore.KUANG.NAME || "{map}灵矿").replace("{map}", DATA.maps[a].name); },
    kuangLine(a) {
      const s = this.s, K = CFG.explore.KUANG, x = s.explore && s.explore.kuang && s.explore.map === a ? s.explore : null, q = s.cq && s.cq.kuang && s.cq.map === a ? s.cq : null;
      return `<div class="line"><div>${this.kuangName(a)}<small>${K.DESC}${q ? " · 出窍中" : ""}</small></div>
        ${!this.realmOK(DATA.mapReq(a)) ? `<button class="sm" disabled>需${DATA.realmLabel(DATA.mapReq(a))}</button>` : !this.mapOpen(a) ? `<button class="sm" disabled>未开启</button>` : `<div><button class="sm ${x ? "on" : ""}" onclick="G.toggleKuang(${a})">${x ? "停止" : "探索"}</button></div>`}</div>`;
    },
    kuangPlan() { return "k".repeat(CFG.explore.KUANG.TIME); },
    // 每步灵石 = (当前地图东域灵石 × KUANG.SHARE% + 随机 RAND) ÷ TIME × 随机(0.5 ~ 1.5)（随机取整）；不掉药材矿石
    kuangStone(a) {
      const X = CFG.explore, x = this.s.explore, K = X.KUANG.SHARE === undefined ? 100 : X.KUANG.SHARE;
      const run = x && x.kuang ? this.runStone(x) : this.zoneStone(a, 0) * K / 100;   // 灵矿：本图东域 × SHARE% + 随机 RAND（runStone）
      return Math.floor(run / X.KUANG.TIME * (0.5 + Math.random()) + Math.random());
    },
    toggleKuang(a) {
      const s = this.s;
      if (s.explore && s.explore.kuang && !s.explore.cq && s.explore.map === a) { this.stopExplore("停止挖矿"); return this.after(); }
      if (s.trib && !s.trib.result) return this.log("渡劫中，不能外出。", "sys");   // 渡劫中只能停止，不能新开 / 更换
      if (!this.kuangOn() || !this.mapOpen(a)) return;   // 灵矿已关闭（KUANG.ON = 0）
      if (s.explore) this.stopExplore("更换");
      if (s.cultSet) s.cultSet.went = false;   // 手动开始的不算修炼设置自动去的（自动去时 cultSetCheck 会再标记）
      s.explore = { map: a, reg: -1, kuang: 1, once: false, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.kuangPlan(), ms: this.exploreMs() };
      this.exploreOpen = true; this.exInfo = "ex";
      this.log(`开始在${this.kuangName(a)}挖矿（期间无法修炼）。`, "sys");
      this.after();
    },
    setWorld(id) { if (this.worldId !== id) { this.mapSel = undefined; this.hallSel = null; } this.mapPage = false; this.worldId = id; this.atlasOn = false; this.atlasSub = null; this.render(); this.viewScroll(this.mapRev(id) ? -1 : 0); },
    // 六界图 / 地图卷轴 / 探索信息浮层（纯界面状态，不进服务器白名单）
    openAtlas() { this.atlasOn = true; this.atlasSub = null; this.render(); this.viewScroll(0); },
    setAtlasSub(k) { this.atlasSub = k; this.atlasOn = !k; this.adminPage = false; this.render(); this.viewScroll(0); },
    // y < 0 = 滚到最底（仙界、魔界第一张图在下面）；图片陆续加载会变高，过一会儿再滚几次
    viewScroll(y) { if (typeof document === "undefined") return; const v = document.getElementById("view"); if (!v) return;
      v.scrollTop = y < 0 ? v.scrollHeight : y;
      // 图片还在加载时高度会变：玩家没自己滑动（scrollTop 没变）就继续贴到底
      if (y < 0) { const t0 = this._vsT = Date.now(); let last = v.scrollTop; [60, 200, 400, 700, 1100, 1600, 2400, 3500].forEach(ms => setTimeout(() => { if (this._vsT === t0 && Math.abs(v.scrollTop - last) < 4) { v.scrollTop = v.scrollHeight; last = v.scrollTop; } }, ms)); } },
    mapRev(wid) { return wid === "xian" || wid === "mo" || wid === "shen"; },   // 仙界、魔界、神界第一张图在最下面
    // 元婴出窍 / 自动探索 列表：所有能出窍 / 探索的地图（已历练通过的区域 + 凡界灵矿），可隐藏（存在本机）
    runHidden(k) { try { return JSON.parse(localStorage.getItem("xiu_runhide_" + k) || "[]"); } catch (e) { return []; } },
    hideRun(k, key) { const h = this.runHidden(k), i = h.indexOf(key); if (i >= 0) h.splice(i, 1); else h.push(key); try { localStorage.setItem("xiu_runhide_" + k, JSON.stringify(h)); } catch (e) {} this.openRunList(k); },
    toggleRunHid(k) { this.runShowHid = !this.runShowHid; this.openRunList(k); },
    openRunList(k) {
      const s = this.s, cq = k === "cq", hid = this.runHidden(k), rows = [];
      DATA.worlds.forEach(w => { if (!this.worldOpen(w.id)) return;
        (DATA.worldMapIdx[w.id] || []).slice().sort((a, b) => DATA.mapReq(a) - DATA.mapReq(b) || a - b).forEach(a => {
          if (!this.realmOK(DATA.mapReq(a)) || !this.mapUnlocked(a)) return;
          const m = DATA.maps[a];
          DATA.regionDirs.forEach((d, r) => { if (!this.regionOpen(a, r) || !this.isTrained(a, r)) return;
            const run = cq ? s.cq && !s.cq.kuang && s.cq.map === a && (s.cq.reg || 0) === r : s.explore && !s.explore.once && !s.explore.kuang && s.explore.mj === undefined && s.explore.map === a && (s.explore.reg || 0) === r;
            rows.push({ key: a + "_" + r, name: `${w.name} · ${m.name} · ${d}域`, run, act: cq ? (run ? `G.stopChuqiao(${a},${r})` : `G.openChuqiao(${a},${r})`) : `G.toggleExplore(${a},${r})` }); });
          if (w.id === "fan" && this.kuangOn() && this.mapOpen(a)) { const run = cq ? s.cq && s.cq.kuang && s.cq.map === a : s.explore && s.explore.kuang && !s.explore.cq && s.explore.map === a;
            rows.push({ key: a + "_k", name: `${w.name} · ${this.kuangName(a)}`, run, act: cq ? (run ? `G.stopChuqiao(${a},-1)` : `G.openChuqiao(${a},-1)`) : `G.toggleKuang(${a})` }); }
        }); });
      const show = rows.filter(x => this.runShowHid || !hid.includes(x.key)), nh = rows.filter(x => hid.includes(x.key)).length, dis = cq && !s.cqLearn;
      this.modal(`<h2>${cq ? "元婴出窍" : "自动探索"}</h2>
        ${dis ? `<p class="desc" style="text-align:center">尚未学会元婴出窍。</p>` : ""}
        <div class="row small" style="align-items:center"><span>可${cq ? "出窍" : "探索"} ${rows.length} 处${nh ? ` · 已隐藏 ${nh} 处` : ""}</span>${nh ? `<button class="sm pill" onclick="G.toggleRunHid('${k}')">${this.runShowHid ? "收起已隐藏" : "显示已隐藏"}</button>` : ""}</div>
        <div class="runlist">${show.map(x => `<div class="line${hid.includes(x.key) ? " dimrow" : ""}"><div>${x.name}</div><div><button class="sm pill${x.run ? " on" : ""}" onclick="${x.act}" ${dis && !x.run ? "disabled" : ""}>${x.run ? "停止" : cq ? "出窍" : "探索"}</button><button class="sm pill" onclick="G.hideRun('${k}','${x.key}')">${hid.includes(x.key) ? "显示" : "隐藏"}</button></div></div>`).join("") || `<p class="desc" style="text-align:center">${rows.length ? "都隐藏了。" : "还没有可以" + (cq ? "出窍" : "探索") + "的地图（先历练通过区域）。"}</p>`}</div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setMapPage(v) { this.mapPage = !!v; this.hallSel = null; this.render(); if (!v) this.viewScroll(this.mapRev(this.worldId || "fan") ? -1 : 0); },
    setExFollow() { this.exFollow = this.exFollow === false; this.render(); },
    // v45：这一界开放没有（config/worldmaps.js 的 open）
    worldOpen(id) {
      if (id === "fan") return true;
      const W = (CFG.worldMaps || {})[id]; if (!W || !(DATA.worldMapIdx[id] || []).length) return false;
      if (DATA.isTest()) return true;   // 测试模式四界全开（没地图的界仍不开）
      const o = W.open || {};
      if (o.realm !== undefined && !this.realmOK(o.realm)) return false;
      if (o.map) { const a = (DATA.worldMapIdx[o.map[0]] || [])[o.map[1] - 1]; if (a === undefined || !this.isTrained(a, 3)) return false; }
      return true;
    },
    mapOpen(a) { return this.worldOpen(DATA.maps[a].w || "fan") && this.realmOK(DATA.mapReq(a)) && this.mapUnlocked(a); },
    // v52：同一界上一张地图（按境界从低到高）北域通关后才开启下一张
    mapPrev(a) {
      const idx = (DATA.worldMapIdx[DATA.maps[a].w || "fan"] || []).slice().sort((x, y) => DATA.mapReq(x) - DATA.mapReq(y) || x - y), i = idx.indexOf(a);
      return i > 0 ? idx[i - 1] : undefined;
    },
    mapUnlocked(a) {
      if (DATA.isTest()) return true;
      const p = this.mapPrev(a);
      return p === undefined || this.isTrained(p, DATA.regionCount - 1) || DATA.regionDirs.some((d, r) => this.isTrained(a, r));
    },
    // v52：东域通关后开启西域，依次类推
    regionOpen(a, r) { return this.mapOpen(a) && (r === 0 || DATA.isTest() || this.isTrained(a, r - 1) || this.isTrained(a, r)); },

    regionKey(a, r) { return a * DATA.regionCount + r; },
    isTrained(a, r) { return this.s.trainedR.includes(this.regionKey(a, r)); },

    // 生成怪物：a 地图、r 区域、kind = normal 普通 / elite 精英 / boss 首领（属性见 js/config/ 数值文件 monster.regions）
    makeMob(a, r, kind) {
      const R = DATA.region(a, r), b = DATA.mobMeet(R, kind), map = DATA.maps[a];   // v168 每次遇到随机层 / 功法
      const v = (x, k) => x * DATA.mobRnd(k);   // × 随机浮动
      const name = kind === "boss" ? DATA.regionBoss(a, r) : (kind === "elite" ? "精英·" : "") + U.pick(map.monsters);
      return this.addMagic({ name, Lm: R.L, kind, boss: kind === "boss", elite: kind === "elite", elKey: kind === "boss" ? `b:${a}:${r}` : "",
        hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, kind);
    },

    // 给怪物加 属性 / 六系抗性 / 法术 / 法宝（config/mobs.js 的 mobs.magic）
    addMagic(m, kind, b = {}) {
      // kind：normal / elite / boss / tower，或直接写中文种类（考核、天将、星君、界主）
      const MG = CFG.mobs.magic || {}, M = MG[{ normal: "普通", elite: "精英", boss: "首领", tower: "试炼塔" }[kind] || kind] || {};
      m.el = b.el || (m.elKey && this.mobElOf(m.elKey)) || U.pick(DATA.elements).id;   // 首领 / 天将 / 星君 / 界主：存档里定死的属性（mobElInit）
      const fx = m.elKey && this.mobFixOf(m.elKey); if (fx) { m.mf = (fx.mf || []).slice(); m.tfFix = fx.tf || []; }   // 定死的秘法、天赋
      const O = 1;   // 本属性抗性改为进战斗随机 +%（下面 ELRES），不再按种类乘 OWN_RES
      m.mana = m.maxMana = b.mana !== undefined ? b.mana : m.mana || 0;   // 法力 = 修为突破 + 肉身突破的法力 × 倍率（同其他属性）
      const r0 = m.res, rv = typeof r0 === "number" ? r0 : 0;   // 数字 = 六系一样；对象 = 每系单独（真经按系分开算）
      m.res = {};
      for (const e of DATA.elements) m.res[e.id] = b.res && b.res[e.id] !== undefined ? b.res[e.id] : (r0 && typeof r0 === "object" ? +r0[e.id] || 0 : rv) * DATA.mobRnd("res_" + e.id) * (e.id === m.el ? O : 1);   // v227 每系单独随机；每系抗性 = 怪物抗性（修为 + 肉身 + 真诀）× 倍率，本属性再 × OWN_RES
      // 进战斗：本属性那系抗性 +UP%，克它的那系 −DOWN%（金克木 木克土 土克水 水克火 火克金；雷随机一系），都在范围内随机
      if (!b.res) {
        const ER = Object.assign({ UP: [15, 25], DOWN: [15, 22], KE: { mu: "jin", tu: "mu", shui: "tu", huo: "shui", jin: "huo" } }, MG.ELRES || {});
        const rr = a => a[0] + Math.random() * ((a[1] ?? a[0]) - a[0]);
        const ke = ER.KE[m.el] || U.pick(DATA.elements.filter(e => e.id !== m.el)).id;
        if (m.res[m.el] !== undefined) m.res[m.el] *= 1 + rr(ER.UP) / 100;
        if (m.res[ke] !== undefined) m.res[ke] *= Math.max(0, 1 - rr(ER.DOWN) / 100);
        m.weakEl = ke;
      }
      const cv = c => c ? { chance: c.几率 || 0, pct: c.伤害 || 0, mana: c.消耗 || [0, 1] } : null;
      m.spell = cv(M.法术); m.fabao = cv(M.法宝);
      m.manaK = DATA.manaRealmK(m.L);   // 法术、法宝法力消耗的境界倍率（config/mobs.js magic.MANA_REALM）
      const MR = +((CFG.rates || {}).MOB ?? 1);   // config/rates.js 怪物属性总倍率（暴击%不乘；雷劫不走这里）
      if (MR !== 1 && MR >= 0) { for (const k of ["hp", "atk", "def", "speed", "hit", "dodge"]) if (typeof m[k] === "number") m[k] *= MR; m.mana = m.maxMana = m.mana * MR; for (const e in m.res) m.res[e] *= MR; }
      const S = M.盾; m.shield = S ? { chance: S.几率 || 0, max: S.次数 || 0, hp: S.护盾值, def: S.盾防御, mana: S.消耗 || [0, 1], red: MG.SHIELD_RED || 0 } : null;
      return m;
    },

    // 首领 / 天将 / 星君 / 界主的属性：第一次进游戏时随机定死（s.mobEl { 键: 元素id }），每类里六种属性平均分；以后新加的按该类最少的属性补
    //   键：首领 b:地图:区域、mj:秘境、ld:灵地；天将 tj:地图；星君 xj:地图:位；界主 jz:地图
    mobElKeys() {
      const C = { 首领: [], 天将: [], 星君: [], 界主: [] };
      DATA.maps.forEach((mp, a) => { for (let r = 0; r < DATA.regionCount; r++) C.首领.push(`b:${a}:${r}`);
        if (mp.w && mp.w !== "fan") { C.天将.push(`tj:${a}`); C.界主.push(`jz:${a}`); this.xjSeats(a).forEach((n, i) => C.星君.push(`xj:${a}:${i}`)); } });
      this.mjCfg().list.forEach((d, i) => C.首领.push(`mj:${i}`));
      this.mjCfg("ld").list.forEach((d, i) => C.首领.push(`ld:${i}`));
      return C;
    },
    mobElInit(s) {
      const E = DATA.elements.map(e => e.id), M = s.mobEl || (s.mobEl = {}), C = this.mobElKeys();
      for (const c in C) {
        const todo = C[c].filter(k => !E.includes(M[k])); if (!todo.length) continue;
        for (let i = todo.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [todo[i], todo[j]] = [todo[j], todo[i]]; }
        const n = {}; E.forEach(e => n[e] = 0); C[c].forEach(k => { if (n[M[k]] !== undefined) n[M[k]]++; });
        for (const k of todo) { const lo = Math.min(...E.map(e => n[e])), pool = E.filter(e => n[e] === lo), e = U.pick(pool); M[k] = e; n[e]++; }
      }
      // 秘法、天赋也一起定死（s.mobFix { 键: { mf, tf } }）
      const F = s.mobFix || (s.mobFix = {});
      for (const c in C) for (const k of C[c]) { if (F[k]) continue;
        const R = this.mobRandCfg(c); F[k] = { mf: this.rollMf(R), tf: this.rollTf(R) }; }   // config/battle.js MOB_RAND
    },
    mobElOf(k) { const M = this.s.mobEl || {}; return M[k] || ""; },
    mobFixOf(k) { return (this.s.mobFix || {})[k] || null; },

    // 怪物天赋（config/battle.js 的 TALENT）：第一次战斗时定，m.tf = ["lianji", "xishou_huo", …]；属性类天赋这时直接加到怪物属性上
    //   首领 / 天将 / 星君 / 界主用存档定死的 m.tfFix；普通 / 精英按 MOB_RAND 每次随机（只地图上的怪）
    mobTalents(m) {
      const T = CFG.battle.TALENT || {};
      m.tf = m.tfFix ? m.tfFix.slice() : m.a >= 0 && DATA.maps[m.a] ? this.rollTf(this.mobRandCfg(m.elite ? "精英" : m.boss ? "首领" : "普通")) : [];
      const up = 1 + (T.STAT || 0) / 100, has = k => m.tf.includes(k);
      if (has("minjie")) { m.speed *= up; m.hit *= up; }
      if (has("qiangzhuang")) m.hp *= up;
      if (has("fangyu")) m.def *= up;
      if (has("qiangli")) m.atk *= up;
    },
    mobRandCfg(c) { return (CFG.battle.MOB_RAND || {})[c] || {}; },
    // 从 pool 里不重复抽：几率% 有，种数 [最少, 最多]
    randSome(pool, pct, N) {
      const p = pool.slice(), out = []; if (Math.random() * 100 >= (pct || 0)) return out;
      const R = Array.isArray(N) ? N : [N || 1, N || 1]; let n = R[0] + Math.floor(Math.random() * (R[1] - R[0] + 1));
      while (n-- > 0 && p.length) out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
      return out;
    },
    rollTf(c) { return this.randSome(Object.keys((CFG.battle.TALENT || {}).NAME || {}), c.天赋几率, c.天赋种数).map(k => k === "xishou" ? "xishou_" + U.pick(DATA.elements).id : k); },
    rollMf(c) { return this.randSome((CFG.wudao.MOB_MIFA || {}).POOL || [], c.秘法几率, c.秘法种数); },
    tfName(k) { const N = (CFG.battle.TALENT || {}).NAME || {}, [a, el] = k.split("_"); return el ? `${(DATA.elById[el] || {}).name || ""}系${N[a] || a}` : N[a] || a; },

    // 通用战斗：速度高者先手，判闪避、暴击。返回 { win, lose, rounds, why, log }，并更新玩家生命、法力
    //   log：完整战斗过程（点「详情」查看），格式见 battleDetail
    //   opt.test（v158 实力测试）：v244 起双方照常扣生命、法力（只在测试画面里），一方倒下或打满 TEST_ROUNDS 回合结束；结束后人物生命 / 法力还原成测试前
    //   v245 进入测试时生命、法力按满的算（不管测试前多少），退出后还原成测试前的数，测试不影响原本的生命、法力
    battle(m, opt = {}) {
      const st = this.stats(), s = this.s, TEST = !!opt.test;
      if (!m.tf) this.mobTalents(m);
      const TL = CFG.battle.TALENT || {}, tf = k => m.tf.includes(k), tfOf = (X, k) => !!(X && X.tf && X.tf.includes(k));
      const tHp = s.hp, tMp = s.mana; if (TEST) { s.hp = st.hp; s.mana = st.mana; }   // v245 实力测试：进入时生命、法力回满，结束后还原成测试前的数
      const spells = s.spellSlots.slice(0, this.slotCount()).map(id => DATA.spellInfo(id, s.gongfa[id])).filter(Boolean);
      let si = 0, act = null;   // act：这一下出手的方式 { k: 0 普通攻击 / 1 法术 / 2 法宝, sp 法术名序号, f: 0 命中 / 1 被闪避 / 2 暴击 }
      const BT = CFG.battle, myL = s.mortal ? 0 : s.L, mL = m.L === undefined ? myL : m.L, MIN = A => A === st ? DATA.minDmg(myL, mL) : DATA.minDmg(A.L === undefined ? myL : A.L, myL), rnd = () => BT.RAND_MIN + Math.random() * (BT.RAND_MAX - BT.RAND_MIN);
      // 某系抗性 = 防御 × RES_RATE + 该系抗性（config/battle.js）
      const RR = BT.RES_RATE === undefined ? BT.DEF_RATE : BT.RES_RATE, ER = BT.RES_EL_RATE === undefined ? 1 : BT.RES_EL_RATE, resOf = (D, el) => D.def * RR + ((D.res || {})[el] || 0) * ER;
      // 伤害减免（config/battle.js FORMULA）：ratio 按比例，sub 旧的直接相减；L = 攻击方层序
      const RAT = DATA.ratioOn(), ATK = (p, D, L) => RAT ? DATA.cutAtk(p, D.def, L) : p - D.def * BT.DEF_RATE,
        EL = (p, D, el, L, ign = 0) => RAT ? DATA.cutEl(p, D.def, (D.res || {})[el] || 0, L, ign) : p - Math.max(0, resOf(D, el) - ign);   // v235 法术 / 法宝减免 = 防御 × RES_RATE(0.9) + 该系抗性（抗性不再 × DEF_RATE）
      // 护盾破碎时溢出的伤害要按本身防御算：rawFn 是「按某个防御方算的基础伤害」，altD = 不带盾的防御方，act.altR = 不带盾 / 带盾 的伤害比
      let altD = null;
      const roll = (A, D, rawFn, k, sp) => {
        act = { k, sp, f: 0 };
        const raw = rawFn(D); if (altD && raw > 0) act.altR = rawFn(altD) / raw;
        if (!tfOf(A, "bizhong") && Math.random() * 100 < DATA.dodgeChance(A.hit, D.dodge, k)) { act.f = 1; return 0; } // 闪避（看命中与闪避之比；v220 法术 / 法宝另加命中率）
        let d = raw * rnd();
        if (!tfOf(D, "xingyun") && Math.random() * 100 < Math.min(DATA.CRIT_CAP, A.crit + (k === 0 && tfOf(A, "baoji") ? TL.BAOJI || 0 : 0))) { d *= BT.CRIT_MULT; act.f = 2; } // 暴击（天赋：幸运不被暴击、暴击加普攻暴击率）
        return d;
      };
      const hit = (A, D) => roll(A, D, X => Math.max(MIN(A), ATK(A.atk, X, A === st ? myL : mL)), 0);
      // v57：鼎 → 对方速度 / 命中 / 闪避降低（m.deb，剩 left 回合）；印 → 对方眩晕（m.stun 回合）；盾 → 护盾（shield，打光为止）
      const mE = () => m.deb ? Object.assign({}, m, { speed: m.speed * (1 - m.deb.speed / 100), hit: m.hit * (1 - m.deb.hit / 100), dodge: m.dodge * (1 - m.deb.dodge / 100) }) : m;
      let shield = null;
      // v25：炼制法宝也能祭出（金木水火土雷属性伤害，消耗法力）
      const fabaos = s.fabao.slice(0, this.slotCount()).filter(e => e && e.attrs).map(e => DATA.fabaoInfo(e));
      // 玩家出手：法术、法宝按顺序轮流（法术在前），法力不足的跳过，都放不出就普通攻击；战斗设置（battleset.js 的 s.bset）可改
      const fbSlots = s.fabao.slice(0, this.slotCount()).map((e, i) => e && e.attrs ? i : -1).filter(i => i >= 0);
      const acts = [...spells.map((sp, i) => ({ k: 1, sp, key: "sp:" + sp.id })), ...fabaos.map((fb, i) => ({ k: 2, fb, key: "fb:" + fbSlots[i] }))];
      const spNames = [...spells.map(sp => sp.name), ...fabaos.map(fb => fb.name)];
      // 法宝伤害：攻击 × 伤害%，按「防御×RES_RATE + 该系抗性 − 无视抗性」减免；再加附加伤害 = 主伤害 × %
      const fabaoDmg = (fb, D = m) => {
        let d = Math.max(MIN(st), EL(fb.atk * fb.pct / 100, D, fb.el, myL, fb.ign));
        let ex = 0; for (const x of fb.extra) ex += d * x.pct / 100;   // 附加伤害：主伤害 × %
        return (d + ex + (fb.addDmg || 0)) * (1 + (fb.fuPct || 0) / 100);   // v152 强化附加伤害（固定数字）；融合：伤害结果 +%
      };
      // 战斗设置只对 探索 / 出窍 / 历练（含秘境）生效（opt.useSet）；考核、试炼塔、测试、天将、星君、界主等按默认方式出手
      const BS = opt.useSet ? this.bsetGet() : { foe: {}, r: [], mode: "rot", off: [], order: [], lowPct: 0, lowKey: "" }, onlyAtk = !!opt.foe && (BS.foe || {})[opt.foe] === "atk", off = BS.off || [],   // v241 按对手类型：只能普通攻击（优先于回合设置）
       keepMp = 0, rKeys = BS.r || [];
      let rDone = 0;
      // 出一招：a = acts[j]；res = true 可以动用保留的法力；放不出返回 null
      const usedN = {};   // v152 这场战斗每招已用几次
      let res2 = false;
      const jmUp = el => 1 + (this.jmElDmg ? this.jmElDmg(el) : 0) / 100, jmDn = el => 1 - (this.jmElCut ? this.jmElCut(el) : 0) / 100;   // 经脉：手部 +% / 腿部 −%（config/jingmai.js elDmg / elCut）
      const cast = (j, res) => {
        const a = acts[j]; if (!a) return null;
        const cost = a.k === 1 ? a.sp.mana : a.fb.mana;
        if (a.k === 2 && a.fb.shield && (shield || !res2)) return null;   // 护盾还在：盾不用再祭；v165 盾只在出手前免费祭（res2），不占出手
        if (s.mana < cost || (!res && s.mana - cost < keepMp)) return null;
        if ((usedN[j] || 0) >= ((a.k === 1 ? a.sp.uses : a.fb.uses) || 1)) return null;   // v152 每场战斗使用次数用完
        usedN[j] = (usedN[j] || 0) + 1;
        s.mana -= cost;
        if (a.k === 1) { const sp = a.sp, d = roll(st, mE(), X => Math.max(MIN(st), EL(sp.atk * sp.pct / 100 * sp.mul * this.lingenSpell(sp.el.id) + (sp.jyDmg || 0), X, sp.el.id, myL)) * (1 + (sp.fuPct || 0) / 100) * jmUp(sp.el.id), 1, j);   // 融合：伤害结果 +%；经脉该系属性伤害 +%
          if (!opt.test) { const xd = CFG.gongfa.XD_GAIN === undefined ? 1 : CFG.gongfa.XD_GAIN; if (xd > 0) { const X = this.s.spXd = this.s.spXd || {}; X[sp.el.id] = (X[sp.el.id] || 0) + xd; act.x = (act.x || 0) | 256; } }   // v239 法术心得
          return d; }
        const fb = a.fb;
        if (fb.shield) { shield = Object.assign({ el: fb.el }, fb.shield); act = { k: 3, sp: j, f: 0 }; return 0; }
        let d = roll(fb.hit || fb.critAdd ? Object.assign({}, st, { hit: st.hit + (fb.hit || 0), crit: st.crit + (fb.critAdd || 0) }) : st, mE(), X => fabaoDmg(fb, X) * jmUp(fb.el), 2, j);   // 经脉该系属性伤害 +%   // 刀 / 锤专属：本次攻击额外命中、暴击
        if (act.f === 2 && fb.crit) d *= fb.crit / 100 / BT.CRIT_MULT;   // 锤：暴击伤害 %（代替普通暴击倍率）
        if (act.f !== 1) {
          if (fb.ding) { m.deb = { speed: fb.ding.speed, hit: fb.ding.hit, dodge: fb.ding.dodge, left: fb.ding.rounds }; act.x = 2; }
          if (fb.yin && Math.random() * 100 < fb.yin.chance) { m.stun = Math.max(m.stun || 0, fb.yin.rounds); act.x = (act.x || 0) | 1; }
        }
        return d;
      };
      const est = a => a.k === 1 ? Math.max(MIN(st), EL(a.sp.atk * a.sp.pct / 100 * a.sp.mul * this.lingenSpell(a.sp.el.id) + (a.sp.jyDmg || 0), m, a.sp.el.id, myL)) * (1 + (a.sp.fuPct || 0) / 100) * jmUp(a.sp.el.id) : a.fb.shield ? -1 : fabaoDmg(a.fb) * jmUp(a.fb.el);
      const costOf = a => a.k === 1 ? a.sp.mana : a.fb.mana;
      const jOf = key => acts.findIndex(a => a.key === key);
      const useJ = acts.map((a, j) => j).filter(j => !off.includes(acts[j].key));
      const ptr = {};   // 各组轮流到第几个
      const rot = (js, g) => {   // 在 js 里轮流，放出一招返回伤害，都放不出返回 null
        let d; const p = ptr[g] || 0;
        for (let k = 0; k < js.length; k++) { const i = (p + k) % js.length; if ((d = cast(js[i])) !== null) { ptr[g] = i + 1; return d; } }
        return null;
      };
      const seq = js => { let d; for (const j of js) if ((d = cast(j)) !== null) return d; return null; };
      const spJ = useJ.filter(j => acts[j].k === 1), fbJ = useJ.filter(j => acts[j].k === 2);
      const ordIdx = key => { const i = (BS.order || []).indexOf(key); return i < 0 ? 999 + jOf(key) : i; };
      const myHit = () => {
        let d;
        if (meSeal || onlyAtk) return hit(st, mE());   // 被镇魂 / v241 战斗设置该类对手只普通攻击：只能普通攻击
        // 生命低于设定：先用设定的防御法宝 / 法术（可动用保留法力）
        if (BS.lowPct > 0 && BS.lowKey && php < st.hp * BS.lowPct / 100 && (d = cast(jOf(BS.lowKey), true)) !== null) return d;
        // 第一 ~ 三回合：每回合第一次出手按设置
        if (rDone !== rounds) {
          rDone = rounds;
          const rk = rKeys[rounds - 1];
          if (rk === "atk") return hit(st, mE());
          if (rk && rk !== "auto" && (d = cast(jOf(rk), true)) !== null) return d;
        }
        const md = BS.mode || "rot";
        if (md === "sp") d = rot(spJ, "s"), d = d !== null ? d : rot(fbJ, "f");
        else if (md === "fb") d = rot(fbJ, "f"), d = d !== null ? d : rot(spJ, "s");
        else if (md === "max") d = seq(useJ.filter(j => est(acts[j]) >= 0).sort((x, y) => est(acts[y]) - est(acts[x])));
        else if (md === "cheap") d = seq(useJ.filter(j => est(acts[j]) >= 0).sort((x, y) => costOf(acts[x]) - costOf(acts[y])));
        else if (md === "atk") d = null;   // v242 剩余回合只普通攻击
        else if (md === "list") d = seq(useJ.slice().sort((x, y) => ordIdx(acts[x].key) - ordIdx(acts[y].key)));
        else d = rot(useJ, "a");
        return d !== null ? d : hit(st, mE());
      };
      let php = s.hp, mhp = m.hp, rounds = 0, dealt = 0, taken = 0;
      const W = CFG.wudao, MB = this.mifaBonus(), LX = W.LIANXING || {}, lxMe = MB.lianxing || 0;
      // 怪物秘法：第一次战斗时随机决定有哪几种（m.mf）
      if (!m.mf) {
        m.mf = this.rollMf(this.mobRandCfg(m.elite ? "精英" : m.boss ? "首领" : "普通"));   // 普通 / 精英每次随机（config/battle.js MOB_RAND）；首领等已在 addMagic 读存档
      }
      const hasM = k => m.mf.includes(k), lxMob = hasM("lianxing") ? LX.MOB || 0 : 0;
      // 战斗秘法（config/wudao.js）：御天 保命、破军 无视防御、血煞 低血增伤、镇魂 只能普攻、金蝉 免疫攻击
      const YT = W.YUTIAN || {}, PJ = W.POJUN || {}, XS = W.XUESHA || {}, ZH = W.ZHENHUN || {}, JC = W.JINCHAN || {};
      const P = (me) => me ? { yt: MB.yutian || 0, ytT: YT.TIMES || 0, pj: MB.pojun || 0, pjI: MB.pojunIgn || 0, xs: MB.xuesha || 0, zh: MB.zhenhun || 0, zhT: ZH.TIMES || 0, zhR: MB.zhenhunR || 3, jc: MB.jinchan || 0, jcT: JC.TIMES || 0, jcC: MB.jinchanCut || 0 }
        : { yt: hasM("yutian") ? YT.MOB || 0 : 0, ytT: YT.MOB_TIMES || 0, pj: hasM("pojun") ? PJ.MOB || 0 : 0, pjI: PJ.MOB_IGNORE || 0, xs: hasM("xuesha") ? XS.MOB || 0 : 0,
          zh: hasM("zhenhun") ? ZH.MOB || 0 : 0, zhT: ZH.TIMES || 0, zhR: ZH.MOB_ROUNDS || 3, jc: hasM("jinchan") ? JC.MOB || 0 : 0, jcT: JC.TIMES || 0, jcC: JC.MOB_CUT || 0 };
      const pMe = P(true), pMob = P(false), cnt = { me: { yt: 0, zh: 0, jc: 0 }, mob: { yt: 0, zh: 0, jc: 0 } };
      let meSeal = 0, mobSeal = 0, meJc = 0, mobJc = 0, sealR = { me: 0, mob: 0 };
      const ch = v => v > 0 && Math.random() * 100 < v;
      // 出手后的伤害修正：血煞增伤、金蝉自降、对方金蝉免疫；返回修正后的伤害
      const after = (d, p, hpNow, hpMax, myJc, tgtJc) => {
        if (!(d > 0) || act.k >= 3) return d;
        if (p.xs > 0) { const r = hpNow / hpMax; d *= 1 + p.xs / 100 * (r * 100 <= (XS.FULL_AT || 0) ? 1 : Math.max(0, 1 - r)); }
        if (myJc) d *= 1 - p.jcC / 100;
        if (tgtJc && act.f !== 1) { d = 0; act.x = (act.x || 0) | 128; }
        return d;
      };
      // v174 本场人物速度随机 95%~105%（怪物属性本身已随机，不再随机），谁快谁先出手
      const SR = BT.SPEED_RAND || [100, 100], spMe = (SR[0] + Math.random() * (SR[1] - SR[0])) / 100, spMob = 1;
      const hp0 = s.hp, mana0 = s.mana, meFirst = st.speed * spMe >= m.speed * spMob;
      // 怪物出手：先判法术，再判法宝（都按 防御×RES_RATE + 该系抗性 减免），都没有就普通攻击
      let mSp = 0, mFb = 0;
      const mCast = (k, el) => {
        const c = m[k], P = c && c.mana || [0, 1], cost = c ? (m.manaBr || 0) * P[0] * (P[1] === undefined ? 1 : P[1]) * (m.manaK ?? 1) : 0;   // 耗法力 = 修为突破法力 × 比例 × 倍率 × 境界倍率
        if (!c || m.mana < cost || Math.random() * 100 >= c.chance) return -1;
        m.mana -= cost; k === "spell" ? mSp++ : mFb++;
        const d = roll(mE(), st, X => Math.max(MIN(m), el ? EL(m.atk * c.pct / 100, X, el, mL) : ATK(m.atk * c.pct / 100, X, mL)), k === "spell" ? 1 : 2);
        return el && d > 0 ? d * (tf("lingxing") ? 1 + (TL.LINGXING || 0) / 100 : 1) * jmDn(el) : d;   // 天赋灵性：金木水火土雷属性伤害都增加；经脉腿部：受到该系伤害 −%
      };
      const mobHit = () => { let d = mCast("spell", m.el); if (d < 0) d = mCast("fabao", m.el); return d < 0 ? hit(mE(), st) : d; };   // v25：怪物法宝也是属性伤害
      // 每一下记一条：[回合, 谁(0 你 / 1 对方), 方式, 法术名序号, 结果, 伤害, 你的生命, 你的法力, 对方生命, 对方法力]
      const log = [], R = Math.round;
      //   v57 多两格：[10] 标记（1 眩晕对方 2 鼎减益 4 护盾破碎）、[11] 护盾抵挡的伤害；方式 3 = 祭起护盾（伤害格 = 护盾值）、4 = 被眩晕
      const rec = (w, d) => log.push([rounds, w, act.k, act.sp === undefined ? -1 : act.sp, act.f, R(d), R(Math.max(0, php)), R(s.mana), R(Math.max(0, mhp)), R(m.mana || 0), act.x || 0, R(act.ab || 0)]);
      // v165 出手前：护盾不在、盾还有次数、法力够 → 先免费祭起护盾（不占这次出手，只算盾的使用次数）
      const freeShield = () => {
        if (meSeal || shield || onlyAtk) return;
        for (const j of useJ) if (acts[j].k === 2 && acts[j].fb.shield) {
          res2 = true; const d = cast(j, true); res2 = false;
          if (d !== null) { rec(0, shield.hp); return; }
        }
      };
      // v165 怪物护盾：几率、次数、护盾值、盾防御、消耗按种类单独设置（config/mobs.js 的 mobs.magic.种类.盾），不占出手
      let mShield = null, mShN = 0;
      const mobShield = () => {
        const c = m.shield; if (!c || mobSeal || mShield || mShN >= c.max) return;
        const P = c.mana || [0, 1], cost = (m.manaBr || 0) * P[0] * (P[1] === undefined ? 1 : P[1]);
        if (m.mana < cost || Math.random() * 100 >= c.chance) return;
        m.mana -= cost; mShN++;
        const rp = v => Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v || 0;   // v166 [最小, 最大] 随机
        mShield = { hp: m.hp * rp(c.hp) / 100, def: m.def * rp(c.def) / 100, red: c.red || 0 };
        act = { k: 3, f: 0 }; rec(1, mShield.hp);
      };
      const me = (lx) => {
        freeShield();
        const pj = ch(pMe.pj), def0 = m.def; if (mShield) m.def = mShield.def;   // 有护盾：按盾防御算（代替怪物本身防御）
        if (pj) m.def = m.def * (1 - pMe.pjI / 100);   // 破军：这一下无视部分防御
        altD = mShield ? Object.assign({}, mE(), { def: def0 * (pj ? 1 - pMe.pjI / 100 : 1) }) : null;
        let d = myHit(); m.def = def0; altD = null;
        if ((act.k === 1 || act.k === 2) && act.f !== 1 && d > 0) {   // 天赋 X系吸收：免疫该系法术 / 法宝伤害
          const a = acts[act.sp], el = a ? (act.k === 1 ? a.sp.el.id : a.fb.el) : "";
          if (el && tf("xishou_" + el)) { d = 0; act.x = (act.x || 0) | 512; }
          else if (el && m.elRed && m.elRed[el]) d *= Math.max(0, 1 - m.elRed[el] / 100);   // 试炼塔守关者：某几系伤害减少（config/mobs.js tower.EL_RED）
        }
        if (lx) act.x = (act.x || 0) | 8;
        if (pj && act.k < 3 && act.f !== 1) act.x = (act.x || 0) | 32;
        d = after(d, pMe, php, st.hp, meJc, mobJc);
        if (act.k < 3 && act.f !== 1 && !(act.x & 640) && !mobSeal && cnt.me.zh < pMe.zhT && ch(pMe.zh)) { mobSeal = pMe.zhR; sealR.mob = rounds; cnt.me.zh++; act.x = (act.x || 0) | 64; }
        if (mShield && act.k < 3 && act.f !== 1 && d > 0) {   // v165 怪物护盾
          const dSo = d;   // 减伤%之前（盾碎后溢出部分不再吃盾的减伤%）
          if (mShield.red) d = Math.max(MIN(st), d * (1 - mShield.red / 100));   // 盾防御已在出手时代替本身防御，这里只算额外减伤%
          const ab = Math.min(mShield.hp, d), dS = d; mShield.hp -= ab; d -= ab; act.ab = ab;
          if (mShield.hp <= 0) { mShield = null; act.x = (act.x || 0) | 4; if (d > 0 && act.altR) d = d / dS * dSo * act.altR; }   // 盾碎：溢出部分按怪物本身防御算
        }
        mhp -= d; dealt += d;
        if (mhp <= 0 && php > 0 && cnt.mob.yt < pMob.ytT && ch(pMob.yt)) { dealt -= 1 - mhp; mhp = 1; cnt.mob.yt++; act.x = (act.x || 0) | 16; }   // 对方御天保命
        const SY = TL.SHENYOU || {};
        if (mhp <= 0 && php > 0 && !syUsed && tf("shenyou") && ch(SY.CHANCE || 0)) {   // 天赋神佑：复活，恢复生命、法力（每场 1 次）
          syUsed = 1; mhp = m.hp * (SY.PCT || 0) / 100; m.mana = Math.min(m.maxMana || 0, (m.mana || 0) + (m.maxMana || 0) * (SY.PCT || 0) / 100); act.x = (act.x || 0) | 2048;
        }
        rec(0, d);
      };
      let syUsed = 0;
      const him = (lx, lj) => {
        if (m.stun > 0) { m.stun--; act = { k: 4, f: 0 }; rec(1, 0); return; }   // 被眩晕：这次不能出手
        mobShield();
        const pj = ch(pMob.pj), def0 = st.def; if (shield) st.def = shield.def;   // 有护盾：按盾防御算（代替人物本身防御）
        if (pj) st.def = st.def * (1 - pMob.pjI / 100);
        altD = shield ? Object.assign({}, st, { def: def0 * (pj ? 1 - pMob.pjI / 100 : 1) }) : null;
        let d = mobSeal || lj ? hit(mE(), st) : mobHit(); st.def = def0; altD = null;   // 被镇魂 / 连击：只能普通攻击
        if (lx) act.x = (act.x || 0) | 8;
        if (lj) act.x = (act.x || 0) | 1024;
        if (pj && act.f !== 1) act.x = (act.x || 0) | 32;
        d = after(d, pMob, mhp, m.hp, mobJc, meJc);
        // 境界伤害：怪物每比人物高 1 层，命中后额外 + REALM_DMG（不吃加成，无视防御、抗性；之后和正常伤害一样过护盾）；人物打怪物没有
        if (act.f !== 1 && !((act.x || 0) & 128) && mL > myL && BT.REALM_DMG) d += (mL - myL) * BT.REALM_DMG;
        if (act.f !== 1 && !(act.x & 128) && !meSeal && cnt.mob.zh < pMob.zhT && ch(pMob.zh)) { meSeal = pMob.zhR; sealR.me = rounds; cnt.mob.zh++; act.x = (act.x || 0) | 64; }
        if (shield && act.f !== 1 && d > 0) {   // 人物护盾：伤害按盾防御算（代替本身防御），再减「受到伤害减少%」，剩下先扣护盾值
          const dSo = d;   // 减伤%之前（盾碎后溢出部分不再吃盾的减伤%）
          if (shield.red) d = Math.max(MIN(m), d * (1 - shield.red / 100));   // 盾防御已在出手时代替本身防御，这里只算额外减伤%
          const ab = Math.min(shield.hp, d), dS = d; shield.hp -= ab; d -= ab; act.ab = ab;
          if (shield.hp <= 0) { shield = null; act.x = (act.x || 0) | 4; if (d > 0 && act.altR) d = d / dS * dSo * act.altR; }   // 盾碎：溢出部分按人物本身防御算
        }
        php -= d; taken += d;
        if (php <= 0 && mhp > 0 && cnt.me.yt < pMe.ytT && ch(pMe.yt)) { taken -= 1 - php; php = 1; cnt.me.yt++; act.x = (act.x || 0) | 16; }   // 御天保命
        rec(1, d);
      };
      // 金蝉：每回合开始判定（方式 5 = 发动金蝉秘法）
      const jcTry = (w) => {
        const c = w ? cnt.mob : cnt.me, p = w ? pMob : pMe;
        if ((w ? mobJc : meJc) || c.jc >= p.jcT || !ch(p.jc)) return;
        c.jc++; if (w) mobJc = JC.ROUNDS || 3; else meJc = JC.ROUNDS || 3;
        act = { k: 5, f: 0 }; rec(w, 0);
      };
      while (php > 0 && mhp > 0 && rounds < (TEST ? BT.TEST_ROUNDS || 500 : BT.MAX_ROUNDS)) {
        rounds++;
        jcTry(0); jcTry(1);
        // 连星秘法：这回合有几率再出手一次（[10] 标记 8）
        const meT = () => { me(); if (mhp > 0 && php > 0 && Math.random() * 100 < lxMe) me(true); };
        const himT = () => {
          him(); if (act.k === 0 && mhp > 0 && php > 0 && tf("lianji") && ch(TL.LIANJI || 0)) him(false, true);   // 天赋连击：普通攻击后再普通攻击一次
          if (act.k !== 4 && mhp > 0 && php > 0 && Math.random() * 100 < lxMob) him(true);
        };
        if (st.speed * spMe >= mE().speed * spMob) { meT(); if (mhp > 0) himT(); }   // 每回合按当前速度定先手（鼎会降低对方速度）
        else { himT(); if (php > 0) meT(); }
        if (m.deb && --m.deb.left <= 0) m.deb = null;
        if (meJc) meJc--; if (mobJc) mobJc--;
        if (meSeal && sealR.me !== rounds) meSeal--; else if (meSeal) sealR.me = -1;
        if (mobSeal && sealR.mob !== rounds) mobSeal--; else if (mobSeal) sealR.mob = -1;
      }
      s.hp = TEST ? tHp : Math.max(1, php);
      if (TEST) s.mana = tMp;
      // 战斗说明（显示在探索信息里）
      const why = `你出战时生命 ${U.fmt(hp0)}，共造成 ${U.fmt(dealt)} 伤害（对方剩余生命 ${U.fmt(Math.max(0, mhp))}/${U.fmt(m.hp)}），承受 ${U.fmt(taken)} 伤害；对方攻击 ${U.fmt(m.atk)} 防御 ${U.fmt(m.def)}${m.el ? `，${DATA.elById[m.el].name}属性，施法术 ${mSp} 次、法宝 ${mFb} 次` : ""}`;
      const detail = { name: m.name, el: m.el || "", a: m.a, img: m.img, glow: m.glow ? 1 : 0, sp: spNames, spEl: spells.map(sp => sp.el.name), vfx: [...spells.map(sp => sp.el.id), ...fabaos.map(fb => [fb.el, fb.ft])], first: meFirst ? 0 : 1, log, mf: m.mf.slice(), tf: m.tf.slice(),
        me: [R(hp0), R(st.hp), R(mana0), R(st.mana)], mob: [R(m.hp), R(m.hp), R(m.maxMana || 0), R(m.maxMana || 0)],
        // v181 这场战斗怪物的准确属性（战斗画面点怪物查看）
        ms: { hp: m.hp, atk: m.atk, def: m.def, speed: m.speed, hit: m.hit, dodge: m.dodge, mana: m.maxMana || 0, crit: m.crit || 0, res: Object.assign({}, m.res || {}),
          sp: m.spell ? [m.spell.chance, m.spell.pct] : null, fb: m.fabao ? [m.fabao.chance, m.fabao.pct] : null } };
      const win = mhp <= 0 && php > 0;   // 打满 MAX_ROUNDS 回合没击败对方也算失败（timeout）
      return { win, lose: !win, timeout: !win && php > 0, rounds, why, detail };
    },

    // 战斗过程每一下的文字（b = battle() 返回的 detail）
    battleRow(b, x) {
      const [r, w, k, sp, f, d, ph, pm, mh, mm, fx, ab] = x, el = b.el ? DATA.elById[b.el].name : "";
      const P = `<span class="bt-p">你</span>`, M = `<span class="bt-m">${b.name}</span>`, who = w ? M : P, tgt = w ? P : M;
      const S = t => `<span class="bt-s">${t}</span>`, D = n => `<span class="bt-d">${U.fmt(n)}</span>`;
      const pre = (fx & 8 ? `发动${S("连星秘法")}，` : "") + (fx & 1024 ? `发动${S("连击")}，` : "") + (fx & 32 ? `发动${S("破军秘法")}，` : "");
      const how = k === 1 ? `施放${S(w ? `${el}系法术` : `《${b.sp[sp] || "法术"}》`)}` : k === 2 ? `祭出${S(w || !b.sp[sp] ? "法宝" : `「${b.sp[sp]}」`)}`
        : k === 3 ? `祭起${S(`「${b.sp[sp] || "护盾"}」`)}` : k === 4 ? "被眩晕" : k === 5 ? `发动${S("金蝉秘法")}` : "发动普通攻击";
      let res = k === 3 ? `，护盾值 ${D(d)}` : k === 4 ? "，无法行动" : k === 5 ? `，${CFG.wudao.JINCHAN && CFG.wudao.JINCHAN.ROUNDS || 3} 回合内免疫攻击` : fx & 128 ? `，被${tgt}的金蝉秘法挡下` : f === 1 ? `，被${tgt}闪避` : `，${f === 2 ? `<span class="bt-c">暴击</span>` : ""}对${tgt}造成 ${D(d)} 点伤害`;
      if (ab) res += `（护盾抵挡 ${U.fmt(ab)}）`;
      if (fx & 4) res += `，${tgt}的护盾破碎`;
      if (fx & 2) res += `，${tgt}速度、命中、闪避降低`;
      if (fx & 1) res += `，${tgt}被眩晕`;
      if (fx & 64) res += `，${tgt}被镇魂，只能普通攻击`;
      if (fx & 16) res += `，${tgt}发动御天秘法，保留一点生命`;
      if (fx & 512) res = `，被${tgt}的${S("吸收")}天赋化解，没有造成伤害`;
      if (fx & 2048) res += `，${tgt}天赋${S("神佑")}发动，复活并恢复生命、法力`;
      if (fx & 256 && !w) res += `，获得${(b.spEl && b.spEl[sp]) || ""}系法术心得 ${CFG.gongfa.XD_GAIN === undefined ? 1 : CFG.gongfa.XD_GAIN} 点`;   // v239
      return `<p>${who}${pre}${how}${res}。</p>`;
    },
    // 战斗总览：先手、开战数值、双方各方式伤害合计
    battleHead(b) {
      const K = ["普通攻击", "法术", "法宝", "护盾", "被眩晕", "金蝉秘法"], el = b.el ? DATA.elById[b.el].name : "";
      const sum = (w, k) => b.log.filter(x => x[1] === w && x[2] === k).reduce((t, x) => t + x[5], 0);
      const cnt = (w, k) => b.log.filter(x => x[1] === w && x[2] === k).length;
      const line = w => K.map((n, k) => cnt(w, k) ? `${n} ${cnt(w, k)} 次${k < 3 ? " " + U.fmt(sum(w, k)) : ""}` : "").filter(Boolean).join("，") || "无";
      return `<p class="bt-sum">${el ? `${b.name}为${el}属性 · ` : ""}${b.first ? `${b.name}先手` : "你先手"}${b.mf && b.mf.length ? `<br>${b.name}秘法：${b.mf.map(k => (DATA.mifaKindById[k] || {}).name || k).join("、")}` : ""}${b.tf && b.tf.length ? `<br>${b.name}天赋：${b.tf.map(k => this.tfName(k)).join("、")}` : ""}<br>开战：你 生命 ${U.fmt(b.me[0])}/${U.fmt(b.me[1])} 法力 ${U.fmt(b.me[2])}/${U.fmt(b.me[3])} · ${b.name} 生命 ${U.fmt(b.mob[0])} 法力 ${U.fmt(b.mob[2])}<br>
        你造成：${line(0)}<br>${b.name}造成：${line(1)}</p>`;
    },
    // 看详情：src = "cur" 本次探索 / "last" 上一次结果，i = 事件序号；用战斗过程画面重放，随时可跳过
    async showBattle(src, i) {
      const s = this.s, hi = /^h\d+$/.test(src) ? +src.slice(1) : -1, list = hi >= 0 ? ((this._hist || [])[hi] || {}).ev : src === "cur" ? (s.explore && s.explore.ev) : src === "cqcur" ? (s.cq && s.cq.ev) : src === "cqlast" ? (s.lastCq && s.lastCq.ev) : (s.lastRun && s.lastRun.ev), e = list && list[i];   // v205 "h序号" = 全部探索里的第几次
      if (!e || !e.b) return;
      if (typeof e.b !== "object") {   // 全部信息列表不带战斗回放，点详情时单独读这一场
        const h = (this._hist || [])[hi] || {};
        try { e.b = (await API.req(`hist-battle?id=${h.id}&i=${i}`)).b; } catch (err) { return this.log("读取战斗记录失败：" + err.message, "bad"); }
        if (!e.b || !e.b.log) return;
      }
      this._backHist = hi >= 0;   // 从全部探索点进来：关闭回放后回到全部探索窗口
      const b = e.b, last = b.log[b.log.length - 1], win = last ? last[8] <= 0 && last[6] > 0 : false;
      this.playBattle(b, "战斗过程", win ? "胜利" : "失败", win, [], true);
    },
    // 怪物图：img/mob/地图序号_怪物序号.webp（DATA.maps[a].monsters 的序号）；北域首领 / 秘境怪等用 img/mob/m地图序号.webp
    //   「精英·X」「东域·X王」按 X 找图；试炼塔、晋升考验没有地图，按名字固定挑一张地图首领图
    //   秘境 / 灵地怪：b.img = mj处_序号 / ld处_序号（makeMjMob）
    //   人物（考官 / 试炼塔守关者 / 天将：rn0~54 普通修士；星君 / 界主：rx0~44 带光华）：npcImg(种子, "rn"/"rx") 按种子固定挑一张
    npcImg(key, pool) {
      let h = 2166136261; for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      return pool + (h % (pool === "rx" ? 45 : 55));
    },
    battleMobImg(b) {
      if (b.img) return { src: `img/mob/${b.img}.webp?v=${DATA.IMG_V}`, alt: `img/mob/m0.webp?v=${DATA.IMG_V}` };
      let a = b.a, f;
      if (!(a >= 0 && a < DATA.maps.length)) { let h = 0; for (const ch of b.name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0; a = h % DATA.maps.length; }
      else { const nm = String(b.name || "").replace(/^精英·/, "").replace(/^.域·(.+)王$/, "$1"), i = (DATA.maps[a].monsters || []).indexOf(nm); if (i >= 0) f = `${a}_${i}`; }
      return { src: `img/mob/${f || "m" + a}.webp?v=${DATA.IMG_V}`, alt: `img/mob/m${a}.webp?v=${DATA.IMG_V}` };
    },
    // 战斗过程画面：每 ACT_SEC 秒播放一次出手；结果已经结算好，这里只是播放
    //   现场战斗（试炼塔等）SKIP_SEC 秒后可跳过，replay（看详情）随时可跳过
    //   结果提示（log）等战斗播放完才出：logs = [[文字, 颜色], …]，不传则用 txt（胜 gold / 败 bad）
    //   opt.test（v158 实力测试）：不自动结束、随时可关闭，显示累计伤害
    // v181 点怪物：显示这场战斗怪物的准确属性（再点一次关闭）
    btMobInfo() {
      const el = document.getElementById("bt-info"), b = this._bp && this._bp.b; if (!el || !b) return;
      if (el.style.display !== "none") { el.style.display = "none"; return; }
      const m = b.ms; if (!m) { el.innerHTML = "<p>没有这场战斗的怪物属性</p>"; el.style.display = ""; return; }
      const f = U.fmt, rs = DATA.elements.map(e => `${e.name}${U.fmt(m.res[e.id] || 0)}`).join("　");
      const im = document.querySelector("#bt-u1 img"), imName = (CFG.rates || {}).MOB_IMG_NAME !== 0 && im ? `　<small style="color:#9ab">${String(im.src).split("?")[0].split("/").pop()}</small>` : "";   // config/rates.js MOB_IMG_NAME：1 显示图片文件名，0 关闭
      el.innerHTML = `<b>${b.name}${b.el && DATA.elById[b.el] ? `（${DATA.elById[b.el].name}属性）` : ""}</b>${imName}
        <p>生命 ${f(m.hp)}　攻击 ${f(m.atk)}　防御 ${f(m.def)}</p><p>速度 ${f(m.speed)}　命中 ${f(m.hit)}　闪避 ${f(m.dodge)}</p>
        <p>法力 ${f(m.mana)}　暴击 ${U.num(m.crit)}%</p><p>抗性：${rs}</p>
        ${m.sp ? `<p>法术：每回合 ${m.sp[0]}% 几率，攻击×${m.sp[1]}%</p>` : ""}${m.fb ? `<p>法宝：每回合 ${m.fb[0]}% 几率，攻击×${m.fb[1]}%</p>` : ""}
        ${b.mf && b.mf.length ? `<p>秘法：${b.mf.map(k => (DATA.mifaKindById[k] || {}).name || k).join("、")}</p>` : ""}
        <p>天赋：${b.tf && b.tf.length ? b.tf.map(k => this.tfName(k)).join("、") : "无"}</p><small>点击关闭</small>`;
      el.style.display = "";
    },
    playBattle(b, title, txt, win, logs, replay, opt = {}) {
      if (this._bp && this._bp.timer) clearInterval(this._bp.timer);
      if (this._bp) this.battleDone(this._bp);
      const bp = this._bp = { b, title, txt, win, logs: logs || [[txt, win ? "gold" : "bad"]], acts: b.log.slice(), shown: 0, t0: Date.now(), done: false, replay: !!replay, test: !!opt.test, sum: [0, 0], hp: [b.me[0], b.mob[0]], mp: [b.me[2], b.mob[2]] };
      this._lockModal = true;
      const v = DATA.IMG_V, mi = this.battleMobImg(b);
      // v161 名字不放在人物 / 怪物脚下，怪物名字放标题后面（opt.tname 可改标题里显示的名字）
      this.modal(`<div class="btv" style="--bs:${CFG.battle.ANIM_SLOW || 1}">
        <div class="btv-title">${title}${opt.tname === "" ? "" : ` · ${opt.tname || b.name}`}</div>
        <div class="btv-stage" style="background-image:url(img/bt_bg.webp?v=${v})">
          <div class="btv-hp l"><div class="btv-bar"><i id="bt-hp0"></i></div><span id="bt-hpt0"></span><div class="btv-mp"><i id="bt-mp0"></i></div></div>
          <div class="btv-zhan">战</div>
          <div class="btv-hp r"><div class="btv-bar"><i id="bt-hp1"></i></div><span id="bt-hpt1"></span><div class="btv-mp"><i id="bt-mp1"></i></div></div>
          <div class="btv-u l" id="bt-u0">${this.heroId && this.heroId() ? `<div class="btv-hero bth-f"><img class="btv-body" src="img/bt_${this.heroFile ? this.heroFile() : this.heroId()}.webp?v=${v}" alt=""></div>` : `<div class="btv-hero"><img class="btv-body" src="img/bt_hero.webp?v=${v}" alt=""><div class="btv-arm"><img class="btv-sword" src="img/bt_sword.webp?v=${v}" alt=""><img class="btv-hand" src="img/bt_hand.webp?v=${v}" alt=""></div></div>`}</div>
          <div class="btv-u r${b.glow ? " glow" : ""}" id="bt-u1" onclick="G.btMobInfo()"><img src="${mi.src}" onerror="this.onerror=null;this.src='${mi.alt}'" alt=""></div>
          <div class="btv-fx" id="bt-fx"></div>
          <div class="btv-info" id="bt-info" style="display:none" onclick="G.btMobInfo()"></div>
        </div>
        ${opt.test ? `<div class="btv-sum" id="bt-sum"></div>` : ""}
        <div class="btv-log" id="bt-log">${opt.head || ""}<p class="bt-gray"><span class="bt-m">${b.name}</span>上阵${b.el ? `（${DATA.elById[b.el].name}属性）` : ""}，${b.first ? `<span class="bt-m">${b.name}</span>先手` : `<span class="bt-p">你</span>先手`}。</p></div>
        <div class="btns" id="bt-btn"></div></div>`);
      this.btHp();
      const step = () => {
        if (this._bp !== bp) return clearInterval(bp.timer);
        if (bp.shown < bp.acts.length) this.btAct(bp.acts[bp.shown++], true);
        if (bp.shown >= bp.acts.length) { clearInterval(bp.timer);
          if (bp.test) { const lg = $("#bt-log"); if (lg) { const L = bp.acts[bp.acts.length - 1] || [], ph = L[6], mh = L[8];   // v244 测试也会分出胜负
            lg.insertAdjacentHTML("beforeend", `<p class="bt-gray">${mh <= 0 && ph > 0 ? `第 ${bp.round || 0} 回合击败对手` : ph <= 0 ? `第 ${bp.round || 0} 回合落败` : `已打满 ${bp.round || 0} 回合`}。</p>`); lg.scrollTop = 1e9; } }
          else setTimeout(() => { if (this._bp === bp) this.btFinish(); }, 600); }
        this.btBtn();
      };
      this.btBtn();
      if (!bp.acts.length) return this.btFinish();
      step(); bp.timer = setInterval(step, (CFG.battle.ACT_SEC || 1) * 1000);
      bp.skipT = setTimeout(() => this.btBtn(), (CFG.battle.SKIP_SEC || 3) * 1000 + 50);
    },
    btCanSkip() { const bp = this._bp; return bp && (bp.replay || Date.now() - bp.t0 >= (CFG.battle.SKIP_SEC || 3) * 1000); },
    btBtn() {
      const bp = this._bp, el = $("#bt-btn"); if (!bp || !el) return;
      const ok = this.btCanSkip(), left = Math.ceil((CFG.battle.SKIP_SEC || 3) - (Date.now() - bp.t0) / 1000);
      const h = bp.done || bp.test ? `<button class="btv-btn" onclick="G.closeBattle()">关闭</button>`
        : `<button class="btv-btn" onclick="G.skipBattle()" ${ok ? "" : "disabled"}>${ok ? "跳过" : `${left} 秒后可跳过`}</button>`;
      if (el.innerHTML !== h) el.innerHTML = h;
    },
    btHp() {
      const bp = this._bp; if (!bp) return; const b = bp.b, mx = [b.me[1], b.mob[1]];
      for (const i of [0, 1]) { const bar = $("#bt-hp" + i), t = $("#bt-hpt" + i); if (!bar) continue;
        bar.style.width = Math.max(0, Math.min(100, bp.hp[i] / (mx[i] || 1) * 100)) + "%"; t.textContent = U.fmt(Math.max(0, bp.hp[i]));
        const mb = $("#bt-mp" + i), mm = [b.me[3], b.mob[3]][i]; if (mb) mb.style.width = (mm > 0 ? Math.max(0, Math.min(100, (bp.mp || [])[i] / mm * 100)) : 0) + "%"; }   // v244 法力蓝条
    },
    // 播放一次出手：文字 + 血条 + 动作（普通攻击冲撞、法术光球、法宝飞剑、护盾光罩）
    btAct(x, anim) {
      const bp = this._bp, b = bp.b, [r, w, k, sp, f, d, ph, pm, mh, mm, fx] = x;
      bp.hp = [ph, mh]; bp.mp = [pm, mm];
      if (bp.test) { if (k < 3 && d > 0) bp.sum[w] += d; const se = $("#bt-sum"), R0 = bp.round || 1;
        if (se) se.innerHTML = `你共造成 <b>${U.fmt(bp.sum[0])}</b>（每回合 ${U.fmt(bp.sum[0] / Math.max(1, r))}）　对方共造成 <b>${U.fmt(bp.sum[1])}</b>（每回合 ${U.fmt(bp.sum[1] / Math.max(1, r))}）`; }
      const log = $("#bt-log");
      if (log) { if (r !== bp.round) { bp.round = r; log.insertAdjacentHTML("beforeend", `<p class="bt-rd">第 ${r} 回合</p>`); }
        log.insertAdjacentHTML("beforeend", this.battleRow(b, x)); log.scrollTop = 1e9; }
      if (!anim) return;
      const fxEl = $("#bt-fx"), me = $("#bt-u" + w), tg = $("#bt-u" + (1 - w)); if (!fxEl || !me || !tg) return this.btHp();
      // v160 同一个元素只留一个动作 class（否则 CSS 里后写的动作会盖掉新动作，看起来原地不动）
      const ALL = ["btv-hit", "btv-dodge", "btv-lunge-l", "btv-pounce-r", "btv-claw-r", "btv-wave-r", "btv-mpounce", "btv-mwave", "btv-cast", "btv-hact"];
      const re = (el, c) => { ALL.forEach(x => el.classList.remove(x)); void el.offsetWidth; el.classList.add(c); };
      const SL = CFG.battle.ANIM_SLOW || 1;   // v161 动画放慢倍数
      const add = (cls, txt, side, ms) => { ms = (ms || 1200) * SL; const n = document.createElement("div"); n.className = cls + " " + (side ? "r" : "l"); if (txt) n.textContent = txt; fxEl.appendChild(n); setTimeout(() => n.remove(), ms || 1200); return n; };
      const el = b.el && !w ? "" : b.el;   // 怪物法术 / 法宝带属性色
      const name = k === 1 ? (w ? (b.el ? DATA.elById[b.el].name + "系法术" : "法术") : (b.sp[sp] || "法术")) : k === 2 ? (w || !b.sp[sp] ? "法宝" : b.sp[sp]) : k === 3 ? (b.sp[sp] || "护盾") : k === 5 ? "金蝉秘法" : "";
      if (name) add("btv-skill", name, w);
      const hit = () => {
        if (fx & 4) this.btRing(1 - w, false);   // v165 护盾破碎：光圈消失
        if (k === 3 || k === 4 || k === 5) return;
        if (fx & 128) { add("btv-pop gray", "免疫", 1 - w); return; }
        if (fx & 512) { add("btv-pop gray", "吸收", 1 - w); return; }
        if (f === 1) { re(tg, "btv-dodge"); add("btv-pop gray", "闪避", 1 - w); return; }
        re(tg, "btv-hit"); add("btv-pop" + (f === 2 ? " crit" : ""), (f === 2 ? "暴击 " : "") + "-" + U.fmt(d), 1 - w);
        if (fx & 2048) setTimeout(() => add("btv-pop", "神佑复活", 1 - w), 400 * SL);
        this.btHp();
      };
      // v170 人物不挥剑：普攻 / 法术 / 法宝 = 原地抖动 + 放大，放完恢复原大小；（v159）怪物普攻 = 冲过去扑 / 挥爪（随机）；怪物法术 / 法宝 = 原地前扑 / 挥手（随机）
      // 普攻：先算出跑到对方面前要走多远（--dx，像素），再播放动作
      const mv = c => { if (k === 0) { const im = el => (el.querySelector("img") || el).getBoundingClientRect(), a = im(me), t = im(tg);
          const dx = w ? (t.right - a.left) - a.width * 0.25 : (t.left - a.right) + a.width * 0.25; me.style.setProperty("--dx", Math.round(dx) + "px"); }
        re(me, c); if (k !== 0 && (k === 1 || k === 2)) me.classList.add("btv-cast"); };
      if (k === 1 || k === 2) { if (w) mv(Math.random() < 0.5 ? "btv-mpounce" : "btv-mwave"); }
      if (k === 0) { if (w) mv(["btv-pounce-r", "btv-claw-r", "btv-wave-r"][Math.floor(Math.random() * 3)]); else re(me, "btv-hact"); setTimeout(hit, 430 * SL); }
      else if (k === 1 || k === 2) { if (!w) { re(me, "btv-hact"); me.classList.add("btv-cast"); }
        // v246 法术按属性、法宝按形状各有特效（见 btVfx）；怪物法宝随机一种形状
        const v = !w && b.vfx ? b.vfx[sp] : null, sEl = (k === 1 ? (w ? b.el : v) : (w ? b.el : v && v[0])) || "huo";
        const ft = k === 2 ? (w ? Math.floor(Math.random() * 7) : v ? v[1] : 0) : -1;
        setTimeout(hit, this.btVfx(fxEl, w, k, sEl, ft, SL, tg) * SL); }
      else if (k === 3) { this.btRing(w, true); this.btHp(); }
      else if (k === 4) { add("btv-pop gray", "眩晕", w); this.btHp(); }
      else { add("btv-shield gold", "", w, 1000); this.btHp(); }
    },
    // v247 法术 / 法宝特效（画布粒子，发光叠加）：法术按属性（金剑光、木飞叶缠藤、水柱溅射、火球爆炸、土落石尘爆、雷电弧劈下），
    //   法宝按形状 ft（0 剑：三把飞剑，用 CSS；1 刀、2 锤、3 环、4 盾、5 鼎、6 印：写实图 img/fx_*.webp + 光尾 + 冲击），颜色跟属性；返回命中时刻（毫秒，未乘放慢倍数）
    btVfx(fxEl, w, k, el, ft, SL, tg) {
      const E = this.btFx(fxEl); if (!E) return 500;
      const C = { jin: [255, 210, 90], mu: [110, 230, 90], shui: [90, 180, 255], huo: [255, 120, 40], tu: [210, 160, 90], lei: [170, 140, 255] }[el] || [255, 200, 120];
      const W = E.W, H = E.H, S = H / 225, X0 = (w ? 0.76 : 0.24) * W, X1 = (w ? 0.24 : 0.76) * W, Y = 0.56 * H, d = w ? -1 : 1;
      const R = (a, b) => a + Math.random() * (b - a);
      const at = (ms, f) => setTimeout(f, ms * SL);
      const T = ms => ms * SL;
      const P = o => E.parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, age: 0, life: 600, sz: 4, grow: 1, col: C, a: 1, kind: "glow" }, o, { life: T(o.life || 600) })) && E.kick();
      const O = (dur, draw, o) => { E.objs.push(Object.assign({ t0: performance.now(), dur: T(dur), draw }, o || {})); E.kick(); };
      const FIRE = [[255, 250, 220], [255, 210, 90], [255, 120, 30], [190, 40, 10]];
      const spark = (x, y, n, col, sp, g) => { for (let i = 0; i < n; i++) { const a = R(0, 6.283), v = R(.3, 1) * sp * S; P({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (g ? v * .4 : 0), g: g || 0, drag: .94, life: R(300, 650), sz: R(1, 2.2) * S, col: col || C, kind: "streak" }); } };
      const flash = (a, col) => O(260, (c, p) => { c.globalCompositeOperation = "lighter"; c.fillStyle = `rgba(${(col || C).join(",")},${a * (1 - p)})`; c.fillRect(0, 0, W, H); });
      const ring = (x, y, r1, col, flat) => O(520, (c, p) => { const r = r1 * S * (.2 + p); c.globalCompositeOperation = "lighter"; c.strokeStyle = `rgba(${(col || C).join(",")},${(1 - p) * .55})`; c.lineWidth = (3.5 * (1 - p) + .8) * S;
        c.shadowColor = `rgb(${(col || C).join(",")})`; c.shadowBlur = 12 * S; c.beginPath(); c.ellipse(x, y, r, r * (flat || 1), 0, 0, 6.283); c.stroke(); c.shadowBlur = 0; });
      const dust = (x, y, n, sp) => { for (let i = 0; i < n; i++) { const a = R(3.4, 6.0); P({ x: x + R(-10, 10) * S, y, vx: Math.cos(a) * R(.2, 1) * sp * S, vy: Math.sin(a) * R(.1, .5) * sp * S, drag: .93, life: R(600, 1100), sz: R(8, 16) * S, grow: 2.6, col: [150, 120, 90], a: .55, kind: "smoke" }); } };
      const debris = (x, y, n) => { for (let i = 0; i < n; i++) P({ x, y, vx: R(-3, 3) * S, vy: R(-5, -2) * S, g: .25 * S, life: R(500, 800), sz: R(2, 5) * S, col: [110, 90, 70], kind: "rock", rot: R(0, 6), vr: R(-.3, .3), a: 1 }); };
      const shake = ms => at(ms, () => { const st = fxEl.parentNode; st.classList.remove("vx-shake"); void st.offsetWidth; st.classList.add("vx-shake"); });
      // 沿路径飞的东西：每帧调 f(x, y, p)
      const fly = (dur, x0, y0, x1, y1, arc, f, ease) => O(dur, (c, p) => { const q = ease ? ease(p) : p, x = x0 + (x1 - x0) * q, y = y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * arc * S; f(c, x, y, q); });
      if (k === 1) {
        if (el === "lei") {   // 雷：天色一暗，云里先闪几下，随后多道分叉电弧劈到目标身上，闪白 + 电火花
          O(900, (c, p) => { c.globalCompositeOperation = "source-over"; c.fillStyle = `rgba(8,6,25,${.45 * Math.sin(Math.min(1, p * 1.4) * Math.PI)})`; c.fillRect(0, 0, W, H); });
          for (let i = 0; i < 3; i++) at(80 + i * 70, () => { const x = X1 + R(-60, 60) * S; O(90, (c, p) => this.btBolt(c, x, 0, x + R(-40, 40) * S, R(.1, .25) * H, S, C, (1 - p) * .6, 0)); });
          const strike = (t, a, br) => at(t, () => { const sx = X1 + R(-30, 30) * S, seed = Math.random(); const ex = X1 + R(-4, 4) * S; O(300, (c, p) => this.btBolt(c, sx, -10, ex, Y - 10 * S, S * 1.4, C, (p < .3 ? 1 : p < .45 ? .35 : p < .6 ? 1 : (1 - p) * 2.5) * a, br, seed)); });
          strike(330, 1, 3); strike(400, .8, 2); strike(470, 1, 3); strike(560, .5, 1);
          at(330, () => { flash(.55, [230, 220, 255]); spark(X1, Y, 26, [220, 210, 255], 7, .1);
            O(420, (c, p) => { E.glow(c, X1, Y, 60 * S, C, .5 * (1 - p)); for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283, r = R(14, 34) * S; this.btBolt(c, X1, Y, X1 + Math.cos(a) * r, Y + Math.sin(a) * r, S * .4, C, (1 - p) * .9, 0); } }); });
          shake(330); return 360;
        }
        if (el === "huo") {   // 火（v248 加强）：大火球裹着螺旋火焰飞过去，撞上连环爆炸，火焰在目标身上继续燃烧
          fly(560, X0, Y - 8 * S, X1, Y, 34, (c, x, y, q) => { E.glow(c, x, y, 44 * S, [255, 120, 30], .75); E.glow(c, x, y, 26 * S, [255, 190, 80], .95); E.glow(c, x, y, 13 * S, [255, 250, 225], 1);
            for (let i = 0; i < 11; i++) P({ x: x + R(-8, 8) * S, y: y + R(-8, 8) * S, vx: -d * R(.6, 2.2) * S, vy: R(-1.4, .3) * S, drag: .96, life: R(280, 520), sz: R(9, 17) * S, grow: .3, pal: FIRE, blend: i % 3 ? "source-over" : "lighter", a: .85 });
            for (let i = 0; i < 2; i++) { const a = q * 30 + i * 3.14; P({ x: x + Math.cos(a) * 18 * S, y: y + Math.sin(a) * 18 * S, vx: -d * .8 * S, vy: -.3 * S, drag: .95, life: 380, sz: 6 * S, grow: .3, col: [255, 220, 120] }); }
            if (Math.random() < .5) P({ x, y, vx: -d * R(1, 3) * S, vy: R(-2, 1) * S, g: .05 * S, drag: .97, life: 500, sz: 1.6 * S, col: [255, 210, 120], kind: "streak" });
            if (Math.random() < .3) P({ x: x - d * 18 * S, y, vx: -d * .5 * S, vy: -R(.3, .8) * S, life: 650, sz: 6 * S, grow: 2.5, col: [95, 85, 80], a: .25, kind: "smoke" }); }, p => p * p * .4 + p * .6);
          const blast = (bx, by, n, sz, sp) => { for (let i = 0; i < n; i++) { const a = R(0, 6.283), v = R(.5, sp) * S; P({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v - S, drag: .93, life: R(380, 760), sz: R(sz * .5, sz) * S, grow: .25, pal: FIRE, blend: i % 3 ? "source-over" : "lighter", a: .9 }); }
            E.glow && O(300, (c, p) => E.glow(c, bx, by, sz * 4 * S * (.5 + p), [255, 170, 60], .8 * (1 - p))); };
          at(560, () => { flash(.3, [255, 170, 80]); ring(X1, Y, 95, [255, 160, 60], .45); blast(X1, Y, 140, 28, 6.5); spark(X1, Y, 50, [255, 200, 90], 10, .12); });
          at(640, () => blast(X1 - d * 22 * S, Y - 18 * S, 50, 18, 4)); at(720, () => blast(X1 + d * 16 * S, Y + 10 * S, 50, 18, 4));
          O(700, (c, p) => { if (p < .8) for (let i = 0; i < 4; i++) P({ x: X1 + R(-28, 28) * S, y: Y + R(-10, 30) * S, vx: R(-.3, .3) * S, vy: -R(1, 2.4) * S, drag: .98, life: R(300, 500), sz: R(6, 12) * S, grow: .3, pal: FIRE, blend: "source-over", a: .8 }); }, { t0: performance.now() + T(600) });
          at(800, () => { for (let i = 0; i < 10; i++) P({ x: X1 + R(-25, 25) * S, y: Y - R(0, 25) * S, vx: R(-.6, .6) * S, vy: -R(.4, 1.1) * S, drag: .97, life: R(900, 1300), sz: R(9, 13) * S, grow: 3, col: [80, 70, 65], a: .3, kind: "smoke" }); });
          shake(560); shake(700); return 580;
        }
        if (el === "shui") {   // 水（v248 加强）：两道粗水柱冲过去，撞上掀起水柱冲天、水珠四溅，水流在目标周围旋转
          const jy0 = Y - 8 * S, cy = Y - 60 * S;
          const jetOf = (ox, cyo) => t => { const u = 1 - t, x0 = X0 + d * 22 * S + ox, c2 = cy + cyo; return [u * u * x0 + 2 * u * t * ((x0 + X1) / 2) + t * t * X1, u * u * jy0 + 2 * u * t * c2 + t * t * Y]; };
          const drawJet = (jet, dl, wmul) => O(640, (c, p) => { const head = Math.min(1, p / .7), tail = Math.max(0, (p - .55) / .45), n = 30; if (head <= tail) return;
            const pts = []; for (let i = 0; i <= n; i++) pts.push(jet(tail + (head - tail) * i / n));
            const t0 = performance.now() / 50; c.globalCompositeOperation = "source-over"; c.lineCap = "round";
            for (const [lw, st] of [[22, "rgba(30,110,215,.3)"], [14, "rgba(70,155,245,.7)"], [7, "rgba(150,210,255,.85)"], [2.6, "rgba(240,250,255,.95)"]]) { c.strokeStyle = st; c.beginPath();
              pts.forEach(([x, y], i) => { const wob = Math.sin(i * 1.3 + t0) * 2 * S; i ? c.lineTo(x, y + wob) : c.moveTo(x, y + wob); }); c.lineWidth = lw * S * wmul; c.stroke(); }
            const [hx, hy] = pts[n]; for (let i = 0; i < 5; i++) P({ x: hx, y: hy, vx: R(-2, 2) * S, vy: R(-2, .5) * S, g: .12 * S, life: R(280, 460), sz: R(1, 2.2) * S, col: [190, 230, 255], kind: "streak2" }); }, { t0: performance.now() + T(dl) });
          drawJet(jetOf(0, 0), 0, 1); drawJet(jetOf(0, -34 * S), 90, .7);
          at(440, () => { flash(.2, [200, 230, 255]);
            for (let i = 0; i < 130; i++) { const a = R(3.4, 6.0), v = R(1.5, 8) * S; P({ x: X1 + R(-10, 10) * S, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .22 * S, life: R(500, 900), sz: R(1, 2.6) * S, col: Math.random() < .5 ? [235, 248, 255] : [100, 175, 250], kind: i % 4 ? "streak2" : "drop" }); }
            for (let i = 0; i < 40; i++) P({ x: X1 + R(-12, 12) * S, y: Y + 20 * S, vx: R(-.8, .8) * S, vy: -R(5, 10) * S, g: .25 * S, life: R(500, 800), sz: R(2, 3.5) * S, col: Math.random() < .5 ? [240, 250, 255] : [120, 190, 255], kind: "streak2" });
            for (let i = 0; i < 18; i++) P({ x: X1 + R(-25, 25) * S, y: Y + R(-20, 20) * S, vx: R(-.8, .8) * S, vy: -R(.2, .8) * S, drag: .97, life: R(800, 1200), sz: R(14, 22) * S, grow: 2.4, col: [220, 240, 255], a: .4, kind: "smoke" }); });
          O(600, (c, p) => { for (let k2 = 0; k2 < 2; k2++) { const a = p * 14 + k2 * 3.14, r = (44 - p * 14) * S; for (let i = 0; i < 6; i++) { const b = a - i * .12; P({ x: X1 + Math.cos(b) * r, y: Y + 4 * S + Math.sin(b) * r * .35, life: 220, sz: (2.6 - i * .3) * S, col: i ? [120, 190, 255] : [240, 250, 255], kind: "drop" }); } } }, { t0: performance.now() + T(460) });
          shake(460); return 460;
        }
        if (el === "tu") {   // 土：几块巨石从天而降，砸地尘土飞扬、碎石四溅
          for (let i = 0; i < 4; i++) { const ox = R(-30, 30) * S, sz = R(14, 24) * S, t = i * 90, vr = R(-.15, .15);
            at(t, () => fly(460, X1 + ox + d * 40 * S, -30 * S, X1 + ox * .5, Y + R(-6, 10) * S, 0, (c, x, y, q) => { E.rock(c, x, y, sz, q * 6 * vr * 10, [128, 104, 80]);
              P({ x: x + R(-sz, sz) * .4, y: y - sz * .6, vx: R(-.2, .2) * S, vy: -.4 * S, life: 450, sz: sz * .45, grow: 2.2, col: [140, 120, 100], a: .28, kind: "smoke" }); }, p => p * p));
            at(t + 460, () => { dust(X1 + ox * .5, Y + 14 * S, 6, 4); debris(X1 + ox * .5, Y, 6); }); }
          at(460, () => flash(.1, [255, 220, 170]));
          shake(460); shake(730); return 480;
        }
        if (el === "mu") {   // 木（v248 加强）：一大阵飞叶裹着绿光卷过去，目标脚下粗藤破土缠绕，最后炸成漫天碎叶
          for (let i = 0; i < 48; i++) { const t = i * 9, ph = R(0, 6.283), amp = R(10, 28), yo = R(-20, 20), sz = R(5, 9);
            at(t, () => fly(500, X0 + d * 20 * S, Y + yo * S, X1, Y + yo * .4 * S, R(0, 20), (c, x, y, q) => { const yy = y + Math.sin(q * 9 + ph) * amp * S * (1 - q * .6);
              E.leaf(c, x, yy, sz * S, q * 16 + ph, [70 + (i % 4) * 25, 185 + (i % 3) * 15, 60]); if (Math.random() < .35) P({ x, y: yy, life: 320, sz: 4 * S, col: [170, 255, 140] }); })); }
          O(500, (c, p) => E.glow(c, X0 + (X1 - X0) * p, Y, 40 * S, [110, 230, 90], .35));
          at(360, () => { for (let v = 0; v < 11; v++) { const bx = X1 + R(-44, 44) * S, h = R(60, 105) * S, sw = R(-1.2, 1.2), wd = R(4, 7.5) * S;
              O(820, (c, p) => E.vine(c, bx, Y + 32 * S, h, sw, wd, Math.min(1, p * 2.4), p > .78 ? (1 - p) * 4.5 : 1)); }
            dust(X1, Y + 30 * S, 8, 3); debris(X1, Y + 26 * S, 8); });
          O(700, (c, p) => { for (let i = 0; i < 3; i++) P({ x: X1 + R(-40, 40) * S, y: Y + 30 * S, vx: R(-.3, .3) * S, vy: -R(1, 2.2) * S, drag: .98, life: R(500, 800), sz: R(2.5, 4) * S, col: [150, 255, 120] }); }, { t0: performance.now() + T(380) });
          at(520, () => { flash(.15, [180, 255, 160]); for (let i = 0; i < 50; i++) { const a = R(0, 6.283), v = R(1, 5) * S; P({ x: X1, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .04 * S, drag: .95, life: R(600, 1000), sz: R(4, 7) * S, col: [80 + (i % 3) * 30, 200, 70], kind: "leaf", rot: R(0, 6), vr: R(-.35, .35) }); }
            spark(X1, Y, 26, [190, 255, 150], 6); E.glow && O(400, (c, p) => E.glow(c, X1, Y, 70 * S * (.5 + p), [120, 240, 100], .6 * (1 - p))); });
          at(1000, () => { for (let i = 0; i < 40; i++) P({ x: X1 + R(-40, 40) * S, y: Y + R(-50, 30) * S, vx: R(-2, 2) * S, vy: R(-2.5, -.5) * S, g: .05 * S, drag: .96, life: R(600, 900), sz: R(3, 6) * S, col: [90 + (i % 3) * 30, 190, 60], kind: "leaf", rot: R(0, 6), vr: R(-.4, .4) }); });
          shake(520); return 520;
        }
        // 金（v248 加强）：五道金色剑光接连斩过去，最后一道十字巨型剑光劈在目标身上，金属火星四射
        for (let i = 0; i < 5; i++) { const yo = (i - 2) * 13 * S, rot = (i - 2) * .2;
          at(i * 60, () => fly(360, X0 + d * 20 * S, Y + yo, X1, Y + yo * .3, 0, (c, x, y, q) => { E.crescent(c, x, y, 46 * S, d, rot, C, q < .1 ? q * 10 : 1); E.glow(c, x, y, 26 * S, [255, 210, 90], .35);
            for (let j = 0; j < 2; j++) P({ x: x - d * 6 * S, y: y + R(-20, 20) * S, vx: -d * R(1, 2.5) * S, life: 240, sz: 1.6 * S, col: [255, 240, 180], kind: "streak" }); }, p => p * p * .3 + p * .7));
          at(i * 60 + 360, () => { spark(X1, Y + yo * .3, 22, [255, 230, 150], 10, .15); O(260, (c, p) => { c.globalCompositeOperation = "lighter"; c.strokeStyle = `rgba(255,245,200,${1 - p})`; c.lineWidth = 3.5 * S * (1 - p); c.shadowColor = "#ffd36b"; c.shadowBlur = 16 * S;
            c.beginPath(); c.moveTo(X1 - 46 * S, Y + yo * .3 - (24 - i * 12) * S); c.lineTo(X1 + 46 * S, Y + yo * .3 + (24 - i * 12) * S); c.stroke(); c.shadowBlur = 0; }); }); }
        at(640, () => { flash(.35, [255, 235, 170]); spark(X1, Y, 60, [255, 235, 160], 13, .12);
          for (const r0 of [.75, -.75]) O(420, (c, p) => { c.globalCompositeOperation = "lighter"; const L2 = 95 * S * Math.min(1, p * 4), a = 1 - p * p; c.save(); c.translate(X1, Y); c.rotate(r0);
            c.shadowColor = "#ffcf5a"; c.shadowBlur = 24 * S; c.strokeStyle = `rgba(255,215,110,${a * .6})`; c.lineWidth = 12 * S * (1 - p * .6); c.beginPath(); c.moveTo(-L2, 0); c.lineTo(L2, 0); c.stroke();
            c.strokeStyle = `rgba(255,252,235,${a})`; c.lineWidth = 3.5 * S * (1 - p * .5); c.stroke(); c.restore(); });
          O(450, (c, p) => E.glow(c, X1, Y, 80 * S * (.5 + p), [255, 215, 110], .7 * (1 - p))); });
        shake(640); return 380;
      }
      // ---------- 法宝 ----------
      const img = n => E.img(n);
      const trail = (c, x, y) => { E.glow(c, x, y, 30 * S, C, .45); if (Math.random() < .9) P({ x: x + R(-6, 6) * S, y: y + R(-6, 6) * S, vx: -d * R(.3, 1) * S, vy: R(-.5, .5) * S, life: R(250, 450), sz: R(3, 6) * S, grow: .4 }); };
      const mixW = C.map(v => v + (255 - v) * .6 | 0);
      const slam = (x, y, big) => { flash(big ? .14 : .1, mixW); ring(x, y + 20 * S, big ? 95 : 70, C, .3); ring(x, y + 20 * S, big ? 60 : 45, [255, 255, 255], .3); dust(x, y + 22 * S, big ? 14 : 8, 5); debris(x, y + 10 * S, big ? 12 : 6); spark(x, y, 20, C, 7, .1); };
      if (ft === 0) { const mk = (cls, ms, css, html) => { const n = document.createElement("div"); n.className = "vx " + cls + " vx-" + el; n.style.cssText = `--x0:${w ? 76 : 24}%;--x1:${w ? 24 : 76}%;--d:${d};` + (css || ""); if (html) n.innerHTML = html; fxEl.appendChild(n); setTimeout(() => n.remove(), ms * SL); return n; };
        for (let i = 0; i < 3; i++) mk("vx-sword", 900, `animation-delay:${i * 80 * SL}ms;--y:${42 + i * 8}%`, `<img src="img/bt_sword.webp?v=${DATA.IMG_V || 1}" alt="">`);
        at(600, () => { spark(X1, Y, 22, [255, 240, 200], 8, .12); flash(.15, C); E.glow && O(300, (c, p) => E.glow(c, X1, Y, 50 * S * (.5 + p), C, 1 - p)); }); return 640; }   // 剑：三把飞剑（保留原效果）
      if (ft === 1) {   // 刀：旋转飞斩过去，命中拉出一道大刀光
        const im = img("dao"), ln = 96 * S;
        fly(480, X0 + d * 10 * S, Y - 10 * S, X1, Y - 4 * S, 18, (c, x, y, q) => { trail(c, x, y); E.draw(c, im, x, y, ln, d * q * 4 * Math.PI * 2, 1, d < 0); });
        at(480, () => { spark(X1, Y, 24, [255, 240, 200], 9, .12); flash(.12, mixW);
          O(300, (c, p) => E.crescent(c, X1 + d * 30 * S, Y, 58 * S * (.8 + p * .3), d, -.5, C, 1 - p * p)); });
        return 500;
      }
      if (ft === 2) {   // 锤：巨锤在目标头顶现形，抡下砸地，冲击波 + 尘土碎石 + 震屏
        const im = img("chui"), ln = 100 * S, px = X1 + d * 18 * S;
        O(620, (c, p) => { const q = p < .45 ? 0 : Math.pow((p - .45) / .55, 2.2), a = d * (-1.4 + q * 1.4) * (p < .45 ? 1 : 1), y = Y - 40 * S - (1 - q) * 30 * S;
          E.glow(c, px, y, 50 * S, C, .35 * Math.min(1, p * 4)); E.draw(c, im, px, y, ln, a, Math.min(1, p * 4), false, .5, .95); });
        at(620, () => slam(X1, Y, true)); shake(620); return 630;
      }
      if (ft === 3) {   // 环：旋转着飞过去（立体翻转），套住目标收紧
        const im = img("huan"), ln = 50 * S;
        fly(560, X0 + d * 10 * S, Y - 8 * S, X1, Y - 4 * S, 30, (c, x, y, q) => { trail(c, x, y); E.draw(c, im, x, y, ln * (.7 + q * .5), q * 10, 1, false, .5, .5, Math.abs(Math.cos(q * 12)) * .7 + .3); });
        at(560, () => { spark(X1, Y, 18, C, 5); flash(.15, C);
          O(520, (c, p) => { const r = (60 - p * 30) * S; E.glow(c, X1, Y, r * 1.2, C, .4 * (1 - p)); E.draw(c, im, X1, Y + 6 * S, r * 2, 0, 1 - p * p, false, .5, .5, .28);
            c.globalCompositeOperation = "lighter"; c.strokeStyle = `rgba(${C.join(",")},${(1 - p) * .6})`; c.lineWidth = 1.6 * S; c.shadowColor = `rgb(${C.join(",")})`; c.shadowBlur = 12 * S; c.beginPath(); c.ellipse(X1, Y + 6 * S, r, r * .28, 0, 0, 6.283); c.stroke(); c.shadowBlur = 0; }); });
        return 580;
      }
      if (ft === 5 || ft === 6) {   // 鼎 / 印：从天而降压在目标身上，落地冲击；印另有方形印纹
        const im = img(ft === 5 ? "ding" : "yin"), ln = (ft === 5 ? 88 : 78) * S;
        O(640, (c, p) => { const q = p < .25 ? 0 : Math.pow((p - .25) / .75, 2.4), y = -60 * S + (Y - 6 * S + 60 * S) * q, sc = .75 + q * .35;
          E.glow(c, X1, y, ln * .8, C, .5 * Math.min(1, p * 3)); E.draw(c, im, X1, y, ln * sc, 0, Math.min(1, p * 4)); });
        at(640, () => { slam(X1, Y, true); O(500, (c, p) => { E.draw(c, im, X1, Y - 6 * S, ln * 1.1 * (1 + p * .08), 0, 1 - p); });
          if (ft === 6) O(700, (c, p) => { const r = (40 + p * 70) * S; c.save(); c.translate(X1, Y + 24 * S); c.scale(1, .32); c.rotate(.785 + p); c.globalCompositeOperation = "lighter";
            c.strokeStyle = `rgba(${C.join(",")},${1 - p})`; c.shadowColor = `rgb(${C.join(",")})`; c.shadowBlur = 16 * S; c.lineWidth = 4 * S; c.strokeRect(-r, -r, r * 2, r * 2); c.lineWidth = 2 * S; c.strokeRect(-r * .78, -r * .78, r * 1.56, r * 1.56); c.restore(); }); });
        shake(640); return 650;
      }
      // 盾（及其他）：一面光盾撞过去
      fly(480, X0 + d * 16 * S, Y, X1, Y, 0, (c, x, y) => { E.glow(c, x, y, 34 * S, C, .7); E.glow(c, x, y, 14 * S, [255, 255, 255], .7); trail(c, x, y); });
      at(480, () => slam(X1, Y, false)); return 500;
    },
    // 画布特效引擎：每个战斗画面一块 canvas，粒子 + 定时绘制对象，没东西时停帧
    btFx(fxEl) {
      let E = this._btFx;
      if (!E || !E.cv.isConnected || E.cv.parentNode !== fxEl) {
        const r = fxEl.getBoundingClientRect(); if (!r.width) return null;
        const cv = document.createElement("canvas"); cv.className = "vx-cv"; fxEl.appendChild(cv);
        const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
        const c = cv.getContext("2d"), sprites = {}, imgs = {};
        E = this._btFx = { cv, c, W: cv.width, H: cv.height, parts: [], objs: [], run: false };
        const sprite = col => { const key = col.join(","); if (sprites[key]) return sprites[key];
          const s = document.createElement("canvas"); s.width = s.height = 64; const g = s.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
          gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.22, `rgba(${key},.95)`); gr.addColorStop(.55, `rgba(${key},.35)`); gr.addColorStop(1, `rgba(${key},0)`);
          g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (sprites[key] = s); };
        const smoke = col => { const key = "s" + col.join(","); if (sprites[key]) return sprites[key];
          const s = document.createElement("canvas"); s.width = s.height = 64; const g = s.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
          gr.addColorStop(0, `rgba(${col.join(",")},.8)`); gr.addColorStop(.5, `rgba(${col.join(",")},.35)`); gr.addColorStop(1, `rgba(${col.join(",")},0)`);
          g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (sprites[key] = s); };
        E.glow = (c, x, y, r, col, a, blend) => { c.globalCompositeOperation = blend || "lighter"; c.globalAlpha = Math.max(0, Math.min(1, a)); c.drawImage(sprite(col), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; };
        E.img = n => { if (!imgs[n]) { imgs[n] = new Image(); imgs[n].src = `img/fx_${n}.webp?v=${DATA.IMG_V || 1}`; } return imgs[n]; };
        // 画图：ln = 长边像素，ax/ay 旋转中心（0~1），sx 横向压缩（环翻转）
        E.draw = (c, im, x, y, ln, rot, a, flip, ax, ay, sx) => { if (!im.complete || !im.naturalWidth) return; const k = ln / Math.max(im.naturalWidth, im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
          c.save(); c.globalCompositeOperation = "source-over"; c.globalAlpha = Math.max(0, Math.min(1, a)); c.translate(x, y); c.rotate(rot || 0); c.scale((flip ? -1 : 1) * (sx || 1), 1);
          c.drawImage(im, -w * (ax === undefined ? .5 : ax), -h * (ay === undefined ? .5 : ay), w, h); c.restore(); };
        E.rock = (c, x, y, r, rot, col) => { c.save(); c.translate(x, y); c.rotate(rot); c.globalCompositeOperation = "source-over";
          const g = c.createRadialGradient(-r * .35, -r * .35, r * .1, 0, 0, r * 1.1); g.addColorStop(0, `rgb(${col.map(v => Math.min(255, v + 40)).join(",")})`); g.addColorStop(.6, `rgb(${col.join(",")})`); g.addColorStop(1, "rgb(60,40,25)");
          c.fillStyle = g; c.beginPath(); const n = 8; for (let i = 0; i < n; i++) { const a = i / n * 6.283, rr = r * (.75 + ((i * 37) % 10) / 30); i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          c.closePath(); c.fill(); c.save(); c.clip(); c.strokeStyle = "rgba(30,20,12,.55)"; c.lineWidth = Math.max(.6, r * .06);
          for (let i = 0; i < 3; i++) { const a = i * 2.1 + .4; c.beginPath(); c.moveTo(Math.cos(a) * r * .1, Math.sin(a) * r * .1); c.lineTo(Math.cos(a + .3) * r * .5, Math.sin(a + .3) * r * .5); c.lineTo(Math.cos(a - .2) * r, Math.sin(a - .2) * r); c.stroke(); }
          c.fillStyle = "rgba(255,240,210,.18)"; c.beginPath(); c.arc(-r * .35, -r * .35, r * .45, 0, 6.283); c.fill();
          for (let i = 0; i < 7; i++) { c.fillStyle = i % 2 ? "rgba(30,20,10,.25)" : "rgba(255,240,220,.15)"; c.beginPath(); c.arc(Math.cos(i * 2.4) * r * .55, Math.sin(i * 3.1) * r * .5, r * .09, 0, 6.283); c.fill(); }
          c.restore(); c.strokeStyle = "rgba(35,22,12,.75)"; c.lineWidth = Math.max(1, r * .07); c.stroke(); c.restore(); };
        E.leaf = (c, x, y, r, rot, col) => { c.save(); c.translate(x, y); c.rotate(rot); c.globalCompositeOperation = "source-over";
          const g = c.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, `rgb(${col.map(v => v * .55 | 0).join(",")})`); g.addColorStop(.5, `rgb(${col.join(",")})`); g.addColorStop(1, `rgb(${col.map(v => v * .7 | 0).join(",")})`);
          c.fillStyle = g; c.beginPath(); c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * .55, r, 0); c.quadraticCurveTo(0, r * .55, -r, 0); c.fill();
          c.strokeStyle = "rgba(20,60,15,.6)"; c.lineWidth = Math.max(.6, r * .08); c.beginPath(); c.moveTo(-r, 0); c.lineTo(r * .9, 0); c.stroke(); c.restore(); };
        // 藤蔓：从地面长出、弯曲、渐细，带刺
        E.vine = (c, bx, by, h, sw, wd, grow, a) => { const n = 18, pts = []; for (let i = 0; i <= n * grow; i++) { const t = i / n; pts.push([bx + Math.sin(t * 5 + sw * 3) * 14 * t * (wd / 4) + sw * t * 20, by - h * t]); }
          if (pts.length < 2) return; c.save(); c.globalCompositeOperation = "source-over"; c.globalAlpha = Math.max(0, a); c.lineCap = "round";
          for (let i = 1; i < pts.length; i++) { const t = i / n; c.strokeStyle = `rgb(${40 + t * 30 | 0},${95 + t * 50 | 0},${30 + t * 10 | 0})`; c.lineWidth = wd * (1 - t * .8) + .5; c.beginPath(); c.moveTo(...pts[i - 1]); c.lineTo(...pts[i]); c.stroke();
            if (i % 3 === 0) { c.strokeStyle = "rgba(170,220,120,.8)"; c.lineWidth = 1; c.beginPath(); c.moveTo(...pts[i]); c.lineTo(pts[i][0] + (i % 6 ? 5 : -5) * wd / 4, pts[i][1] - 3); c.stroke(); } }
          c.restore(); };
        // 月牙剑光
        // 剑光：细长弧线，白芯 + 属性色外光，尾端渐隐
        E.crescent = (c, x, y, r, d, rot, col, a) => { c.save(); c.translate(x, y); c.rotate(rot); c.scale(d, 1); c.globalCompositeOperation = "lighter"; c.lineCap = "round";
          const seg = 14, a0 = -1.15, a1 = 1.15; c.shadowColor = `rgb(${col.join(",")})`; c.shadowBlur = r * .35;
          for (let i = 0; i < seg; i++) { const u0 = a0 + (a1 - a0) * i / seg, u1 = a0 + (a1 - a0) * (i + 1) / seg, mid = 1 - Math.abs((i + .5) / seg - .5) * 2;
            c.strokeStyle = `rgba(${col.join(",")},${a * .45 * mid})`; c.lineWidth = r * .16 * mid + .5; c.beginPath(); c.arc(-r * .6, 0, r, u0, u1); c.stroke();
            c.strokeStyle = `rgba(255,252,235,${a * mid})`; c.lineWidth = r * .05 * mid + .4; c.beginPath(); c.arc(-r * .6, 0, r, u0, u1); c.stroke(); }
          c.restore(); };
        const loop = () => {
          const now = performance.now(), dt = Math.min(50, now - (E.last || now)) / 16.7; E.last = now;
          c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, E.W, E.H);
          E.objs = E.objs.filter(o => { const p = (now - o.t0) / o.dur; if (p < 0) return true; if (p >= 1) return false; c.save(); o.draw(c, p); c.restore(); return true; });
          E.parts = E.parts.filter(q => { q.age += dt * 16.7; if (q.age >= q.life) return false; const t = q.age / q.life;
            q.vx *= Math.pow(q.drag, dt); q.vy = q.vy * Math.pow(q.drag, dt) + q.g * dt; const ox = q.x, oy = q.y; q.x += q.vx * dt; q.y += q.vy * dt;
            const sz = q.sz * (1 + (q.grow - 1) * t);
            let col = q.col; if (q.pal) { const f = t * (q.pal.length - 1), i = Math.min(q.pal.length - 2, f | 0), u = f - i; col = q.pal[i].map((v, j) => v + (q.pal[i + 1][j] - v) * u | 0); }
            if (q.kind === "glow") E.glow(c, q.x, q.y, sz, col, q.a * (1 - t * t), q.blend);
            else if (q.kind === "smoke") { c.globalCompositeOperation = "source-over"; c.globalAlpha = q.a * (1 - t); c.drawImage(smoke(col), q.x - sz, q.y - sz, sz * 2, sz * 2); c.globalAlpha = 1; }
            else if (q.kind === "streak") { c.globalCompositeOperation = "lighter"; c.strokeStyle = `rgba(${col.join(",")},${1 - t})`; c.lineWidth = sz; c.lineCap = "round"; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 2.2, q.y - q.vy * 2.2); c.stroke(); }
            else if (q.kind === "streak2") { c.globalCompositeOperation = "source-over"; c.strokeStyle = `rgba(${col.join(",")},${.9 * (1 - t)})`; c.lineWidth = sz; c.lineCap = "round"; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 1.8, q.y - q.vy * 1.8); c.stroke(); }
            else if (q.kind === "drop") { c.globalCompositeOperation = "source-over"; c.globalAlpha = .85 * (1 - t * t); c.fillStyle = `rgb(${col.join(",")})`; c.beginPath(); c.ellipse(q.x, q.y, sz * .6, sz, Math.atan2(q.vy, q.vx) + 1.57, 0, 6.283); c.fill();
              c.fillStyle = "rgba(255,255,255,.7)"; c.beginPath(); c.arc(q.x - sz * .2, q.y - sz * .3, sz * .25, 0, 6.283); c.fill(); c.globalAlpha = 1; }
            else if (q.kind === "rock") { q.rot += q.vr * dt; E.rock(c, q.x, q.y, sz, q.rot, col); }
            else if (q.kind === "leaf") { q.rot += q.vr * dt; c.globalAlpha = 1 - t * t; E.leaf(c, q.x, q.y, sz, q.rot, col); c.globalAlpha = 1; }
            return true; });
          if (E.objs.length || E.parts.length) requestAnimationFrame(loop); else { E.run = false; E.last = 0; c.clearRect(0, 0, E.W, E.H); }
        };
        E.kick = () => { if (!E.run) { E.run = true; requestAnimationFrame(loop); } };
        ["dao", "chui", "huan", "ding", "yin"].forEach(E.img);
      }
      return E;
    },
    // 分叉电弧：中点位移法生成折线，画三层（外光、中光、白芯）；br 分叉数；seed 让同一道闪电在几帧里形状不变
    btBolt(c, x0, y0, x1, y1, S, col, a, br, seed) {
      if (a <= 0) return;
      let s = seed === undefined ? Math.random() * 1e6 : seed * 1e6 + 1; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const path = (ax, ay, bx, by, dev, n) => { let pts = [[ax, ay], [bx, by]]; for (let k = 0; k < n; k++) { const np = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [px, py] = pts[i - 1], [qx, qy] = pts[i];
        const mx = (px + qx) / 2 + (rnd() - .5) * dev, my = (py + qy) / 2 + (rnd() - .5) * dev * .3; np.push([mx, my], pts[i]); } pts = np; dev *= .55; } return pts; };
      const L = Math.hypot(x1 - x0, y1 - y0), main = path(x0, y0, x1, y1, L * .35, 6), lines = [[main, 1]];
      for (let b = 0; b < (br || 0); b++) { const i = 8 + Math.floor(rnd() * (main.length - 20)), [bx, by] = main[Math.max(0, Math.min(main.length - 1, i))];
        const ang = Math.atan2(y1 - y0, x1 - x0) + (rnd() - .5) * 1.6, ln = L * (.15 + rnd() * .25); lines.push([path(bx, by, bx + Math.cos(ang) * ln, by + Math.sin(ang) * ln, ln * .4, 4), .5]); }
      c.save(); c.globalCompositeOperation = "lighter"; c.lineJoin = "round"; c.lineCap = "round";
      for (const [pts, wv] of lines) { const stroke = (lw, st) => { c.strokeStyle = st; c.lineWidth = lw; c.beginPath(); c.moveTo(...pts[0]); for (const p of pts) c.lineTo(...p); c.stroke(); };
        c.shadowColor = `rgb(${col.join(",")})`; c.shadowBlur = 20 * S; stroke(10 * S * wv, `rgba(${col.join(",")},${.25 * a})`); c.shadowBlur = 8 * S; stroke(4 * S * wv, `rgba(${col.map(v => Math.min(255, v + 60)).join(",")},${.6 * a})`); c.shadowBlur = 0; stroke(Math.max(1, 1.6 * S * wv), `rgba(255,255,255,${a})`); }
      c.restore();
    },
    // v165 护盾光圈：护盾在的时候一直显示，套住人物 / 怪物（比人物大一点），破碎时消失
    btRing(w, on) {
      const u = $("#bt-u" + w); if (!u) return;
      let r = u.querySelector(".btv-ring:not(.off)");
      if (!on) { if (r) { r.classList.add("off"); setTimeout(() => r.remove(), 500); } return; }
      if (r) r.remove();
      r = document.createElement("div"); r.className = "btv-ring" + (w ? " mob" : "");
      u.appendChild(r);
      this.btRingPos(u, r, 0);
    },
    // v245 光圈位置：按人物 / 怪物图在格子里的布局尺寸算（不受出手动画缩放影响）；
    //   图还没加载好（宽度 0，常见于第 1 回合就放盾）时等图加载完再算，之前光圈大小为 0 看不到
    btRingPos(u, r, n) {
      if (!r.isConnected) return;
      const t = u.querySelector(".btv-hero") || u.querySelector("img") || u;
      let x = 0, y = 0, e = t;
      while (e && e !== u && u.contains(e)) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
      if (e !== u) { const a = t.getBoundingClientRect(), b = u.getBoundingClientRect(); x = a.left - b.left; y = a.top - b.top; }
      const iw = t.offsetWidth, ih = t.offsetHeight;
      if ((iw < 8 || ih < 8) && n < 40) {
        const img = t.tagName === "IMG" ? t : t.querySelector("img");
        if (img && !img.complete && n === 0) img.addEventListener("load", () => this.btRingPos(u, r, 1), { once: true });
        setTimeout(() => this.btRingPos(u, r, n + 1), 100);
        return;
      }
      const W = Math.max(iw, 40) * 1.3, H = Math.max(ih, 40) * 1.1;
      Object.assign(r.style, { width: W + "px", height: H + "px", left: (x + iw / 2 - W / 2) + "px", top: (y + ih / 2 - H / 2) + "px" });
    },
    btFinish() {
      const bp = this._bp; if (!bp || bp.done) return;
      clearInterval(bp.timer); clearTimeout(bp.skipT);
      while (bp.shown < bp.acts.length) this.btAct(bp.acts[bp.shown++], false);
      const last = bp.acts[bp.acts.length - 1]; if (last) bp.hp = [last[6], last[8]];
      bp.done = true; this.btHp(); this.battleDone(bp);
      const log = $("#bt-log"); if (log) { log.insertAdjacentHTML("beforeend", `<p class="bt-res ${bp.win ? "win" : "lose"}">${bp.txt}</p>${this.battleHead(bp.b)}`); log.scrollTop = 1e9; }
      this.btBtn();
    },
    // 播放完：这时才在信息栏提示胜负（只提示一次）
    battleDone(bp) { if (bp.logged) return; bp.logged = true; bp.logs.forEach(([m, c]) => this.log(m, c)); },
    skipBattle() { if (this.btCanSkip()) this.btFinish(); },
    closeBattle() { if (this._bp) { clearInterval(this._bp.timer); clearTimeout(this._bp.skipT); this.battleDone(this._bp); } this._bp = null; this._lockModal = false; this.closeModal(); this.render(); if (this._backHist) { this._backHist = false; this.openExHist(); } },

    /* ---------- 掉落 ---------- */
    newLoot() { return { stone: 0, mats: {} }; },
    // 必掉物品：config/drops.js 里该地图 fixed[事件]（随机药材矿石按 CFG.dropTotal 分到各步，见 matPlan / stepMats）
    rollEvent(loot, ev, a) {
      const fixed = DATA.mapFixed(a, ev), got = [];
      for (const name in fixed) { const r = fixed[name] || [1, 1], n = U.rand(r[0], r[1]);
        if (n > 0) { const t = this.lootAdd(loot, name, n); if (t) got.push(t); } }
      return got.join("、");
    },
    // v236 本次探索的药材 / 矿石总量（CFG.dropTotal），分配到各步：返回 { 步序号: [药材个数, 矿石个数] }
    //   药材可落在 灵药 / 怪物 步，矿石可落在 矿脉 / 怪物 步；挖灵石矿（kuang）不掉
    matPlan(x) {
      const T = CFG.dropTotal || {}, plan = x.plan || "", mp = {};
      if (x.kuang) return mp;
      const tk = x.mj === undefined ? "explore" : x.mk === "ld" ? "lingdi" : "mijing", t = T[tk] || {};
      const pick = (r, ok, j) => { if (!r) return; const n = U.rand(r[0], r[1]), idx = [];
        for (let i = 0; i < plan.length; i++) if (ok.includes(plan[i])) idx.push(i);
        if (!idx.length) idx.push(plan.length - 1);
        for (let k = 0; k < n; k++) { const i = U.pick(idx); (mp[i] = mp[i] || [0, 0])[j]++; } };
      pick(t.herb, "hmeb", 0); pick(t.ore, "omeb", 1);
      // 本次探索只出几种：药材、矿石各从池里抽 KINDS 种（config/drops.js dropTotal.KINDS）；耀石 / 灵晶 / 灵元各抽 EL_KINDS 种属性（config/mijing.js）
      const kn = r => Array.isArray(r) ? U.rand(r[0], r[1]) : (r || 0), few = (L, r) => { const a = L.slice(), n = kn(r); if (!n || n >= a.length) return a; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
      const pool = DATA.mapPool(this.matPoolMap(x));
      x.mpK = { herb: few(pool.herb || [], T.KINDS), ore: few(pool.ore || [], T.KINDS), el: {} };
      for (const k of DATA.SM_GRADED) { const nk = ((CFG.mijing.items[k] || {}).names || DATA.elements).length; x.mpK.el[k] = few([...Array(nk).keys()], CFG.mijing.EL_KINDS); }
      // 灵元：凡界秘境一次合计 LINGYUAN.N 个，随机分到各怪物步（普通、精英、首领）
      x.lyp = {};
      if (x.mj !== undefined && x.mk !== "ld") {
        const LY = CFG.mijing.LINGYUAN || {}, N = LY.N || [LY.MIN || 0, LY.MAX || 0], n = kn(N), idx = [];
        for (let i = 0; i < plan.length; i++) if ("meb".includes(plan[i])) idx.push(i);
        if (idx.length) for (let k = 0; k < n; k++) { const i = U.pick(idx); x.lyp[i] = (x.lyp[i] || 0) + 1; }
      }
      return mp;
    },
    // 本次探索用哪张地图的药材矿石池：地图 / 秘境 drops / 灵地发现地图
    matPoolMap(x) { if (x.mj === undefined) return x.map; const d = this.mjDef(x.mj, x.mk); return x.mk === "ld" ? d._map : d.drops; },
    // 第 i 步分到的药材矿石：每个从池里等权重随机，写进 loot，返回描述
    stepMats(x, i) {
      const c = (x.mp || {})[i], ly = (x.lyp || {})[i], out = [];
      if (c) {
        const pool = DATA.mapPool(this.matPoolMap(x)), K = x.mpK || {}, cnt = {};
        ["herb", "ore"].forEach((k, j) => { const L = (K[k] || []).length ? K[k] : pool[k]; if (!L.length) return; for (let n = 0; n < c[j]; n++) { const name = U.pick(L); cnt[name] = (cnt[name] || 0) + 1; } });
        out.push(...Object.keys(cnt).map(n => this.lootAdd(x.loot, n, cnt[n])));
      }
      if (ly) out.push(this.lootAdd(x.loot, DATA.smName("ly"), ly, ((x.mpK || {}).el || {}).ly));   // 灵元（秘境一次合计，见 matPlan）
      return out.filter(Boolean).join("、");
    },
    // 击败怪物的掉落，写进 loot，返回描述文字
    //   mj = 秘境序号（秘境：灵石倍率、掉落按 config/mijing.js）
    //   mk = "ld"：灵地（config/lingdi.js）
    // 个数参数：数字或 [最少, 最多]（config/explore.js、mijing.js、lingdi.js）
    cntRoll(v) { return Array.isArray(v) ? U.rand(v[0], v[1]) : (v || 0); },
    cntAvg(v) { return Array.isArray(v) ? (v[0] + v[1]) / 2 : (v || 0); },
    // CFG.drop.RUN_STONE：这一处灵石 = 最少 + 第几处(1 起) × (最多 − 最少) ÷ 总处数
    //   凡界 / 四界：每张图东西南北各算一处（地图 × 4）；秘境：按列表顺序；灵地：同一界里按列表顺序
    zoneStone(a, r, mj, mk) {
      const RS = CFG.drop.RUN_STONE; let R, i, n;
      if (mj !== undefined && mk === "ld") { const L = this.mjCfg("ld").list, w = L[mj].w, same = L.map((d, k) => d.w === w ? k : -1).filter(k => k >= 0).sort((a, b) => this.ldOrd(a) - this.ldOrd(b)); R = (RS.lingdi || {})[w]; i = same.indexOf(mj); n = same.length; }
      else if (mj !== undefined) { R = RS.mijing; i = mj; n = this.mjCfg().list.length; }
      else { const w = DATA.maps[a].w || "fan", idx = DATA.worldMapIdx[w]; R = RS[w]; i = idx.indexOf(a) * DATA.regionCount + Math.max(0, r || 0); n = idx.length * DATA.regionCount; }
      if (!R) return 0;
      return R[0] + (i + 1) * (R[1] - R[0]) / Math.max(1, n);   // 第 1 处（青云山林东）= 最少 + 1 级，最后一处 = 最多
    },
    // 本次探索的灵石总收益：这一处平均灵石 + 随机整数[−RAND, RAND]（每次探索算一次，记在 x.rs）
    runStone(x) {
      if (x.rs === undefined) { const RD = CFG.drop.RUN_STONE.RAND || 0, K = x.kuang ? (CFG.explore.KUANG.SHARE === undefined ? 100 : CFG.explore.KUANG.SHARE) / 100 : 1;   // 灵矿：东域 × SHARE%
        x.rs = Math.max(0, this.zoneStone(x.map, x.kuang ? 0 : x.reg || 0, x.mj, x.mk) * K + U.rand(-RD, RD)) * this.incMul(x); }
      return x.rs;
    },
    // config/rates.js 地图收益倍率：按分类（凡界地图 / 四界地图 / 秘境 / 灵地）
    incMul(x) {
      const G0 = (CFG.rates || {}).MAP_GAIN || {}, n = v => (v === undefined ? 1 : Math.max(0, +v || 0));
      const k = x.mj !== undefined ? (x.mk === "ld" ? "lingdi" : "mijing") : ((DATA.maps[x.map] || {}).w || "fan") === "fan" ? "fan" : "sijie";
      return n(G0[k]) * (k === "mijing" && this.oriSum ? 1 + this.oriSum("mjDrop") / 100 : 1);   // 出身「秘境遗民」
    },
    // 击败怪物的掉落，写进 loot，返回描述文字
    //   灵石：本次总收益分摊到本次的怪：首领合计 BOSS_SHARE%，其余普通怪、精英怪平分
    //   mj = 秘境序号（掉落按 config/mijing.js）；mk = "ld"：灵地（config/lingdi.js）
    rollMonsterLoot(x, m) {
      const loot = x.loot, a = x.map, mj = x.mj, mk = x.mk;
      const E = CFG.drop, ev = m.boss ? "boss" : m.elite ? "elite" : "monster", P = x.plan || "", cnt = c => P.split(c).length - 1;
      const nb = cnt("b"), w = cnt("m") + cnt("e"), bs = nb ? Math.min(100, E.BOSS_SHARE || 0) / 100 : 0;
      const tot = this.runStone(x);
      const share = m.boss ? (w ? bs : 1) / Math.max(1, nb) : (nb ? 1 - bs : 1) / Math.max(1, w);
      const stone = Math.floor(tot * share + Math.random());   // 随机取整，平均值不被向下取整吃掉
      loot.stone += stone;
      const mats = mj !== undefined ? this.rollMj(loot, ev, mj, mk, x) : this.rollEvent(loot, ev, a);
      return `灵石${U.fmt(stone)}${mats ? "、" + mats : ""}`; // 怪物不掉丹药、装备
    },
    // 把收获放进背包，返回简短描述
    giveLoot(loot) {
      const s = this.s, parts = [], o = this._off;
      if (o) {   // 离线账本（core/game.js offlineReport）；v173 出窍单独记
        const cq = s.explore && s.explore.cq, L = cq ? o.cq : o;
        if (cq) { o.cq.runs++; o.cq.stone += loot.stone; } else { o.exRuns++; o.exStone += loot.stone; }
        const add = (k, n) => { L.exItems[k] = (L.exItems[k] || 0) + n; o.allItems[k] = (o.allItems[k] || 0) + n; };
        for (const k in loot.mats) { const x = loot.mats[k]; add(DATA.matFull(x.kind, x.g), x.n); }
        for (const name in loot.cu || {}) add(name, loot.cu[name]);
        if (loot.hx) add(DATA.HX, loot.hx);
        for (const k in loot.sm || {}) { const p = DATA.smParse(k); add(DATA.smName(p.k, p.ft, p.tier), loot.sm[k]); }
      }
      s.stone += loot.stone; if (loot.stone) parts.push(`灵石${U.fmt(loot.stone)}`);
      let lost = 0;
      for (const k in loot.mats) { const x = loot.mats[k]; if (this.addMat(x.kind, x.name, x.g, x.n)) parts.push(`${DATA.matFull(x.kind, x.g)}×${U.fmt(x.n)}`); else lost++; }
      for (const name in loot.cu || {}) { if (this.addCustom(name, loot.cu[name])) parts.push(`${name}×${U.fmt(loot.cu[name])}`); else lost++; } // 自定义物品
      if (loot.hx) { if (this.addFire(loot.hx)) parts.push(`${DATA.HX}×${U.fmt(loot.hx)}`); else lost++; }   // 秘境：火髓、专用材料
      for (const k in loot.sm || {}) { const p = DATA.smParse(k);
        if (this.addSm(p.k, loot.sm[k], p.ft, p.tier)) parts.push(`${DATA.smName(p.k, p.ft, p.tier)}×${U.fmt(loot.sm[k])}`); else lost++; }
      if (o) o.exLost += lost;
      return parts.join("、") + (lost ? `（背包已满，遗失 ${lost} 件）` : "");
    },

    /* ---------- 自动探索 ---------- */
    // once = true：历练（只走一次）；否则自动探索（需先历练通过该区域）
    toggleExplore(a, r, once) {
      const s = this.s;
      if (s.explore && !s.explore.cq && s.explore.map === a && s.explore.reg === r && !!s.explore.once === !!once) { this.stopExplore(once ? "放弃历练" : "停止自动探索"); return this.after(); }
      if (s.trib && !s.trib.result) return this.log("渡劫中，不能外出。", "sys");   // 渡劫中只能停止，不能新开 / 更换
      if (!this.regionOpen(a, r)) return;
      if (!once && !this.isTrained(a, r)) return this.log("需先在此区域历练通过，才能自动探索。", "sys");
      if (s.explore) this.stopExplore("更换");
      if (once && s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻（每 10 秒恢复 1%）。", "sys");
      if (s.cultSet) s.cultSet.went = false;
      s.explore = { map: a, reg: r, once: !!once, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.makePlan(), ms: this.exploreMs() };
      if (!once && !this.exReady()) { s.explore.rest = 1; this.log(`${this.exReadyTxt()}，先原地休养，恢复后自动开始。`, "sys"); }
      this.exploreOpen = true; this.exInfo = "ex";
      this.log(`开始在${DATA.regionName(a, r)}${once ? "历练" : "自动探索"}（期间无法修炼）。`, "sys");
      this.after();
    },
    /* ---------- 元婴出窍（config/sect.js 的 CFG.chuqiao）：自动探索指定次数，期间可以继续修炼 ---------- */
    stopChuqiao(a, r) {
      const x = this.s.cq;
      if (x && x.map === a && (x.reg || 0) === r) { this.stopCq("结束出窍"); return this.after(); }
    },
    openChuqiao(a, r) {
      const s = this.s, C = CFG.chuqiao;
      if (r < 0 && !this.kuangOn()) return;   // 灵矿已关闭
      if (!s.cqLearn) return this.log(`需先在宗门宝库兑换${C.NAME}。`, "sys");
      if (this.cqLeftToday() <= 0) return this.log("今天的出窍次数已用完。", "sys");
      if (!this.realmOK(C.REALM)) return this.log(`出窍需要${DATA.realmLabel(C.REALM)}。`, "sys");
      if (r >= 0 && !this.isTrained(a, r)) return this.log("需先在此区域历练通过，才能出窍探索。", "sys");
      if (r < 0 ? !this.mapOpen(a) : !this.regionOpen(a, r)) return;
      const max = this.cqLeftToday();
      this.modal(`<h2>元婴出窍 · ${r < 0 ? this.kuangName(a) : DATA.regionName(a, r)}</h2>
        <p>神识强度 ${s.ssPow || 0}，今天还能出窍探索 ${max} 次；出窍期间可以继续修炼。开始时先扣次数，中途停止只扣已完成和正在进行的，剩下的返还。</p>
        <div class="line"><div>出窍次数<small>1 ~ ${max}</small></div><input id="cq-n" type="number" min="1" max="${max}" value="${max}" style="width:110px"></div>
        <div class="btns"><button class="primary" onclick="G.startChuqiao(${a},${r})">出窍</button><button onclick="G.closeModal()">取消</button></div>`);
    },
    startChuqiao(a, r, nAuto) {
      if (this.s.trib && !this.s.trib.result) return this.log("渡劫中，不能外出。", "sys");   // nAuto：自动任务直接给次数（不弹窗）
      const s = this.s, max = this.cqLeftToday(), n = Math.min(max, Math.floor(nAuto || +($("#cq-n") && $("#cq-n").value) || 0));
      if (n < 1) return;
      if (!nAuto) this.closeModal();
      if (s.cq) this.stopCq("更换");
      this.cqUse(n);   // 开始先扣次数，停止时返还没走的（stopCq）
      s.cq = { map: a, reg: r, once: false, cq: n, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: r < 0 ? this.kuangPlan() : this.makePlan(), ms: this.exploreMs() };
      if (r < 0) s.cq.kuang = 1;   // 灵矿
      if (r >= 0 && !this.exReady()) { s.cq.rest = 1; this.log(`${this.exReadyTxt()}，先原地休养，恢复后自动开始出窍。`, "sys"); }
      this.exploreOpen = true; this.exInfo = "cq";
      this.log(`元婴出窍，前往${r < 0 ? this.kuangName(a) : DATA.regionName(a, r)}探索 ${n} 次（期间可以继续修炼）。`, "sys");
      this.after();
    },
    // 停止：本次已获得的东西也结算
    // 正在出窍时不能历练 / 探索，要先停止出窍
    // v 出窍和探索可以同时进行：出窍放在 s.cq（结构同 s.explore），上一次出窍结果 s.lastCq
    //   cqRun(fn)：把 s.cq / s.lastCq 临时换到 s.explore / s.lastRun 上执行，探索那套代码直接复用
    cqBusy() { return false; },
    cqRun(fn) {
      const s = this.s, e = s.explore, l = s.lastRun;
      this._cqOther = !!(e && !e.rest);   // 探索也在走：每步恢复只算一次（由探索那边算）
      s.explore = s.cq || null; s.lastRun = s.lastCq || null; this._inCq = true;
      try { return fn(); } finally { this._inCq = false; this._cqOther = false; s.cq = s.explore || null; s.lastCq = s.lastRun || null; s.explore = e; s.lastRun = l; }
    },
    stopCq(why) { if (this.s.cq) this.cqRun(() => this.stopExplore(why)); },
    // 旧存档：出窍放在 s.explore 里的挪到 s.cq
    cqMigrate() { const s = this.s; if (s.explore && s.explore.cq && !s.cq) { s.cq = s.explore; s.explore = null; } },
    stopExplore(why) {
      const x = this.s.explore; if (!x) return;
      if (x.cq) { const back = Math.max(0, x.cq - x.count - (x.rest ? 0 : 1)); this.cqRefund(back); if (back) why += `，返还 ${back} 次出窍`; }   // 正在进行的这次扣除，剩下的返还
      const got = this.giveLoot(x.loot);
      this.log(`${why}，${x.mj !== undefined ? `离开${this.exName(x)}` : `共完成 ${x.count} 次探索`}${got ? "，本次收获 " + got : ""}。`, "sys");
      this.s.explore = null;
    },
    // 走一步：随机事件
    exploreStep() {
      const x = this.s.explore, a = x.map, r = x.reg || 0, mj = x.mj, mk = x.mk;
      if (!x.plan) x.plan = this.exPlan(x);
      if (x.step === 0 || !x.mp) x.mp = this.matPlan(x);   // v236 每次开始：定好本次药材 / 矿石总量
      const si = x.step, sm = () => this.stepMats(x, si);
      if (x.loot) { const k = this.incMul(x); if (k !== 1) x.loot.k = k; else delete x.loot.k; }
      const type = { n: "nothing", m: "monster", e: "elite", b: "boss", h: "herb", o: "ore", k: "kuang" }[x.plan[x.step]] || "nothing";
      x.step++;
      // 每走一步恢复生命、法力（HEAL_STEP + 宗门秘法「斗血 / 斗灵」）；战斗回合中不恢复
      const st = this.stats(), H = this._inCq && this._cqOther ? { hp: 0, mana: 0 } : this.regenStep();
      this.s.hp = Math.min(st.hp, this.s.hp + st.hp * H.hp / 100 + (H.hpFlat || 0)); this.s.mana = Math.min(st.mana, this.s.mana + st.mana * H.mana / 100 + (H.manaFlat || 0));
      let t = "", c = "", bd = null;
      const roll = ev => mj !== undefined ? this.rollMj(x.loot, ev, mj, mk, x) : this.rollEvent(x.loot, ev, a);
      if (type === "kuang") { const g = this.kuangStone(a); x.loot.stone += g; t = `挖掘灵石矿，获得灵石 ${U.fmt(g)}`; c = "good"; }
      else if (type === "herb" || type === "ore") {   // v199 什么都没得到时不显示「发现灵药 / 矿脉，获得 无」，当作普通一步
        const g = [roll(type === "herb" ? "herbEvent" : "oreEvent"), sm()].filter(Boolean).join("、");
        if (g) { t = type === "herb" ? `发现灵药，采得 ${g}` : `发现矿脉，挖得 ${g}`; c = "good"; }
        else t = U.pick(DATA.exploreIdle);
      }
      else if (type === "monster" || type === "elite" || type === "boss") {
        const kind = type === "monster" ? "normal" : type, m = mj !== undefined ? this.makeMjMob(mj, kind, mk) : this.makeMob(a, r, kind);
        m.a = a;
        const res = this.battle(m, { foe: m.boss ? "boss" : m.elite ? "elite" : "mob", useSet: true }), tag = `${m.boss ? "【首领】" : m.elite ? "【精英】" : ""}${String(m.name).replace(/^精英·/, "")}`;
        if (res.win) { this.s.kills++; t = `遭遇${tag}，${res.rounds}回合击败，获得 ${[this.rollMonsterLoot(x, m), sm()].filter(Boolean).join("、")}`; c = m.boss ? "gold" : ""; }
        else if (res.lose) { t = `遭遇${tag}，${res.timeout ? `${res.rounds} 回合未能击败，力竭重伤` : `第 ${res.rounds} 回合不敌重伤`}，本次探索收获全部遗失。${res.why}`; c = "bad"; }
        else { const g = sm(); t = `遭遇${tag}，缠斗 ${res.rounds} 回合，各自退去${g ? `，拾得 ${g}` : ""}`; }
        bd = res.detail;
      } else t = U.pick(DATA.exploreIdle);
      x.ev.unshift(bd ? { n: x.step, t, c, b: bd } : { n: x.step, t, c });   // b：完整战斗过程（点「详情」看）
      if (x.ev.length > this.exCfg(x).TIME) x.ev.length = this.exCfg(x).TIME;
      return c === "bad"; // 战败：本次提前结束
    },
    // 生成一次探索的事件顺序（字符串，每个字符一步）：首领固定在最后一步
    makePlan(E = CFG.explore) {
      const T = E.TIME;
      const B = this.cntRoll(E.BOSS), list = [...Array(this.cntRoll(E.MONSTERS)).fill("m"), ...Array(this.cntRoll(E.ELITES)).fill("e"), ...Array(this.cntRoll(E.HERB)).fill("h"), ...Array(this.cntRoll(E.ORE)).fill("o")];
      while (list.length < T - B) list.push("n");
      list.length = T - B;
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      return list.join("") + "b".repeat(B);
    },
    // 地图每走一步的毫秒数 = STEP_SEC − 宗门秘法「神行」 − 出窍真诀（历练、自动探索、出窍、灵矿、秘境、灵地走路都用这个，最少 STEP_MIN 秒）
    exploreMs() { const E = CFG.explore; if (DATA.isTest()) return 1000; return Math.round(Math.max(E.STEP_MIN || 0.5, (E.STEP_SEC || 1) - this.mifaBonus().explore - this.cqzjSec()) * 1000); },
    // v242 自动探索 / 出窍能否继续：生命 ≥ 战斗设置 goHp%且 法力 ≥ goMp%
    exGo() { const b = this.bsetGet(), st = this.stats(); return { hp: st.hp * Math.min(100, b.goHp || 0) / 100, mp: st.mana * Math.min(100, b.goMp || 0) / 100 }; },
    exReady() { const g = this.exGo(); return this.s.hp >= g.hp - 1e-6 && this.s.mana >= g.mp - 1e-6; },
    exReadyTxt() { const g = this.exGo(), b = this.bsetGet(); return this.s.hp < g.hp - 1e-6 ? `生命低于 ${U.num(b.goHp)}%` : `法力低于 ${U.num(b.goMp)}%`; },
    // 下一件事的时间（没有 = Infinity；休养中且已恢复 = 现在）
    exDueAt(x) {
      if (!x) return Infinity;
      if (x.rest) return this.exReady() ? this.now() : Infinity;
      const T = this.exCfg(x).TIME, W = (CFG.explore.END_WAIT || 0) * 1000, ms = x.ms || this.exploreMs();
      return x.lostWait ? x.start + (x.step + 1) * ms : x.step >= T ? x.start + T * ms + W : x.start + (x.step + 1) * ms;
    },
    // 推进到当前时间：探索（s.explore）和出窍（s.cq）按时间先后一件一件交替结算，生命、法力顺序正确
    advanceExplore() {
      const s = this.s; this.cqMigrate();
      // 渡劫中探索、出窍暂停（只结算到点开始渡劫那一刻），渡劫结束后整体顺延，不会在劫雷前就打怪掉血
      const tb = s.trib && !s.trib.result, pz = tb ? (s.trib.t0 || s.trib.start - CFG.trib.PRE_SEC * 1000) : null;
      if (!tb) this.exResume();
      for (let n = 0; n < 200000 && (s.explore || s.cq); n++) {
        const now = pz === null ? this.now() : Math.min(this.now(), pz), dE = s.explore && s.explore._pz != null ? Infinity : this.exDueAt(s.explore), dC = s.cq && s.cq._pz != null ? Infinity : this.exDueAt(s.cq);
        if (Math.min(dE, dC) > now) break;
        if (dE <= dC) this.exAdvance1(dE); else this.cqRun(() => this.exAdvance1(dC));
      }
      if (tb) for (const x of [s.explore, s.cq]) if (x && x._pz == null) x._pz = Math.min(this.now(), pz);
    },
    // 渡劫结束：暂停的探索 / 出窍按暂停时长顺延
    exResume() {
      const s = this.s, now = this.now();
      for (const x of [s.explore, s.cq]) if (x && x._pz != null) { x.start += Math.max(0, now - x._pz); delete x._pz; }
    },
    // 结算 s.explore 的一件事（休养恢复 / 走一步 / 结算一次），只处理到 limit 为止
    exAdvance1(limit) {
      const s = this.s;
      if (!s.explore) return;
      let x = s.explore; const T = this.exCfg(x).TIME;
      let changed = false;
      if (!x.ms) x.ms = this.exploreMs();
      if (x.rest) {   // v186 探索 / 出窍：生命不足时原地休养，恢复满后自动继续
        if (!this.exReady()) return;
        x.rest = 0; x.start = this.now(); x.step = 0; x.loot = this.newLoot(); x.ev = []; x.plan = this.exPlan(x); delete x.rs;
        this.log(`生命、法力已恢复，继续${x.cq ? "出窍探索" : "自动探索"}。`, "sys"); changed = true;
      }
      const W = (CFG.explore.END_WAIT || 0) * 1000;   // v203 走完最后一步：先显示出来，固定再等 END_WAIT 秒才结算（「神行」不影响）
      const due = () => x.lostWait ? x.start + (x.step + 1) * x.ms : x.step >= T ? x.start + T * x.ms + W : x.start + (x.step + 1) * x.ms;
      for (let once = 0; s.explore && once < 1 && Math.min(limit, this.now()) >= due(); once++) {
        changed = true;
        const at = due();   // 这次结算的时间：下一次从这里开始
        // 战败：先把战败那一步显示出来，再等一步的时间才结算「探索失败」
        let lost = false;
        if (x.lostWait) { lost = true; x.lostWait = 0; }
        else if (x.step < T) { if (this.exploreStep()) x.lostWait = 1; continue; }
        if (x.step >= T || lost) {
          // 结算本次
          x.count++;
          if (lost) x.loot = this.newLoot();   // v187 战败：只丢本次收获（物品 + 灵石），不扣身上灵石
          const got = this.giveLoot(x.loot);
          x.last = `${x.once ? "历练" : x.mj !== undefined ? "探索" : `第 ${x.count} 次探索`}${lost ? `（第 ${x.step} 步战败，提前结束）` : ""}：${got || "一无所获"}`;
          this.log(x.mj !== undefined ? this.exName(x) + x.last : x.last, lost ? "bad" : "gold");
          // 保存这一次的全部事件，结束后也能查看（含失败那一步）
          s.lastRun = { title: `${this.exName(x)} · ${x.last}`, ev: x.ev.slice(), bad: lost };
          this.exHistAdd(s.lastRun, x);   // 全部信息：服务器保存最近 20 条
          if (x.mj !== undefined) { if (!this.mjFinish(x, lost)) break; x = s.explore; continue; }   // 秘境：每处只走一次，一键探索接着走下一处
          if (!lost && !x.kuang) this.mjDiscover(x.map);   // 地图走完一次：有几率发现秘境（凡界）/ 灵地（四界）
          if (x.once) { // 历练只走一次；走完且未战败 = 通过，解锁该区域自动探索
            const key = this.regionKey(x.map, x.reg || 0);
            if (!lost && DATA.maps[x.map].w !== "fan" && this.xjGxAdd) { const g = CFG.xingjun.CONTRIB_RUN || 0; if (g) { this.xjGxAdd(x.map, g); this.log(`${DATA.maps[x.map].name}贡献 +${g}`, "gold"); } }   // 四界地图：完成一次历练得本图贡献（config/xingjun.js）
            if (!lost && !s.trainedR.includes(key)) { s.trainedR.push(key); this.log(`${DATA.regionName(x.map, x.reg || 0)}历练通过！已可自动探索。`, "gold"); }
            else if (lost) this.log("历练失败，提升实力后再来。", "bad");
            s.explore = null; break;
          }
          if (x.cq && x.count >= x.cq) {   // 元婴出窍：探索够次数就回来
            this.log(`出窍探索 ${x.count} 次已完成，元婴归窍。`, "gold");
            s.explore = null; break;
          }
          if (!this.exReady()) {   // v242 生命 / 法力低于战斗设置的「继续探索」：原地休养，恢复到了再继续
            this.log(`${this.exReadyTxt()}，原地休养，恢复后自动继续（已探索 ${x.count} 次）。`, "bad");
            x.rest = 1; x.step = 0; x.loot = this.newLoot(); x.ev = []; break;
          }
          x.start = at; x.ms = this.exploreMs(); x.step = 0; x.loot = this.newLoot(); x.ev = []; x.plan = this.exPlan(x); delete x.rs;
        }
      }
      if (changed) this.dirty();
    },
    /* ---------- 秘境（config/mijing.js）、灵地（config/lingdi.js）：共用一套，k = "mj" 秘境（默认）/ "ld" 灵地 ---------- */
    exCfg(x) { return x && x.mj !== undefined ? this.mjCfg(x.mk) : x && x.kuang ? CFG.explore.KUANG : CFG.explore; },
    exPlan(x) { return x.kuang ? this.kuangPlan() : this.makePlan(this.exCfg(x)); },
    exName(x) { return x.mj !== undefined ? this.mjLabel(x.mk) + "·" + this.mjDef(x.mj, x.mk).name : x.kuang ? this.kuangName(x.map) : DATA.regionName(x.map, x.reg || 0); },
    mjCfg(k) { return k === "ld" ? CFG.lingdi : CFG.mijing; },
    mjLabel(k) { return k === "ld" ? DATA.nmPick(CFG.names.mjLabel, "ld", "秘境") : DATA.nmPick(CFG.names.mjLabel, "mj", "秘境"); },   // 名字在 config/names.js 的 mjLabel
    mjDef(i, k) { return this.mjCfg(k).list[i]; },
    mjToday() { return this.bjDay(); },   // 秘境 / 灵地每天次数：北京时间 0 点重置
    // 秘境 / 灵地存档（换日自动清空今天的次数）
    mjState(k) {
      const s = this.s, key = k === "ld" ? "ld" : "mj", m = s[key] || (s[key] = { found: [], trained: [], day: "", used: {} }), t = this.mjToday();
      if (m.day !== t) { m.day = t; m.used = {}; }
      return m;
    },
    mjLeft(i, k) { return Math.max(0, (this.mjCfg(k).DAILY || 1) - (this.mjState(k).used[i] || 0)); },
    // 地图走完一次：凡界地图 → 秘境（find.map = 凡界地图序号）；四界地图 → 灵地（仙冥魔神任一界第 find.map 张）
    //   每处在这张地图能发现、还没发现的按 find.chance% 判定，一次最多发现一处（秘境、灵地各算）
    mjDiscover(a) {
      for (const k of ["mj", "ld"]) {
        const C = this.mjCfg(k); if (!C || !C.list) continue;
        const m = this.mjState(k);
        for (let i = 0; i < C.list.length; i++) {
          const d = C.list[i], M = DATA.maps[a] || {}, at = k === "ld" ? (M.w && M.w !== "fan" && d.find && M.wi === d.find.map ? a : -1) : d.find && d.find.map;
          if (m.found.includes(i) || !d.find || at !== a || Math.random() * 100 >= (d.find.chance || 0)) continue;
          m.found.push(i);
          this.log(k === "ld" ? `探得秘境消息：发现${(DATA.worlds.find(w => w.id === d.w) || {}).name || ""}秘境「${d.name}」！可在 仙冥魔神任一地图 → 灵地 进入。`
            : `探得秘境消息：发现「${d.name}」（需${DATA.realmLabel(d.realm)}）！可在 历练 → 秘境 进入。`, "gold");
          break;
        }
      }
    },
    // 秘境 / 灵地怪物：属性在 js/data/mobs.js 按 config/mobs.js 生成
    makeMjMob(i, kind, k) {
      const d = this.mjDef(i, k), b = DATA.mobMeet(d, kind), v = (x, k) => x * DATA.mobRnd(k);
      const pick = kind === "boss" ? -1 : Math.floor(Math.random() * d.monsters.length), name = kind === "boss" ? d.bossName : (kind === "elite" ? "精英·" : "") + d.monsters[pick];
      const img = `${k === "ld" ? "ld" : "mj"}${i}_${pick + 1}`;   // 秘境 / 灵地怪物图：img/mob/mj第几处_序号.webp（0 = 首领，1~4 = monsters 顺序），灵地 ld 开头
      return this.addMagic({ name, img, Lm: d.L, kind, boss: kind === "boss", elite: kind === "elite", elKey: kind === "boss" ? `${k === "ld" ? "ld" : "mj"}:${i}` : "",
        hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, kind);
    },
    // 秘境 / 灵地掉落：extra 必掉 / 几率掉落（药材矿石总量见 CFG.dropTotal，按步分配，stepMats）
    //   秘境借用 drops 那张凡界地图；灵地借用发现地图（这一界的药材矿石表）
    rollMj(loot, ev, i, k, x) {
      const d = this.mjDef(i, k), EL = ((x || {}).mpK || {}).el || {};
      const got = [];   // v236 随机药材矿石改按 CFG.dropTotal 总量（stepMats）；灵元也在 stepMats（一次合计）；这里只掉 extra
      if (ev === "boss" && k !== "ld" && d.realm === CFG.chuqiao.LU_MJ_REALM && CFG.chuqiao.LU_DROP > 0) { const t = this.lootAdd(loot, DATA.smName("lu"), CFG.chuqiao.LU_DROP); if (t) got.push(t); }   // 元婴期秘境首领必掉养神露
      for (const it of (d.extra || {})[ev] || []) {
        if (Math.random() * 100 >= (it.chance || 0)) continue;
        const nn = it.n || [1, 1], n = U.rand(nn[0], nn[1]); if (n <= 0) continue;
        const sm = DATA.smByName(it.item), t = this.lootAdd(loot, it.item, n, sm ? EL[sm.k] : undefined); if (t) got.push(t);   // 耀石 / 灵晶：只出本次抽中的几种属性
      }
      return got.filter(Boolean).join("、");
    },
    // 按名字把东西记进 loot：火髓 / 专用材料 / 药材矿石 / 自定义物品
    //   耀石 / 灵晶：名字是「耀石」「灵晶」（没写属性）每个随机一种属性
    lootAdd(loot, name, n, fts) {   // fts：耀石 / 灵晶 / 灵元 没写属性时只从这几种属性里随机（属性序号数组）
      if (loot.k !== undefined && loot.k !== 1) { n = Math.floor(n * loot.k + Math.random()); if (n <= 0) return ""; }   // 地图收益倍率（incMul，exploreStep 写进 loot.k）
      if (name === DATA.HX) { loot.hx = (loot.hx || 0) + n; return `${DATA.HX}×${n}`; }
      const sm = DATA.smByName(name);
      if (sm) {
        loot.sm = loot.sm || {};
        if (!(DATA.SM_GRADED.includes(sm.k) && sm.ft === undefined)) { const key = DATA.smKey(sm.k, sm.ft); loot.sm[key] = (loot.sm[key] || 0) + n; return `${DATA.smName(sm.k, sm.ft)}×${n}`; }
        const cnt = {};
        const nk = ((CFG.mijing.items[sm.k] || {}).names || DATA.elements).length;
        for (let j = 0; j < n; j++) { const key = DATA.smKey(sm.k, fts && fts.length ? U.pick(fts) : Math.floor(Math.random() * nk)); loot.sm[key] = (loot.sm[key] || 0) + 1; cnt[key] = (cnt[key] || 0) + 1; }
        return Object.keys(cnt).map(key => `${DATA.smName(sm.k, DATA.smParse(key).ft)}×${cnt[key]}`).join("、");
      }
      const m = DATA.matByName[name];
      if (m) { const key = m.kind + "|" + name; (loot.mats[key] = loot.mats[key] || { kind: m.kind, name, g: m.g, n: 0 }).n += n; return `${name}×${n}`; }
      if (this.cuDef(name)) { loot.cu = loot.cu || {}; loot.cu[name] = (loot.cu[name] || 0) + n; return `${name}×${n}`; }
      return "";
    },
    mjCanEnter(i, k) { const d = this.mjDef(i, k); return !!d && this.mjState(k).found.includes(i) && this.r() >= d.realm && this.mjLeft(i, k) > 0; },
    // 开始走一处秘境 / 灵地（扣今天的次数）；x = 正在走的探索（一键探索接着走）
    mjStart(i, once, queue, x, k) {
      const s = this.s, st = this.mjState(k), d = this.mjDef(i, k); st.used[i] = (st.used[i] || 0) + 1;
      const n = { map: -1, reg: 0, mj: i, once: !!once, queue: queue || [], start: x ? x.start + x.step * x.ms : this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.makePlan(this.mjCfg(k)), ms: this.exploreMs() };
      if (k === "ld") n.mk = "ld";
      s.explore = n;   // 本次结果一直保留到下一次结算
      this.log(`进入${this.mjLabel(k)}「${d.name}」${once ? "历练" : "探索"}（期间无法修炼）。`, "sys");
    },
    // 历练 / 探索一处秘境 / 灵地
    toggleMj(i, once, k) {
      const s = this.s, x = s.explore, L = this.mjLabel(k);
      if (x && x.mj === i && (x.mk || "mj") === (k || "mj")) { this.stopExplore(once ? "放弃历练" : "停止探索"); return this.after(); }
      const d = this.mjDef(i, k), m = this.mjState(k);
      if (!d || !m.found.includes(i)) return;
      if (!this.realmOK(d.realm)) return;
      if (!once && !m.trained.includes(i)) return this.log(`需先历练通过这处${L}，才能自动探索。`, "sys");
      if (this.mjLeft(i, k) <= 0) return this.log(`这处${L}今天已经进过了，明天再来。`, "sys");
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻。", "sys");
      if (s.trib && !s.trib.result) return this.log("渡劫中，不能外出。", "sys");
      if (x) this.stopExplore("更换");
      this.mjStart(i, once, null, null, k); this.exploreOpen = true; this.exInfo = "ex"; this.after();
    },
    // 一键探索：今天还没进过、已历练通过的秘境 / 灵地依次自动探索；k = "all" 凡界秘境 + 四界秘境一起（世界页「秘境探索」）
    //   队列项：数字 = 同一种（x.mk），"mj:序号" / "ld:序号" = 指定种类
    mjQ(e, k) { if (typeof e === "string") { const [kk, i] = e.split(":"); return { k: kk === "ld" ? "ld" : undefined, i: +i }; } return { k, i: e }; },
    mjAllList(k) {
      const ks = k === "all" ? ["mj", "ld"] : [k]; const out = [];
      for (const kk of ks) { const kx = kk === "ld" ? "ld" : undefined, m = this.mjState(kx);
        m.found.filter(i => m.trained.includes(i) && this.mjCanEnter(i, kx)).sort((a, b) => a - b).forEach(i => out.push((kx || "mj") + ":" + i)); }
      return out;
    },
    mjAll(k) {
      const s = this.s, list = this.mjAllList(k);
      if (!list.length) return this.log(`没有可以探索的秘境（要已发现、已历练通过、今天还没进过）。`, "sys");
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻。", "sys");
      if (s.trib && !s.trib.result) return this.log("渡劫中，不能外出。", "sys");
      if (s.explore) this.stopExplore("更换");
      const f = this.mjQ(list[0]); this.mjStart(f.i, false, list.slice(1), null, f.k); this.exploreOpen = true; this.exInfo = "ex"; this.after();
    },
    // 秘境 / 灵地走完一处：历练通过记下；一键探索接着下一处。返回 true = 还在继续
    mjFinish(x, lost) {
      const s = this.s, k = x.mk, m = this.mjState(k), name = this.mjDef(x.mj, k).name, L = this.mjLabel(k);
      if (x.once) {
        if (!lost && !m.trained.includes(x.mj)) { m.trained.push(x.mj); this.log(`${L}「${name}」历练通过！以后可以自动探索。`, "gold"); }
        else if (lost) this.log(`${L}历练失败，明天提升实力再来。`, "bad");
      }
      const q = (x.queue || []).filter(e => { const o = this.mjQ(e, k); return this.mjCanEnter(o.i, o.k); });
      if (lost || !q.length) { s.explore = null; if (x.queue && x.queue.length && lost) s.lastRun.title += "；战败，一键探索停止"; return false; }
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) { this.log("生命不足三成，一键探索停止。", "bad"); s.lastRun.title += "；生命不足三成，一键探索停止"; s.explore = null; return false; }
      const nx = this.mjQ(q[0], k); this.mjStart(nx.i, false, q.slice(1).map(e => typeof e === "string" ? e : (k || "mj") + ":" + e), x, nx.k);
      return true;
    },
    stopNow() { const x = this.s.explore; if (x) this.stopExplore(x.once ? "放弃历练" : "停止探索"); this.after(); },
    stopCqNow() { this.stopCq("结束出窍"); this.after(); },
    // 一处秘境 / 灵地的一行（历练 / 探索按钮）
    mjRow(i, k) {
      const s = this.s, m = this.mjState(k), d = this.mjDef(i, k), x = s.explore, ka = k === "ld" ? ",'ld'" : "";
      const lock = !this.realmOK(d.realm), ok = m.trained.includes(i), left = x && x.cq ? 0 : this.mjLeft(i, k), on = x && x.mj === i && (x.mk || "mj") === (k || "mj");   // 出窍中不能进
      return `<div class="line"><div>${k === "ld" ? DATA.li("img/hall_lingdi.png") : ""}${this._mjModal ? (k === "ld" ? (DATA.worlds.find(w => w.id === d.w) || {}).name || "" : (DATA.worlds.find(w => w.id === "fan") || {}).name || "凡界") + " · " : ""}${d.name}${k === "ld" ? "" : `<span class="tag">需${DATA.realmLabel(d.realm)}</span>`}<small>首领 ${d.bossName} · ${ok ? "已通过历练" : "未历练"} · 今天${left > 0 ? `还能进 ${left} 次` : "已进过"}</small></div>
          ${lock ? `<button class="sm" disabled>境界不足</button>` : `<div><button class="sm ${on && x.once ? "on" : ""}" ${this._mjModal ? `data-refresh="openMjList"` : ""} onclick="G.toggleMj(${i},true${ka})" ${on ? "" : left > 0 ? "" : "disabled"}>${on && x.once ? "停止" : "历练"}</button>
          <button class="sm ${on && !x.once ? "on" : ""}" ${this._mjModal ? `data-refresh="openMjList"` : ""} onclick="G.toggleMj(${i},false${ka})" ${on ? "" : ok && left > 0 ? "" : "disabled"}>${on && !x.once ? "停止" : "探索"}</button></div>`}</div>`;
    },
    mjReady(k) { const m = this.mjState(k), x = this.s.explore; return x && x.cq ? 0 : m.found.filter(i => m.trained.includes(i) && this.mjCanEnter(i, k)).length; },
    mijingView() {
      const m = this.mjState(), L = CFG.mijing.list, ready = this.mjReady();
      const rows = m.found.slice().sort((a, b) => a - b).map(i => this.mjRow(i)).join("");
      return `<div class="card"><h3>凡界${this.mjLabel("mj")}<small>已发现 ${m.found.length} / ${L.length}</small></h3>
        ${rows || `<p class="desc">还没有发现秘境。在凡界地图历练、自动探索时，有几率探得秘境消息。</p>`}
        ${m.found.length ? `<div class="btns"><button class="primary" ${this._mjModal ? `data-refresh="openMjList"` : ""} onclick="G.mjAll()" ${ready ? "" : "disabled"}>一键探索（${ready} 处）</button></div>` : ""}</div>`;
    },
    // 灵地：在仙冥魔神任一地图的「灵地」里显示四界全部已发现的灵地（按界分组）
    // 灵地同一界里的顺序：按发现地图，同一张图按列表顺序
    ldOrd(i) { const d = ((CFG.lingdi || {}).list || [])[i] || {}; return ((d.find || {}).map || 0) * 1000 + i; },
    lingdiView() {
      const m = this.mjState("ld"), L = (CFG.lingdi || {}).list || [], ready = this.mjReady("ld");
      const groups = ["xian", "ming", "mo", "shen"].map(w => {
        const ids = m.found.filter(i => L[i] && L[i].w === w).sort((a, b) => this.ldOrd(a) - this.ldOrd(b)); if (!ids.length) return "";
        const all = L.filter(d => d.w === w).length, wn = (DATA.worlds.find(o => o.id === w) || {}).name || w;
        return `<p class="desc"><b>${wn}</b> · 已发现 ${ids.length} / ${all}</p>` + ids.map(i => this.mjRow(i, "ld")).join("");
      }).join("");
      return `<div class="card"><h3>四界${this.mjLabel("ld")}<small>已发现 ${m.found.filter(i => L[i]).length} / ${L.length}</small></h3>
        ${groups || `<p class="desc">还没有发现四界秘境。在仙界、冥界、魔界、神界的地图历练、自动探索时，有几率探得秘境消息。</p>`}
        ${m.found.length ? `<div class="btns"><button class="primary" ${this._mjModal ? `data-refresh="openMjList"` : ""} onclick="G.mjAll('ld')" ${ready ? "" : "disabled"}>一键探索（${ready} 处）</button></div>` : ""}</div>`;
    },
    // 世界页「秘境探索」：已发现的凡界秘境 + 四界秘境列成一行一处（同 自动探索 / 元婴出窍），底部 一键探索 / 关闭
    //   一键探索 = 全部已发现、已历练通过、今天还没进过的依次自动探索；每处每天一次（config/mijing.js、lingdi.js 的 DAILY）
    openMjList() {
      const rows = [];
      { const m = this.mjState(); m.found.slice().sort((a, b) => a - b).forEach(i => rows.push(this.mjRow(i))); }
      { const m = this.mjState("ld"), L = (CFG.lingdi || {}).list || [];
        m.found.filter(i => L[i]).sort((a, b) => ["xian", "ming", "mo", "shen"].indexOf(L[a].w) - ["xian", "ming", "mo", "shen"].indexOf(L[b].w) || this.ldOrd(a) - this.ldOrd(b)).forEach(i => rows.push(this.mjRow(i, "ld"))); }
      this._mjModal = true; let h; try { h = rows.join(""); } finally { this._mjModal = false; }
      const n = this.s.explore && this.s.explore.cq ? 0 : this.mjAllList("all").length;
      this.modal(`<h2>秘境探索</h2>
        <div class="row small"><span>已发现 ${rows.length} 处 · 今天可一键探索 ${n} 处</span></div>
        <div class="runlist mj-modal">${h || `<p class="desc" style="text-align:center">还没有发现秘境。</p>`}</div>
        <div class="btns"><button class="primary" data-refresh="openMjList" onclick="G.mjAll('all')" ${n ? "" : "disabled"}>一键探索</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setExploreOpen(v) { this.exploreOpen = v; this.render(); },
    // 信息框显示哪个：cq 出窍 / ex 探索（没选过时：正在走的那个，都没有就探索）
    exInfoTab() { const s = this.s; return this.exInfo === "cq" || this.exInfo === "ex" ? this.exInfo : s.cq && !s.explore ? "cq" : "ex"; },
    // 六界图：整张插画 + 各界竖条名牌（位置 % 写在 ATLAS_POS；没开放的变暗）
    atlasView() {
      const P = { tianwai: [50, 12], shen: [50, 29.5], xian: [50, 47.5], fan: [50, 86], mo: [21, 62], ming: [79, 62] };
      const tags = DATA.worlds.map(w => { const p = P[w.id]; if (!p) return "";
        const open = w.open !== false && (this.worldOpen(w.id) || w.id === "fan"), cur = (this.worldId || "fan") === w.id;
        const req = (((CFG.worldMaps || {})[w.id] || {}).open || {}).realm;
        const sub = w.open === false ? "未开放" : "";   // 不显示「需某境界」「当前」
        return `<button class="atag${open ? "" : " dim"}${cur ? " cur" : ""}" style="left:${p[0]}%;top:${p[1]}%" onclick="${w.open === false ? "G.log('机缘暂未开放，敬请期待。','sys')" : `G.setWorld('${w.id}')`}"><b>${w.name}</b>${sub ? `<small>${sub}</small>` : ""}</button>`; }).join("");
      const s = this.s, ln = (x, cq) => x ? `<p onclick="G.setExInfo('${cq ? "cq" : "ex"}',1)"><i>${cq ? "出窍中" : x.once ? "历练中" : "探索中"}</i>${this.exName(x)}</p>` : "";
      const top = `<div class="atl-l"><div class="atl-btns"><button class="pill" onclick="G.openRunList('cq')">元婴出窍</button><button class="pill" onclick="G.openRunList('ex')">自动探索</button></div>${ln(s.cq, true)}${ln(s.explore, false)}</div>
        <div class="atl-r"><button class="pill" onclick="G.openMjList()">秘境探索</button><button class="pill" onclick="G.setExInfo('${s.cq && !s.explore ? "cq" : "ex"}',1)">探索信息</button></div>
`;   // 战斗、设置已移到修炼页顶部「设置」（战斗设置 / 其他设置）
      return `<div class="atlas"><img src="img/map/atlas.webp?v=2" alt="">${tags}${top}</div>` + this.exOverlay();
    },
    // 一界的地图卷轴：从上到下第 1 ~ 10 张图，图左右交替，旁边竖写图名；凡界最后加秘境
    mapScroll(wid, idx, ex) {
      const fan = wid === "fan", s = this.s;
      const rows = idx.map((a, i) => {
        const m = DATA.maps[a], img = fan ? "fan" + Math.min(8, i) : wid + (i % 3), flip = !fan && Math.floor(i / 3) % 2;
        const lockR = !this.realmOK(DATA.mapReq(a)), lockU = !lockR && !this.mapUnlocked(a), run = ex === a;
        const sub = lockR ? "需" + DATA.realmLabel(DATA.mapReq(a)) : lockU ? "未开启" : run ? "探索中" : (fan ? "" : `第 ${i + 1} 重`);
        return `<div class="wsi ${i % 2 ? "r" : "l"}${lockR || lockU ? " lock" : ""}${run ? " cur" : ""}" onclick="G.setMapSel(${a})">
          <img src="img/map/is_${img}.webp" alt=""${flip ? ` style="transform:scaleX(-1)"` : ""}><div class="wsn"><b style="height:${[...m.name].length * 1.45 + 1.2}em">${m.name}</b>${sub ? `<small>${sub}</small>` : ""}</div></div>`; });
      const shop = fan ? `<div class="wsi ${(idx.length + 1) % 2 ? "r" : "l"}" onclick="G.setMapSel('shop')"><img src="img/map/is_shop.webp" alt=""><div class="wsn"><b style="height:${2 * 1.45 + 1.2}em">${DATA.nmPick(CFG.names.worldTab, "shop", "坊市")}</b></div></div>` : "";
      const mj = fan ? (n => `<div class="wsi ${idx.length % 2 ? "r" : "l"}${ex === "mj" ? " cur" : ""}" onclick="G.setMapSel('mj')"><img src="img/map/is_mj.webp" alt=""><div class="wsn"><b style="height:${[...this.mjLabel("mj")].length * 1.45 + 1.2}em">${this.mjLabel("mj")}</b><small>${ex === "mj" ? "探索中" : n ? `已发现 ${n} 处` : "未发现"}</small></div></div>`)(this.mjState().found.length) : "";
      const list = this.mapRev(wid) ? rows.slice().reverse() : rows;
      return `<div class="wscroll ws-${wid}" style="background-image:url(img/map/bg_${wid}.webp)">${list.join("")}${mj}${shop}</div>`;
    },
    // 探索信息浮层：夹在顶部花纹和底部 6 个按钮之间（game.js exovFit），底部 出窍信息 / 探索信息 / 全部信息 / 关闭；「跟随最新」时停在最上面的最新一条（game.js render）
    exOverlay() {
      if (!this.exploreOpen) return "";
      const s = this.s, tab = this.exInfoTab(), x = tab === "cq" ? s.cq : s.explore, last = tab === "cq" ? s.lastCq : s.lastRun, run = x && !x.rest && x.ev;
      const list = run ? x.ev : last ? last.ev : [], src = run ? (tab === "cq" ? "cqcur" : "cur") : (tab === "cq" ? "cqlast" : "last");
      const title = x ? `${tab === "cq" ? "出窍中" : x.once ? "历练中" : "探索中"} · ${this.exName(x)}` : last ? last.title : tab === "cq" ? "出窍信息" : "探索信息";
      const T = x ? this.exCfg(x).TIME : 0, left = x && !x.rest ? Math.max(0, Math.ceil((x.start + T * (x.ms || 1000) - (x._pz != null ? x._pz : this.now())) / 1000 + (CFG.explore.END_WAIT || 0))) : 0;
      const sub = x ? [x.rest ? "休养中" : `第 ${U.fix(Math.min(x.step, T))} / ${T} 步 · 剩余 ${U.cd(left, 1)}`, x.cq ? `已完成 ${x.count} / ${x.cq} 次` : x.count !== undefined && !x.once ? `已完成 ${x.count} 次` : ""].filter(Boolean).join(" · ") : "";
      const st = this.stats(), H = this.regenStep(), hpR = st.hp * H.hp / 100 + (H.hpFlat || 0), mpR = st.mana * H.mana / 100 + (H.manaFlat || 0);
      const vit = `<div class="exov-st"><span>生命 ${U.fmt(s.hp)} / ${U.fmt(st.hp)}</span><span>法力 ${U.fmt(s.mana)} / ${U.fmt(st.mana)}</span><span>每步恢复 生命 ${U.fmt(Math.floor(hpR))} · 法力 ${U.fmt(Math.floor(mpR))}</span></div>`;
      const btn = (k, n) => `<button class="${tab === k ? "on" : ""}" onclick="G.setExInfo('${k}',1)">${n}</button>`;
      return `<div class="exov"><div class="exov-head"><div><b class="${!x && last && last.bad ? "q5" : ""}">${title}</b>${sub ? `<small>${sub}</small>` : ""}${vit}</div>
        <div class="exov-r"><button class="sm${this.exFollow === false ? "" : " on"}" onclick="G.setExFollow()">${this.exFollow === false ? "☐" : "☑"} 跟随最新</button>
        ${x ? `<button class="sm" onclick="${tab === "cq" ? "G.stopCqNow()" : "G.stopNow()"}">${tab === "cq" ? "停止出窍" : x.once ? "放弃历练" : x.kuang ? "停止挖矿" : "停止探索"}</button>` : ""}</div></div>
        <div class="exov-log explore-log" id="exov-log">${list.map((e, i) => this.evLine(e, src, i)).join("") || `<p>${x ? "出发……" : tab === "cq" ? "还没有出窍结果。" : "还没有探索结果。"}</p>`}</div>
        <div class="exov-tabs">${btn("cq", "出窍信息")}${btn("ex", "探索信息")}<button onclick="G.openExHist()">全部信息</button><button onclick="G.setExploreOpen(false)">关闭</button></div></div>`;
    },
    setExInfo(k, keep) { if (!keep && this.exploreOpen && this.exInfoTab() === k) this.exploreOpen = false; else { this.exploreOpen = true; this.exInfo = k; } this.render(); },
    // 探索信息一行：战斗事件后面带「详情」按钮
    evLine(e, src, i) { return `<p class="${e.c}">${e.n ? `<b>第${e.n}步</b> ` : ""}${e.t}${e.b ? ` <button class="sm" onclick="G.showBattle('${src}',${i})">详情</button>` : ""}</p>`; },
    setLastOpen(v) { this.lastOpen = v; this.render(); },
    // 全部信息：探索、出窍、历练、秘境每次结束记一条，战斗（实力测试除外）在服务器 playBattle 里记，天劫在 trib.js endTrib 记；
    //   放进 s.histQ，服务器取走存 hist 表（最近 20 条），客户端打开时用 /api/hist 读
    exHistAdd(r, x) {
      const s = this.s, k = !x ? "探索" : x.mj !== undefined ? this.mjLabel(x.mk) : x.once ? "历练" : x.cq ? "出窍" : x.kuang ? "挖矿" : "探索";
      (s.histQ || (s.histQ = [])).push({ at: this.now(), k, title: r.title, bad: !!r.bad, ev: r.ev.slice() });
    },
    async openExHist(k) {
      if (k === undefined) {   // 打开时从服务器读最近 20 条
        this.exHistSel = -1;
        this.modal(`<h2>全部信息</h2><p class="desc">读取中…</p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
        try { this._hist = (await API.req("hist")).list || []; } catch (e) { this._hist = []; this.log("读取全部信息失败：" + e.message, "bad"); }
      } else this.exHistSel = this.exHistSel === k ? -1 : k;
      const h = this._hist || [], sel = this.exHistSel, z = n => String(n).padStart(2, "0");
      const tm = t => { const d = new Date(t); return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
      this.modal(`<h2>全部信息<small style="color:#8c7e66;font-size:12px;margin-left:6px">最近 ${h.length} 条</small></h2>
        ${h.length ? h.map((r, i) => `<div class="line" style="align-items:center"><div class="${r.bad ? "q5" : ""}" style="font-size:13px">${r.k ? `<span class="tag">${r.k}</span> ` : ""}${r.title}<small>${r.at ? tm(r.at) : ""}</small></div><button class="sm ${sel === i ? "on" : ""}" style="flex-shrink:0" onclick="G.openExHist(${i})">${sel === i ? "收起" : "详细"}</button></div>
          ${sel === i ? `<div class="explore-log">${(r.ev || []).map((e, j) => this.evLine(e, "h" + i, j)).join("")}</div>` : ""}`).join("") : "<p>还没有记录。</p>"}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setMapSel(a) { this.shopFromCult = false; this.mapSel = a; this.mapPage = true; this.hallSel = null; this.render(); this.viewScroll(0); },   // a = 地图序号，"mj" = 秘境

    /* ---------- 坊市：丹药 装备 功法 药材 矿石 ----------
     * 丹药、装备：content/items.js 的 ITEMS.shop，只卖练气品质
     * 功法：凡界坊市功法（config/gongfa.js 的 shop），灵石购买，买下即学会第 1 层
     * 药材、矿石：凡界地图会掉的（config/drops.js），售价 = 出售价 × CFG.price.SHOP_MAT */
    setShopTab(t) { this.shopTab = t; this.render(); },
    setShopStar(n) { this.shopStar = n; this.render(); },
    shopList() {
      const g = 0, list = [];   // 只卖练气品质
      for (const x of ITEMS.shop) {
        if (!x || (x.realm !== undefined && this.r() < x.realm)) continue;
        if (x.kind === "pill" && DATA.pills[x.type]) list.push({ kind: "pill", type: x.type, g, price: DATA.shopPrice(x.price || DATA.pillPrice(x.type, g)), tab: "pill" });
        else if (x.kind === "eq" && DATA.eqSlots6.includes(x.slot)) list.push({ kind: "eq", slot: x.slot, price: DATA.shopPrice(x.price), tab: "eq" });
      }
      return list;
    },
    buy(i, n = 1) {
      const it = this.shopList()[i]; if (!it) return;
      let k = 0;
      for (; k < n; k++) {
        if (this.s.stone < it.price) { this.log("灵石不足。", "sys"); break; }
        const ok = it.kind === "pill" ? this.addPill(it.type, it.g) : this.addEquip(DATA.rollForged(it.slot, 0)); // 头盔~吊坠：一阶炼器装备（随机属性）
        if (!ok) break;
        this.s.stone -= it.price;
      }
      if (k) this.log(`购买成功 ×${k}。`, "good");
      this.after();
    },
    // 坊市药材、矿石
    shopMatPrice(kind, g) { return DATA.shopPrice(Math.max(1, Math.ceil(DATA.matPrice(kind, g) * (CFG.price.SHOP_MAT || 3)))); },
    buyMat(kind, g, n) {
      n = Math.floor(n || +($("#shop-n") && $("#shop-n").value) || 1);
      const names = kind === "herb" ? DATA.herbs : DATA.ores;
      if (n <= 0 || !DATA.fanMats().has(names[g])) return;
      const c = this.shopMatPrice(kind, g) * n;
      if (this.s.stone < c) return this.log(`灵石不足，需要 ${U.fmt(c)}。`, "sys");
      if (!this.addMat(kind, names[g], g, n)) return;
      this.s.stone -= c; this.shopN = n;
      this.log(`购买${DATA.matFull(kind, g)} ×${U.fmt(n)}，灵石 -${U.fmt(c)}。`, "good"); this.after();
    },
    // 坊市功法：买下即学会第 1 层
    buyGongfa(id) {
      const g = DATA.skillInfo(id);
      if (!g || g.src !== "shop" || this.hasGongfa(id)) return;
      if (!this.realmOK(g.sect.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(g.sect.reqRealm)}。`, "sys");
      if (this.s.stone < g.cost) return this.log("灵石不足。", "sys");
      if (!this.lqCan("gf", id)) return;   // v173 学习队列
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      this.s.stone -= g.cost; this.startGfLearn(id); this.after();
    },
    // 仙魔冥神坊市 / 功德司功法：坊市 = 灵石 + 本图贡献，功德司 = 功德
    learnJieGf(id) {
      const g = DATA.skillInfo(id), s = this.s;
      if (!g || (g.src !== "jshop" && g.src !== "gd") || (g.sect && g.sect.old) || this.hasGongfa(id)) return;   // 神界旧 6~10 星不再出售
      if (!this.realmOK(g.sect.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(g.sect.reqRealm)}。`, "sys");
      if (!this.lqCan("gf", id)) return;   // v173 学习队列
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      if (g.src === "gd") { if ((s.merit || 0) < g.cost) return this.log("功德不足。", "sys"); s.merit -= g.cost; }
      else {
        if (s.stone < g.cost) return this.log("灵石不足。", "sys");
        if (this.xjGxOf(g.sect.map) < g.gx) return this.log("本图贡献不足。", "sys");
        s.stone -= g.cost; this.xjGxAdd(g.sect.map, -g.gx);
      }
      this.startGfLearn(id); this.after();
    },
    // 功德司上古丹：本界第 i 张图卖 i 阶（config/alchemy.js 的 SHANGGU）
    sgDanList(a) {
      const S = CFG.alchemy.SHANGGU || {}, w = DATA.maps[a].w, cat = (S.WORLD_CAT || {})[w], g = (DATA.worldMapIdx[w] || []).indexOf(a);
      if (!cat || g < 0) return [];
      return Object.keys(DATA.dans).filter(t => DATA.danCat(t) === cat && CFG.alchemy.recipes[t].val[g] !== undefined).map(type => ({ type, g, cost: ((w === "shen" && S.SHEN_MERIT ? S.SHEN_MERIT : S.MERIT) || [])[g] || 0 }));   // 含 6 种抗性丹；神界价格单独
    },
    // 四界功德司丹方：第 i 张地图（0 起）学本界 i 阶丹方，功德 = DATA.danGdCost(i)
    gdRecipeList(a) {
      const S = CFG.alchemy.SHANGGU || {}, w = (DATA.maps[a] || {}).w, cat = (S.WORLD_CAT || {})[w], g = (DATA.worldMapIdx[w] || []).indexOf(a);
      if (!cat || g < 0) return [];
      return Object.keys(DATA.recipes).filter(t => DATA.danCat(t) === cat && DATA.recipeHas(t, g)).map(type => ({ type, g, cost: DATA.danGdCost(g, w === "shen") }));
    },
    learnGdRecipe(a, type) {
      const s = this.s, o = DATA.jieGfOf("gd", a), d = this.gdRecipeList(a).find(x => x.type === type); if (!o || !d) return;
      const key = type + "|" + d.g;
      if (s.recipes.includes(key)) return this.log("已经学会了。", "sys");
      if (s.bag.some(x => x.t === "dfb" && x.type === type && x.g === d.g)) return this.log("背包里已经有这张丹方了。", "sys");
      if (!this.realmOK(o.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(o.reqRealm)}。`, "sys");
      if ((s.merit || 0) < d.cost) return this.log("功德不足。", "sys");
      if (this.bagFull()) return this.log("背包已满。", "sys");
      s.merit -= d.cost; s.bag.push({ t: "dfb", type, g: d.g });   // 兑换到背包，在背包里学习
      this.log(`兑换了${DATA.danName(type, d.g)}丹方，放入背包，可在背包里学习。`, "good"); this.after();
    },
    buySgDan(a, type, n) {
      const s = this.s, o = DATA.jieGfOf("gd", a), d = this.sgDanList(a).find(x => x.type === type); if (!o || !d) return;
      if (!this.realmOK(o.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(o.reqRealm)}。`, "sys");
      n = Math.min(n, Math.floor((s.merit || 0) / d.cost)); if (n <= 0) return this.log("功德不足。", "sys");
      if (!this.addDan(type, d.g, n, 1)) return;
      s.merit -= d.cost * n; this.log(`购得${DATA.danName(type, d.g, 1)} ×${n}。`, "good"); this.after();
    },
    jieGfView(kind, a) {
      const s = this.s, o = DATA.jieGfOf(kind, a); if (!o) return "";
      const lock = !this.realmOK(o.reqRealm), gd = kind === "gd";
      const rows = U.doneLast(DATA.gfTypesOf(o.src, o.star).map(ty => { const g = DATA.gongfaInfo(DATA.gongfaId(o.id, ty.id)), has = this.hasGongfa(g.id);
        const poor = gd ? (s.merit || 0) < g.cost : s.stone < g.cost || this.xjGxOf(a) < g.gx;
        return [has, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${g.el.name}</span><span class="tag">${ty.name}</span><small>每层${g.label} +${U.num(g.perLv)}${g.label2 ? ` · ${g.label2} +${U.num(g.perLv2)}` : ""} · ${gd ? `${U.fmt(g.cost)} 功德` : `${U.fmt(g.cost)} 灵石 · ${U.fmt(g.gx)} 贡献`} · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>
          ${lock && !has ? `<button class="sm" disabled>境界不足</button>` : this.gfLearnBtn(g, `G.learnJieGf('${g.id}')`, poor)}</div>`]; }));
      const dans = gd ? this.sgDanList(a).map(d => { const r = DATA.dans[d.type], poor = (s.merit || 0) < d.cost;
        return `<div class="line"><div>${DATA.danImg(DATA.danIcon(d.type), DATA.danCls(d.type, d.g), "li")}${DATA.danName(d.type, d.g, 1)}<small>永久${r.label} +${U.num(DATA.danVal(d.type, d.g))} · 已服 ${DATA.danLimit(d.type, d.g) - this.danLeft(d.type, d.g)} / ${DATA.danLimit(d.type, d.g)} · ${U.fmt(d.cost)} 功德</small></div>
          ${lock ? `<button class="sm" disabled>境界不足</button>` : `<div class="sg-btns"><button class="sm" onclick="G.buySgDan(${a},'${d.type}',1)" ${poor ? "disabled" : ""}>购买</button><button class="sm" onclick="G.buySgDan(${a},'${d.type}',10)" ${poor ? "disabled" : ""}>×10</button></div>`}</div>`; }).join("") : "";
      const recs = gd ? this.gdRecipeList(a).map(d => { const key = d.type + "|" + d.g, has = s.recipes.includes(key);
        return [has, `<div class="line"><div>${DATA.danImg(DATA.danIcon(d.type), DATA.danCls(d.type, d.g), "li")}《${DATA.danName(d.type, d.g)}》<span class="tag">${DATA.recipeEffect(d.type, d.g)}</span>
          <small>${this.matsText(DATA.danRecipe(d.type, d.g))}<br>${U.fmt(d.cost)} 功德</small></div>
          ${has ? `<button class="sm" disabled>已学会</button>` : s.bag.some(x => x.t === "dfb" && x.type === d.type && x.g === d.g) ? `<button class="sm" disabled>已在背包</button>` : lock ? `<button class="sm" disabled>境界不足</button>` : `<button class="sm" onclick="G.learnGdRecipe(${a},'${d.type}')" ${(s.merit || 0) < d.cost ? "disabled" : ""}>兑换</button>`}</div>`]; }) : [];
      const fruit = gd ? (c => `<div class="card"><h3>${DATA.smName("wdg")}</h3><div class="line"><div>${DATA.li(DATA.smIcon("wdg"))}${DATA.smName("wdg")}<small>洞府悟道室悟道用 · ${c} 功德/个 · 已有 ${U.fmt(this.smCount("wdg"))}</small></div>
        <div class="sg-btns"><button class="sm" onclick="G.buyWdFruit(1,${a})" ${(s.merit || 0) < c ? "disabled" : ""}>购买</button><button class="sm" onclick="G.buyWdFruit(10,${a})" ${(s.merit || 0) < c * 10 ? "disabled" : ""}>×10</button></div></div></div>`)(this.wdFruitCost(a)) : "";
      return this.lqCard("gf") + fruit + `<div class="card"><h3>${o.name}<small>${gd ? `功德 ${U.fmt(s.merit || 0)}` : `灵石 ${U.fmt(s.stone)} · 本图贡献 ${U.fmt(this.xjGxOf(a))}`}</small></h3>${rows}</div>${recs.length ? this.lqCard("dan") + `<div class="card"><h3>丹方<small>用功德兑换，在背包里学习</small></h3>${U.doneLast(recs)}</div>` : ""}${dans ? `<div class="card"><h3>上古丹</h3>${dans}</div>` : ""}`;
    },
    // 管理员：网页里更新游戏（服务器拉取 GitHub 最新代码，完成后刷新页面）
    async webUpdate() {
      if (this.updating || !(await this.ask("从 GitHub 拉取最新代码并重启存档服务？在线玩家会短暂断线并重连。"))) return;
      this.updating = true; this.render();
      try { await API.adminUpdate(); } catch (e) { this.updating = false; this.log("更新失败：" + e.message, "bad"); return this.render(); }
      const t0 = Date.now(), poll = async () => {
        try { const j = await API.adminInfo(); this.adminInfo = j;
          if (/更新完成|失败|error/i.test(j.log || "") && Date.now() - t0 > 3000) { this.updating = false; this.log(/更新完成/.test(j.log) ? "游戏已更新，点「刷新页面」载入新版本。" : "更新出错，看下面的输出。", /更新完成/.test(j.log) ? "gold" : "bad"); return this.render(); }
        } catch (e) {}   // 存档服务重启的几秒连不上，继续等
        if (Date.now() - t0 > 120000) { this.updating = false; this.log("等待超时，稍后刷新页面看看。", "bad"); return this.render(); }
        this.render(); setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    },
    shopView() {
      const s = this.s, t = this.shopTab || "pill";
      const tabs = `<div class="sub-tabs">${[["pill", "丹药"], ["eq", "装备"], ["gf", "功法"], ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore]].map(([k, n]) =>
        `<button class="${t === k ? "active" : ""}" onclick="G.setShopTab('${k}')">${n}</button>`).join("")}</div>`;
      if (t === "pill" || t === "eq") {
        const rows = this.shopList().map((it, i) => {
          if (it.tab !== t) return "";
          const multi = it.kind === "pill";
          const name = it.kind === "pill" ? `${DATA.realms[it.g]}·${DATA.pills[it.type].name}` : DATA.forgeEqName(it.slot, 0);
          const desc = it.kind === "pill" ? `修炼速度 +${Math.round(DATA.pillPct(it.type, it.g))}%，${DATA.pills[it.type].dur}次修炼` : `${DATA.slots[it.slot]} · 2 条主属性 + 1~5 条附加属性（颜色随机）`;
          const img = it.kind === "pill" ? DATA.pillIcon(it.type) : DATA.iconImg("eq_" + it.slot);
          return `<div class="line"><div>${DATA.li(img)}${name}<small>${desc}</small></div><div>
            <button class="sm" onclick="G.buy(${i})" ${s.stone < it.price ? "disabled" : ""}>${U.fmt(it.price)}</button>
            ${multi ? `<button class="sm" onclick="G.buy(${i},10)" ${s.stone < it.price * 10 ? "disabled" : ""}>×10</button>` : ""}</div></div>`;
        }).join("");
        return tabs + `<div class="card"><h3>${t === "pill" ? "丹药" : "装备"}<small>练气期货品 · 灵石 ${U.fmt(s.stone)}</small></h3>${rows || `<p class="desc">暂无货品。</p>`}</div>`;
      }
      if (t === "gf") {
        const star = this.shopStar || 1, N = DATA.SHOP_GF_PREFIX.length;
        const srcs = DATA.shopSources.filter(o => o.star === star), lock = !this.realmOK(srcs[0] ? srcs[0].reqRealm : 0);
        const line = g => { const has = this.hasGongfa(g.id);
          const desc = g.kind === "sp" ? `${g.el.name}系 · ${this.spellDmgTxt(g)} · 耗法力 ${U.fmt(g.mana)}` : `每层${g.label} +${U.num(g.perLv)}${g.label2 ? ` · ${g.label2} +${U.num(g.perLv2)}` : ""}`;
          return [has, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${g.kind === "sp" ? "法术" : g.type.name}</span><small>${desc} · ${U.fmt(g.cost)} 灵石 · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>
            ${lock && !has ? `<button class="sm" disabled>境界不足</button>` : this.gfLearnBtn(g, `G.buyGongfa('${g.id}')`, s.stone < g.cost)}</div>`]; };
        return tabs + this.lqCard("gf") + `<div class="room-grid">${Array.from({ length: N }, (_, i) => `<button class="${star === i + 1 ? "active" : ""}" onclick="G.setShopStar(${i + 1})">${i + 1}星</button>`).join("")}</div>` +
          U.doneCards(srcs.map(o => ({ head: `<h3>${o.name}<span class="tag">${DATA.elById[o.el].name}</span></h3>`,
            rows: DATA.gfTypesOf("shop", o.star).filter(ty => !ty.sectOnly).map(ty => line(DATA.gongfaInfo(DATA.gongfaId(o.id, ty.id))))
              .concat([line(DATA.spellInfo(DATA.spellId(o.id, o.el)))]) })));
      }
      const names = t === "herb" ? DATA.herbs : DATA.ores, fan = DATA.fanMats();
      return tabs + `<div class="card"><h3>${DATA.matKinds[t]}<small>凡界地图产出 · 灵石 ${U.fmt(s.stone)}</small></h3>
        <div class="line"><div>购买数量</div><input id="shop-n" type="number" min="1" value="${this.shopN || 1}" oninput="G.shopN=+this.value" style="width:110px"></div>` +
        names.map((n, g) => { if (!fan.has(n)) return ""; const c = this.shopMatPrice(t, g);
          return `<div class="line"><div>${DATA.li(DATA.matImg(t, g))}${DATA.matFull(t, g)}<small>${U.fmt(c)} 灵石/个 · 已有 ${U.fmt(this.countMat(t, g))}</small></div>
            <button class="sm" onclick="G.buyMat('${t}',${g})" ${s.stone < c ? "disabled" : ""}>购买</button></div>`; }).join("") + `</div>`;
    },

    // 其他设置（修炼页 → 设置 → 其他设置）：管理员、礼包码、账号（人物形象、背景在「背景设置」）
    otherSetHtml() {
      const isAdmin = !!(this.adminInfo && this.adminInfo.admin);
      if (this.adminInfo === undefined) { this.adminInfo = null; API.adminInfo().then(j => { this.adminInfo = j; this.render(); }).catch(() => {}); }
      const upd = isAdmin ? `<div class="card"><h3>管理员<small>仅管理员可见</small></h3><div class="btns"><button class="primary" onclick="G.openAdminFromCult()">管理员</button></div></div>` : "";
      return upd + this.giftRedeemCard() + `<div class="card"><h3>账号<small>${API.user}</small></h3>${this.oriNames && this.oriNames() ? `<p class="desc">出身：${this.oriNames()}</p>` : ""}
      <p class="desc">存档保存在服务器，换手机、关浏览器都不会丢。离线期间修炼、聚灵阵持续进行，不封顶。</p>
      <div class="btns"><button onclick="G.openPwForm(true)">修改密码</button><button onclick="G.logout()">退出登录</button>
      <button onclick="G.restart()">删档重来</button></div>${this.pwFormView()}</div>`;
    },
    // 管理员页在「世界」页里显示：跳过去，返回时回到修炼页设置
    openAdminFromCult() { this.setFromCult = true; this.tab = "world"; this.atlasOn = false; this.atlasSub = "set"; this.openAdmin(true); },
    backToCultSet() { this.setFromCult = false; this.adminPage = false; this.atlasSub = null; this.atlasOn = true; this.tab = "cultivate"; this.cultView = "set"; this.setTab = "other"; this.render(); },
    backFromShop() { this.shopFromCult = false; this.mapPage = false; this.atlasOn = true; this.tab = "cultivate"; this.render(); },

    /* ---------- 背景主题：存在本机（localStorage xiu_bg），只影响这台设备 ---------- */
    bgCard() {
      let cur = ""; try { cur = localStorage.getItem("xiu_bg") || ""; } catch (e) {}
      return `<div class="card"><h3>背景</h3><div class="bg-grid">${BG_THEMES.map(([id, nm]) =>
        `<div class="bg-sw${id === cur ? " on" : ""}" data-bgsw="${id}" onclick="G.setBg('${id}')">${nm}</div>`).join("")}</div></div>`;
    },
    setBg(id) {
      try { id ? localStorage.setItem("xiu_bg", id) : localStorage.removeItem("xiu_bg"); } catch (e) {}
      applyBg(); this.render();
    },
  },

  view() {
    // 战斗、设置从六界图左下 / 右下进（atlasSub）；凡界坊市在凡界地图卷轴里（mapSel "shop"）
    const s = this.s, wid = this.worldId || "fan", wt = this.atlasSub === "battle" || this.atlasSub === "set" ? this.atlasSub : "explore";
    const fback = fn => `<div class="fback"><button onclick="${fn}">返回</button></div>`;   // 固定在右下角的返回（不跟着地图滑动）
    // 六界图（img/map/atlas.webp，竖条名牌按 ATLAS_POS 摆）；进了某一界顶部只留一条：六界图按钮 + 界名
    const W0 = DATA.worlds.find(w => w.id === wid) || DATA.worlds[0];
    if (wt === "explore" && (this.atlasOn || this.worldId === undefined)) return this.atlasView();
    const worlds = "";
    const W = DATA.worlds.find(w => w.id === wid);
    if (wt === "battle") return `<div class="mpage"><div class="pghead">战斗</div>` + this.bsetView() + fback("G.setAtlasSub(null)") + "</div>";   // 包 mpage：返回固定右下
    if (!this.worldOpen(wid) && wt === "explore") return worlds + `<div class="mpage"><div class="card"><h3>${W.name}</h3><p class="desc">${W.desc}</p>${(CFG.worldMaps || {})[wid] ? "" : `<p class="desc">界壁未开，以你如今的修为尚无法踏足。</p>`}</div>` + fback("G.openAtlas()") + "</div>";
    const tabs = "";

    if (wt === "explore") {
      const st = this.stats();
      const bars = `<div class="row small"><span>生命 ${U.fmt(s.hp)} / ${U.fmt(st.hp)}</span><span>斩妖 ${s.kills}</span></div>
        <div class="bar hp"><div style="width:${s.hp / st.hp * 100}%"></div></div>
        <div class="row small"><span>法力 ${U.fmt(s.mana)} / ${U.fmt(st.mana)}</span><span>灵石 ${U.fmt(s.stone)}</span></div>`;
      // 进行中的卡片：探索（s.explore）、出窍（s.cq）各一张；下面一个信息框：出窍信息 / 探索信息 / 全部信息
      const runCard = (x, cq) => { const T = this.exCfg(x).TIME;
          const sub = x.mj !== undefined ? (x.once ? "" : x.queue && x.queue.length ? `一键探索 · 后面还有 ${x.queue.length} 处` : this.mjLabel(x.mk) + "探索") : x.once ? "" : x.cq ? `已完成 ${x.count} / ${x.cq} 次` : `已完成 ${x.count} 次`, hpP = Math.min(100, s.hp / this.stats().hp * 100), mpP = Math.min(100, s.mana / Math.max(1, this.stats().mana) * 100), bg = this.bsetGet(), gH = Math.min(100, bg.goHp || 0), gM = Math.min(100, bg.goMp || 0), restP = Math.min(gH > 0 ? hpP / gH : 1, gM > 0 ? mpP / gM : 1) * 100;   // v202 休养进度 = 生命、法力离「继续探索」设置还差多少
          return `<div class="card"><h3>${x.once ? "历练中" : cq ? "出窍中" : "探索中"} · ${this.exName(x)}<small>${sub}</small></h3>
          <div class="bar tick"><div style="width:${x.rest ? Math.min(100, restP) : x.step / T * 100}%"></div></div>
          <div class="row small" style="align-items:center"><span>${x.rest ? `<b class="c-red">休养中</b> · 生命 ${U.fix(Math.floor(hpP) + "%")} / <b class="c-green">${gH}%</b><br><b class="c-red">休养中</b> · 法力 ${U.fix(Math.floor(mpP) + "%")} / <b class="c-green">${gM}%</b>` : x.step >= T ? `第 ${U.fix(T)} / ${T} 步 · 结算中` : `第 ${U.fix(x.step)} / ${T} 步 · 剩余 ${U.cd(Math.max(0, Math.ceil((x.start + T * (x.ms || 1000) - (x._pz != null ? x._pz : this.now())) / 1000 + (CFG.explore.END_WAIT || 0))), 1)}`}</span><span style="white-space:nowrap;flex-shrink:0">
            <button class="sm" onclick="G.setExInfo('${cq ? "cq" : "ex"}',1)">${cq ? "出窍信息" : "探索信息"}</button>
            <button class="sm" onclick="G.${cq ? "stopCqNow" : "stopNow"}()">停止</button></span></div></div>`; };
      // 没在探索 / 出窍时：一行三个按钮打开信息浮层（进行中用卡片上的按钮）
      const infoBox = s.explore || s.cq ? "" : `<div class="card"><div class="btns" style="margin-top:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px"><button class="sm" onclick="G.setExInfo('cq',1)">出窍信息</button><button class="sm" onclick="G.setExInfo('ex',1)">探索信息</button><button class="sm" onclick="G.openExHist()">全部信息</button></div></div>`;
      const status = (s.explore ? runCard(s.explore, false) : "") + (s.cq ? runCard(s.cq, true) : "") + infoBox + this.exOverlay();
      // 地图选择（9 张）+ 选中地图的 东西南北 四个区域
      // v45：只列当前这一界的 9 张地图；秘境只在凡界
      const idx = (DATA.worldMapIdx[wid] || []).slice().sort((a, b) => DATA.mapReq(a) - DATA.mapReq(b) || a - b), fan = wid === "fan";   // 从低到高
      const ex = s.explore ? (s.explore.mj !== undefined ? (fan && s.explore.mk !== "ld" ? "mj" : undefined) : idx.includes(s.explore.map) ? s.explore.map : undefined) : undefined;
      const ok = idx.filter(a => this.mapOpen(a));
      const sel = this.mapSel !== undefined && (this.mapSel === "mj" || this.mapSel === "shop" ? fan : idx.includes(this.mapSel)) ? this.mapSel : ex !== undefined ? ex : idx[0];
      const halls = ((CFG.worldMaps || {})[wid] || {}).halls;
      if (!this.mapPage) {   // 地图卷轴：不显示生命法力，点一张图进去；四界左下角固定 灵地 / 悟道碑（不跟着地图滑动）
        const wh = halls && (this.hallSel === "lingdi" || this.hallSel === "wudao") && halls[this.hallSel] !== undefined ? this.hallSel : null;
        if (wh) return `<div class="mpage" style="background-image:url(img/map/bg_${wid}.webp)"><div class="pghead">${halls[wh]}</div>${wh === "lingdi" ? this.lingdiView() : `<div class="card"><h3>${halls[wh]}</h3></div>`}${fback("G.setWHall(null)")}</div>` + this.exOverlay();
        const fl = halls ? ["lingdi", "wudao"].filter(id => halls[id] !== undefined).map(id => `<button class="fic" onclick="G.setWHall('${id}')"><img src="img/hall_${id}.png" alt=""><span>${halls[id]}</span></button>`).join("") : "";
        return this.mapScroll(wid, idx, ex) + this.exOverlay() + `<div class="fback"><div class="fl">${fl}</div><button onclick="G.openAtlas()">返回</button></div>`;
      }
      const mb = fback(sel === "shop" && this.shopFromCult ? "G.backFromShop()" : "G.setMapPage(false)"), pg = h => `<div class="mpage" style="background-image:url(img/map/bg_${wid}.webp)">${h}${mb}</div>`;   // 点进去的页面也铺满（本界背景图）
      const gs = this.gridSel;   // 地图格子页
      if (gs && gs.a === sel && this.gridOpen(gs.a, gs.r)) return `<div class="mpage gpage" style="background-image:url(img/map/bg_${wid}.webp)"><div class="pghead">${DATA.regionName(gs.a, gs.r)}</div>${this.gridView(gs.a, gs.r, wid)}<div class="fback"><div class="fl"><button class="gq" onclick="G.gridQuick(${gs.a},${gs.r})">快速<br>游历</button><button class="gq" onclick="G.openGridRec()">已获<br>机缘</button></div><button onclick="G.openGrid()">返回</button></div></div>`;
      if (sel === "shop") return pg(`<div class="pghead">${DATA.nmPick(CFG.names.worldTab, "shop", "坊市")}</div>` + this.shopView());
      const mback = `<div class="pghead">${sel === "mj" ? this.mjLabel("mj") : DATA.maps[sel].name}</div>`;
      if (halls && sel !== "mj") {
        // v49：仙冥魔神每张地图 7 处地点（config/worldmaps.js 的 halls，图片 img/hall_<id>.png），点进去是各自的页面
        const hn = id => this.xjHallName(sel, id), hs = halls[this.hallSel] ? this.hallSel : null;
        if (hs) {
          const back = `<div class="pghead">${DATA.maps[sel].name} · ${hn(hs)}</div>`;
          const page = hs === "tg" ? this.tgView(sel) : hs === "xj" ? this.xjView(sel)
            : hs === "lilian" ? bars + status + this.regionsCard(sel) : hs === "lingdi" ? bars + status + this.lingdiView()
            : hs === "shop" || hs === "gd" ? this.jieGfView(hs === "gd" ? "gd" : "jshop", sel) : `<div class="card"><h3>${hn(hs)}</h3></div>`;
          return `<div class="mpage" style="background-image:url(img/map/bg_${wid}.webp)">${back + page + fback("G.setHall(null)")}</div>`;
        }
        const ico = (id, cls) => halls[id] === undefined ? "" : `<button class="${cls || ""}" onclick="G.setHall('${id}')"><img src="img/hall_${id}.png" alt=""><span>${hn(id)}</span></button>`;
        const gxTag = this.xjGxOf ? `<div class="xs-gx">贡献<b>${U.fmt(this.xjGxOf(sel))}</b></div>` : "";   // 本图贡献：显示在天宫图片左边
        return `<div class="mpage mfit" style="background-image:url(img/map/bg_${wid}.webp)"><div class="xscene xs-${wid}"><div class="xs-name">${DATA.maps[sel].name}</div><div class="tgrow">${gxTag}${ico("tg", "tg")}</div><div class="xsrow">${ico("xj")}${ico("shop", "mid")}${ico("gd")}</div></div>` + this.regionsCard(sel, true) + this.exOverlay() + mb + "</div>";   // 四界：不显示生命法力 / 探索中；东西南北四域直接显示在下面（灵地、悟道碑在地图卷轴左下角）
      }
      return pg(mback + bars + status + (sel === "mj" ? this.mijingView() : this.regionsCard(sel)));
    }

    const isAdmin = !!(this.adminInfo && this.adminInfo.admin);
    if (this.giftPage && isAdmin) return tabs + this.giftAdminView();
    if (this.accPage && isAdmin) return tabs + this.accAdminView();
    if (this.srvPage && isAdmin) return tabs + this.srvInfoView();
    if (this.adminInfo === undefined) { this.adminInfo = null; API.adminInfo().then(j => { this.adminInfo = j; this.render(); }).catch(() => {}); }
    const A = this.adminInfo;
    // 管理员页：游戏更新（从 GitHub 更新 / 刷新页面）、礼包码、账号管理
    if (this.adminPage && isAdmin) return tabs + `<div class="row" style="margin:6px 0"><b>管理员</b><button class="sm" onclick="G.openAdmin(false)">返回</button></div>
      <div class="card"><h3>游戏更新<small>管理员</small></h3>
      <p class="desc">当前版本：${String(A.version || "未知").replace(/</g, "&lt;")}</p>
      <div class="btns"><button class="primary" onclick="G.webUpdate()" ${this.updating ? "disabled" : ""}>${this.updating ? "更新中…" : "从 GitHub 更新"}</button>
      <button onclick="location.reload()">刷新页面</button></div>
      ${A.log ? `<div class="explore-log" style="white-space:pre-wrap;font-size:11px">${A.log.replace(/</g, "&lt;")}</div>` : ""}</div>
      <div class="card"><h3>服务器信息<small>管理员</small></h3><p class="desc">游戏程序运行情况、自动备份；设置上传 GitHub 的令牌和间隔。</p><div class="btns"><button class="primary" onclick="G.openSrvInfo(true)">服务器信息</button></div></div>
      <div class="card"><h3>礼包码<small>管理员</small></h3><div class="btns"><button class="primary" onclick="G.openGiftAdmin(true)">生成礼包码</button></div></div>
      <div class="card"><h3>账号管理<small>管理员</small></h3><div class="btns"><button class="primary" onclick="G.openAccAdmin(true)">账号管理</button></div></div>
      <div class="card"><h3>数据修改<small>管理员</small></h3><p class="desc">直接修改 js/config 里的游戏参数，保存后服务器立即使用新参数。</p><div class="btns"><button class="primary" onclick="G.openCfgEdit()">数据修改</button></div></div>`;
    // 管理员页返回到这里：从修炼页设置进来的，再返回回到修炼页设置
    return `<div class="mpage"><div class="pghead">设置</div>` + this.otherSetHtml() + fback(this.setFromCult ? "G.backToCultSet()" : "G.setAtlasSub(null)") + "</div>";
  },

});

// 背景主题列表：[id, 名字]，id 为空 = 默认；样式在 style.css 的 html[data-bg="id"]
const BG_THEMES = [["", "默认"], ["xuanzhi", "宣纸"], ["xinghuang", "杏黄"], ["zhuqing", "竹青"], ["qingci", "青瓷"], ["yunbai", "云白"], ["yuebai", "月白"], ["yanmo", "烟墨"]];
const BG_DARK = ["yanmo"];   // 深色背景主题（文字保持浅色）；其他非默认主题都按浅色处理
function applyBg() {
  if (typeof document === "undefined" || !document.documentElement) return;   // 服务器端引擎里没有页面
  let id = ""; try { id = localStorage.getItem("xiu_bg") || ""; } catch (e) {}
  if (!BG_THEMES.some(t => t[0] === id)) id = "";
  if (id) document.documentElement.dataset.bg = id; else delete document.documentElement.dataset.bg;
  document.documentElement.classList.toggle("bg-light", !!id && !BG_DARK.includes(id));   // 浅色背景：style.css 里 html.bg-light 把写死的浅色字改深
}
applyBg();
