import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TICK_MS = 10_000;
// 游戏参数（web/js/config/*.js）：管理员在网页里改过的版本存放在数据目录，不进 git，GitHub 更新也不会覆盖。
export const CONFIG_DIR = path.join(ROOT, "web/js/config");
export const CONFIG_OVERRIDE_DIR = path.resolve(process.env.XIU_CONFIG_DIR || path.join(process.env.XIU_DATA_DIR || path.join(HERE, "data"), "config"));
// 加载顺序（后面的文件可以用前面文件定义的参数）；新加的参数文件不在列表里时按文件名排在最后
const CONFIG_ORDER = ["rates.js", "realm.js", "player.js", "array.js", "mobs.js", "explore.js", "drops.js", "worldmaps.js", "xingjun.js", "battle.js", "equip.js", "start.js", "bag.js", "gongfa.js", "lingen.js", "items.js", "alchemy.js", "furnace.js", "forge.js", "benming.js", "garden.js", "trib.js", "servant.js", "sect.js", "wudao.js", "craftsman.js", "mijing.js", "lingdi.js", "body.js", "names.js", "shenshi.js", "wudaoshi.js", "jingmai.js", "zhenfa.js"];
export function configNames() {
  const files = fs.readdirSync(CONFIG_DIR).filter(f => /^[a-z0-9_-]+\.js$/i.test(f));
  return [...CONFIG_ORDER.filter(f => files.includes(f)), ...files.filter(f => !CONFIG_ORDER.includes(f)).sort()];
}
export function configHash(code) { return crypto.createHash("sha1").update(code).digest("hex").slice(0, 12); }
export function validConfigName(name) {
  const n = String(name || "");
  if (!/^[a-z0-9_-]+\.js$/i.test(n) || !configNames().includes(n)) throw Object.assign(new Error("没有这个参数文件"), { status: 404 });
  return n;
}
export function configOverridden(name) { return fs.existsSync(path.join(CONFIG_OVERRIDE_DIR, name)); }
export function readConfig(name, { original = false } = {}) {
  const n = validConfigName(name);
  if (!original && configOverridden(n)) return fs.readFileSync(path.join(CONFIG_OVERRIDE_DIR, n), "utf8");
  return fs.readFileSync(path.join(CONFIG_DIR, n), "utf8");
}
const MAX_TICKS_PER_ADVANCE = 3_000_000;
// 登录 / 会话 / 重连 / 动作单次最多补算的 tick 数（86400 个 10 秒 = 10 天）：
// state.last 落后几十天时全量补算会卡住事件循环；截断后剩下的由定时结算继续补
// （advance 截断时 s.last 不跳到现在，见 advance），所以这里可以比离线后台的 1 天大得多。
export const ADVANCE_BUDGET_TICKS = 86_400;

function elementStub() {
  const classes = new Set();
  return {
    style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", scrollTop: 0,
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), toggle: (x, on) => on ? classes.add(x) : classes.delete(x), contains: x => classes.has(x) },
    appendChild() {}, remove() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function serverDate(clock) {
  const NativeDate = Date;
  function DateForGame(...args) {
    if (!new.target) return new NativeDate(clock.now).toString();
    return args.length ? new NativeDate(...args) : new NativeDate(clock.now);
  }
  DateForGame.now = () => clock.now;
  DateForGame.parse = NativeDate.parse;
  DateForGame.UTC = NativeDate.UTC;
  DateForGame.prototype = NativeDate.prototype;
  Object.setPrototypeOf(DateForGame, NativeDate);
  return DateForGame;
}

function serverMath(random) {
  return new Proxy(Math, {
    get(target, key) {
      if (key === "random") return random;
      return Reflect.get(target, key, target);
    },
  });
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class GameEngine {
  // overrides：{ "mobs.js": "代码" }，用于保存前先用新参数完整加载一遍做检查
  constructor(overrides = {}) {
    this.clock = { now: Date.now() };
    this.random = Math.random;
    this.sequence = 0;
    this.logs = [];
    this.battles = [];

    const localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
    const document = {
      hidden: false,
      body: elementStub(),
      getElementById: () => elementStub(),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => elementStub(),
      addEventListener() {},
    };
    const sandbox = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      localStorage,
      document,
      navigator: { sendBeacon() { return true; } },
      location: { href: "http://server.invalid/", reload() {} },
      setTimeout: () => 0,
      // 确认框在客户端发送操作前弹出（api.js 的 CONFIRMS），到服务器时一律视为已确认
      confirm: () => true,
      alert() {},
      clearTimeout() {},
      setInterval: () => 0,
      clearInterval() {},
      requestAnimationFrame() {},
      fetch: async () => { throw new Error("Network access is disabled in the game runtime"); },
      Blob,
      URL,
      TextEncoder,
      TextDecoder,
      Date: serverDate(this.clock),
      Math: serverMath(() => this.random()),
      crypto: { getRandomValues(array) { crypto.randomFillSync(array); return array; } },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox, { name: "xiu-online-game-runtime" });
    this.context = sandbox;

    const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
    const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1].split("?")[0]);
    for (const source of sources) {
      let code;
      const cfg = source.match(/^(?:api|js)\/config\/([^/]+\.js)$/);
      const cfgOf = name => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : readConfig(name);
      if (source === "api/config-loader.js") {
        // 参数文件是管理员可写的任意 JS：超时从 30 秒收紧到 5 秒，恶意/死循环参数
        // 只能阻塞单台引擎 5 秒；游戏脚本本身的 30 秒不动
        for (const name of configNames()) vm.runInContext(cfgOf(name), sandbox, { filename: `js/config/${name}`, timeout: 5_000 });
        continue;
      }
      if (cfg) code = cfgOf(cfg[1]);
      else {
        const fullPath = path.resolve(ROOT, "web", source);
        if (!fullPath.startsWith(path.join(ROOT, "web") + path.sep)) throw new Error(`Invalid game script path: ${source}`);
        code = fs.readFileSync(fullPath, "utf8");
      }
      vm.runInContext(code, sandbox, { filename: source, timeout: 30_000 });
    }
    vm.runInContext("globalThis.__xiuGame = G; globalThis.__xiuData = DATA; globalThis.__xiuConfig = CFG;", sandbox, { timeout: 1_000 });
    this.G = sandbox.__xiuGame;
    this.DATA = sandbox.__xiuData;
    this.CFG = sandbox.__xiuConfig;
    if (!this.G || !this.G.runTicks || !this.G.modules.length) throw new Error("The game modules did not initialize");

    const engine = this;
    this.G.log = function (message, color = "") {
      if (!this.s || this.silent) return;
      const entry = { m: String(message), c: String(color) };
      this.s.log ||= [];
      this.s.log.unshift(entry);
      if (this.s.log.length > 60) this.s.log.length = 60;
      engine.logs.unshift(entry);
      if (engine.logs.length > 100) engine.logs.length = 100;
    };
    // 悟道读条强制（服务端）：wudao 只记录开始时间、不结算；wudaoDone 结算时校验是否读满
    // CFG.wudaoRoom.TIME 秒（见下面的 wudaoDone 包装）。开始时间存进存档（s._wdStart），
    // 断线重连后仍有效；已有未完成的开始时间则保留，重复点「开始」不重置读条。
    // 注意：正常客户端流程（web/js/core/api.js 的 wudao 拦截）只发 wudaoDone、不发 wudao，
    // 自动任务（sect.js runAutoTask）也是直接调 wudaoDone——这两路都不带 _wdStart，
    // 所以 wudaoDone 在无 _wdStart 时不拦（见下）；只有带开始时间却没读满时才拦。
    // 想彻底堵住“只发 wudaoDone 跳过读条”，需前端在读条开始时先发一次 wudao。
    this.G.wudao = function (dao) {
      if (!this.wdCheck(dao)) return;
      const cur = this.s._wdStart;
      if (!cur || cur.dao !== dao) this.s._wdStart = { dao, at: engine.clock.now };
    };
    const origWudaoDone = this.G.wudaoDone;
    if (typeof origWudaoDone === "function") {
      this.G.wudaoDone = function (dao) {
        const s = this.s, start = s && s._wdStart;
        if (start && start.dao === dao) {
          const needMs = ((engine.CFG.wudaoRoom || {}).TIME || 0) * 1000;
          if (engine.clock.now - start.at < needMs) throw new Error("悟道尚未完成，请等读条结束");
          delete s._wdStart;
        }
        return origWudaoDone.call(this, dao);
      };
    }
    this.G.save = function () {};
    this.G.upload = async function () {};
    this.G.render = function () {};
    this.G.renderLog = function () {};
    this.G.bars = function () {};
    // The browser build deliberately disables local ticks; restore the original
    // module scheduler here so the authoritative server completes timed systems.
    this.G.tickAll = function (offline) {
      for (const module of this.modules) if (module.tick) module.tick.call(this, offline);
    };
    this.G.modal = function () {};
    // 战斗画面在客户端播放：服务器只记下来，随操作结果发回（一次响应里多场战斗都保留，
    // 不再每次调用都覆盖成只剩最后一场；act()/advance() 开始时清空一次，见下）
    this.G.playBattle = function (b, title, txt, win, logs, replay, opt) {
      (engine.battles ||= []).push(safeClone({ b, title, txt, win, logs: logs || null, replay: !!replay, opt: opt || {} }));
      // 全部信息：除实力测试、回放以外的战斗都记一条（服务器存 hist 表，见 server.mjs drainHist）
      if (!replay && !(opt && opt.test) && b && this.s) {
        const nm = opt && opt.tname !== undefined ? opt.tname : b.name, t = `${title}${nm ? " · " + nm : ""}`;
        (this.s.histQ || (this.s.histQ = [])).push(safeClone({ at: engine.clock.now, k: "战斗", title: `${t}${txt ? "：" + txt : ""}`, bad: !win, ev: [{ t: txt || (win ? "胜利" : "失败"), c: win ? "gold" : "bad", b }] }));
      }
    };
    this.G.closeModal = function () {};
    this.G.setSync = function () {};
    // 多名玩家共用一个引擎（server.mjs 引擎池）：记下刚建好时 G 上的全部字段，
    // 换人时把上一位玩家留在 G 上的界面 / 临时字段（bagFilter、forgeMode……）收起来，恢复成初始，再放回下一位自己的
    this._base = new Map(Object.keys(this.G).map(k => [k, this.G[k]]));
    this._owner = null;
    this._sides = new Map();
  }

  // 切换到某位玩家（key 一般是用户 id）；同一位玩家连续调用不做任何事
  use(key) {
    if (key === this._owner) return this;
    const G = this.G, base = this._base;
    // drop() 把当前 owner 置空后会 use(Symbol("none")) 占位：Symbol 不是真玩家，下次真实
    // use() 时不能把它当 owner 存一份 side，否则每台引擎上 Symbol 侧栏永不清理、缓慢增长
    if (this._owner !== null && typeof this._owner !== "symbol") {
      const side = {};
      for (const k of Object.keys(G)) if (k !== "s" && (!base.has(k) || G[k] !== base.get(k))) side[k] = G[k];
      this._sides.set(this._owner, side);
    }
    for (const k of Object.keys(G)) if (!base.has(k)) delete G[k];
    for (const [k, v] of base) if (G[k] !== v) G[k] = v;
    const mine = this._sides.get(key);
    if (mine) Object.assign(G, mine);
    this._owner = key;
    return this;
  }
  // 玩家下线久了：丢掉他留在引擎里的界面字段
  // 注意：若 key 恰是当前 owner，不能先删 side 再 use()，因为 use() 切换前会把当前
  // owner 的界面字段重新存回 _sides[key]，等于把刚删的复活。先把 _owner 置空再
  // use(Symbol("none")) 占位；占位 Symbol 本身不存 side（use 里的 symbol 守卫）。
  drop(key) {
    this._sides.delete(key);
    if (key === this._owner) { this._owner = null; this.use(Symbol("none")); }
  }

  seedRandom() {
    let state = crypto.randomBytes(4).readUInt32LE(0) || 0x9e3779b9;
    this.random = () => {
      // xorshift32 seeded from the operating system's cryptographic RNG.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
  }

  setNow(now) {
    const n = Number(now);
    if (!Number.isFinite(n) || n < 0) throw new TypeError("Invalid server time");
    this.clock.now = Math.trunc(n);
    this.G._simNow = this.clock.now;
  }

  createState(name, now = Date.now(), ori = []) {
    this.seedRandom();
    this.setNow(now);
    const state = this.G.newSave(String(name));
    this.G.s = state;
    this.G.dirty();
    const stats = this.G.stats();
    state.hp = stats.hp;
    state.mana = stats.mana;
    if (this.G.oriApply) { this.G.oriApply(ori); const st2 = this.G.stats(); state.hp = st2.hp; state.mana = st2.mana; }   // 出身（config/start.js CFG.origin）
    this.G.log(`${state.name}，自此踏上仙途。赠你聚气丹三枚、${this.CFG.start.book ? this.CFG.start.book.name : "练气诀"}一本。`, "gold");
    this.G.log("提示：修炼页开启“自动修炼”，服务器会继续进行修炼和离线结算。", "sys");
    state.last = this.clock.now;
    return safeClone(state);
  }

  // 这个引擎是否属于管理员账号（config/rates.js 的测试模式只对管理员生效）
  setAdmin(v) { this.DATA._admin = !!v; }
  setDebug(v) { this.DATA._debug = !!v; }   // 调试人物：始终测试模式

  bindState(state, now = Date.now()) {
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("Invalid player state");
    this.seedRandom();
    this.setNow(now);
    this.G.s = state;
    this.G.silent = false;
    this.G._stopped = false;
    this.G._hold = false;
    this.G._lastTick = Number.isFinite(Number(state.last)) ? Number(state.last) : this.clock.now;
    this.G._simNow = this.clock.now;
    this.G._cache = null;
    this.G._ver = (this.G._ver || 0) + 1;
    this.G.migrate(state);
    if (typeof this.G.fabaoNames === "function") this.G.fabaoNames();
    return state;
  }

  advance(state, now = Date.now(), maxTicks = MAX_TICKS_PER_ADVANCE) {   // maxTicks：这次最多补算几个 10 秒（后台离线结算分批用，剩下的下一轮接着算）
    this.bindState(state, now);
    this.logs = [];
    this.battles = [];
    const s = this.G.s;
    const last = Math.min(Number(s.last) || this.clock.now, this.clock.now);
    const totalDue = Math.floor(Math.max(0, this.clock.now - last) / TICK_MS);
    let due = Math.min(totalDue, MAX_TICKS_PER_ADVANCE, Math.max(1, Math.floor(maxTicks) || MAX_TICKS_PER_ADVANCE));
    const truncated = due < totalDue;   // 被 maxTicks / 300 万上限截断：s.last 只能推进到已算完的位置，剩下的下一轮接着算
    if (due > 0) {
      this.G.silent = false;
      this.G.runTicks(last, due);
      s.last = last + due * TICK_MS;
      this.G._lastTick = s.last;
    }
    this.G._simNow = this.clock.now;
    // 修炼室 / 练功房扣贡献、功法修炼完成：到点就结算，不等下一个 10 秒周期（否则倒计时到 0 会卡几秒）
    try {
      const a = s.affair, at = a && a.task >= 0 && this.DATA.affairs && this.DATA.affairs[a.task];
      const affairDue = at && this.clock.now >= a.start + at.time * 60000;   // 事务堂奖励还没结算：留给 10 秒周期按时间先后一起算
      if (!affairDue && typeof this.G.roomBill === "function" && (s.room >= 0 || s.gfRoom >= 0)) this.G.roomBill(this.clock.now);
      if (s.gfStudy && typeof this.G.gfStudyEnd === "function") {
        const end = this.G.gfStudyEnd(), gm = (this.G.modules || []).find(m => m.id === "gongfa");
        if (end != null && this.clock.now >= end && gm && gm.tick) gm.tick.call(this.G, false);
      }
    } catch (err) { console.error("timed settle failed:", err?.stack || err); }
    if (typeof this.G.advanceExplore === "function" && (s.explore || s.cq)) this.G.advanceExplore();
    if (typeof this.G.advanceTrib === "function" && s.trib) this.G.advanceTrib();
    // Preserve the partial 10-second interval; the server owns this timestamp.
    // 只有没被截断时才能把 s.last 对齐到现在：被截断时上面已把 s.last 设成 last+due*TICK_MS，
    // 再对齐到现在会把还没算的离线时间直接丢掉（离线超过 1 天只算第 1 天、剩下 29 天永久丢失）。
    if (!truncated) s.last = this.clock.now - ((this.clock.now - last) % TICK_MS);
    this.G._simNow = this.clock.now;
    return { state: safeClone(s), logs: safeClone(this.logs), serverNow: this.clock.now, processedTicks: due, truncated, nextDue: this.nextDue(s) };
  }

  // 下一次会改变状态的时间点（修炼周期、探索下一步、下一道劫雷）；服务器在这一刻立即结算并推送。
  nextDue(s = this.G.s) {
    const times = [];
    const last = Number(s && s.last);
    if (Number.isFinite(last)) times.push(last + TICK_MS);
    try {
      for (const x of [s && s.explore, s && s.cq]) if (x && !x.rest && x.ms > 0 && x._pz == null) {   // 探索、出窍各自的下一步
        const T = this.G.exCfg(x).TIME, W = (this.CFG.explore.END_WAIT || 0) * 1000;
        times.push(x.lostWait ? x.start + (x.step + 1) * x.ms : x.step >= T ? x.start + T * x.ms + W : x.start + (x.step + 1) * x.ms);
      }
    } catch {}
    try {
      const t = s && s.trib;
      if (t && !t.result) {
        const HS = this.CFG.trib.HIT_SEC, nextHit = (Math.floor(t.sec / HS) + 1) * HS;
        times.push(t.start + Math.min(nextHit, t.time) * 1000);
      }
    } catch {}
    try {   // 修炼室 / 练功房下次扣贡献、功法修炼这一层结束
      if (s && s.sect && s.room >= 0 && s.roomAt > 0) times.push(s.roomAt);
      if (s && s.sect && s.gfRoom >= 0 && s.gfRoomAt > 0) times.push(s.gfRoomAt);
      if (s && s.gfStudy && typeof this.G.gfStudyEnd === "function") { const e = this.G.gfStudyEnd(); if (e != null) times.push(e); }
    } catch {}
    const valid = times.filter(Number.isFinite);
    return valid.length ? Math.min(...valid) : this.clock.now + TICK_MS;
  }

  act(state, action, args = [], now = Date.now(), maxTicks = ADVANCE_BUDGET_TICKS) {
    // 单次操作最多补算 10 天：state.last 落后几十天时全量补算会卡住事件循环；
    // 截断后剩下的由定时结算继续补（advance 截断时 s.last 不跳到现在）。
    // battles 在 advance 之前清空：一次响应里的多场战斗（本次 advance 的探索/渡劫 + 本次操作）都保留。
    this.battles = [];
    const advanced = this.advance(state, now, maxTicks);
    const method = this.G[action];
    if (typeof method !== "function") throw new Error("未知操作");
    if (action.startsWith("_") || ["init", "start", "loop", "runTicks", "offline", "tickAll", "migrate", "newSave"].includes(action)) throw new Error("不允许调用该操作");
    this.seedRandom();
    this.G._simNow = this.clock.now;
    // 背包是固定格子，客户端不再自动排序：服务端这里也不能在操作前排序，
    // 否则客户端按格子序号点的操作会对到排序后的另一件物品；只有点「整理」时才排序。
    const preBad = this.insane(this.G.s);   // 旧存档本来就有问题时不拦，免得以后每个操作都被拒
    // 一键熔炼没有数量参数、按持有量逐颗循环：持有量（礼包一次最多 1e6 颗）不受 validateValue 约束，
    // 单次超过 1000 颗就拒绝，改用 bmFuse(j, n) 分批（每批 ≤1000，见 server.mjs validateValue）。
    if (action === "bmFuseAll" && typeof this.G.bmStones === "function" && typeof this.G.herbCount === "function") {
      let tot = 0;
      for (const x of this.G.bmStones()) { tot += this.G.herbCount(x.name) || 0; if (tot > 1000) throw new Error("熔炼石太多，一次最多熔炼 1000 颗，请分批熔炼"); }
    }
    let result;
    try { result = method.apply(this.G, args); }
    catch (err) {
      // 参数类型不对、在不该点的时候点（如没加入宗门点晋升）：引擎内部报 TypeError。服务器会回滚存档，这里只换成中文提示。
      if (err && ["TypeError", "RangeError", "ReferenceError"].includes(err.name)) { const e2 = new Error("操作参数无效"); e2.cause = err; throw e2; }
      throw err;
    }
    if (!preBad) { const bad = this.insane(this.G.s); if (bad) { const err = new Error("操作数据异常，已取消"); err.detail = bad; throw err; } }
    if (result && typeof result.then === "function") throw new Error("异步 UI 方法不能作为游戏操作调用");
    // 只有 advance 没被截断时才能把 s.last 对齐到现在，否则会丢掉还没算的离线时间（见 advance）。
    if (!advanced.truncated) this.G.s.last = Math.max(Number(this.G.s.last) || 0, this.clock.now - ((this.clock.now - (Number(this.G.s.last) || this.clock.now)) % TICK_MS));
    const response = {
      state: safeClone(this.G.s),
      logs: safeClone(this.logs),
      serverNow: this.clock.now,
      result: result === undefined ? null : result,
      battles: this.battles,
      processedTicks: advanced.processedTicks,
      truncated: advanced.truncated,
    };
    return response;
  }
}

// 兜底检查：操作后存档里不能有 NaN / Infinity（NaN 会让「灵石不足」之类的判断失效），历练 / 出窍的区域必须存在（否则之后每次结算都报错、存档卡死）。
// 不通过就抛错，服务器丢弃这次操作的副本，存档保持原样。
GameEngine.prototype.insane = function (s) {
  const bad = [];
  const walk = (o, p, d) => {
    if (bad.length || d > 14 || !o || typeof o !== "object") return;
    for (const k in o) {
      if (k === "log" || k === "_nm") continue;
      const v = o[k];
      if (typeof v === "number") { if (!Number.isFinite(v)) { bad.push(p + "." + k); return; } }
      else if (v && typeof v === "object") walk(v, p + "." + k, d + 1);
    }
  };
  walk(s, "s", 0);
  for (const k of ["explore", "cq"]) { const x = s[k]; if (x && x.map !== -1 && x.mj == null && typeof this.G.regionOk === "function" && !this.G.regionOk(x.map, x.reg)) bad.push("s." + k + ".reg"); }
  return bad[0] || "";
};

export const GAME_TICK_MS = TICK_MS;
