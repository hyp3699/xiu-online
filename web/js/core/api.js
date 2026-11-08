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
  // 原生时钟（脚本加载时捕获，之后 Date.now 永不被覆盖）：看门狗、重试拦截、
  // 悟道读条等计时一律用它；显示用的服务器同步时间走 API.now()。
  _nativeNow: Date.now.bind(Date),
  _shownNow: 0,   // API.now() 平滑后的显示时间
  _shownPerf: 0,
  _wrapped: new Set(),
  _originalActions: new Map(),
  _pending: new Map(),
  _retryBlock: new Map(),   // 超时动作的重试拦截：键 = 动作名 + 参数，值 = { at: 超时时刻（原生时钟）, seq: 超时时的已应用序号 }；完整状态到了就清掉，补丁序号超过它也清掉
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
  _localEdits: new Map(),   // 本地先改：顶层状态键 → { owner: 等待中的动作 id, whole?: 整值, subs?: Map(子键 → {v}|{del}) }；只保护仍在途的动作改过的子字段
  _revertKeys: new Set(),   // 本次 applyState 要按服务器值恢复的键（失败动作的键），用完即清
  _battleQueue: [],   // 待播战斗（服务器一次可回多场）：按顺序逐场播，上一场关闭后再播下一场
  _battlePump: 0,
  // 开关 / 设置类操作：先在本地改好显示，服务器结果到了再以服务器为准（失败会自动恢复）。
  OPTIMISTIC: new Set(["toggleAuto", "toggleAutoPill", "toggleBodyAuto", "toggleRefill", "bsetToggle", "bsetMove", "bsetRound", "bsetSet", "autoTaskSet", "cultSetSave", "atPickSet", "setHero", "setHeroSkin"]),

  async req(path, body, method, timeoutMs) {
    const opt = { method: method || (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json" }, cache: "no-store" };
    // timeoutMs：超时就中断（ws-ticket 用，网络刚恢复时别让一次请求卡很久）
    let tmo = 0; if (timeoutMs && typeof AbortController !== "undefined") { const ac = new AbortController(); opt.signal = ac.signal; tmo = setTimeout(() => ac.abort(), timeoutMs); }
    if (this.token) opt.headers["X-Token"] = this.token;
    if (body !== undefined && body !== null) opt.body = typeof body === "string" ? body : JSON.stringify(body);
    let r;
    try { r = await fetch(this.BASE + path, opt); }
    catch (e) { clearTimeout(tmo); if (e && e.name === "AbortError") throw new Error("连接服务器超时"); console.warn("fetch failed:", e); throw new Error("网络连接失败（可能是网络不稳或服务器正在重启），请稍后再试"); }   // 浏览器原文是英文 Failed to fetch / Load failed
    // body 不是 JSON 时按失败处理：原来 200 配非法 body 会把 { error } 当成功数据返回，
    // 调用方（如 loadSave）会拿到没有 data 的“成功”结果。
    let j;
    try { j = await r.json(); } catch { clearTimeout(tmo); throw new Error("服务器无响应"); }
    clearTimeout(tmo);
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
    this._retryBlock.clear();
    this._battleQueue.length = 0;
    if (this._battlePump) { clearInterval(this._battlePump); this._battlePump = 0; }
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
  },

  // 显示用时钟（经服务器同步、平滑后）：倒计时、进度条等显示读它，不要读 Date.now()。
  // 计时/超时（看门狗、重试拦截、悟道读条）一律用原生时间 this._nativeNow() / performance.now()，
  // 绝不能用这个会被拉伸/压缩的显示时钟。注意：这里不再覆盖全局 Date.now——
  // 全局覆盖会让全站约 49 处共用被拉伸/压缩的时钟，计时全部失真。
  now() {
    if (!this.serverNow) return this._nativeNow();
    const perf = typeof performance !== "undefined" ? performance.now() : 0;
    // 校准不再一下跳过去（倒计时会一秒跳 2~3 秒或倒退），而是让时钟稍快 / 稍慢走，几秒内追上；
    // 差距超过 3 秒（首次同步、休眠恢复）才直接跳。时钟永不倒退。
    const target = this.serverNow + Math.max(0, perf - this._clockPerf), dt = Math.max(0, perf - this._shownPerf);
    if (!this._shownNow || Math.abs(target - this._shownNow) > 3000) this._shownNow = target;
    else if (target >= this._shownNow) this._shownNow = Math.min(target, this._shownNow + dt * 1.25);
    else this._shownNow = Math.max(this._shownNow, Math.max(target, this._shownNow + dt * 0.75));
    this._shownPerf = perf;
    return Math.floor(this._shownNow);
  },

  // 应用服务器补丁（格式见 server.mjs 的 diffState）
  patchState(target, patch) {
    if (!patch || patch.$p !== 1 || !target || typeof target !== "object" || Array.isArray(target)) return patch;
    for (const k of patch.d || []) delete target[k];
    for (const [k, v] of Object.entries(patch.s || {})) {
      // 客户端缺失该嵌套键时，原来会把补丁对象本身 {$p:1,...} 当成状态值；改成从空对象展开
      const base = v && v.$p === 1 ? (target[k] && typeof target[k] === "object" && !Array.isArray(target[k]) ? target[k] : {}) : null;
      target[k] = v && v.$p === 1 ? this.patchState(base, v) : v;
    }
    return target;
  },

  // 返回 false = 没应用上（补丁序号对不上，已请服务器重发完整状态）
  applyState(message) {
    if (!message) return false;
    let viaPatch = false;
    if (message.state) { this.serverState = message.state; this._retryBlock.clear(); }   // 完整状态到了：超时动作的结果已见分晓，放行重试
    else if ("patch" in message) {
      // 序号对不上（漏了消息）就请服务器重发完整状态
      if (!this.serverState || message.base !== this._seq) {
        if (this._socket && this._socket.readyState === WebSocket.OPEN) this._socket.send(JSON.stringify({ type: "resync" }));
        this.setSync && this.setSync("正在重新同步…");
        return false;
      }
      if (message.patch) this.serverState = this.patchState(this.serverState, message.patch);
      viaPatch = true;
    } else return false;
    if (message.seq) {
      this._seq = message.seq;
      // 补丁序号已推进到超过被拦动作发出时的序号：那个动作的结果已包含在状态里了，放行重试
      for (const [k, v] of this._retryBlock) if (v && Number(v.seq) < message.seq) this._retryBlock.delete(k);
    }
    this.syncClock(message.serverNow);
    // 本次要按服务器值恢复的键：失败动作的键（onSocketMessage 在 applyState 前登记）。
    // 拥有者（等待中的动作）已不在的先改也不再受保护：结果已到或已超时，服务器值说了算。
    const revertKeys = new Set(this._revertKeys); this._revertKeys = new Set();
    const editedBefore = new Set(this._localEdits.keys());
    const pruned = this._pruneLocalEdits();
    if (typeof G === "undefined" || !G.s) return true;
    const tab = G.tab;
    // 空闲心跳（补丁为空、无待恢复的本地先改）：状态什么都没变，不重绘、不重算属性；
    // 进度条由每帧的 bars() 自己刷，日志由调用方 toastLogs 单独处理，不会漏。
    // 注意：空闲心跳不再冲掉本地先改——以前单布尔 _localEdit 让任何一次心跳都整份复制覆盖。
    if (viaPatch && !message.patch && message.ok !== false && !pruned && !revertKeys.size) return true;
    if (message.state || (viaPatch && !message.patch)) {
      // 完整状态 / 空补丁（失败恢复）：整份复制一次，下面再把仍在途的本地先改写回
      G.s = structuredClone(this.serverState);
    } else if (viaPatch && message.patch) {
      // 界面用副本：本地先显示的改动不会污染服务器基准状态。
      // 补丁只覆盖它碰到的键：没碰本地先改的键直接合并（小补丁，不整份深拷贝）；
      // 碰到的键按服务器值恢复，仍在途的先改随后把改动过的子字段写回，
      // 服务器同时改的同键其他子字段（如 array.ling）不会被旧快照冲掉。
      const touched = new Set([...Object.keys(message.patch.s || {}), ...(message.patch.d || [])].filter(k => editedBefore.has(k) || revertKeys.has(k)));
      G.s = this.patchState(G.s, structuredClone(message.patch));
      for (const k of touched) {
        if (this._localEdits.has(k)) continue;   // 仍在途：下面 _restoreLocalEdits 写回改动过的子字段
        if (k in this.serverState) G.s[k] = structuredClone(this.serverState[k]); else delete G.s[k];
      }
      for (const k of revertKeys) {
        if (touched.has(k)) continue;   // 失败动作的键即使补丁没碰，也按服务器值恢复
        if (k in this.serverState) G.s[k] = structuredClone(this.serverState[k]); else delete G.s[k];
      }
    }
    this._restoreLocalEdits();
    const state = G.s;
    if (Number.isFinite(Number(state.last))) G._lastTick = Number(state.last);
    if (tab) G.tab = tab;
    G.dirty();
    if (!G._stopped) { G.render(); G.renderLog(); G.bars(); }
    return true;
  },

  // 乐观动作 → 它在本地先改的顶层状态键（补丁按顶层键合并，跟踪粒度与补丁一致）
  _OPT_KEYS: { toggleAuto: ["auto"], toggleAutoPill: ["autoPill"], toggleBodyAuto: ["bodyAuto"], toggleRefill: ["array"], bsetToggle: ["bset"], bsetMove: ["bset"], bsetRound: ["bset"], bsetSet: ["bset"], autoTaskSet: ["autoTask"], cultSetSave: ["cultSet"], setHero: ["hero"], setHeroSkin: ["heroSkin"] },
  _optimisticKeys(name, args) {
    if (name === "atPickSet") return [args && args[0] === "tgt" ? "cultSet" : "autoTask"];   // atPickSet(k,i)：tgt 改 cultSet，其余改 autoTask
    return this._OPT_KEYS[name] || [];
  },

  // 记下本地先改：只记改动过的子字段（对象按子键 diff，数组/标量整记），
  // 恢复时只写回这些子字段。before/after 是原函数执行前后的 G.s[key]。
  _recordLocalEdit(key, before, after, owner) {
    let rec;
    if (after && before && typeof after === "object" && typeof before === "object" && !Array.isArray(after) && !Array.isArray(before)) {
      const subs = new Map();
      for (const sk of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[sk]) === JSON.stringify(after[sk])) continue;
        subs.set(sk, sk in after ? { v: structuredClone(after[sk]) } : { del: true });
      }
      if (!subs.size) return;
      rec = { owner, subs };
    } else {
      if (JSON.stringify(before) === JSON.stringify(after)) return;   // 原函数提前返回、实际没改，不跟踪
      rec = { owner, whole: structuredClone(after) };
    }
    this._localEdits.set(key, rec);
  },

  // 拥有者（等待中的动作）已不在，本地先改不再受保护：删掉，取服务器值。返回删掉的个数。
  _pruneLocalEdits() {
    let n = 0;
    for (const [key, rec] of this._localEdits) {
      if (rec.owner && !this._pending.has(rec.owner)) { this._localEdits.delete(key); n++; }
    }
    return n;
  },

  // 把仍在途的本地先改写回 G.s（只写改动过的子字段）
  _restoreLocalEdits() {
    if (typeof G === "undefined" || !G.s) return;
    for (const [key, rec] of this._localEdits) {
      if ("whole" in rec) { G.s[key] = structuredClone(rec.whole); continue; }
      if (!rec.subs) continue;
      let obj = G.s[key];
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = G.s[key] = {};
      for (const [sk, w] of rec.subs) { if (w.del) delete obj[sk]; else obj[sk] = structuredClone(w.v); }
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
    // 日志本身带的品质颜色 span 要保留渲染（精炼 / 炼成日志：<span class="q1">装备名</span>），
    // 其它 HTML 照样转义：先全转义，再把恰好是 q0~q5 的 span 开闭标签换回来，
    // 带其它属性 / 其它 class / 单引号的 span 仍是转义文本，不会变成真的标签。
    const safeLog = m => esc(m)
      .replace(/&lt;span class=&quot;(q[0-5])&quot;&gt;/g, '<span class="$1">')
      .replace(/&lt;\/span&gt;/g, "</span>");
    t.innerHTML = logs.slice(0, 3).reverse().map(l => `<p class="${esc(l.c || "")}">${safeLog(l.m || "")}</p>`).join("");
    t.classList.toggle("center", fail); delete t.dataset.tone;
    t.classList.add("show");
    clearTimeout(G._toastT); clearTimeout(this._actionToastTimer);
    G._toastT = setTimeout(() => t.classList.remove("show"), 1800);
  },

  // 需要玩家确认的操作：先在本地弹确认框，取消就不发给服务器（服务器端 confirm 一律视为确定）
  CONFIRMS: {
    leaveSect: () => G.s.sect && G.s.contrib >= G.leaveCost() ? `叛出门派将扣除贡献 ${U.fmt(G.leaveCost())}、清空职务（已学功法保留），确定？` : "",
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
    this.isAdmin = !!j.admin; DATA._admin = this.isAdmin; DATA._debug = !!j.debug;   // 测试模式：管理员 + TEST，或调试人物
    this.syncClock(j.serverNow);
    this.installActions(j.actions || []);
    this.installResume();
    this.checkLines();
    this.serverState = j.data || null;
    // 首屏不等 WS 握手：先把存档交给界面渲染，WS 在后台接；按钮操作本身
    // 会在 socket 未就绪时先 connectSocket 再发，握手失败则走后台重连循环，
    // 不会因为一次握手失败就让已打开的游戏收不到 10 秒结算推送。
    if (j.data) this.connectSocket().catch(() => this.scheduleReconnect());
    return j.data;
  },

  async createCharacter(name, ori) {
    const j = await this.req("character", { name: String(name || "无名散修").slice(0, 12), ori: Array.isArray(ori) ? ori.slice(0, 20).map(String) : [] });
    this.serverState = j.data;
    this.syncClock(j.serverNow);
    this.installResume();
    this.connectSocket().catch(() => this.scheduleReconnect());
    return j.data;
  },

  // 断线后循环重连（带退避），而不是只试一次：服务器重启/更新的空档
  // 往往超过 1.5 秒，一次失败就停会导致客户端卡在断线状态，只能重启 App。
  // 会话已死：令牌吊销 / 过期后 ws-ticket 一律 401，再试也连不上，停掉循环并让玩家重新登录。
  sessionExpired() {
    this.cancelReconnect();
    if (typeof G !== "undefined" && G.relogin) G.relogin();
    else { this.token = ""; this.serverState = null; try { localStorage.removeItem("xiu_token"); } catch {} this.setSync("登录已过期，请重新登录"); }
  },
  // 被踢（4001）、终结性关闭（4003/4004/4005）和正常登出（1000）不走这里，由 onclose 直接排除。
  scheduleReconnect() {
    if (!this.token || !this.serverState) return;
    clearTimeout(this._reconnectTimer);
    const delay = Math.min(1500 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(async () => {
      if (!this.token || !this.serverState) return;
      try { await this.connectSocket(); this._reconnectAttempts = 0; }
      catch (e) { if (e && e.status === 401) this.sessionExpired(); else this.scheduleReconnect(); }
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
  PING_MS: 15000, DEAD_MS: 35000, CONNECT_TIMEOUT: 5000,
  startWatchdog() {
    clearInterval(this._watchdogTimer);
    this._lastMessageAt = this._nativeNow();
    this._watchdogTimer = setInterval(() => {
      const s = this._socket;
      if (!s || s.readyState !== WebSocket.OPEN || !this.token || !this.serverState) return;
      const idle = this._nativeNow() - this._lastMessageAt;
      if (idle > this.DEAD_MS) { try { s.close(4000, "watchdog"); } catch {} return; }
      // 心跳：闲置超过 PING_MS 发一个 ping，服务器回 pong；既能让 NAT / 路由器不回收连接，也能及时发现死连接
      if (idle > this.PING_MS) { try { s.send(JSON.stringify({ type: "ping" })); } catch {} }
    }, 5000);
  },

  async connectSocket() {
    if (!this.token) throw new Error("请先登录");
    if (this._socket && this._socket.readyState === WebSocket.OPEN) return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const { ticket } = await this.req("ws-ticket", {}, "POST", this.CONNECT_TIMEOUT);
      const u = new URL(this.BASE + "ws", location.href);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.searchParams.set("ticket", ticket);
      const socket = new WebSocket(u.toString());
      this._socket = socket;
      // 消息处理先挂上：握手成功后服务器立刻推完整状态，虽说按微任务顺序本就不会丢，
      // 但先挂上就彻底没有“open 已回、onmessage 还没赋值”的空档
      socket.onmessage = event => { this._lastMessageAt = this._nativeNow(); this.onSocketMessage(event.data); };
      await new Promise((resolve, reject) => {
        let opened = false;
        // 握手失败：把 _socket 清掉，否则切回来的 3 秒重试看到 _socket 还在就不会再试
        const fail = msg => { clearTimeout(timeout); if (this._socket === socket) this._socket = null; try { socket.onopen = socket.onerror = null; socket.close(); } catch {} reject(new Error(msg)); };
        const timeout = setTimeout(() => { if (!opened) fail("连接游戏服务器超时"); }, this.CONNECT_TIMEOUT);
        socket.onopen = () => { opened = true; clearTimeout(timeout); this._reconnectAttempts = 0; clearTimeout(this._reconnectTimer); this.startWatchdog(); resolve(); this.setSync("已连接服务器"); };
        socket.onerror = () => { if (!opened) fail("无法连接游戏服务器"); };
      });
      socket.onclose = event => {
        const cur = this._socket === socket || !this._socket;   // 旧连接晚到的 close 不要把新连接的看门狗关掉
        if (cur) { clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
        if (this._socket === socket) this._socket = null;
        for (const [id, pending] of this._pending) {
          clearTimeout(pending.timer); this.finishButtonPending(pending);
          pending.reject(new Error("与服务器断开连接，请重试")); this._pending.delete(id);
        }
        if (event.code === 4001 && typeof G !== "undefined" && G.kicked) G.kicked();
        else if ([4003, 4004, 4005].includes(event.code)) {
          // 终结性关闭：密码已改 / 账号或人物已删 / 存档异常——令牌已吊销或存档不存在，
          // 重连永远连不上，必须停掉循环并让玩家重新登录（原来会静默循环请求 ws-ticket）
          this.sessionExpired();
        }
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
      const ok = this.applyState(message);
      if (this._resumeWait && message.state) this.resumeDone();   // 切回前台后服务器推回了结算好的完整状态
      if (this._resumePendingAway && message.state) { this._resumePendingAway = false; if (typeof G !== "undefined" && G.awayCheck) G.awayCheck(); } // 超时兜底时基线未动：完整状态到了再补算离开收益
      this.toastLogs(message.logs);
      if (ok) this.setSync("已同步到服务器");   // 序号错位时等完整状态到了再显示已同步
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
    if (!pending) { this.applyState(message); this.toastLogs(message.logs); return; }   // 超时后才到的结果：动作已不等了，但状态补丁照样打上（不打的话序号错位、界面一直是旧的）
    clearTimeout(pending.timer); this._pending.delete(message.id);
    this.finishButtonPending(pending);
    // 失败的动作：它乐观改过的键在 applyState 里按服务器值恢复（本条补丁可能没碰这些键）
    if (!message.ok && pending.optKeys) this._revertKeys = new Set(pending.optKeys);
    // 除了日志什么都没变 = 条件不足没执行（有补丁就看补丁改了哪些键，不再把整个状态序列化两次）
    const onlyLog = p => !p || (p.$p === 1 && !(p.d || []).length && Object.keys(p.s || {}).every(k => k === "log"));
    const noLog = st => st ? JSON.stringify({ ...st, log: 0 }) : "";
    const before = "patch" in message ? "" : noLog(this.serverState);
    if (!this.applyState(message) && message.ok) { pending.resolve(message); return; }   // 补丁没对上：已请求完整状态，不播战斗、不报成功，等完整状态到了界面自然更新
    const failed = message.ok && ("patch" in message ? onlyLog(message.patch) : before === noLog(this.serverState));
    if (!message.ok) {
      const error = message.error || "操作失败";
      this.showActionFeedback(error, "bad");
      pending.reject(new Error(error)); return;
    }
    this.afterRemoteAction(pending.name, pending.args, pending.refresh, message.result, pending.exStart, message.logs || [], pending.cqStart);
    // 服务器打完的战斗在这里播放：一次回多场时按顺序逐场播（以前只取最后一场，前面的直接丢了）
    const battles = Array.isArray(message.battles) ? message.battles.filter(bt => bt && bt.b) : [];
    if (battles.length && typeof G !== "undefined" && G.playBattle) this.queueBattles(battles);
    else if (pending.name !== "wudaoDone") this.toastLogs(message.logs, true, failed);
    pending.resolve(message);
  },

  // 多场战斗按顺序逐场播：复用 G.playBattle 本身做播放，不另起播放器。
  // playBattle 会顶掉正在播的一场（旧场只记日志），所以这里一次只播一场：
  // G._bp 还在（播着、或播完等玩家点「关闭」）就等着，玩家关闭后（_bp 清掉）再播下一场。
  // 新到的战斗排到队尾，不丢。登出时清队。
  queueBattles(list) {
    for (const bt of list || []) if (bt && bt.b) this._battleQueue.push(bt);
    this._pumpBattles();
  },
  _pumpBattles() {
    if (this._battlePump || !this._battleQueue.length) return;
    this._battlePump = setInterval(() => {
      if (!this._battleQueue.length) { clearInterval(this._battlePump); this._battlePump = 0; return; }
      if (typeof G === "undefined" || !G.playBattle || !G.s) return;   // 界面还没好：等着，别丢
      // 上一场还在：_bp 在且战斗画面还在 DOM 里就等；画面已不在（异常关闭）则当作播完
      if (G._bp && typeof document !== "undefined" && document.querySelector("#modal-box .btv")) return;
      const bt = this._battleQueue.shift();
      try { G.playBattle(bt.b, bt.title, bt.txt, bt.win, bt.logs || undefined, bt.replay, bt.opt || {}); }
      catch (e) { /* 这场播不了就跳过，下一场继续 */ }
    }, 500);
  },

  afterRemoteAction(name, args, refresh, result, exStart, logs = [], cqStart) {
    // 悟道结果窗口：服务器结算后用它写的日志在本地弹出
    if (name === "wudaoDone") {
      const D0 = ((CFG.wudaoRoom || {}).daos || []).find(d => d.id === args[0]), log = logs.find(l => l.c === "gold");
      if (D0 && log && G.wdModal) G.wdModal(D0, String(log.m).replace(/。$/, "").split("，").slice(1).map(x => `<div class="line"><div>${x.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div></div>`).join(""));
    }
    // 开始探索 / 秘境后展开探索信息（单机版在操作里设置 exploreOpen，服务器上设置不到客户端）
    if (["toggleExplore", "toggleMj", "mjAll", "ysEnterMj"].includes(name) && G.s.explore && G.s.explore.start !== exStart) { G.exploreOpen = true; G.exInfo = "ex"; G.render(); }
    if (name === "startChuqiao" && G.s.cq && G.s.cq.start !== cqStart) { G.exploreOpen = true; G.exInfo = "cq"; G.render(); }
    // These actions combine a server state change with a purely visual transition.
    if (name === "startTrib") { G.tribOpen = true; if (G.tribRender) G.tribRender(true); }
    if (name === "startChuqiao") { G.closeModal(); G.exploreOpen = true; G.render(); }
    if (["autoTaskSet", "atPickSet"].includes(name) && G.openCultSet) G.openCultSet();
    if (["learnBook", "learnGfBook", "learnBlueprint", "learnRingBp", "installFurnace", "equipItem", "unequip", "sellItem", "slotSpell", "swapFabao", "unslotSpell", "useStone", "useFurnace", "eatDan", "eatWuzhen", "eatQl", "eatYsDan", "eatLg", "eatYb", "useCxp", "learnXd", "learnDanScroll", "plantField", "clearField", "svAccept", "spellAdv"].includes(name) && G.closeModal) G.closeModal();
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
    if (["bmFuse", "bmFuseAll"].includes(name) && result && G.bmFuseDone) G.bmFuseDone(result);   // 熔炼后弹出增加的属性
  },

  // 超时动作的重试键：同名同参数才算同一次操作
  _blockKey(name, args) { try { return name + "\n" + JSON.stringify(args); } catch { return name; } },

  async sendAction(name, args, opts) {
    const button = this._clickedButton;
    this._clickedButton = null;
    if (typeof G !== "undefined" && G.s) {
      // 炼法宝还没选类型 / 属性：在本地打开选择窗口，选好后再发给服务器
      if (name === "craftFurnace" && args[2] === "fabao" && !(DATA.fabaoTypes[args[3]] && DATA.elById[args[4]])) { G.openFabaoPick(args[1]); return false; }
      // 突破要渡劫（如练气十层 → 筑基）：渡劫准备页只在本地打开，点「开始突破」才发 startTrib 给服务器
      // v259 去掉准备页：有渡劫在进行就看渡劫页，否则直接开始渡劫
      if (name === "breakthrough" && G.s.trib) { G.openTrib(); return false; }
      if (name === "breakthrough" && G.canBreak() && G.needTrib()) return this.sendAction("startTrib", []);
      // 悟道：先发一次 wudao 让服务器记下开始时间（服务端 wudaoDone 会校验是否读满），
      // 再在本地播放读条动画，结束时发 wudaoDone 结算。_raw 的 wudao 本身不走这段拦截，避免递归。
      if (name === "wudao" && !(opts && opts._raw)) {
        const dao = args[0];
        if (G._wdRun) return false;
        if (!G.wdCheck(dao)) { G.renderLog(); this.toastLogs(G.s.log.slice(0, 1), true, true); return false; }
        try { await this.sendAction("wudao", [dao], { _raw: true }); }
        catch (e) { this.showActionFeedback(e.message || "悟道开始失败", "bad"); return false; }
        const ms = ((CFG.wudaoRoom || {}).TIME || 0) * 1000;
        G._wdRun = { dao, end: this._nativeNow() + ms }; G.render();
        await new Promise(r => setTimeout(r, ms));
        G._wdRun = null; G._wdFx = this._nativeNow();
        return this.sendAction("wudaoDone", [dao]);
      }
      if (this.CONFIRMS[name]) {
        let text = "";
        try { text = this.CONFIRMS[name](...args); } catch {}
        if (text && !(await G.ask(text))) return false;
      }
    }
    // 上次同名同参数的操作超时后结果还没同步回来：先拦住重试，等完整状态到了再放行
    // （超时注释里本来就写着“先重同步再允许重试”，这里把它落到实处；否则慢服务器 + 手快重试会重复执行）
    const blockKey = this._blockKey(name, args);
    const blocked = this._retryBlock.get(blockKey);
    if (blocked) {
      // 60 秒兜底（原生时钟计时）；序号已推进/完整状态已到时 applyState 里已提前清掉
      if (this._nativeNow() - blocked.at < 60_000) { this.showActionFeedback("上次操作结果还没同步回来，请稍后再试", "bad"); return false; }
      this._retryBlock.delete(blockKey);
    }
    const buttonPending = this.markButtonPending(button);
    const refresh = button && button.dataset ? button.dataset.refresh || "" : "";
    try {
      if (!this._socket || this._socket.readyState !== WebSocket.OPEN) await this.connectSocket();
    } catch (error) {
      this.finishButtonPending(buttonPending);
      if (error && error.status === 401) this.sessionExpired();
      else this.showActionFeedback(error.message || "无法连接游戏服务器", "bad");
      throw error;
    }
    const socket = this._socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.finishButtonPending(buttonPending);
      const error = new Error("游戏服务器暂不可用");
      this.showActionFeedback(error.message, "bad");
      throw error;
    }
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${this._nativeNow().toString(36)}-${(++this._actionCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let optKeys = [];
    if (this.OPTIMISTIC.has(name) && typeof G !== "undefined" && G.s) {
      // 乐观动作：先在本地改好显示，记下改动过的键/子字段（按动作跟踪，不是单布尔），
      // 服务器结果到了只对这些键按服务器值恢复，其余补丁和空闲心跳不再冲掉本地先改
      optKeys = this._optimisticKeys(name, args);
      const before = new Map(optKeys.map(k => [k, structuredClone(G.s[k])]));
      try { this._originalActions.get(name).apply(G, args); G.dirty(); G.render(); G.bars(); this.refreshOpenModal(); } catch {}
      for (const k of optKeys) this._recordLocalEdit(k, before.get(k), G.s[k], id);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(id);
        this._pending.delete(id); this.finishButtonPending(pending);
        const error = new Error("服务器响应超时，请稍后查看状态");
        this.showActionFeedback(error.message, "bad");
        // 超时后客户端状态可能已旧（服务端可能已执行）：先重同步再允许重试，否则重试会按旧格子序号操作
        try { if (this._socket && this._socket.readyState === WebSocket.OPEN) this._socket.send(JSON.stringify({ type: "resync" })); } catch {}
        // 记下超时时的已应用序号：之后任何序号超过它的补丁/完整状态一到就放行重试（applyState 里清）
        this._retryBlock.set(blockKey, { at: this._nativeNow(), seq: this._seq });
        reject(error);
      }, 15_000);
      const exStart = typeof G !== "undefined" && G.s && G.s.explore ? G.s.explore.start : undefined, cqStart = typeof G !== "undefined" && G.s && G.s.cq ? G.s.cq.start : undefined;
      this._pending.set(id, { resolve, reject, timer, name, args, refresh, exStart, cqStart, optKeys, ...buttonPending });
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
  async giftMail(d) { return this.req("admin/gift/mail", d); },
  async giftDelete(code) { return this.req("admin/gift/del", { code }); },
  async giftRedeem(code) { const j = await this.req("gift", { code }); if (j.state) this.applyState(j); return j; },   // 不再发 resync：HTTP 响应本身就是完整状态，服务器端兑换时在线客户端还会再推一次完整状态，再发一次等于同一份完整状态传三遍
  async changePassword(oldPw, newPw) { return this.req("password", { old: oldPw, new: newPw }); },
  async userList() { return this.req("admin/users"); },
  async setRegOpen(open) { return this.req("admin/reg", { open }); },
  async userDelete(id) { return this.req("admin/user/del", { id }); },
  async userRename(id, username) { return this.req("admin/user/rename", { id, username }); },
  async charList() { return this.req("admin/chars"); },
  async charNew(debug) { return this.req("admin/char/new", { debug: !!debug }); },
  async charSwitch(id) { return this.req("admin/char/switch", { id }); },
  async charDel(id) { return this.req("admin/char/del", { id }); },
  // ---- 从后台切回游戏：显示「加载游戏中…」，等服务器把离开这段时间结算完、推回完整状态再关闭 ----
  _hiddenAt: 0, _resumeWait: false, _resumeShow: 0, _resumeTimer: 0, _resumeKick: 0, _resumeRetry: 0, _resumePendingAway: false, // 超时兜底先关了提示：基线未动，待完整状态到达再补算一次离开收益（见 snapshot 分支）
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
    this._resumePendingAway = false; // 新一轮切回，清除上一轮超时留下的待补弹窗标记
    // 安卓版后台保持连接时，切回来服务器几百毫秒就推回状态：0.8 秒内完成就不显示「加载游戏中…」
    clearTimeout(this._resumeShow);
    this._resumeShow = setTimeout(() => { if (this._resumeWait) this.showResume(true); }, 800);
    // 切后台后连接可能已经悄悄断了但 readyState 还是 OPEN：不再信任它，直接关掉旧连接马上重连
    //   （新连接一接通服务器就会结算并推完整状态）；看门狗计时也从现在重新算
    this._lastMessageAt = this._nativeNow();
    clearTimeout(this._reconnectTimer); this._reconnectAttempts = 0;
    const s = this._socket;
    if (s) { this._socket = null; s.onmessage = null; try { s.close(4000, "resume"); } catch {} clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
    this.connectSocket().catch(() => {});
    // 连不上就每 3 秒再试一次；最多等 20 秒，之后关掉提示（后台继续自动重连）
    clearInterval(this._resumeRetry);
    this._resumeRetry = setInterval(() => {
      if (!this._resumeWait) return clearInterval(this._resumeRetry);
      if (!this._socket && !this._connectPromise) this.connectSocket().catch(() => {});
    }, 3000);
    clearTimeout(this._resumeTimer);
    this._resumeTimer = setTimeout(() => {
      if (!this._resumeWait) return;
      this._resumePendingAway = true; // 20 秒还没等到完整状态：先关提示，基线不动，等完整状态到了再补算离开收益
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
  // 换线路时带上登录，不用重新登录。90 天令牌绝不再放进 URL hash：
  // 同源用 sessionStorage 一次交接（30 秒有效、读一次就删），跨域用 30 秒一次性 ws-ticket
  // 向目标线路的 POST api/line-redeem（server/server.mjs）换登录令牌，一次消费、30 秒过期。
  // 注意：ticket 只存在发券进程的内存 Map 里，目标线路若是另一台独立后端进程就换不到，
  // 会落到目标线路的登录页（手动登录一次）；同进程/同后端的不同域名线路不受影响。
  async goLine(url) {
    const base = this.lineKey(url);
    const app = typeof window !== "undefined" && window.XiuApp;
    const go = full => { if (app && app.switchTo) app.switchTo(base, full); else location.href = full; };
    if (!this.token) return go(base);
    let sameOrigin = false;
    try { sameOrigin = typeof location !== "undefined" && new URL(base, location.href).origin === location.origin; } catch {}
    if (sameOrigin) {
      try { sessionStorage.setItem("xiu_line_handoff", JSON.stringify({ u: this.user, t: this.token, exp: this._nativeNow() + 30_000 })); } catch {}
      return go(base);
    }
    // 跨域：sessionStorage 跨不过 origin，改发 30 秒一次性 ticket 放 hash（长效令牌不进 URL）
    try {
      const { ticket } = await this.req("ws-ticket", {}, "POST", this.CONNECT_TIMEOUT);
      if (ticket) return go(`${base}#xtk=${encodeURIComponent(ticket)}&xu=${encodeURIComponent(this.user)}`);
    } catch (e) {}
    go(base);   // 发票失败：只跳地址，不带凭证（目标页登录一次即可）
  },

  // 跨域换线：用一次性 ticket 向目标服务器换登录令牌（POST api/line-redeem，
  // 入参 { ticket }，成功返回 { user, token }，ticket 一次消费、30 秒过期，与 ws-ticket 同规则）。
  // 成功后刷新一次，让登录流程用新令牌正常进游戏；失败（票过期、目标线路是另一台独立后端等）
  // 留在登录页，不回退到把长效令牌放 URL。
  async redeemLineTicket(ticket, user) {
    try {
      const j = await this.req("line-redeem", { ticket }, "POST", 5000);
      if (!j || !j.token) return false;
      this.setLogin(j.user || j.username || user, j.token);
      try { history.replaceState(null, "", location.pathname + location.search); } catch {}
      location.reload();
      return true;
    } catch (e) { return false; }
  },

  setSync(text) { const el = document.getElementById("sync"); if (el) el.textContent = text; },
};

// 换线路交接（只在页面加载时读一次）：
//  1. 同源 sessionStorage（goLine 写的 30 秒一次交接）：读到就消费掉并登录，URL 干干净净；
//  2. 跨域 #xtk= 一次性 ticket：异步换 token（见 API.redeemLineTicket），换到就刷新进游戏；
//  3. 旧 #xt= 长效令牌：仅兼容过渡期仍在外流转的旧链接，goLine 已不再产生；读到后立即从地址栏去掉。
try {
  const handoff = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("xiu_line_handoff") : null;
  if (handoff) {
    try { sessionStorage.removeItem("xiu_line_handoff"); } catch {}
    const h = JSON.parse(handoff);
    if (h && h.t && h.u && Number(h.exp) > API._nativeNow()) API.setLogin(h.u, h.t);
  }
} catch (e) {}
if (typeof location !== "undefined" && typeof location.hash === "string" && /[#&]xtk=/.test(location.hash)) {
  try {
    const h = new URLSearchParams(location.hash.slice(1)), t = h.get("xtk"), u = h.get("xu");
    history.replaceState(null, "", location.pathname + location.search);   // 先把 ticket 从地址栏去掉，再异步换 token
    if (t && u) API.redeemLineTicket(t, u);
  } catch (e) {}
} else if (typeof location !== "undefined" && typeof location.hash === "string" && /[#&]xt=/.test(location.hash)) {
  try {
    const h = new URLSearchParams(location.hash.slice(1)), t = h.get("xt"), u = h.get("xu");
    if (t && u) API.setLogin(u, t);
    history.replaceState(null, "", location.pathname + location.search);
  } catch (e) {}
}
