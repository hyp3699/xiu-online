/* =====================================================================
 * 核心：服务器权威 API（账号、服务器状态与游戏指令）
 * ---------------------------------------------------------------------
 * 账号通过 HTTP 登录；角色状态、时间推进、随机结果和可改变状态的
 * 游戏操作均由 Node 服务处理。浏览器只显示服务器快照，不上传本地存档。
 * ===================================================================== */
const API = {
  BASE: "api/",
  token: localStorage.getItem("xiu_token") || "",
  user: localStorage.getItem("xiu_user") || "",
  actions: [],
  serverState: null,
  serverNow: 0,
  _clockPerf: 0,
  _clockInstalled: false,
  _wrapped: new Set(),
  _originalActions: new Map(),
  _pending: new Map(),
  _clickedButton: null,
  _clickTracking: false,
  _actionToastTimer: 0,
  _socket: null,
  _connectPromise: null,
  _reconnectTimer: null,
  _reconnectAttempts: 0,
  _watchdogTimer: null,
  _lastMessageAt: 0,
  _actionCounter: 0,
  _seq: 0,
  // 开关 / 设置类操作：先在本地改好显示，服务器结果到了再以服务器为准（失败会自动恢复）。
  OPTIMISTIC: new Set(["toggleAuto", "toggleAutoPill", "toggleBodyAuto", "toggleRefill", "bsetToggle", "bsetMove", "bsetFoe", "bsetRound", "bsetSet", "autoTaskSet", "cultSetSave", "atPickSet", "setHero", "setHeroSkin"]),

  async req(path, body, method) {
    const opt = { method: method || (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json" }, cache: "no-store" };
    if (this.token) opt.headers["X-Token"] = this.token;
    if (body !== undefined && body !== null) opt.body = typeof body === "string" ? body : JSON.stringify(body);
    let r;
    try { r = await fetch(this.BASE + path, opt); }
    catch (e) { console.warn("fetch failed:", e); throw new Error("网络连接失败（可能是网络不稳或服务器正在重启），请稍后再试"); }   // 浏览器原文是英文 Failed to fetch / Load failed
    const j = await r.json().catch(() => ({ error: "服务器无响应" }));
    if (!r.ok) { const e = new Error(j.error || "请求失败 " + r.status); e.status = r.status; throw e; }
    return j;
  },

  setLogin(user, token) {
    this.user = user; this.token = token;
    localStorage.setItem("xiu_user", user); localStorage.setItem("xiu_token", token);
  },
  logout() {
    const token = this.token;
    if (token) fetch(this.BASE + "logout", { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token }, body: "{}", keepalive: true }).catch(() => {});
    this.cancelReconnect();
    if (this._socket) this._socket.close(1000, "logout");
    this._socket = null;
    this.token = ""; this.serverState = null;
    localStorage.removeItem("xiu_token");
  },

  async register(u, p) { const j = await this.req("register", { username: u, password: p }); this.setLogin(u, j.token); },
  async login(u, p) { const j = await this.req("login", { username: u, password: p }); this.setLogin(u, j.token); },

  syncClock(serverNow) {
    if (!Number.isFinite(Number(serverNow))) return;
    // 时钟只往前平滑校准：快照路上的网络延迟每次不同，直接覆盖会让时间前后跳，进度条一顿一顿。
    // 差距超过 1.5 秒（首次同步、休眠恢复）才直接重设。
    const perf = typeof performance !== "undefined" ? performance.now() : 0;
    if (this.serverNow) {
      const cur = this.serverNow + (perf - this._clockPerf), next = Number(serverNow);
      if (Math.abs(next - cur) <= 1500 && next <= cur) return;
    }
    this.serverNow = Number(serverNow);
    this._clockPerf = perf;
    if (!this._clockInstalled) {
      const api = this, nativeNow = Date.now.bind(Date);
      // 显示用时钟平滑：校准不再一下跳过去（倒计时会一秒跳 2~3 秒或倒退），而是让时钟稍快 / 稍慢走，几秒内追上；
      // 差距超过 3 秒（首次同步、休眠恢复）才直接跳。时钟永不倒退。
      let shown = 0, shownPerf = 0;
      Date.now = function () {
        if (!api.serverNow) return nativeNow();
        const p = typeof performance !== "undefined" ? performance.now() : 0;
        const target = api.serverNow + Math.max(0, p - api._clockPerf), dt = Math.max(0, p - shownPerf);
        if (!shown || Math.abs(target - shown) > 3000) shown = target;
        else if (target >= shown) shown = Math.min(target, shown + dt * 1.25);
        else shown = Math.max(shown, Math.max(target, shown + dt * 0.75));
        shownPerf = p;
        return Math.floor(shown);
      };
      this._clockInstalled = true;
    }
  },

  // 应用服务器补丁（格式见 server.mjs 的 diffState）
  patchState(target, patch) {
    if (!patch || patch.$p !== 1 || !target || typeof target !== "object" || Array.isArray(target)) return patch;
    for (const k of patch.d || []) delete target[k];
    for (const [k, v] of Object.entries(patch.s || {})) target[k] = v && v.$p === 1 ? this.patchState(target[k], v) : v;
    return target;
  },

  applyState(message) {
    if (!message) return;
    let viaPatch = false;
    if (message.state) this.serverState = message.state;
    else if ("patch" in message) {
      // 序号对不上（漏了消息）就请服务器重发完整状态
      if (!this.serverState || message.base !== this._seq) {
        if (this._socket && this._socket.readyState === WebSocket.OPEN) this._socket.send(JSON.stringify({ type: "resync" }));
        return;
      }
      if (message.patch) this.serverState = this.patchState(this.serverState, message.patch);
      viaPatch = true;
    } else return;
    if (message.seq) this._seq = message.seq;
    this.syncClock(message.serverNow);
    if (typeof G !== "undefined") {
      const tab = G.tab;
      // 界面用副本：本地先显示的改动不会污染服务器基准状态。
      // 没有本地先显示的改动时，只把补丁（复制一份，小）打到 G.s 上，不再整份深拷贝；否则整份复制一次，把本地改动冲掉
      if (viaPatch && G.s && !this._localEdit && message.ok !== false) { if (message.patch) G.s = this.patchState(G.s, structuredClone(message.patch)); }
      else { G.s = structuredClone(this.serverState); this._localEdit = false; }
      const state = G.s;
      if (Number.isFinite(Number(state.last))) G._lastTick = Number(state.last);
      if (tab) G.tab = tab;
      G.dirty();
      if (!G._stopped) { G.render(); G.renderLog(); G.bars(); }
    }
  },

  // 记住最近一次打开弹窗的函数：服务器操作完成后弹窗还开着，就用新状态重新打开它，
  // 弹窗里的按钮、数量、状态立即刷新（以前只有少数弹窗会刷新）。
  trackModalOpeners() {
    if (this._modalTracking || typeof G === "undefined") return;
    this._modalTracking = true;
    const modal = G.modal;
    G._modalSeq = 0;
    // 不是 open* 打开的弹窗（如悟道结果）不记录打开函数，避免被刷新成上一个弹窗
    G.modal = function (...args) { G._modalSeq++; G._modalOpener = null; return modal.apply(this, args); };
    const closeModal = G.closeModal;
    G.closeModal = function (...args) { G._modalOpener = null; return closeModal.apply(this, args); };
    for (const key of Object.keys(G)) {
      const fn = G[key];
      if (!/^open[A-Z]/.test(key) || typeof fn !== "function" || this._wrapped.has(key) || fn.constructor.name === "AsyncFunction") continue;
      G[key] = function (...args) {
        const before = G._modalSeq, result = fn.apply(this, args);
        if (G._modalSeq !== before) G._modalOpener = { key, fn, args };
        return result;
      };
    }
  },

  refreshOpenModal() {
    const m = typeof G !== "undefined" && G._modalOpener, el = document.getElementById("modal"), box = document.getElementById("modal-box");
    if (!m || G._lockModal || G._cfgOpen || !el || el.classList.contains("hidden")) return;
    if (G.editing && G.editing(box)) return;   // 正在弹窗里输入：不重画，免得输入法收起
    const top = box ? box.scrollTop : 0;
    try { m.fn.apply(G, m.args); G._modalOpener = m; } catch { return; }
    if (box) box.scrollTop = top;
  },

  installActions(names) {
    this.actions = Array.isArray(names) ? names.filter(x => typeof x === "string") : [];
    this.trackButtonClicks();
    for (const name of this.actions) {
      if (this._wrapped.has(name) || typeof G[name] !== "function") continue;
      const original = G[name];
      this._originalActions.set(name, original);
      G[name] = (...args) => this.sendAction(name, this.captureActionArgs(name, args)).catch(error => {
        if (G && typeof G.log === "function") G.log(this.zhErr(error.message || "服务器操作失败"), "bad");
        return false;
      });
      this._wrapped.add(name);
    }
    this.trackModalOpeners();
  },

  trackButtonClicks() {
    if (this._clickTracking || typeof document === "undefined") return;
    document.addEventListener("click", event => {
      const button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!button) return;
      this._clickedButton = button;
      // 必须用 setTimeout（宏任务）清除：真实点击时，捕获监听器返回后浏览器会立刻跑微任务，
      // 用 Promise.resolve().then 会在按钮自己的 onclick 执行前就把记录清掉，
      // 导致按钮没有“处理中”状态、data-refresh 弹窗也不会刷新。
      setTimeout(() => { if (this._clickedButton === button) this._clickedButton = null; }, 0);
    }, true);
    this._clickTracking = true;
  },

  // 按钮不再显示「处理中…」：结果由服务器很快推回，界面直接刷新
  markButtonPending() { return { button: null }; },
  finishButtonPending() {},

  // 服务器写的游戏日志（如「灵石不足」）：和单机版 G.log 一样，不在修炼页（或开着弹窗）时用浮动提示显示
  // fail = 条件不足等没执行成功的提示：红色，显示在屏幕中间
  toastLogs(logs, force = false, fail = false) {
    if (!Array.isArray(logs) || !logs.length || typeof G === "undefined") return;
    const modal = document.getElementById("modal"), modalOpen = modal && !modal.classList.contains("hidden");
    if (!force && G.tab === "cultivate" && !modalOpen) return;
    const t = document.getElementById("toast"); if (!t) return;
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    t.innerHTML = logs.slice(0, 3).reverse().map(l => `<p class="${esc(l.c || "")}">${esc(l.m || "")}</p>`).join("");
    t.classList.toggle("center", fail); delete t.dataset.tone;
    t.classList.add("show");
    clearTimeout(G._toastT); clearTimeout(this._actionToastTimer);
    G._toastT = setTimeout(() => t.classList.remove("show"), 1800);
  },

  // 需要玩家确认的操作：先在本地弹确认框，取消就不发给服务器（服务器端 confirm 一律视为确定）
  CONFIRMS: {
    leaveSect: () => G.s.sect && G.s.contrib >= G.leaveCost() ? `叛出门派将扣除贡献 ${U.fmt(G.leaveCost())}、清空职务（已学功法保留），确定？` : "",
    stopStudy: () => G.s.gfStudy ? "中断修炼，已消耗的灵气不退还，确定？" : "",
    svFire: () => "遣散这个道童？",
    svStartPick: () => !G.s.svPick && G.s.servants.length < CFG.servant.MAX && G.s.stone >= CFG.servant.PICK_COST ? `花费 ${U.fmt(CFG.servant.PICK_COST)} 灵石选拔道童（${CFG.servant.PICK_SEC} 秒出结果），确定？` : "",
    forgetGongfa: id => {
      const g = G.s.gongfa[id] && DATA.skillInfo(id, G.s.gongfa[id]);
      return g && G.ssForgettable(id) ? `遗忘《${g.name}》？\n第 ${g.lv} 层和加的${g.label}全部删除，归还灵识点 ${G.ssCost(id)}。` : "";
    },
  },

  // 浏览器 / 脚本自带的英文错误（Failed to fetch、Cannot read properties…）换成中文提示，原文写到控制台
  zhErr(text) { const t = String(text || ""); if (!t || /[\u4e00-\u9fa5]/.test(t)) return t || "操作失败"; console.warn("action error:", t); return "操作失败（网络或服务器暂时不可用），请稍后再试"; },
  showActionFeedback(text, tone = "sys") {
    text = this.zhErr(text);
    this.setSync(text);
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = text;
    toast.dataset.tone = tone;
    toast.classList.toggle("center", tone === "bad");
    toast.classList.add("show");
    clearTimeout(this._actionToastTimer);
    this._actionToastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  },

  captureActionArgs(name, args) {
    const value = selector => document.querySelector(selector)?.value;
    const out = [...args];
    if (name === "cultSetSave") {
      if (out[1] === undefined) out[1] = value("#cs-low");
      if (out[2] === undefined) out[2] = value("#cs-high");
    }
    if (name === "startChuqiao" && out[2] === undefined) out[2] = value("#cq-n");
    if (name === "buyMat" && out[2] === undefined) out[2] = value("#shop-n");
    if (name === "exchangeMat" && out[2] === undefined) out[2] = value("#tr-n");
    return out;
  },

  async loadSave() {
    const j = await this.req("session");
    this.isAdmin = !!j.admin; DATA._admin = this.isAdmin;   // 测试模式只对管理员生效
    this.syncClock(j.serverNow);
    this.installActions(j.actions || []);
    this.installResume();
    this.checkLines();
    this.serverState = j.data || null;
    if (j.data) await this.connectSocket();
    return j.data;
  },

  async createCharacter(name, ori) {
    const j = await this.req("character", { name: String(name || "无名散修").slice(0, 12), ori: Array.isArray(ori) ? ori.slice(0, 20).map(String) : [] });
    this.serverState = j.data;
    this.syncClock(j.serverNow);
    this.installResume();
    await this.connectSocket();
    return j.data;
  },

  // 断线后循环重连（带退避），而不是只试一次：服务器重启/更新的空档
  // 往往超过 1.5 秒，一次失败就停会导致客户端卡在断线状态，只能重启 App。
  // 被踢（4001）和正常登出（1000）不走这里，由 onclose 直接排除。
  scheduleReconnect() {
    if (!this.token || !this.serverState) return;
    clearTimeout(this._reconnectTimer);
    const delay = Math.min(1500 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(async () => {
      if (!this.token || !this.serverState) return;
      try { await this.connectSocket(); this._reconnectAttempts = 0; }
      catch { this.scheduleReconnect(); }
    }, delay);
  },
  cancelReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  },
  // 半断不断的连接不会触发 onclose：服务端平时最多 10 秒推一次快照，
  // 超过 35 秒没收到任何消息就判定为死连接，主动关掉它走重连循环。
  startWatchdog() {
    clearInterval(this._watchdogTimer);
    this._lastMessageAt = Date.now();
    this._watchdogTimer = setInterval(() => {
      const s = this._socket;
      if (!s || s.readyState !== WebSocket.OPEN || !this.token || !this.serverState) return;
      if (Date.now() - this._lastMessageAt > 35000) {
        try { s.close(4000, "watchdog"); } catch {}
      }
    }, 5000);
  },

  async connectSocket() {
    if (!this.token) throw new Error("请先登录");
    if (this._socket && this._socket.readyState === WebSocket.OPEN) return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const { ticket } = await this.req("ws-ticket", {}, "POST");
      const u = new URL(this.BASE + "ws", location.href);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.searchParams.set("ticket", ticket);
      const socket = new WebSocket(u.toString());
      this._socket = socket;
      await new Promise((resolve, reject) => {
        let opened = false;
        const timeout = setTimeout(() => { if (!opened) { socket.close(); reject(new Error("连接游戏服务器超时")); } }, 10_000);
        socket.onopen = () => { opened = true; clearTimeout(timeout); this._reconnectAttempts = 0; clearTimeout(this._reconnectTimer); this.startWatchdog(); resolve(); this.setSync("已连接服务器"); };
        socket.onerror = () => { if (!opened) { clearTimeout(timeout); reject(new Error("无法连接游戏服务器")); } };
      });
      socket.onmessage = event => { this._lastMessageAt = Date.now(); this.onSocketMessage(event.data); };
      socket.onclose = event => {
        clearInterval(this._watchdogTimer);
        this._watchdogTimer = null;
        if (this._socket === socket) this._socket = null;
        for (const [id, pending] of this._pending) {
          clearTimeout(pending.timer); this.finishButtonPending(pending);
          pending.reject(new Error("与服务器断开连接，请重试")); this._pending.delete(id);
        }
        if (event.code === 4001 && typeof G !== "undefined" && G.kicked) G.kicked();
        else if (this.token && this.serverState && event.code !== 1000) {
          // 后台静默重连，不在前台弹提示；循环重连直到成功或登出
          this.scheduleReconnect();
        }
      };
    })();
    try { await this._connectPromise; } finally { this._connectPromise = null; }
  },

  onSocketMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === "snapshot") {
      this.applyState(message);
      if (this._resumeWait && message.state) this.resumeDone();   // 切回前台后服务器推回了结算好的完整状态
      this.toastLogs(message.logs);
      this.setSync("已同步到服务器");
      return;
    }
    if (message.type === "config") {
      // 管理员改了游戏参数：重新加载网页拿新参数（正在编辑参数的管理员等关闭窗口再加载）
      if (typeof G !== "undefined" && G._cfgOpen) { G._cfgReload = true; return; }
      this.showActionFeedback("游戏参数已更新，正在重新加载…");
      setTimeout(() => location.reload(), 1200); return;
    }
    if (message.type === "error" && !message.id) {
      this.showActionFeedback(message.error || "服务器操作失败", "bad"); return;
    }
    if (message.type !== "result") return;
    const pending = this._pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this._pending.delete(message.id);
    this.finishButtonPending(pending);
    // 除了日志什么都没变 = 条件不足没执行（有补丁就看补丁改了哪些键，不再把整个状态序列化两次）
    const onlyLog = p => !p || (p.$p === 1 && !(p.d || []).length && Object.keys(p.s || {}).every(k => k === "log"));
    const noLog = st => st ? JSON.stringify({ ...st, log: 0 }) : "";
    const before = "patch" in message ? "" : noLog(this.serverState);
    this.applyState(message);
    const failed = message.ok && ("patch" in message ? onlyLog(message.patch) : before === noLog(this.serverState));
    if (!message.ok) {
      const error = message.error || "操作失败";
      this.showActionFeedback(error, "bad");
      pending.reject(new Error(error)); return;
    }
    this.afterRemoteAction(pending.name, pending.args, pending.refresh, message.result, pending.exStart, message.logs || [], pending.cqStart);
    const bt = Array.isArray(message.battles) && message.battles[message.battles.length - 1];
    if (bt && bt.b && G.playBattle) { G.playBattle(bt.b, bt.title, bt.txt, bt.win, bt.logs || undefined, bt.replay, bt.opt || {}); }   // 服务器打完的战斗在这里播放
    else if (pending.name !== "wudaoDone") this.toastLogs(message.logs, true, failed);
    pending.resolve(message);
  },

  afterRemoteAction(name, args, refresh, result, exStart, logs = [], cqStart) {
    // 悟道结果窗口：服务器结算后用它写的日志在本地弹出
    if (name === "wudaoDone") {
      const D0 = ((CFG.wudaoRoom || {}).daos || []).find(d => d.id === args[0]), log = logs.find(l => l.c === "gold");
      if (D0 && log && G.wdModal) G.wdModal(D0, String(log.m).replace(/。$/, "").split("，").slice(1).map(x => `<div class="line"><div>${x.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div></div>`).join(""));
    }
    // 开始探索 / 挖矿 / 秘境后展开探索信息（单机版在操作里设置 exploreOpen，服务器上设置不到客户端）
    if (["toggleExplore", "toggleKuang", "toggleMj", "mjAll"].includes(name) && G.s.explore && G.s.explore.start !== exStart) { G.exploreOpen = true; G.exInfo = "ex"; G.render(); }
    if (name === "startChuqiao" && G.s.cq && G.s.cq.start !== cqStart) { G.exploreOpen = true; G.exInfo = "cq"; G.render(); }
    // These actions combine a server state change with a purely visual transition.
    if (name === "startTrib") { G.tribOpen = true; if (G.tribRender) G.tribRender(true); }
    if (name === "tribPut") { G.closeModal(); if (G.tribOpen && G.tribRender) G.tribRender(true); }
    if (name === "tribUse" && G.tribRender) G.tribRender(false);
    if (name === "startChuqiao") { G.closeModal(); G.exploreOpen = true; G.render(); }
    if (["autoTaskSet", "atPickSet"].includes(name) && G.openCultSet) G.openCultSet();
    if (["learnBook", "learnGfBook", "learnBlueprint", "learnRingBp", "installFurnace", "equipItem", "unequip", "sellItem", "slotSpell", "swapFabao", "unslotSpell", "useStone", "useFurnace", "eatDan", "eatQl", "plantField", "clearField", "svAccept", "spellAdv"].includes(name) && G.closeModal) G.closeModal();
    // spellAdv 会删掉弹窗里的低星法术：不关弹窗的话 refreshOpenModal 会重开
    // 已删除法术的进阶弹窗，显示「修炼到 10 层才能进阶」。
    if (name === "craftFurnace" && args[2] === "fabao" && G.closeModal) G.closeModal();
    if (name === "spellJy" && G.openSpellJy) G.openSpellJy(args[0]);
    if (name === "doEnhance" && G.openEnhance) G.openEnhance(args[0]);
    if (name === "doReset" && G.openReset) { G._locks = Array.isArray(result && result.locks) ? result.locks : G._locks || []; G.openReset(args[0]); }
    if (refresh && typeof G[refresh] === "function") G[refresh]();
    else this.refreshOpenModal();
    if (name === "closeTrib") {
      G.tribOpen = false;
      const trib = document.getElementById("trib");
      if (trib) { trib.classList.add("hidden"); trib.innerHTML = ""; }
      G.render();
    }
    if (name === "skipBattle") G.render();
  },

  async sendAction(name, args) {
    const button = this._clickedButton;
    this._clickedButton = null;
    if (typeof G !== "undefined" && G.s) {
      // 炼法宝还没选类型 / 属性：在本地打开选择窗口，选好后再发给服务器
      if (name === "craftFurnace" && args[2] === "fabao" && !(DATA.fabaoTypes[args[3]] && DATA.elById[args[4]])) { G.openFabaoPick(args[1]); return false; }
      // 突破要渡劫（如练气十层 → 筑基）：渡劫准备页只在本地打开，点「开始突破」才发 startTrib 给服务器
      if (name === "breakthrough" && (G.s.trib || (G.canBreak() && G.needTrib()))) { G.openTrib(); return false; }
      // 悟道：读条动画在本地播放，结束时让服务器结算
      if (name === "wudao") {
        const dao = args[0];
        if (G._wdRun) return false;
        if (!G.wdCheck(dao)) { G.renderLog(); this.toastLogs(G.s.log.slice(0, 1), true, true); return false; }
        const ms = ((CFG.wudaoRoom || {}).TIME || 0) * 1000;
        G._wdRun = { dao, end: Date.now() + ms }; G.render();
        await new Promise(r => setTimeout(r, ms));
        G._wdRun = null; G._wdFx = Date.now();
        return this.sendAction("wudaoDone", [dao]);
      }
      if (this.CONFIRMS[name]) {
        let text = "";
        try { text = this.CONFIRMS[name](...args); } catch {}
        if (text && !(await G.ask(text))) return false;
      }
    }
    const buttonPending = this.markButtonPending(button);
    const refresh = button && button.dataset ? button.dataset.refresh || "" : "";
    try {
      if (!this._socket || this._socket.readyState !== WebSocket.OPEN) await this.connectSocket();
    } catch (error) {
      this.finishButtonPending(buttonPending);
      this.showActionFeedback(error.message || "无法连接游戏服务器", "bad");
      throw error;
    }
    const socket = this._socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.finishButtonPending(buttonPending);
      const error = new Error("游戏服务器暂不可用");
      this.showActionFeedback(error.message, "bad");
      throw error;
    }
    if (this.OPTIMISTIC.has(name) && typeof G !== "undefined" && G.s) {
      try { this._localEdit = true; this._originalActions.get(name).apply(G, args); G.dirty(); G.render(); G.bars(); this.refreshOpenModal(); } catch {}
    }
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++this._actionCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(id);
        this._pending.delete(id); this.finishButtonPending(pending);
        const error = new Error("服务器响应超时，请稍后查看状态");
        this.showActionFeedback(error.message, "bad"); reject(error);
      }, 15_000);
      const exStart = typeof G !== "undefined" && G.s && G.s.explore ? G.s.explore.start : undefined, cqStart = typeof G !== "undefined" && G.s && G.s.cq ? G.s.cq.start : undefined;
      this._pending.set(id, { resolve, reject, timer, name, args, refresh, exStart, cqStart, ...buttonPending });
      try { socket.send(JSON.stringify({ type: "action", id, action: name, args })); }
      catch (error) {
        clearTimeout(timer); this._pending.delete(id); this.finishButtonPending(buttonPending);
        this.showActionFeedback(error.message || "发送操作失败", "bad"); reject(error);
      }
    });
  },

  async upload() { throw new Error("客户端存档上传已关闭，所有进度保存在服务器"); },
  beacon() {},
  async resetCharacter() { return this.req("character/reset", {}, "POST"); },

  // 管理员与账号 API
  async adminInfo() { return this.req("admin"); },
  async adminUpdate() { return this.req("admin/update", {}); },
  async giftList() { return this.req("admin/gifts"); },
  async giftCreate(d) { return this.req("admin/gift", d); },
  async giftDelete(code) { return this.req("admin/gift/del", { code }); },
  async giftRedeem(code) { const j = await this.req("gift", { code }); if (j.state) this.applyState(j); return j; },
  async changePassword(oldPw, newPw) { return this.req("password", { old: oldPw, new: newPw }); },
  async userList() { return this.req("admin/users"); },
  async setRegOpen(open) { return this.req("admin/reg", { open }); },
  async userDelete(id) { return this.req("admin/user/del", { id }); },
  // ---- 从后台切回游戏：显示「加载游戏中…」，等服务器把离开这段时间结算完、推回完整状态再关闭 ----
  _hiddenAt: 0, _resumeWait: false, _resumeShow: 0, _resumeTimer: 0, _resumeKick: 0, _resumeRetry: 0,
  RESUME_MIN_MS: 1500,   // 离开不到 1.5 秒（如下拉通知栏）不显示
  installResume() {
    if (this._resumeInstalled || typeof document === "undefined") return;
    this._resumeInstalled = true;
    const mono = () => (typeof performance !== "undefined" ? performance.now() : 0);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this._hiddenAt = mono(); if (typeof G !== "undefined" && G.awaySnap) G.awaySnap(); return; }
      const away = this._hiddenAt ? mono() - this._hiddenAt : 0;
      this._hiddenAt = 0;
      this.onResume(away);
    });
    window.addEventListener("pageshow", e => { if (e.persisted) this.onResume(this.RESUME_MIN_MS); });
    // 安卓安装版：MainActivity.onResume 会调用 window.__appResume(离开的毫秒数)
    window.__appResume = ms => this.onResume(Number(ms) || 0);
  },
  onResume(awayMs) {
    if (!this.token || !this.serverState || this._resumeWait) return;
    if (!(awayMs >= this.RESUME_MIN_MS)) return;
    this._resumeWait = true;
    // 安卓版后台保持连接时，切回来服务器几百毫秒就推回状态：0.8 秒内完成就不显示「加载游戏中…」
    clearTimeout(this._resumeShow);
    this._resumeShow = setTimeout(() => { if (this._resumeWait) this.showResume(true); }, 800);
    const s = this._socket;
    if (s && s.readyState === WebSocket.OPEN) {
      try { s.send(JSON.stringify({ type: "resync" })); } catch {}
      // 连接可能在后台已经断了但还没发现：1.5 秒没收到结算结果就换一条新连接
      clearTimeout(this._resumeKick);
      this._resumeKick = setTimeout(() => {
        if (!this._resumeWait) return;
        if (this._socket === s) { this._socket = null; s.onmessage = null; try { s.close(4000, "resume"); } catch {} }
        this.connectSocket().catch(() => {});
      }, 1500);
    } else this.connectSocket().catch(() => {});
    // 连不上就每 3 秒再试一次；最多等 20 秒，之后关掉提示（后台继续自动重连）
    clearInterval(this._resumeRetry);
    this._resumeRetry = setInterval(() => {
      if (!this._resumeWait) return clearInterval(this._resumeRetry);
      if (!this._socket && !this._connectPromise) this.connectSocket().catch(() => {});
    }, 3000);
    clearTimeout(this._resumeTimer);
    this._resumeTimer = setTimeout(() => {
      if (!this._resumeWait) return;
      this.resumeDone();
      this.showActionFeedback("连接服务器较慢，正在后台重试…", "bad");
    }, 20_000);
  },
  resumeDone() {
    this._resumeWait = false;
    clearTimeout(this._resumeShow); clearTimeout(this._resumeTimer); clearTimeout(this._resumeKick); clearInterval(this._resumeRetry);
    this.showResume(false);
    if (typeof G !== "undefined" && G.awayCheck) G.awayCheck();   // 离开收益弹窗
  },
  showResume(on) {
    let el = document.getElementById("resume-load");
    if (!el) {
      if (!on) return;
      el = document.createElement("div"); el.id = "resume-load";
      el.innerHTML = "<span>加载游戏中…</span>";
      document.body.appendChild(el);
    }
    el.classList.toggle("show", !!on);
  },

  /* ---------- 游戏线路（服务器地址） ----------
   * 管理员在「服务器信息」里设置线路列表和默认线路。安卓客户端（window.XiuApp）每次进游戏缓存一份列表，
   * 连不上时原生弹窗让玩家选别的线路；管理员改了默认线路，客户端下次进游戏自动切过去。换线路时带上登录，不用重新登录。 */
  lineKey(u) { return String(u || "").split("#")[0].split("?")[0].replace(/index\.html$/, "").replace(/\/+$/, "") + "/"; },
  curLine() { return typeof location === "undefined" ? "" : this.lineKey(location.href); },
  async checkLines() {
    try {
      const app = typeof window !== "undefined" && window.XiuApp;
      if (!app || !app.setLines) return;
      const j = await this.req("lines"); this.lines = j;
      app.setLines(JSON.stringify(j.lines || []));
      const def = j.def ? this.lineKey(j.def) : "", seen = localStorage.getItem("xiu_line_def") || "";
      if (def && def !== seen) { localStorage.setItem("xiu_line_def", def); if (def !== this.curLine()) this.goLine(def); }
    } catch (e) {}
  },
  goLine(url) {
    const base = this.lineKey(url), full = base + (this.token ? `#xt=${encodeURIComponent(this.token)}&xu=${encodeURIComponent(this.user)}` : "");
    const app = typeof window !== "undefined" && window.XiuApp;
    if (app && app.switchTo) app.switchTo(base, full); else location.href = full;
  },

  setSync(text) { const el = document.getElementById("sync"); if (el) el.textContent = text; },
};

// 换线路时网址里带着登录（#xt=令牌&xu=账号）：存下来后从地址栏去掉
if (typeof location !== "undefined" && typeof location.hash === "string" && /[#&]xt=/.test(location.hash)) {
  try {
    const h = new URLSearchParams(location.hash.slice(1)), t = h.get("xt"), u = h.get("xu");
    if (t && u) API.setLogin(u, t);
    history.replaceState(null, "", location.pathname + location.search);
  } catch (e) {}
}
