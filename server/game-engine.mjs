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
const CONFIG_ORDER = ["rates.js", "realm.js", "player.js", "array.js", "mobs.js", "explore.js", "drops.js", "worldmaps.js", "xingjun.js", "battle.js", "equip.js", "start.js", "bag.js", "gongfa.js", "lingen.js", "items.js", "alchemy.js", "furnace.js", "forge.js", "garden.js", "trib.js", "servant.js", "sect.js", "wudao.js", "craftsman.js", "mijing.js", "lingdi.js", "body.js", "names.js", "shenshi.js", "wudaoshi.js", "jingmai.js"];
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
        for (const name of configNames()) vm.runInContext(cfgOf(name), sandbox, { filename: `js/config/${name}`, timeout: 30_000 });
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
    // 悟道的读条在客户端播放，结束后发 wudaoDone；直接调用 wudao 时立即结算（服务器没有定时器）
    this.G.wudao = function (dao) { if (this.wdCheck(dao)) this.wudaoDone(dao); };
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
    // 战斗画面在客户端播放：服务器只记下来，随操作结果发回
    this.G.playBattle = function (b, title, txt, win, logs, replay, opt) {
      engine.battles = [safeClone({ b, title, txt, win, logs: logs || null, replay: !!replay, opt: opt || {} })];
      // 全部信息：除实力测试、回放以外的战斗都记一条（服务器存 hist 表，见 server.mjs drainHist）
      if (!replay && !(opt && opt.test) && b && this.s) {
        const nm = opt && opt.tname !== undefined ? opt.tname : b.name, t = `${title}${nm ? " · " + nm : ""}`;
        (this.s.histQ || (this.s.histQ = [])).push(safeClone({ at: engine.clock.now, k: "战斗", title: `${t}${txt ? "：" + txt : ""}`, bad: !win, ev: [{ t: txt || (win ? "胜利" : "失败"), c: win ? "gold" : "bad", b }] }));
      }
    };
    this.G.closeModal = function () {};
    this.G.setSync = function () {};
    this.G.offlineReport = function () {};
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

  advance(state, now = Date.now()) {
    this.bindState(state, now);
    this.logs = [];
    const s = this.G.s;
    const last = Math.min(Number(s.last) || this.clock.now, this.clock.now);
    let due = Math.floor(Math.max(0, this.clock.now - last) / TICK_MS);
    due = Math.min(due, MAX_TICKS_PER_ADVANCE);
    if (due > 0) {
      this.G.silent = false;
      this.G.runTicks(last, due);
      s.last = last + due * TICK_MS;
      this.G._lastTick = s.last;
    }
    this.G._simNow = this.clock.now;
    if (typeof this.G.advanceExplore === "function" && (s.explore || s.cq)) this.G.advanceExplore();
    if (typeof this.G.advanceTrib === "function" && s.trib) this.G.advanceTrib();
    // Preserve the partial 10-second interval; the server owns this timestamp.
    if (due < MAX_TICKS_PER_ADVANCE) s.last = this.clock.now - ((this.clock.now - last) % TICK_MS);
    this.G._simNow = this.clock.now;
    return { state: safeClone(s), logs: safeClone(this.logs), serverNow: this.clock.now, processedTicks: due, nextDue: this.nextDue(s) };
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
    const valid = times.filter(Number.isFinite);
    return valid.length ? Math.min(...valid) : this.clock.now + TICK_MS;
  }

  act(state, action, args = [], now = Date.now()) {
    const advanced = this.advance(state, now);
    const method = this.G[action];
    if (typeof method !== "function") throw new Error("未知操作");
    if (action.startsWith("_") || ["init", "start", "loop", "runTicks", "offline", "tickAll", "migrate", "newSave"].includes(action)) throw new Error("不允许调用该操作");
    this.seedRandom();
    this.G._simNow = this.clock.now;
    // 客户端显示储物格前会排序，按格子序号点的操作要用同样顺序（否则点「使用」会对到别的物品，没反应）
    if (typeof this.G.sortBag === "function" && Array.isArray(this.G.s.bag)) this.G.sortBag();
    this.battles = [];
    const result = method.apply(this.G, args);
    if (result && typeof result.then === "function") throw new Error("异步 UI 方法不能作为游戏操作调用");
    this.G.s.last = Math.max(Number(this.G.s.last) || 0, this.clock.now - ((this.clock.now - (Number(this.G.s.last) || this.clock.now)) % TICK_MS));
    const response = {
      state: safeClone(this.G.s),
      logs: safeClone(this.logs),
      serverNow: this.clock.now,
      result: result === undefined ? null : result,
      battles: this.battles,
      processedTicks: advanced.processedTicks,
    };
    return response;
  }
}

export const GAME_TICK_MS = TICK_MS;
