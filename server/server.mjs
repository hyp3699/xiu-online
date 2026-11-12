import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import os from "node:os";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import { GameEngine, ADVANCE_BUDGET_TICKS, CONFIG_OVERRIDE_DIR, configNames, configOverridden, readConfig, validConfigName, configHash } from "./game-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.XIU_HOST || "127.0.0.1";
const PORT = Number(process.env.XIU_PORT || 18301);
const DATA_DIR = path.resolve(process.env.XIU_DATA_DIR || path.join(HERE, "data"));
const DB_FILE = path.resolve(process.env.XIU_DB_PATH || path.join(DATA_DIR, "xiu-online.sqlite3"));
const WS_PATH = "/api/ws";
const MAX_HTTP_BODY = 64 * 1024;
const MAX_CONFIG_BODY = 1024 * 1024;
const MAX_WS_PAYLOAD = 16 * 1024;
const ACTIONS = new Set(JSON.parse(fs.readFileSync(path.join(HERE, "action-whitelist.json"), "utf8")));
const PBKDF2_ROUNDS = 240_000;
const validationEngine = new GameEngine();
for (const name of ACTIONS) if (typeof validationEngine.G[name] !== "function") throw new Error(`Missing whitelisted action: ${name}`);

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");   // WAL 下每次提交不再强制刷盘（断电最多丢最后几次提交，不会损坏数据库），写存档快很多
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS saves(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hist(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS hist_user ON hist(user_id, id);
  CREATE TABLE IF NOT EXISTS gifts(code TEXT PRIMARY KEY, payload TEXT NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS gift_uses(code TEXT NOT NULL REFERENCES gifts(code) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, used_at INTEGER NOT NULL, PRIMARY KEY(code,user_id));
`);
// 管理员的多个人物：每个人物是一个账号（users 行），owner_id = 主账号 id；主账号 owner_id 为空
{ const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes("owner_id")) db.exec("ALTER TABLE users ADD COLUMN owner_id INTEGER");
  if (!cols.includes("debug")) db.exec("ALTER TABLE users ADD COLUMN debug INTEGER NOT NULL DEFAULT 0"); }   // debug = 调试人物：始终是测试模式
const CHAR_MAX = 20;   // 每个管理员最多几个人物（含主账号）
const q = {
  byName: db.prepare("SELECT * FROM users WHERE username=?"),
  byId: db.prepare("SELECT * FROM users WHERE id=?"),
  token: db.prepare("SELECT user_id,expires_at FROM tokens WHERE token_hash=?"),
  save: db.prepare("SELECT data,revision,updated_at FROM saves WHERE user_id=?"),
  revision: db.prepare("SELECT revision FROM saves WHERE user_id=?"),
  saveUpsert: db.prepare(`INSERT INTO saves(user_id,data,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=saves.revision+1,updated_at=excluded.updated_at`),
};
const clients = new Map();
const tickets = new Map();
const receipts = new Map();   // 按账号记已处理的操作编号（原来按连接，重连后清空）
const engines = new Map();
const startedAt = Date.now();
const REPO_DIR = path.resolve(HERE, "..");
const UPDATE_LOG = path.join(DATA_DIR, "update.log");
const UPDATE_TRIGGER = path.join(DATA_DIR, "update.request");

function repoVersion() {
  return new Promise(resolve => execFile("git", ["-c", "safe.directory=*", "-C", REPO_DIR, "log", "-1", "--format=%h  %s  (%cd)", "--date=format:%Y-%m-%d %H:%M"], { timeout: 5000 },
    (err, stdout, stderr) => resolve(String(stdout || "").trim() || String(stderr || "").trim() || (err ? err.message : "未知"))));
}
function readUpdateLog() {
  try { return fs.readFileSync(UPDATE_LOG, "utf8").slice(-4000); } catch { return ""; }
}

// 引擎池：所有玩家共用引擎，按「管理员 / 调试人物」分最多 4 个，建好后一直保留（不管离线多久都不用重建）。
//   每位玩家拿到的是绑定了自己 id 的句柄，调用前先 use(id) 把引擎切到自己（服务器单线程，同一时刻只算一个人）。
const enginePool = new Map();
function poolEngine(admin, debug) {
  const key = (admin ? "a" : "") + (debug ? "d" : "");
  let e = enginePool.get(key);
  if (!e) { e = new GameEngine(); e.setAdmin(admin); e.setDebug(debug); enginePool.set(key, e); }   // 测试模式：管理员 + rates.TEST，或调试人物
  return e;
}
function engineHandle(userId, E) {
  return {
    pool: E,
    get G() { E.use(userId); return E.G; },
    get DATA() { E.use(userId); return E.DATA; },
    get CFG() { return E.CFG; },
    get logs() { return E.logs; },
    advance: (s, now, max) => E.use(userId).advance(s, now, max),
    act: (s, action, args, now) => E.use(userId).act(s, action, args, now),
    createState: (...a) => E.use(userId).createState(...a),
    bindState: (s, now) => E.use(userId).bindState(s, now),
    drop: () => E.drop(userId),
  };
}
function getEngine(userId) {
  let entry = engines.get(userId);
  if (!entry) {
    let u = {}; try { u = q.byId.get(userId) || {}; } catch (err) { console.error("load user flags failed", err); }
    entry = { engine: engineHandle(userId, poolEngine(!!u.is_admin, !!u.debug)), lastUsed: Date.now() }; engines.set(userId, entry);
  }
  entry.lastUsed = Date.now();
  return entry.engine;
}
// 预热：引擎第一次建要 1~2 秒，启动后 / 参数改动后先在后台把普通玩家和管理员两台建好，
// 免得第一个进游戏的人等它（调试人物的两台按需再建）
function warmEngines() {
  setTimeout(() => { for (const [a, d] of [[false, false], [true, false]]) { try { const t = Date.now(); poolEngine(a, d); console.log(`engine warm ${a ? "admin" : "player"} ${Date.now() - t}ms`); } catch (err) { console.error("engine warm failed", err?.message || err); } } }, 0);
}
// 结算慢时记一行日志（离线太久、探索 / 出窍中逐个结算等），方便查进游戏慢的原因
function timedAdvance(engine, state, now, tag, max) {
  const t = Date.now(), o = engine.advance(state, now, max), ms = Date.now() - t;
  if (ms >= 300) { const s = o.state || {}; console.log(`slow advance ${tag} ${ms}ms ticks=${o.processedTicks} explore=${!!s.explore} cq=${!!s.cq} trib=${!!s.trib}`); }
  return o;
}
function dropEngine(userId) { const e = engines.get(userId); if (e) { try { e.engine.drop(); } catch {} engines.delete(userId); } }

// 参数改动后：在线玩家立即换成用新参数加载的游戏引擎，并通知网页重新加载参数
function applyNewConfig() {
  engines.clear(); enginePool.clear();
  if (!clients.size) warmEngines();
  for (const [userId, client] of clients) {
    try { client.engine = getEngine(userId); } catch (err) { console.error("reload engine failed", err); }
    send(client.socket, { type: "config" });
  }
}
function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
  res.end(data);
}
function error(res, status, message) { return sendJson(res, status, { error: message }); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
// PBKDF2 放到线程池异步算（原来 pbkdf2Sync 每次阻塞主线程上百毫秒）；同时在算的最多 HASH_MAX 个，多了直接回繁忙
const HASH_MAX = 4; let hashBusy = 0;
class BusyError extends Error { constructor(m) { super(m); this.status = 503; } }
async function passwordHash(password, salt) {
  if (hashBusy >= HASH_MAX) throw new BusyError("服务器繁忙，请稍后再试");
  hashBusy++;
  try { return await new Promise((ok, bad) => crypto.pbkdf2(password, salt, PBKDF2_ROUNDS, 32, "sha256", (e, k) => e ? bad(e) : ok(k.toString("hex")))); }
  finally { hashBusy--; }
}
// 真实客户端 IP：反代（nginx）在本机时用它传来的 X-Real-IP，否则用连接地址
function clientIp(req) {
  const ra = req.socket.remoteAddress || "";
  if (/^(::1|127\.|::ffff:127\.)/.test(ra)) { const x = String(req.headers["x-real-ip"] || "").trim(); if (x && x.length < 64) return x; }
  return ra;
}
function equalHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
const TOKEN_DAYS = 7;   // 登录令牌有效期 7 天（原来 90 天）
function pruneLegacyTokens(userId) {
  // 吊销按旧 90 天规则签发的令牌：tokens 表没有签发时间列，但新令牌最长 7 天有效，
  // 所以 expires_at 比现在晚 7 天以上的必定是旧规则签发的；7 天内到期的旧令牌放行（反正几天内就过期）。
  // 多设备登录不受影响：按新规则签发的各设备令牌都在 7 天内，不会被删。
  db.prepare("DELETE FROM tokens WHERE user_id=? AND expires_at>?").run(userId, Date.now() + TOKEN_DAYS * 86400_000);
}
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,?)").run(hashToken(token), userId, Date.now() + TOKEN_DAYS * 86400_000);
  return token;
}
function userFor(req) {
  const token = String(req.headers["x-token"] || "");
  if (!token || token.length > 256) return null;
  const record = q.token.get(hashToken(token));
  if (!record || record.expires_at < Date.now()) return null;
  return q.byId.get(record.user_id) || null;
}
function getState(userId) {
  const row = q.save.get(userId);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { throw new Error("服务器存档损坏，请联系管理员"); }
}
// 全部信息（探索、出窍、历练、秘境记录 + 除实力测试外的战斗）：游戏模块把新记录放进 state.histQ，
//   这里取出存到 hist 表，每人只留最近 HIST_KEEP 条；histQ 不进存档、不推给客户端（客户端用 /api/hist 读取）
const HIST_KEEP = 20, HIST_MAX_BYTES = 512 * 1024;
const histIns = db.prepare("INSERT INTO hist(user_id,at,data) VALUES(?,?,?)");
const histTrim = db.prepare("DELETE FROM hist WHERE user_id=? AND id NOT IN (SELECT id FROM hist WHERE user_id=? ORDER BY id DESC LIMIT ?)");
const histSave = db.transaction((userId, list) => {
  for (const r of list) {
    let data = JSON.stringify(r);
    if (Buffer.byteLength(data) > HIST_MAX_BYTES) data = JSON.stringify({ ...r, ev: (r.ev || []).map(({ b, ...e }) => e) });   // 太大就去掉战斗回放
    histIns.run(userId, Number(r.at) || Date.now(), data);
  }
  histTrim.run(userId, userId, HIST_KEEP);
});
function drainHist(userId, state) {
  if (!state || typeof state !== "object") return;
  const list = [];
  if (Array.isArray(state.exHist)) list.push(...state.exHist.slice().reverse());   // 旧存档里的最近 10 次探索
  if (Array.isArray(state.histQ)) list.push(...state.histQ);
  if (!list.length || !userId) return;
  try { histSave(userId, list.filter(r => r && typeof r === "object")); } catch (err) { console.error("hist save failed:", err?.message || err); return; }
  // 只有落盘成功才删：原来先删后存，写失败时这批历史既不在状态里也不在 hist 表里
  delete state.exHist; delete state.histQ;
}
function persist(userId, state) {
  // 先落存档、再记历史：原来先 drainHist（历史立即入库）再 saveUpsert，存档恰好在
  // 这一步失败时，历史表里会多一条实际未生效动作的记录。历史字段不进存档，落盘前
  // 先从状态上摘下来、失败时原样装回去，成功后再 drainHist（它只在 histSave 成功后删）。
  const histQ = state.histQ, exHist = state.exHist;
  if (histQ !== undefined) delete state.histQ;
  if (exHist !== undefined) delete state.exHist;
  try {
    const data = JSON.stringify(state);
    if (Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error("角色数据超出安全大小限制");
    q.saveUpsert.run(userId, data, Date.now());
  } finally {
    if (histQ !== undefined) state.histQ = histQ;
    if (exHist !== undefined) state.exHist = exHist;
  }
  drainHist(userId, state);
}
// 参数保存前的语义校验：只看“能加载”不够（空文件、NaN、类型写错都能加载成功，
// 进游戏才炸）。拿改动前后的两份 CFG 做对比：
//   1. 改动前已有的每个字段，改动后必须还在（空文件、删键、数组缩短都会被拦）；
//   2. 改动前是数字的字段，改动后必须是有限数字（字符串 "86"、NaN、Infinity 都会被拦）；
//   3. 六个经验倍率必须 ≥ 0（负数会让经验静默归零）。
// 基线不用现建：池里的引擎就是按当前磁盘参数建的（改参数后 applyNewConfig 会清池重建），
// 构造后玩法代码不改 CFG（写 CFG 的只有浏览器端快捷保存，服务器引擎里不跑），所以现成
// 引擎的 CFG 就是干净基线；池里没引擎（没人在线）时才现建一份。校验只现建改动后的一份，
// 约 1 秒，和原来“先加载一遍”的成本一样，不会把事件循环堵上几秒。
function validateConfigChange(overrides) {
  let before = null;
  for (const e of enginePool.values()) { before = e.CFG; break; }
  if (!before) for (const c of clients.values()) { before = c.engine.CFG; break; }
  if (!before) before = new GameEngine().CFG;
  const after = new GameEngine(overrides).CFG;
  const problems = [];
  const seen = new Set();
  const walk = (b, a, p) => {
    if (b === null || b === undefined) return;
    if (typeof b === "number") {
      if (typeof a !== "number" || !Number.isFinite(a)) problems.push(`${p} 应为数字`);
      return;
    }
    if (typeof b !== "object") {
      if (typeof a !== typeof b) problems.push(`${p} 类型不对`);
      return;
    }
    if (a === null || typeof a !== "object") { problems.push(`${p} 缺失`); return; }
    if (seen.has(b)) return;   // 配置里若有共享引用，只查第一处；也防循环引用栈溢出
    seen.add(b);
    for (const k of Object.keys(b)) walk(b[k], a[k], p ? `${p}.${k}` : k);
  };
  walk(before, after, "");
  const C = after.craftsman || {};
  for (const k of ["DAN_EXP_MULT", "QI_EXP_MULT", "LING_EXP_MULT", "DAN_NEED_MULT", "QI_NEED_MULT", "LING_NEED_MULT"]) {
    const v = C[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) problems.push(`craftsman.${k} 应为 0 或以上的数字`);
  }
  if (problems.length) throw new Error("参数语义校验失败：" + problems.slice(0, 5).join("；"));
}
// 参数覆盖文件写盘：临时文件 + 改名（单文件原子），并显式设权限（目录已是 0o750，
// 原来文件权限依赖 umask）；chmod 失败只记日志，不让“已保存”变“保存失败”。
function writeConfigFile(name, content) {
  fs.mkdirSync(CONFIG_OVERRIDE_DIR, { recursive: true, mode: 0o750 });
  const tmp = path.join(CONFIG_OVERRIDE_DIR, `.${name}.${process.pid}.tmp`), dest = path.join(CONFIG_OVERRIDE_DIR, name);
  fs.writeFileSync(tmp, content); fs.renameSync(tmp, dest);
  try { fs.chmodSync(dest, 0o640); } catch (err) { console.error("config chmod failed:", err?.message || err); }
}
// 登录失败限流：同步 PBKDF2（24 万轮）每次都阻塞事件循环，HTTP 层无限流时可被用来拖垮
// 单线程。按 IP 和按（账号，IP）分别计：10 分钟内失败 10 次，封 15 分钟；成功登录清掉
// （账号，IP）计数。只按账号锁会被人用来锁别人的号（知道用户名连发 10 次错密码），
// 所以账号锁必须绑定 IP：同一账号从同一 IP 连续失败才锁该组合；换 IP 撞库仍会被按 IP 的计数拦住。
const loginFails = new Map();
function loginBlocked(key) {
  const r = loginFails.get(key);
  if (!r) return false;
  if (r.until && Date.now() < r.until) return true;
  if (Date.now() - r.first > 10 * 60_000) { loginFails.delete(key); return false; }
  return false;
}
function loginFail(key) {
  const now = Date.now(), r = loginFails.get(key);
  if (!r || now - r.first > 10 * 60_000) { loginFails.set(key, { n: 1, first: now, until: 0 }); return; }
  r.n++;
  if (r.n >= 10) r.until = now + 15 * 60_000;
}
const regHits = new Map();
function regHit(key) {
  const now = Date.now(), r = regHits.get(key);
  if (!r || now - r.first > 60 * 60_000) { regHits.set(key, { n: 1, first: now }); return false; }
  return ++r.n > 5;
}
// 登录+注册全局限流（内存滑动窗口）：单靠按 IP / 按（账号，IP）限流挡不住轮换 IP/用户名
// 打满哈希槽（HASH_MAX=4）。登录和注册合计每分钟最多 120 次，超了直接 429，不占哈希槽；
// 注册另有全局每小时 60 次。正常玩家和现有测试的登录次数远低于这个量，不会被误拦。
const AUTH_MIN_LIMIT = 120, AUTH_MIN_MS = 60_000, REG_HOUR_LIMIT = 60, REG_HOUR_MS = 3600_000;
const authAttempts = [], regGlobalAttempts = [];
function rateLimited(list, limit, windowMs) {
  const now = Date.now();
  while (list.length && now - list[0] > windowMs) list.shift();
  if (list.length >= limit) return true;
  list.push(now); return false;
}
// 礼包物品校验（建礼包码、传音群发共用）。原来只校验数量：类别写错、必需字段缺失的礼包也能建，兑换时才进“遗失”分支
const GIFT_CATS = new Set(["stone", "contrib", "merit", "yl", "gf", "sp", "mf", "fabao", "eq", "herb", "ore", "lj", "lz", "hx", "bm", "st", "tc", "dan", "bp"]);
function giftItemError(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return ("礼包物品格式无效");
  if (!GIFT_CATS.has(item.c)) return (`礼包物品类别无效：${String(item.c)}`);
  const count = Number(item.n || 1);
  const cap = ["stone", "contrib", "merit", "yl"].includes(item.c) ? 10_000_000_000 : ["eq", "fabao", "bp"].includes(item.c) ? 100 : 1_000_000;   // 灵石 / 贡献 / 功德 / 愿力最多 100 亿（用户定 2026-11-12）
  if (!Number.isFinite(count) || count < 1 || count > cap) return (`礼包物品数量超过限制（最多 ${cap}）`);
  if ((item.c === "dan" || item.c === "bp") && !String(item.item || "").includes(":")) return ("礼包丹药/图纸缺少 item");
  if (item.c === "eq" && typeof item.slot !== "string") return ("礼包装备缺少 slot");
  if ((item.c === "eq" || item.c === "fabao") && !(Number.isInteger(item.g) && item.g >= 0 && item.g <= 11)) return ("礼包装备/法宝星级需为 0–11（一~十二星）");
  if (item.c === "gf" && (typeof item.src !== "string" || typeof item.type !== "string")) return ("礼包功法缺少 src/type");
  if (item.c === "sp" && typeof item.src !== "string") return ("礼包法术缺少 src");
  if (item.c === "mf" && (typeof item.star !== "number" || typeof item.kind !== "string")) return ("礼包秘法缺少 star/kind");
  if ((item.c === "herb" || item.c === "ore") && (!Number.isInteger(item.g) || item.g < 0)) return ("礼包材料缺少合法 g");
  if ((item.c === "lj" || item.c === "lz") && !Number.isFinite(item.ft)) return ("礼包灵晶/灵珠缺少 ft");
  if (item.c === "tc" && (typeof item.name !== "string" || !item.name || item.name.length > 32 || /[<>&"'`]/.test(item.name))) return ("礼包特产名称无效（不能含 < > & 引号）");
  if (item.c === "st" && typeof item.id !== "string") return ("礼包神通缺少 id");
  return null;
}
function registrationOpen() {
  const value = db.prepare("SELECT value FROM settings WHERE key='registration_open'").get()?.value;
  return value === undefined || value === "true";
}
async function readBody(req, limit = MAX_HTTP_BODY) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求 JSON 格式错误"), { status: 400 }); }
}
function validUsername(raw) {
  const username = String(raw || "").trim();
  if (username.length < 2 || username.length > 20 || !/^[\p{L}\p{N}_-]+$/u.test(username)) throw new Error("账号需为 2–20 个字母、数字、中文、下划线或连字符");
  return username;
}
// 服务端统一兜底：所有 WebSocket 操作参数里的数字必须是整数。
// 负数一律拒绝，只放行确实用 -1 当哨兵的操作：
//   bsetMove(dir=-1 上移)、jmSwap(n=-1 全部)。
//   灵矿已删除，出窍的 r=-1 不再是合法哨兵，不再放行。
// 其它 -1 以外、以及 -999 这类负数，仍会被挡下；小数、非整数同样被挡下，
// 这样 sellItem(i, -999)、buyLingshi(0.5) 在进引擎前就失败，状态用的是出错前的工作副本，
// 不会落盘。sellItem(i, 1e12) 是整数、能过这一层，靠 sellItem 内部按格 clamp 挡下。
// 数量上限仍保留原来的 1e12，
// 因为 cultSetSave 的灵石阈值这类设置本身就可能超过 1e9，真正防超卖靠下面各函数的按格 clamp。
const NEGATIVE_ONE_ACTIONS = new Set(["bsetMove", "jmSwap"]);
function validateValue(value, depth = 0, action = "") {
  if (depth > 5) throw new Error("操作参数层级过深");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 2048) throw new Error("操作参数过长");
    // 长得像数字的字符串（"1e21"、"-5"、"Infinity"）按数字同样校验：引擎里大量 Math.floor(+n)，字符串会绕过下面的数字检查
    const t = value.trim();
    if (t && /^[-+]?(\d|\.\d|Infinity)/.test(t) && !Number.isNaN(Number(t))) return validateValue(Number(t), depth, action);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || Math.abs(value) > 1e12) throw new Error("操作参数无效");
    // 逐件循环类操作的数量参数第二道防线：buy(i,n)/bmFuse(j,n) 的 n 在引擎里还会 clamp（buy ≤1000、bmFuse ≤持有量），
    // 但这里先拦住超大数，避免单条请求在引擎里逐件循环卡死事件循环；其它操作（如 cultSetSave 的阈值）不受影响。
    if ((action === "buy" || action === "bmFuse") && value > 1000) throw new Error("操作参数无效");
    if (value < 0 && !(value === -1 && NEGATIVE_ONE_ACTIONS.has(action))) throw new Error("操作参数无效");
    return;
  }
  if (Array.isArray(value)) { if (value.length > 100) throw new Error("操作参数数组过长"); return value.forEach(x => validateValue(x, depth + 1, action)); }
  if (typeof value === "object") {
    const pairs = Object.entries(value); if (pairs.length > 50) throw new Error("操作参数对象过大");
    for (const [key, child] of pairs) { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("操作参数字段无效"); validateValue(child, depth + 1, action); }
    return;
  }
  throw new Error("操作参数类型无效");
}
// 注意：无显式白名单时信任 X-Forwarded-Host，前提是反代会剥离客户端自带的该头；
// 即使绕过 Origin 检查也建不了连接——WS 仍需已认证才发的 ticket，这里只是多一层门。
function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const explicit = (process.env.XIU_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (explicit.length) return explicit.includes(parsed.origin);
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    return parsed.host === host;
  } catch { return false; }
}
function createWsTicket(userId) {
  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
  return ticket;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const route = url.pathname;
  try {
    if (restoring) return error(res, 503, "服务器正在恢复存档并重启，请稍候刷新");
    if (req.method === "GET" && route === "/health") return sendJson(res, 200, { ok: true, service: "xiu-online", uptime: Math.floor((Date.now() - startedAt) / 1000) });
    // 游戏线路（不用登录）：管理员在「服务器信息」里设置；安卓客户端缓存下来，换地址不用重新打包
    if (req.method === "GET" && route === "/api/lines") return sendJson(res, 200, linesInfo());
    // 跨域换线：目标线路用源线路发的 30 秒一次性 ws-ticket 换登录令牌（前端 goLine/redeemLineTicket）。
    // ticket 本身就是凭证，不用再带登录令牌；一次消费、过期作废；换到的令牌按正常 7 天规则签发。
    // 注意：ticket 只存在发券进程的内存 Map 里——目标线路若是另一台独立后端进程，发券方和核销方
    // 认不到同一张票，换线会落到登录页；同进程/同后端的不同域名线路不受影响。
    if (req.method === "POST" && route === "/api/line-redeem") {
      const body = await readBody(req), ticket = String(body.ticket || "");
      const session = ticket ? tickets.get(ticket) : null;
      if (ticket) tickets.delete(ticket);
      if (!session || session.expiresAt < Date.now()) return error(res, 401, "换线凭证无效或已过期，请重新登录");
      const target = q.byId.get(session.userId);
      if (!target) return error(res, 401, "换线凭证无效或已过期，请重新登录");
      return sendJson(res, 200, { user: target.username, token: issueToken(target.id) });
    }
    if (req.method === "POST" && route === "/api/register") {
      const body = await readBody(req);
      if (rateLimited(authAttempts, AUTH_MIN_LIMIT, AUTH_MIN_MS)) return error(res, 429, "登录/注册太频繁，请稍后再试");
      if (rateLimited(regGlobalAttempts, REG_HOUR_LIMIT, REG_HOUR_MS)) return error(res, 429, "注册太频繁，请 1 小时后再试");
      if (!registrationOpen()) return error(res, 403, "暂未开放注册");
      const username = validUsername(body.username), password = String(body.password || "");
      if (password.length < 6 || password.length > 128) return error(res, 400, "密码长度需为 6–128 位");
      if (q.byName.get(username)) return error(res, 409, "账号已存在");
      const rip = "reg:" + clientIp(req);   // 注册限流：同一 IP 1 小时最多 5 次
      if (regHit(rip)) return error(res, 429, "注册太频繁，请 1 小时后再试");
      const salt = crypto.randomBytes(16).toString("hex");
      const isAdmin = db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0 ? 1 : 0;
      const result = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)").run(username, salt, await passwordHash(password, salt), isAdmin, Date.now());
      return sendJson(res, 201, { token: issueToken(Number(result.lastInsertRowid)), admin: !!isAdmin });
    }
    if (req.method === "POST" && route === "/api/login") {
      const body = await readBody(req), ip = clientIp(req);
      if (rateLimited(authAttempts, AUTH_MIN_LIMIT, AUTH_MIN_MS)) return error(res, 429, "登录/注册太频繁，请稍后再试");
      let username;
      try { username = validUsername(body.username); } catch { loginFail("ip:" + ip); return error(res, 401, "账号或密码错误"); }
      if (loginBlocked("ip:" + ip) || loginBlocked("ua:" + username + "@" + ip)) return error(res, 429, "登录失败次数过多，请 15 分钟后再试");
      const user = q.byName.get(username), password = String(body.password || "");
      const candidate = await passwordHash(password, user?.salt || "00000000000000000000000000000000");
      if (!user || !equalHex(candidate, user.password_hash)) { loginFail("ip:" + ip); loginFail("ua:" + username + "@" + ip); return error(res, 401, "账号或密码错误"); }
      loginFails.delete("ua:" + username + "@" + ip);
      pruneLegacyTokens(user.id);   // 吊销按旧 90 天规则签发的令牌（见 pruneLegacyTokens）
      return sendJson(res, 200, { token: issueToken(user.id), admin: !!user.is_admin });
    }
    if (req.method === "POST" && route === "/api/logout") {
      const token = String(req.headers["x-token"] || "");
      if (!userFor(req)) return error(res, 401, "登录已过期");
      db.prepare("DELETE FROM tokens WHERE token_hash=?").run(hashToken(token));
      return sendJson(res, 200, { ok: true });
    }

    // 游戏参数脚本（浏览器和服务器用同一份；管理员改过的优先）。
    // config-loader.js 每次都不缓存，按内容哈希写出参数包的地址：参数一改地址就变，
    // 不会被浏览器 / Cloudflare 缓存住旧参数；地址带对哈希的包可以长期缓存。
    // 以前是 35 个参数文件各一个 document.write 脚本、串行加载；现在合成一个包，
    // 顺序和原来 configNames() 的顺序完全一致，内容用 "\n;\n" 隔开（防上一文件末尾
    // 没分号和下一文件首句连在一起），进游戏少 34 个请求。
    const configBundle = () => {
      const code = configNames().map(name => readConfig(name)).join("\n;\n");
      return { code, hash: configHash(code) };
    };
    if (req.method === "GET" && route === "/api/config-loader.js") {
      const { hash } = configBundle();
      const data = Buffer.from(`(function(){document.write('<script src="api/config-bundle.js?h=${hash}"><\\/script>');})();\n`);
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(data);
    }
    if (req.method === "GET" && route === "/api/config-bundle.js") {
      const { code, hash } = configBundle();
      const data = Buffer.from(code);
      const cache = url.searchParams.get("h") === hash ? "public, max-age=31536000, immutable" : "no-store";
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Content-Length": data.length, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
      return res.end(data);
    }
    const cfgRoute = route.match(/^\/api\/config\/([^/]+)$/);
    if (req.method === "GET" && cfgRoute) {
      let code;
      try { code = readConfig(cfgRoute[1]); } catch { res.writeHead(404); return res.end(); }
      const data = Buffer.from(code), hash = configHash(code);
      const cache = url.searchParams.get("h") === hash ? "public, max-age=31536000, immutable" : "no-store";
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Content-Length": data.length, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
      return res.end(data);
    }

    const user = userFor(req);
    if (!user) return error(res, 401, "登录已过期，请重新登录");
    if (req.method === "GET" && route === "/api/session") {
      // 在线玩家优先用内存里的最新状态（同 /api/gift）：直接读数据库会拿到
      // 上次落盘的旧存档，结算并覆盖后最近一段时间的进度就回档了。
      // 刷新 / 重连时旧 WebSocket 往往还没断开，这个分支正好命中。
      const on = clients.get(user.id);
      let data;
      if (on) {
        // 单次最多补 10 天：剩下的由 WS 定时结算继续补（advance 截断时 s.last 不跳到现在）
        const advanced = on.engine.advance(on.state, Date.now(), ADVANCE_BUDGET_TICKS);
        on.state = advanced.state; on.nextCheck = Math.min(Date.now() + CHECK_MS, Math.max(Date.now() + 50, (advanced.nextDue || 0) + DUE_MARGIN_MS));
        data = on.state; persist(user.id, data);
      } else {
        data = getState(user.id);
        if (data) { data = timedAdvance(getEngine(user.id), data, Date.now(), `session u${user.id}`, ADVANCE_BUDGET_TICKS).state; persist(user.id, data); }
      }
      return sendJson(res, 200, { data, serverNow: Date.now(), actions: [...ACTIONS], admin: !!user.is_admin, debug: !!user.debug });
    }
    if (req.method === "GET" && route === "/api/hist") {
      const rows = db.prepare("SELECT id,at,data FROM hist WHERE user_id=? ORDER BY id DESC LIMIT ?").all(user.id, HIST_KEEP);
      // 列表只带文字，战斗回放（ev[].b）换成 1，点「详情」再用 /api/hist-battle 单独读，列表读取快很多
      return sendJson(res, 200, { list: rows.map(r => { try { const d = JSON.parse(r.data); return { ...d, ev: (d.ev || []).map(e => e && e.b ? { ...e, b: 1 } : e), id: r.id, at: r.at }; } catch { return { id: r.id, at: r.at, title: "（记录损坏）", ev: [] }; } }) });
    }
    if (req.method === "GET" && route === "/api/hist-battle") {
      const row = db.prepare("SELECT data FROM hist WHERE user_id=? AND id=?").get(user.id, Number(url.searchParams.get("id")) || 0);
      let b = null; try { b = row && (JSON.parse(row.data).ev || [])[Number(url.searchParams.get("i")) || 0]?.b || null; } catch {}
      return b ? sendJson(res, 200, { b }) : error(res, 404, "这条战斗记录已经没有了");
    }
    if (req.method === "POST" && route === "/api/character") {
      const body = await readBody(req);
      if (q.save.get(user.id)) return error(res, 409, "角色已经创建");
      const name = [...String(body.name || "无名散修").trim().replace(/[^\p{L}\p{N}_·-]/gu, "")].slice(0, 12).join("") || "无名散修";
      const data = getEngine(user.id).createState(name, Date.now(), Array.isArray(body.ori) ? body.ori.slice(0, 20).map(String) : []); persist(user.id, data);
      return sendJson(res, 201, { data, serverNow: Date.now() });
    }
    if (req.method === "POST" && route === "/api/character/reset") {
      await readBody(req);
      db.prepare("DELETE FROM saves WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM hist WHERE user_id=?").run(user.id);
      const online = clients.get(user.id);
      if (online) { clients.delete(user.id); online.socket.close(4004, "角色已重置"); }
      dropEngine(user.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/ws-ticket") {
      await readBody(req);
      return sendJson(res, 200, { ticket: createWsTicket(user.id), expiresIn: 30 });
    }
    if (req.method === "POST" && route === "/api/password") {
      const body = await readBody(req), oldPw = String(body.old || ""), newPw = String(body.new || "");
      if (newPw.length < 6 || newPw.length > 128) return error(res, 400, "新密码长度需为 6–128 位");
      if (!equalHex(await passwordHash(oldPw, user.salt), user.password_hash)) return error(res, 403, "旧密码不正确");
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?").run(salt, await passwordHash(newPw, salt), user.id);
      db.prepare("DELETE FROM tokens WHERE user_id=?").run(user.id);   // 改密码即吊销全部登录令牌（含当前设备，需重新登录），与界面文案一致
      for (const [t, s] of tickets) if (s.userId === user.id) tickets.delete(t);   // 未用的 ws-ticket 也作废：否则 30 秒内凭旧 ticket 仍能建连接，等于没踢掉
      // 只删令牌不够：已建立的 WS 连接不再校验令牌，不关掉就还能继续游戏
      const online = clients.get(user.id);
      if (online) { try { persist(user.id, online.state); } catch {} clients.delete(user.id); online.socket.close(4003, "密码已修改，请重新登录"); }
      dropEngine(user.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/save") return error(res, 410, "客户端存档上传已停用；状态由服务器结算和保存");

    if (req.method === "GET" && route === "/api/admin") {
      if (!user.is_admin) return sendJson(res, 200, { admin: false });
      return sendJson(res, 200, { admin: true, service: "xiu-online", version: await repoVersion(), log: readUpdateLog(), registrationOpen: registrationOpen(), startedAt });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/server") return sendJson(res, 200, await serverInfo());
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gh") {
      const body = await readBody(req);
      const repo = normRepo(body.repo);
      if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return error(res, 400, "仓库格式：用户名/仓库名");
      const iv = Number(body.interval);
      if (!GH_INTERVALS.includes(iv)) return error(res, 400, "上传间隔无效");
      setSetting("gh_repo", repo || null); setSetting("gh_interval", iv);
      if (body.clearToken) setSetting("gh_token", null);
      else if (typeof body.token === "string" && body.token.trim()) {
        const token = body.token.trim();
        if (token.length > 255 || /\s/.test(token)) return error(res, 400, "令牌格式不对");
        setSetting("gh_token", token);
      }
      return sendJson(res, 200, { ok: true, info: await serverInfo() });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/lines") {
      const body = await readBody(req), list = Array.isArray(body.lines) ? body.lines : [];
      if (list.length > 20) return error(res, 400, "线路最多 20 条");
      const lines = [];
      for (const x of list) {
        const name = String(x && x.name || "").trim().slice(0, 20);
        let u = String(x && x.url || "").trim();
        if (!/^https?:\/\/[^\s"'<>`#]+$/i.test(u) || u.length > 300) return error(res, 400, `地址格式不对：${u.slice(0, 60)}`);
        if (!u.endsWith("/")) u += "/";
        if (!lines.some(l => l.url === u)) lines.push({ name: name || `线路${lines.length + 1}`, url: u });
      }
      let def = String(body.def || "").trim(); if (def && !def.endsWith("/")) def += "/";
      if (def && !lines.some(l => l.url === def)) def = "";
      setSetting("lines", lines.length ? JSON.stringify(lines) : null);
      setSetting("lines_def", def || null);
      return sendJson(res, 200, linesInfo());
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gh/restore") {
      const body = await readBody(req);
      const info = await ghRestore(body.repo, body.token);
      return sendJson(res, 200, { ok: true, ...info });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gh/upload") {
      await readBody(req);
      const last = await ghUpload(true);
      return sendJson(res, 200, { ok: true, last, info: await serverInfo() });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/reg") {
      const body = await readBody(req);
      db.prepare("INSERT INTO settings(key,value) VALUES('registration_open',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body.open ? "true" : "false");
      return sendJson(res, 200, { ok: true, open: registrationOpen(), reg_open: registrationOpen() });
    }
    // ---- 管理员多人物：创建 / 切换 / 删除。没切过去的人物照常结算（下次进入时按离线补算） ----
    if (user.is_admin && req.method === "GET" && route === "/api/admin/chars") {
      const root = user.owner_id || user.id;
      const rows = db.prepare("SELECT u.id,u.username,u.owner_id,u.debug,u.created_at,s.updated_at,json_extract(s.data,'$.name') AS name FROM users u LEFT JOIN saves s ON s.user_id=u.id WHERE u.id=? OR u.owner_id=? ORDER BY u.id").all(root, root);
      return sendJson(res, 200, { cur: user.id, max: CHAR_MAX, list: rows.map(r => ({ id: r.id, main: !r.owner_id, debug: !!r.debug, name: r.name || "", created: Math.floor(r.created_at / 1000), updated: r.updated_at ? Math.floor(r.updated_at / 1000) : 0 })) });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/char/new") {
      const body = await readBody(req), debug = body.debug ? 1 : 0;
      const root = q.byId.get(user.owner_id || user.id); if (!root) return error(res, 400, "主账号不存在");
      const n = db.prepare("SELECT COUNT(*) n FROM users WHERE id=? OR owner_id=?").get(root.id, root.id).n;
      if (n >= CHAR_MAX) return error(res, 400, `最多 ${CHAR_MAX} 个人物`);
      let k = n + 1, name; while (q.byName.get(name = `${root.username}#${k}`)) k++;
      const salt = crypto.randomBytes(16).toString("hex");   // 小号不能用密码登录，只能从管理员切换过去
      const r = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at,owner_id,debug) VALUES(?,?,?,1,?,?,?)").run(name, salt, await passwordHash(crypto.randomBytes(24).toString("hex"), salt), Date.now(), root.id, debug);
      return sendJson(res, 201, { id: Number(r.lastInsertRowid) });
    }
    if (user.is_admin && req.method === "POST" && (route === "/api/admin/char/switch" || route === "/api/admin/char/del")) {
      const body = await readBody(req), id = Number(body.id), root = user.owner_id || user.id, t = Number.isSafeInteger(id) ? q.byId.get(id) : null;
      if (!t || (t.id !== root && t.owner_id !== root)) return error(res, 400, "没有这个人物");
      if (route.endsWith("/switch")) { pruneLegacyTokens(t.id); return sendJson(res, 200, { token: issueToken(t.id), username: t.username, admin: !!t.is_admin }); }
      if (!t.owner_id || t.id === user.id) return error(res, 400, "不能删除主账号或当前人物");
      db.prepare("DELETE FROM users WHERE id=?").run(t.id); dropEngine(t.id);
      const online = clients.get(t.id); if (online) { clients.delete(t.id); online.socket.close(4003, "人物已删除"); }
      return sendJson(res, 200, { ok: true });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/users") {
      const rows = db.prepare("SELECT u.id,u.username,u.is_admin,u.created_at,s.updated_at FROM users u LEFT JOIN saves s ON s.user_id=u.id WHERE u.owner_id IS NULL ORDER BY u.id").all();
      const list = rows.map(row => ({ id: row.id, username: row.username, admin: !!row.is_admin, created: Math.floor(row.created_at / 1000), updated: row.updated_at ? Math.floor(row.updated_at / 1000) : 0 }));
      return sendJson(res, 200, { list, reg_open: registrationOpen() });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/user/del") {
      const body = await readBody(req), id = Number(body.id);
      if (!Number.isSafeInteger(id) || id === user.id) return error(res, 400, "不能删除该账号");
      // 主号连同小号一起删：原来只删一行，小号行本身留下成孤儿——仍是管理员、能继续
      // 游戏，却永远无法新建人物，管理员界面也看不到（存档、令牌、历史靠外键级联清掉）
      const subs = db.prepare("SELECT id FROM users WHERE owner_id=?").all(id);
      db.transaction(() => {
        for (const s of subs) db.prepare("DELETE FROM users WHERE id=?").run(s.id);
        db.prepare("DELETE FROM users WHERE id=?").run(id);
      })();
      for (const s of subs) { dropEngine(s.id); const on = clients.get(s.id); if (on) { clients.delete(s.id); on.socket.close(4003, "账号已删除"); } }
      dropEngine(id);
      const online = clients.get(id); if (online) { clients.delete(id); online.socket.close(4003, "账号已删除"); }
      return sendJson(res, 200, { ok: true });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/user/rename") {
      // 管理员可改任何主账号的账号名（包括其他管理员和自己）：只改 users.username，密码、存档、
      // 令牌都按 user_id 挂着，所以改名不影响登录状态和存档，下次登录用新名。
      // 小号不能直接改：小号名是「主号名#序号」，直接改掉会永久破坏主号改名时小号跟随
      // 前缀的不变量（且 # 不在合法用户名字符里，改不回去），改主号名时会连同小号一起改。
      const body = await readBody(req), id = Number(body.id);
      let name; try { name = validUsername(body.username); } catch (e) { return error(res, 400, e.message); }
      if (!Number.isSafeInteger(id)) return error(res, 400, "没有这个账号");
      const t = q.byId.get(id); if (!t) return error(res, 400, "没有这个账号");
      if (t.owner_id) return error(res, 400, "小号不能直接改名，改主号名时会连同小号一起改");
      if (name === t.username) return sendJson(res, 200, { ok: true, username: name, renamed: 0 });
      // 主号改名时，它的小号（名字是「主号名#序号」）跟着换前缀，保持命名一致；小号先改，
      // 主号后改，这样主号的新名即使撞上某个小号的旧名也不会触发唯一约束。
      const subs = t.owner_id ? [] : db.prepare("SELECT id,username FROM users WHERE owner_id=?").all(t.id);
      const renames = subs.filter(s => s.username.startsWith(t.username + "#"))
        .map(s => ({ id: s.id, name: name + s.username.slice(t.username.length) }));
      renames.push({ id: t.id, name });
      for (const r of renames) {
        const clash = q.byName.get(r.name);
        if (clash && !renames.some(x => x.id === clash.id)) return error(res, 409, "账号已存在");
      }
      db.transaction(() => { for (const r of renames) db.prepare("UPDATE users SET username=? WHERE id=?").run(r.name, r.id); })();
      return sendJson(res, 200, { ok: true, username: name, renamed: renames.length });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/gifts") {
      const rows = db.prepare("SELECT code,payload,max_uses,used_count FROM gifts ORDER BY created_at DESC").all();
      const list = rows.map(row => ({ code: row.code, items: JSON.parse(row.payload).items || [], uses: row.max_uses, used: row.used_count }));
      return sendJson(res, 200, { list });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift") {
      const body = await readBody(req), code = String(body.code || crypto.randomBytes(8).toString("hex").toUpperCase()).trim().slice(0, 64);
      const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.payload?.items) ? body.payload.items : []);
      if (!items.length || items.length > 100) return error(res, 400, "礼包物品数量需为 1–100 件");
      if (db.prepare("SELECT 1 FROM gifts WHERE code=?").get(code)) return error(res, 400, "礼包码已存在");
      for (const item of items) { const bad = giftItemError(item); if (bad) return error(res, 400, bad); }
      const payload = { items };
      const maxUses = Math.max(1, Math.min(100_000, Number(body.uses || body.max_uses || 1)));
      const expiresAt = body.expires_at ? Number(body.expires_at) : null;
      db.prepare("INSERT INTO gifts(code,payload,max_uses,expires_at,created_at) VALUES(?,?,?,?,?)").run(code, JSON.stringify(payload), maxUses, expiresAt, Date.now());
      return sendJson(res, 201, { ok: true, code });
    }
    // 管理员：礼包物品直接传音发送给全部玩家（进传音，10 天未领清除）
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift/mail") {
      const body = await readBody(req), items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 100) return error(res, 400, "礼包物品数量需为 1–100 件");
      for (const item of items) { const bad = giftItemError(item); if (bad) return error(res, 400, bad); }   // 原来几乎不校验，一次能发全服 1e12 灵石
      let n = 0;
      for (const { user_id: uid } of offlineIds.all()) {
        try {
          const on = clients.get(uid), state = on ? structuredClone(on.state) : getState(uid);
          if (!state) continue;
          const eng = getEngine(uid); eng.bindState(state, Date.now());
          const got = [];
          for (const item of items) if (eng.G.giftMailGive(item)) got.push(eng.G.giftLabel(item));
          if (!got.length) continue;
          eng.G.log(`收到传音：${got.join("、")}。`, "gold");
          const st = eng.G.s; persist(uid, st); n++;
          const online = clients.get(uid); if (online) { online.state = structuredClone(st); pushState(online, Date.now(), [], true, true); }
        } catch (e) { console.error("gift mail", uid, e); }
      }
      return sendJson(res, 200, { ok: true, n });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift/del") {
      const body = await readBody(req); db.prepare("DELETE FROM gifts WHERE code=?").run(String(body.code || ""));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/gift") {
      const body = await readBody(req), code = String(body.code || "").trim();
      const redeem = db.transaction(() => {
        const gift = db.prepare("SELECT * FROM gifts WHERE code=?").get(code), on0 = clients.get(user.id);
        let state = on0 ? structuredClone(on0.state) : getState(user.id);   // 在线就用内存里的最新进度
        if (!gift || !state || (gift.expires_at && gift.expires_at < Date.now()) || gift.used_count >= gift.max_uses) return false;
        if (db.prepare("SELECT 1 FROM gift_uses WHERE code=? AND user_id=?").get(code, user.id)) return false;
        const items = JSON.parse(gift.payload).items || [], playerEngine = getEngine(user.id);
        // 在线时也先结算到现在：原来直接用内存状态发奖，内存状态落后时按旧状态结算；
        // 与 /api/session 一致，单次最多补 10 天，剩下的由定时结算继续补。
        state = timedAdvance(playerEngine, state, Date.now(), `gift u${user.id}`, ADVANCE_BUDGET_TICKS).state;
        playerEngine.bindState(state, Date.now());
        const got = [], lost = [];
        for (const item of items) (playerEngine.G.giftGive(item) ? got : lost).push(playerEngine.G.giftLabel(item));
        const updatedState = playerEngine.G.s;
        playerEngine.G.log(`礼包码兑换成功，获得 ${got.join("、") || "无"}${lost.length ? `（背包已满，遗失 ${lost.join("、")}）` : ""}。`, "gold");
        persist(user.id, updatedState);
        db.prepare("INSERT INTO gift_uses(code,user_id,used_at) VALUES(?,?,?)").run(code, user.id, Date.now());
        db.prepare("UPDATE gifts SET used_count=used_count+1 WHERE code=?").run(code);
        return { items, got, lost, state: updatedState };
      });
      const result = redeem();
      // 内存状态和推送移到事务提交之后：原来 pushState 在事务回调里，pushState 抛错会回滚事务、
      // 但内存状态已换、客户端已收到，之后定时落盘会把“未记 gift_uses”的状态写回去，留下重复兑换的口子。
      if (result) {
        const online = clients.get(user.id);
        if (online) { online.state = structuredClone(result.state); pushState(online, Date.now(), [], true, true); }
        return sendJson(res, 200, { ok: true, ...result, serverNow: Date.now() });
      }
      return error(res, 400, "礼包码无效、已过期、已用完或已经兑换");
    }
    // 管理员：数据修改（web/js/config 参数）
    if (user.is_admin && req.method === "GET" && route === "/api/admin/config") {
      return sendJson(res, 200, { list: configNames().map(name => ({ name, overridden: configOverridden(name) })) });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/config/file") {
      const name = validConfigName(url.searchParams.get("name"));
      return sendJson(res, 200, { name, content: readConfig(name), overridden: configOverridden(name) });
    }
    if (user.is_admin && req.method === "POST" && (route === "/api/admin/config/save" || route === "/api/admin/config/reset")) {
      const body = await readBody(req, MAX_CONFIG_BODY), name = validConfigName(body.name), reset = route.endsWith("/reset");
      const content = reset ? null : String(body.content ?? "");
      if (!reset) {
        // 先校验再保存：加载 + 语义对比，任何一项不过都不写盘、不广播
        try { validateConfigChange({ [name]: content }); }
        catch (err) { return error(res, 400, `参数有错误，未保存：${String(err && err.message || err).slice(0, 300)}`); }
        writeConfigFile(name, content);
      } else fs.rmSync(path.join(CONFIG_OVERRIDE_DIR, name), { force: true });
      applyNewConfig();
      return sendJson(res, 200, { ok: true, name, overridden: configOverridden(name), online: clients.size });
    }
    // 快捷修改一次保存多个文件：原来先存 rates.js 再存 realm.js，每步都立即广播全服重载，
    // 第二步失败时第一步已生效，成了“地图收益已改、突破属性未改”的半生效状态
    if (user.is_admin && req.method === "POST" && route === "/api/admin/config/save-multi") {
      const body = await readBody(req, MAX_CONFIG_BODY), files = Array.isArray(body.files) ? body.files : [];
      if (!files.length || files.length > 10) return error(res, 400, "一次最多保存 10 个参数文件");
      const overrides = {}, names = [];
      for (const f of files) {
        const name = validConfigName(f && f.name);
        if (names.includes(name)) return error(res, 400, "参数文件重复");
        if (typeof f.content !== "string" || Buffer.byteLength(f.content) > MAX_CONFIG_BODY) return error(res, 400, "参数内容无效");
        overrides[name] = f.content; names.push(name);
      }
      try { validateConfigChange(overrides); }
      catch (err) { return error(res, 400, `参数有错误，未保存：${String(err && err.message || err).slice(0, 300)}`); }
      for (const name of names) writeConfigFile(name, overrides[name]);
      applyNewConfig();
      return sendJson(res, 200, { ok: true, names, online: clients.size });
    }
    if (req.method === "POST" && route === "/api/admin/update") {
      await readBody(req);
      if (!user.is_admin) return error(res, 403, "只有管理员可以更新");
      // 写一个请求文件，由 root 的 xiu-online-web-update.path 监听并执行 xiu-online-update（Node 服务本身不提权）
      try { fs.rmSync(UPDATE_LOG, { force: true }); fs.writeFileSync(UPDATE_LOG, `>>> 已提交更新请求 ${new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}，等待更新服务启动…\n（一直停在这里：说明服务器还没装好网页更新服务，请在服务器上手动运行一次 sudo xiu-online-update）\n`); } catch {}
      try { fs.writeFileSync(UPDATE_TRIGGER, String(Date.now())); }
      catch (err) { return error(res, 500, "提交更新请求失败：" + err.message); }
      return sendJson(res, 200, { ok: true });
    }
    return error(res, 404, "接口不存在");
  } catch (err) {
    const status = Number(err.status) || 400;
    if (status >= 500) console.error(err?.stack || err);
    return error(res, status, err.message || "请求失败");
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
function send(socket, value) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
// 状态差异：只发变化的字段。普通对象逐层比较；数组和其它值整体替换。
// 补丁格式 { $p: 1, s: { 键: 新值或子补丁 }, d: [删除的键] }；无变化返回 undefined。
const isPlain = v => v !== null && typeof v === "object" && !Array.isArray(v);
function diffState(a, b) {
  if (isPlain(a) && isPlain(b)) {
    const set = {}, del = []; let changed = false;
    for (const k of Object.keys(b)) {
      if (!(k in a)) { set[k] = b[k]; changed = true; continue; }
      const d = diffState(a[k], b[k]);
      if (d !== undefined) { set[k] = d; changed = true; }
    }
    for (const k of Object.keys(a)) if (!(k in b)) { del.push(k); changed = true; }
    return changed ? { $p: 1, s: set, d: del } : undefined;
  }
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b) ? undefined : b;
  return a === b ? undefined : b;
}
// 生成发给某个连接的状态消息：首次或要求重同步时发完整状态，之后只发补丁，并带上序号供客户端校验。
// snap：和 client.state 内容相同、之后不会再被改的副本（引擎改完原对象后另返回一份副本，原对象正好拿来当 lastSent，省掉一次复制）
// pre：已经算好的补丁（pushState 先 diff 判断有没有变化，避免算两次）
function statePayload(client, full = false, snap = null, pre) {
  drainHist(client.userId, client.state);
  if (snap) { delete snap.histQ; delete snap.exHist; }
  const prevSeq = client.seq || 0;
  client.seq = prevSeq + 1;
  let payload;
  if (full || !client.lastSent) payload = { state: client.state };
  else {
    const patch = pre !== undefined ? pre : diffState(client.lastSent, client.state);
    payload = { patch: patch || null, base: prevSeq };
  }
  client.lastSent = snap || structuredClone(client.state);
  return { ...payload, seq: client.seq };
}
server.on("upgrade", (req, socket, head) => {
  if (restoring) return socket.destroy();
  const url = new URL(req.url || "/", "http://localhost"), ticket = url.searchParams.get("ticket") || "";
  const session = tickets.get(ticket);
  if (url.pathname !== WS_PATH || !allowedOrigin(req)) { tickets.delete(ticket); socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  if (!session || session.expiresAt < Date.now()) { tickets.delete(ticket); socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  tickets.delete(ticket);
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, session));
});

wss.on("connection", (socket, session) => {
  const user = q.byId.get(session.userId);
  if (!user) { socket.close(4004, "账号不存在"); return; }
  const previous = clients.get(user.id);
  if (previous?.socket.readyState === WebSocket.OPEN) {
    try { persist(user.id, previous.state); } catch {}
    previous.socket.close(4001, "账号已在其他连接中进入");
  }
  // 读档、建引擎、结算、落盘全包进 try：原来 getState 在 try 外，存档损坏（JSON.parse 抛错）
  // 时整个服务器进程直接崩溃，所有在线玩家断线、重连再崩
  let state, playerEngine, advanced;
  try {
    state = getState(user.id);
    if (!state) { socket.close(4004, "角色尚未创建"); return; }
    playerEngine = getEngine(user.id);
    advanced = timedAdvance(playerEngine, state, Date.now(), `login u${user.id}`, ADVANCE_BUDGET_TICKS); persist(user.id, advanced.state);
  } catch (err) { console.error("login settle/save failed:", err?.message || err); socket.close(4005, "角色数据异常，无法登录"); return; }
  const saved = q.save.get(user.id);
  const client = { socket, userId: user.id, engine: playerEngine, state: advanced.state, revision: saved?.revision || 1, lastPersist: Date.now(), rateWindow: Date.now(), rateCount: 0, nextCheck: Math.min(Date.now() + CHECK_MS, (advanced.nextDue || 0) + DUE_MARGIN_MS), lastPush: 0, lastSent: null, seq: 0 };
  clients.set(user.id, client); if (!receipts.has(user.id)) receipts.set(user.id, new Map());
  pushState(client, Date.now(), advanced.logs, true, true);

  socket.on("message", raw => {
    // 顶号、删号、删人物、重置角色后，旧连接上在途的消息仍可能到达：只认当前登记的连接，
    // 否则重置后旧档可能被一条迟到动作重新落盘“复活”
    if (clients.get(user.id)?.socket !== socket) return;
    const now = Date.now();
    if (now - client.rateWindow >= 1000) { client.rateWindow = now; client.rateCount = 0; }
    let msg; try { msg = JSON.parse(raw.toString("utf8")); } catch { send(socket, { type: "error", error: "消息格式错误" }); return; }
    if (msg && msg.type === "ping") { send(socket, { type: "pong", serverNow: now }); return; }   // 客户端心跳（不计入频率限制）
    if (++client.rateCount > 12) {   // 带上操作编号，客户端马上提示，不用等 15 秒超时
      // resync 例外：限流时不重算（重算是费钱的活），但照推现有完整状态——不能让客户端
      // 拿着旧状态干等下次推送；1 秒内只推一次，免得有人刷 resync 逼服务器狂发大状态。
      if (msg && msg.type === "resync") { if (now - client.lastPush >= 1000) pushState(client, now, [], true, true); return; }
      const rid = msg && msg.type === "action" ? String(msg.id || "") : "";
      send(socket, rid ? { type: "result", id: rid, ok: false, error: "操作过于频繁，请稍后重试", serverNow: now, revision: client.revision } : { type: "error", error: "操作过于频繁，请稍后重试" }); return;
    }
    if (msg && msg.type === "resync") {
      // 客户端从后台切回来会发 resync：先把到现在为止的进度结算完、落盘，再推完整状态
      let logs = [];
      try { const o = client.engine.advance(client.state, now, ADVANCE_BUDGET_TICKS); client.state = o.state; logs = o.logs || []; client.nextCheck = Math.min(now + CHECK_MS, Math.max(now + 50, (o.nextDue || 0) + DUE_MARGIN_MS)); } catch (err) { console.error("resync advance failed:", err?.stack || err); }
      try { persist(user.id, client.state); } catch (err) { console.error("resync save failed:", err?.message || err); }
      pushState(client, now, logs, true, true); return;
    }
    if (!msg || msg.type !== "action") { send(socket, { type: "error", error: "未知消息类型" }); return; }
    const id = String(msg.id || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) { send(socket, { type: "error", id, error: "操作编号无效" }); return; }
    const seen = receipts.get(user.id);
    if (seen.has(id)) { const { patch, base, state, ...cached } = seen.get(id); send(socket, { ...cached, ...statePayload(client, true) }); return; }
    try {
      const action = String(msg.action || ""), args = msg.args;
      if (!ACTIONS.has(action)) throw new Error("此操作未授权");
      if (!Array.isArray(args) || args.length > 20) throw new Error("操作参数无效");
      validateValue(args, 0, action);
      const t0 = performance.now();
      const working = structuredClone(client.state);   // 出错时 client.state 保持原样
      const t1 = performance.now();
      const outcome = client.engine.act(working, action, args, Date.now());   // 引擎直接改 working，另返回一份副本
      const t2 = performance.now();
      // 先落盘再回复：原来先回 ok 再异步存档，存档失败时客户端已以为成功、继续在未落盘的状态上玩，重启就回档
      try { persist(user.id, outcome.state); } catch (err) {
        console.error("save failed", err?.message || err);
        send(socket, { type: "result", id, ok: false, error: "存档失败，操作未生效，请重试", serverNow: Date.now(), revision: client.revision });
        return;
      }
      client.state = outcome.state;
      client.revision += 1; client.lastPersist = Date.now();
      const reply = { type: "result", id, ok: true, serverNow: outcome.serverNow, revision: client.revision, logs: outcome.logs, result: outcome.result, battles: outcome.battles || [], ...statePayload(client, false, working) };
      client.lastPush = Date.now(); client.nextCheck = Date.now();
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
      const t3 = performance.now();
      {
        const total = t3 - t0;
        if (total >= SLOW_MS) console.warn(`[慢操作] ${action} 共${total.toFixed(0)}ms：复制${(t1 - t0).toFixed(0)} 执行${(t2 - t1).toFixed(0)} 补丁+发送${(t3 - t2).toFixed(0)}`);
      }
    } catch (err) {
      const reply = { type: "result", id, ok: false, error: err.message || "操作失败", serverNow: Date.now(), revision: client.revision, ...statePayload(client) };   // 出错：client.state 没变，补丁为空
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
    }
  });
  socket.on("close", () => {
    if (clients.get(user.id)?.socket === socket) {
      try { persist(user.id, client.state); } catch (err) { console.error("final save failed", err); }
      clients.delete(user.id);
      dropEngine(user.id);
    }
  });
  socket.on("error", err => console.warn("WebSocket error:", err.message));
});

// 服务器推送：只在状态变化时推，最多 10 秒一次心跳。
// 每 100ms 检查一次是否到了下一个结算点（修炼周期 / 探索步 / 劫雷），到点立刻结算推送，
// 进度条走满就能马上看到结算；其它计时系统每秒检查一次。
const PUSH_IDLE_MS = 10_000, CHECK_MS = 10_000, DUE_MARGIN_MS = 15, SLOW_MS = Number(process.env.XIU_SLOW_MS) || 80;   // 操作超过 SLOW_MS 毫秒在日志里打印各步耗时
// CHECK_MS：兜底复查间隔。下一次会变的时间（nextDue）已包含每 10 秒结算、探索/出窍下一步、渡劫、修炼室扣费、功法修炼结束，到点就算；不用每秒空算一遍（每次都要整份复制存档）
function pushState(client, now, logs = [], force = false, full = false, snap = null) {
  // 空闲心跳（定时器 10 秒一次、force 但不是完整状态）：走到这里时还没到下一个结算点，状态自上次推送后没变，
  // 不用全量比对状态、也不用整份克隆 lastSent，直接发一个空补丁当心跳；客户端收到空补丁也不重绘
  if (force && !full && !logs.length && client.lastSent) {
    drainHist(client.userId, client.state);
    const base = client.seq || 0;
    client.seq = base + 1; client.lastPush = now;
    send(client.socket, { type: "snapshot", serverNow: now, revision: client.revision, logs: [], patch: null, base, seq: client.seq });
    return;
  }
  let pre;
  if (!full && client.lastSent) {
    drainHist(client.userId, client.state);
    pre = diffState(client.lastSent, client.state);   // 只比较，不再整份序列化
    if (!force && !logs.length && !pre && now - client.lastPush < PUSH_IDLE_MS) { if (snap) { delete snap.histQ; delete snap.exHist; client.lastSent = snap; } return; }
  }
  client.lastPush = now;
  send(client.socket, { type: "snapshot", serverNow: now, revision: client.revision, logs, ...statePayload(client, full, snap, pre) });
}
// ---- 每小时自动备份数据库（存档、账号、礼包码），保留最近 48 份 ----
// 备份在 数据目录/backup/xiu-年月日-时分.sqlite3（北京时间）；最新一份按管理员设置的间隔上传到 GitHub 私有仓库（见下面 ghUpload）
const BACKUP_DIR = path.join(DATA_DIR, "backup"), BACKUP_KEEP = 48, BACKUP_MS = 3600_000;
const BACKUP_RE = /^xiu-\d{8}-\d{4}\.sqlite3$/;
let backupRunning = false;
async function backupDb() {
  if (backupRunning) return; backupRunning = true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o750 });
    // 先把在线玩家的最新进度写进数据库，备份里就是此刻的进度
    for (const [userId, client] of clients) { try { persist(userId, client.state); client.lastPersist = Date.now(); } catch {} }
    const t = new Date(Date.now() + 8 * 3600_000).toISOString();   // 北京时间
    const name = `xiu-${t.slice(0, 10).replace(/-/g, "")}-${t.slice(11, 16).replace(":", "")}.sqlite3`;
    const file = path.join(BACKUP_DIR, name), tmp = file + ".tmp";
    await db.backup(tmp);
    fs.renameSync(tmp, file);   // 备份完整写完才改名，上传脚本不会拿到写了一半的文件
    const old = fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    const players = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(LENGTH(data)),0) b, COALESCE(MAX(LENGTH(data)),0) m FROM saves").get();
    console.log(`backup ok: ${name} ${(fs.statSync(file).size / 1024).toFixed(0)} KB；角色 ${players.n} 个，存档合计 ${(players.b / 1024).toFixed(0)} KB，最大一份 ${(players.m / 1024).toFixed(0)} KB`);
  } catch (err) { console.error("backup failed:", err?.stack || err); }
  finally { backupRunning = false; }
}

// ---- 最新备份上传 GitHub（管理员 → 服务器信息 里设置仓库、令牌、间隔）----
// 用 GitHub Git Data API 建一个没有父提交的新提交并强制指向 main：仓库里永远只有最新一份，不堆历史。
// 设置存在 settings 表：gh_repo、gh_token、gh_interval（小时，0 = 关闭）、gh_last（上次结果 JSON）
const getSetting = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
// 游戏线路：lines = [{ name, url }]，lines_def = 默认线路地址（安卓客户端自动切过去）
function linesInfo() { let lines = []; try { lines = JSON.parse(getSetting("lines") || "[]"); } catch {} return { lines: Array.isArray(lines) ? lines : [], def: getSetting("lines_def") || "" }; }
const setSetting = (k, v) => v === null ? db.prepare("DELETE FROM settings WHERE key=?").run(k) : db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
const GH_INTERVALS = [0, 1, 2, 3, 6, 12, 24];
function ghConfig() {
  const iv = Number(getSetting("gh_interval"));
  let last = null; try { last = JSON.parse(getSetting("gh_last") || "null"); } catch {}
  return { repo: getSetting("gh_repo") || "", token: getSetting("gh_token") || "", interval: GH_INTERVALS.includes(iv) ? iv : 0, last };
}
function backupList() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort().reverse()
      .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, time: st.mtimeMs }; });
  } catch { return []; }
}
async function ghApi(token, method, url, body) {
  const r = await fetch("https://api.github.com" + url, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "xiu-online-backup", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`GitHub ${r.status}：${j.message || "请求失败"}`); e.status = r.status; throw e; }
  return j;
}
let ghRunning = false;
async function ghUpload(manual = false) {
  const cfg = ghConfig();
  if (!cfg.repo || !cfg.token) throw new Error("还没填 GitHub 仓库和令牌");
  if (ghRunning) throw new Error("正在上传，请稍候");
  ghRunning = true;
  const t0 = Date.now();
  try {
    let latest = backupList()[0];
    if (manual || !latest) { await backupDb(); latest = backupList()[0]; }   // 手动上传先备份一次，传的就是此刻的存档
    if (!latest) throw new Error("没有备份文件");
    const R = `/repos/${cfg.repo}`;
    const repo = await ghApi(cfg.token, "GET", R);
    if (!repo.private) throw new Error("这个仓库是公开的！备份里有所有账号和存档，只能传到私有仓库");
    const gz = zlib.gzipSync(fs.readFileSync(path.join(BACKUP_DIR, latest.name)), { level: 9 });
    // 只改存档文件 xiu-online.sqlite3.gz，仓库里其他文件原样保留（base_tree 取当前提交的文件）；
    //   新提交没有父提交、强推覆盖：仓库只保留最新一份存档，不留历史（其他文件的提交记录也一起清掉）
    const branch = repo.default_branch || "main", FILE = "xiu-online.sqlite3.gz", msg = `备份 ${latest.name}`;
    let head = null;
    try { head = (await ghApi(cfg.token, "GET", `${R}/git/ref/heads/${branch}`)).object.sha; }
    catch (err) { if (err.status !== 404 && err.status !== 409) throw err; }   // 404/409：空仓库或没有这个分支
    if (!head) {
      // 空仓库不能建 blob：用 contents 接口直接建存档文件（只建这一个文件）
      await ghApi(cfg.token, "PUT", `${R}/contents/${FILE}`, { message: msg, content: gz.toString("base64"), branch });
    } else {
      const fileSha = (await ghApi(cfg.token, "POST", `${R}/git/blobs`, { content: gz.toString("base64"), encoding: "base64" })).sha;
      const base = (await ghApi(cfg.token, "GET", `${R}/git/commits/${head}`)).tree.sha;
      const tree = await ghApi(cfg.token, "POST", `${R}/git/trees`, { base_tree: base, tree: [{ path: FILE, mode: "100644", type: "blob", sha: fileSha }] });
      const commit = await ghApi(cfg.token, "POST", `${R}/git/commits`, { message: msg, tree: tree.sha, parents: [] });
      await ghApi(cfg.token, "PATCH", `${R}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
    }
    const last = { ok: true, time: Date.now(), file: latest.name, size: gz.length, ms: Date.now() - t0 };
    setSetting("gh_last", JSON.stringify(last));
    console.log(`github backup ok: ${latest.name} ${(gz.length / 1024).toFixed(0)} KB -> ${cfg.repo}`);
    return last;
  } catch (err) {
    const msg = String(err.message || err).split(cfg.token).join("***");
    setSetting("gh_last", JSON.stringify({ ok: false, time: Date.now(), error: msg }));
    console.error("github backup failed:", msg);
    throw new Error(msg);
  } finally { ghRunning = false; }
}
// 每分钟看一次是否到了上传时间（按上次上传时间 + 间隔；失败的话 10 分钟后重试）
setInterval(() => {
  const cfg = ghConfig();
  if (!cfg.interval || !cfg.repo || !cfg.token || ghRunning) return;
  const last = cfg.last, due = !last ? 0 : last.ok ? last.time + cfg.interval * 3600_000 : last.time + 600_000;
  if (Date.now() >= due) ghUpload().catch(() => {});
}, 60_000).unref();

// ---- 从 GitHub 私有仓库下载最新备份并替换当前数据库（只有管理员；替换前先在本地备份一份当前数据库）----
// 替换完成后进程以非 0 退出，systemd（Restart=on-failure）几秒后用恢复的数据库重新启动。
let restoring = false;
async function ghRestore(repoIn, tokenIn) {
  const cfg = ghConfig();
  const repo = normRepo(repoIn) || cfg.repo, token = String(tokenIn || "").trim() || cfg.token;
  if (!repo || !token) throw new Error("请填写备份仓库和令牌");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("仓库格式：用户名/仓库名");
  if (restoring || ghRunning) throw new Error("正在处理，请稍候");
  ghRunning = true;
  const tmp = path.join(DATA_DIR, "restore.tmp");
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/xiu-online.sqlite3.gz`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "xiu-online-backup" }, signal: AbortSignal.timeout(180_000) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(r.status === 404 ? "仓库里没有找到备份文件 xiu-online.sqlite3.gz（或令牌没有这个仓库的权限）" : `GitHub ${r.status}：${j.message || "下载失败"}`); }
    let raw;
    try { raw = zlib.gunzipSync(Buffer.from(await r.arrayBuffer())); } catch { throw new Error("备份文件解压失败，文件可能损坏"); }
    fs.rmSync(tmp, { force: true }); fs.writeFileSync(tmp, raw, { mode: 0o640 });
    let info;
    try {
      const t = new Database(tmp);
      try {
        const ok = t.pragma("integrity_check", { simple: true });
        if (ok !== "ok") throw new Error("备份数据库校验失败：" + ok);
        const names = new Set(t.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
        if (!names.has("users") || !names.has("saves")) throw new Error("这不是游戏的数据库备份");
        info = { users: t.prepare("SELECT COUNT(*) n FROM users").get().n, saves: t.prepare("SELECT COUNT(*) n FROM saves").get().n };
        // 恢复后继续用这个仓库和令牌自动上传
        t.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        const up = t.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        up.run("gh_repo", repo); up.run("gh_token", token);
        t.prepare("DELETE FROM settings WHERE key='gh_last'").run();
        t.pragma("journal_mode = DELETE");
      } finally { t.close(); }
    } catch (err) { throw new Error(/SQLITE|file is not a database/i.test(String(err.message)) ? "备份文件不是有效的数据库" : err.message); }
    // 当前数据库先备份一份（就算恢复错了也能找回来）
    // 先停服（拒绝新请求、踢下线），再把当前数据库备份一份（就算恢复错了也能找回来）：
    //   原来先备份后停服，备份期间玩家的进度既不在备份里也不在恢复后的库里
    restoring = true;
    clearInterval(timer);
    for (const [userId, client] of clients) { try { persist(userId, client.state); } catch {} try { client.socket.close(1012, "服务器正在恢复存档"); } catch {} }
    clients.clear();
    while (backupRunning) await new Promise(ok => setTimeout(ok, 200));   // 自动备份正在跑时等它完，否则 backupDb 会直接跳过
    await backupDb();
    db.close();
    fs.renameSync(tmp, DB_FILE);
    for (const f of [DB_FILE + "-wal", DB_FILE + "-shm"]) fs.rmSync(f, { force: true });
    console.log(`restored database from github ${repo}: ${info.users} users, ${info.saves} saves; restarting`);
    setTimeout(() => process.exit(75), 500);
    return info;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (restoring) { console.error("restore failed after shutdown, restarting:", err?.message || err); setTimeout(() => process.exit(75), 500); }   // 已停服：重启回到原库
    throw new Error(String(err.message || err).split(token).join("***"));
  } finally { if (!restoring) ghRunning = false; }
}
function normRepo(v) { return String(v ?? "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, ""); }

// 管理员 → 服务器信息
async function serverInfo() {
  const mem = process.memoryUsage(), dbSize = f => { try { return fs.statSync(f).size; } catch { return 0; } };
  let disk = null; try { const st = fs.statfsSync(DATA_DIR); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch {}
  const saves = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(LENGTH(data)),0) b, COALESCE(MAX(LENGTH(data)),0) m FROM saves").get();
  const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const backups = backupList(), cfg = ghConfig();
  return {
    version: await repoVersion(), node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, host: os.hostname(),
    startedAt, now: Date.now(), osUptime: os.uptime(), pid: process.pid,
    mem: { rss: mem.rss, heap: mem.heapUsed }, sys: { total: os.totalmem(), free: os.freemem(), load: os.loadavg(), cpus: os.cpus().length },
    disk, db: { file: DB_FILE, size: dbSize(DB_FILE) + dbSize(DB_FILE + "-wal") },
    players: { users, saves: saves.n, total: saves.b, max: saves.m, online: clients.size },
    backup: { dir: BACKUP_DIR, keep: BACKUP_KEEP, count: backups.length, list: backups.slice(0, 5) },
    gh: { repo: cfg.repo, tokenSet: !!cfg.token, tokenTail: cfg.token ? cfg.token.slice(-4) : "", interval: cfg.interval, intervals: GH_INTERVALS, last: cfg.last, running: ghRunning },
  };
}
setTimeout(backupDb, 60_000).unref();                       // 启动 1 分钟后先备份一次
setInterval(backupDb, BACKUP_MS).unref();

// 离线玩家后台结算：间隔读 config/rates.js 的 OFFLINE_SEC（秒，默认 10，0 关闭），管理员改了下一轮就生效。
// 不在线的角色读出来、结算到现在、落盘，再进游戏时只补最后一小段，不用一次性补算整段离线时间。
// 每人每次一个 JSON 读写 + 一个周期结算；整轮超过 1 秒会记日志，玩家多了再改成分批。
const offlineIds = db.prepare("SELECT user_id FROM saves"), offlineBad = new Map();   // 结算出错的角色 30 分钟内不再后台算（免得反复刷错误），之后重试；上线时照常结算
const OFFLINE_CHUNK = 8640;   // 后台结算每轮每人最多补 1 天（8640 个 10 秒），停服很久后不会一轮卡死，剩下的下一轮接着算
function offlineSec() { try { const v = Number(poolEngine(false, false).CFG.rates?.OFFLINE_SEC ?? 10); return Number.isFinite(v) && v > 0 ? Math.max(1, v) : 0; } catch { return 10; } }
function offlineSettle() {
  const t0 = Date.now(); let n = 0;
  for (const { user_id: id } of offlineIds.all()) {
    if (clients.has(id)) continue;
    if (offlineBad.has(id)) { if (Date.now() - offlineBad.get(id) < 30 * 60_000) continue; offlineBad.delete(id); }
    try {
      const st = getState(id); if (!st) continue;
      const o = timedAdvance(getEngine(id), st, Date.now(), `offline u${id}`, OFFLINE_CHUNK);
      if (o.processedTicks > 0) { persist(id, o.state); n++; }
    } catch (err) { offlineBad.set(id, Date.now()); console.error(`offline settle u${id} failed:`, err?.message || err); }
  }
  const ms = Date.now() - t0; if (ms >= 1000) console.log(`offline settle ${n} players ${ms}ms`);
}
(function offlineLoop() {
  const sec = offlineSec();
  setTimeout(() => { if (sec > 0) { try { offlineSettle(); } catch (err) { console.error("offline settle failed:", err?.message || err); } } offlineLoop(); }, (sec || 10) * 1000).unref();
})();

let lastHousekeeping = 0;
const timer = setInterval(() => {
  const now = Date.now();
  for (const [userId, client] of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    try {
      if (now >= client.nextCheck) {
        // 单次最多补 10 天：截断后 nextDue = s.last+10 秒（已过去），下次检查（最快 50 毫秒后）继续补，直到追上现在
        const old = client.state, outcome = client.engine.advance(old, now, ADVANCE_BUDGET_TICKS); client.state = outcome.state;   // old 已被引擎改成和新状态一样，拿来当 lastSent
        client.nextCheck = Math.min(now + CHECK_MS, Math.max(now + 50, (outcome.nextDue || 0) + DUE_MARGIN_MS));
        // 先落盘再推送：原来先推送、30 秒才落盘一次，进程在这窗口内崩溃时，客户端已看到
        // 的进度会回滚，且重算的随机结果可能与已推送的不一致；每次结算都落盘
        try { persist(userId, client.state); } catch (err) { console.error("timed save failed:", err?.message || err); }   // 定时落盘失败不踢人：下一次动作落盘（先落盘再回复）会把完整状态补上
        client.lastPersist = now;
        client.revision += 1;
        pushState(client, now, outcome.logs, false, false, old);
      } else if (now - client.lastPush >= PUSH_IDLE_MS) pushState(client, now, [], true);
    } catch (err) { console.error("game tick failed:", err?.stack || err); client.socket.close(1011, "游戏结算失败"); }
  }
  if (now - lastHousekeeping >= 1000) {
    lastHousekeeping = now;
    for (const [key, r] of loginFails) if (now - r.first > 10 * 60_000 && (!r.until || now > r.until)) loginFails.delete(key);
    for (const [key, r] of regHits) if (now - r.first > 60 * 60_000) regHits.delete(key);
    for (const [ticket, item] of tickets) if (item.expiresAt < now) tickets.delete(ticket);
    for (const [userId, entry] of engines) if (!clients.has(userId) && now - entry.lastUsed > 120_000) dropEngine(userId);
    db.prepare("DELETE FROM tokens WHERE expires_at<?").run(now);
  }
}, 100);
timer.unref();

function shutdown(signal) {
  console.log(`Received ${signal}; flushing online player states.`);
  clearInterval(timer);
  for (const [id, client] of clients) { try { persist(id, client.state); client.socket.close(1001, "server shutdown"); } catch {} }
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
server.listen(PORT, HOST, () => {
  console.log(`xiu-online authoritative server listening on http://${HOST}:${PORT}`);
  warmEngines();
  console.log(`database: ${DB_FILE}`);
  console.log(`loaded ${validationEngine.G.modules.length} game modules; ${ACTIONS.size} whitelisted actions`);
});
