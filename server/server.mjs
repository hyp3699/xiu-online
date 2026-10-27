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
import { GameEngine, CONFIG_OVERRIDE_DIR, configNames, configOverridden, readConfig, validConfigName, configHash } from "./game-engine.mjs";

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
const receipts = new WeakMap();
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

function getEngine(userId) {
  let entry = engines.get(userId);
  if (!entry) { entry = { engine: new GameEngine(), lastUsed: Date.now() }; engines.set(userId, entry);
    try { entry.engine.setAdmin(!!(q.byId.get(userId) || {}).is_admin); } catch (err) { console.error("setAdmin failed", err); } }   // 测试模式只对管理员生效
  entry.lastUsed = Date.now();
  return entry.engine;
}

// 参数改动后：在线玩家立即换成用新参数加载的游戏引擎，并通知网页重新加载参数
function applyNewConfig() {
  engines.clear();
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
function passwordHash(password, salt) { return crypto.pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256").toString("hex"); }
function equalHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,?)").run(hashToken(token), userId, Date.now() + 90 * 86400_000);
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
  if (Array.isArray(state.exHist)) { list.push(...state.exHist.slice().reverse()); delete state.exHist; }   // 旧存档里的最近 10 次探索
  if (Array.isArray(state.histQ)) { list.push(...state.histQ); delete state.histQ; }
  if (!list.length || !userId) return;
  try { histSave(userId, list.filter(r => r && typeof r === "object")); } catch (err) { console.error("hist save failed:", err?.message || err); }
}
function persist(userId, state) {
  drainHist(userId, state);
  const data = JSON.stringify(state);
  if (Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error("角色数据超出安全大小限制");
  q.saveUpsert.run(userId, data, Date.now());
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
function validateValue(value, depth = 0) {
  if (depth > 5) throw new Error("操作参数层级过深");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (value.length > 2048) throw new Error("操作参数过长"); return; }
  if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error("操作参数无效"); return; }
  if (Array.isArray(value)) { if (value.length > 100) throw new Error("操作参数数组过长"); return value.forEach(x => validateValue(x, depth + 1)); }
  if (typeof value === "object") {
    const pairs = Object.entries(value); if (pairs.length > 50) throw new Error("操作参数对象过大");
    for (const [key, child] of pairs) { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("操作参数字段无效"); validateValue(child, depth + 1); }
    return;
  }
  throw new Error("操作参数类型无效");
}
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
    if (req.method === "POST" && route === "/api/register") {
      const body = await readBody(req);
      if (!registrationOpen()) return error(res, 403, "暂未开放注册");
      const username = validUsername(body.username), password = String(body.password || "");
      if (password.length < 6 || password.length > 128) return error(res, 400, "密码长度需为 6–128 位");
      if (q.byName.get(username)) return error(res, 409, "账号已存在");
      const salt = crypto.randomBytes(16).toString("hex");
      const isAdmin = db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0 ? 1 : 0;
      const result = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)").run(username, salt, passwordHash(password, salt), isAdmin, Date.now());
      return sendJson(res, 201, { token: issueToken(Number(result.lastInsertRowid)), admin: !!isAdmin });
    }
    if (req.method === "POST" && route === "/api/login") {
      const body = await readBody(req); let username;
      try { username = validUsername(body.username); } catch { return error(res, 401, "账号或密码错误"); }
      const user = q.byName.get(username), password = String(body.password || "");
      const candidate = passwordHash(password, user?.salt || "00000000000000000000000000000000");
      if (!user || !equalHex(candidate, user.password_hash)) return error(res, 401, "账号或密码错误");
      return sendJson(res, 200, { token: issueToken(user.id), admin: !!user.is_admin });
    }
    if (req.method === "POST" && route === "/api/logout") {
      const token = String(req.headers["x-token"] || "");
      if (!userFor(req)) return error(res, 401, "登录已过期");
      db.prepare("DELETE FROM tokens WHERE token_hash=?").run(hashToken(token));
      return sendJson(res, 200, { ok: true });
    }

    // 游戏参数脚本（浏览器和服务器用同一份；管理员改过的优先）。
    // config-loader.js 每次都不缓存，按内容哈希写出各参数文件的地址：参数一改地址就变，
    // 不会被浏览器 / Cloudflare 缓存住旧参数；地址带对哈希的文件可以长期缓存。
    if (req.method === "GET" && route === "/api/config-loader.js") {
      const tags = configNames().map(name => `api/config/${name}?h=${configHash(readConfig(name))}`);
      const data = Buffer.from(`(function(){var a=${JSON.stringify(tags)};for(var i=0;i<a.length;i++)document.write('<script src="'+a[i]+'"><\\/script>');})();\n`);
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
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
        const advanced = on.engine.advance(on.state, Date.now());
        on.state = advanced.state; on.nextCheck = Math.min(Date.now() + CHECK_MS, Math.max(Date.now() + 50, (advanced.nextDue || 0) + DUE_MARGIN_MS));
        data = on.state; persist(user.id, data);
      } else {
        data = getState(user.id);
        if (data) { data = getEngine(user.id).advance(data, Date.now()).state; persist(user.id, data); }
      }
      return sendJson(res, 200, { data, serverNow: Date.now(), actions: [...ACTIONS], admin: !!user.is_admin });
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
      engines.delete(user.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/ws-ticket") {
      await readBody(req);
      return sendJson(res, 200, { ticket: createWsTicket(user.id), expiresIn: 30 });
    }
    if (req.method === "POST" && route === "/api/password") {
      const body = await readBody(req), oldPw = String(body.old || ""), newPw = String(body.new || "");
      if (newPw.length < 6 || newPw.length > 128) return error(res, 400, "新密码长度需为 6–128 位");
      if (!equalHex(passwordHash(oldPw, user.salt), user.password_hash)) return error(res, 403, "旧密码不正确");
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?").run(salt, passwordHash(newPw, salt), user.id);
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
    if (user.is_admin && req.method === "GET" && route === "/api/admin/users") {
      const rows = db.prepare("SELECT u.id,u.username,u.is_admin,u.created_at,s.updated_at FROM users u LEFT JOIN saves s ON s.user_id=u.id ORDER BY u.id").all();
      const list = rows.map(row => ({ id: row.id, username: row.username, admin: !!row.is_admin, created: Math.floor(row.created_at / 1000), updated: row.updated_at ? Math.floor(row.updated_at / 1000) : 0 }));
      return sendJson(res, 200, { list, reg_open: registrationOpen() });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/user/del") {
      const body = await readBody(req), id = Number(body.id);
      if (!Number.isSafeInteger(id) || id === user.id) return error(res, 400, "不能删除该账号");
      db.prepare("DELETE FROM users WHERE id=?").run(id); engines.delete(id);
      const online = clients.get(id); if (online) { clients.delete(id); online.socket.close(4003, "账号已删除"); }
      return sendJson(res, 200, { ok: true });
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
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return error(res, 400, "礼包物品格式无效");
        const count = Number(item.n || 1);
        if (!Number.isFinite(count) || count < 1 || count > 1_000_000 || (["eq", "fabao", "bp"].includes(item.c) && count > 100)) return error(res, 400, "礼包物品数量超过限制");
      }
      const payload = { items };
      const maxUses = Math.max(1, Math.min(100_000, Number(body.uses || body.max_uses || 1)));
      const expiresAt = body.expires_at ? Number(body.expires_at) : null;
      db.prepare("INSERT INTO gifts(code,payload,max_uses,expires_at,created_at) VALUES(?,?,?,?,?)").run(code, JSON.stringify(payload), maxUses, expiresAt, Date.now());
      return sendJson(res, 201, { ok: true, code });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift/del") {
      const body = await readBody(req); db.prepare("DELETE FROM gifts WHERE code=?").run(String(body.code || ""));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/gift") {
      const body = await readBody(req), code = String(body.code || "").trim();
      const redeem = db.transaction(() => {
        const gift = db.prepare("SELECT * FROM gifts WHERE code=?").get(code), on0 = clients.get(user.id), state = on0 ? structuredClone(on0.state) : getState(user.id);   // 在线就用内存里的最新进度
        if (!gift || !state || (gift.expires_at && gift.expires_at < Date.now()) || gift.used_count >= gift.max_uses) return false;
        if (db.prepare("SELECT 1 FROM gift_uses WHERE code=? AND user_id=?").get(code, user.id)) return false;
        const items = JSON.parse(gift.payload).items || [], playerEngine = getEngine(user.id);
        playerEngine.bindState(state, Date.now());
        const got = [], lost = [];
        for (const item of items) (playerEngine.G.giftGive(item) ? got : lost).push(playerEngine.G.giftLabel(item));
        const updatedState = playerEngine.G.s;
        playerEngine.G.log(`礼包码兑换成功，获得 ${got.join("、") || "无"}${lost.length ? `（背包已满，遗失 ${lost.join("、")}）` : ""}。`, "gold");
        persist(user.id, updatedState);
        db.prepare("INSERT INTO gift_uses(code,user_id,used_at) VALUES(?,?,?)").run(code, user.id, Date.now());
        db.prepare("UPDATE gifts SET used_count=used_count+1 WHERE code=?").run(code);
        const online = clients.get(user.id); if (online) { online.state = structuredClone(updatedState); pushState(online, Date.now(), [], true, true); }
        return { items, got, lost, state: updatedState };
      });
      const result = redeem();
      return result ? sendJson(res, 200, { ok: true, ...result, serverNow: Date.now() }) : error(res, 400, "礼包码无效、已过期、已用完或已经兑换");
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
        // 先用新参数完整加载一遍游戏，出错就不保存
        try { new GameEngine({ [name]: content }); }
        catch (err) { return error(res, 400, `参数有错误，未保存：${String(err && err.message || err).slice(0, 300)}`); }
        fs.mkdirSync(CONFIG_OVERRIDE_DIR, { recursive: true, mode: 0o750 });
        const tmp = path.join(CONFIG_OVERRIDE_DIR, `.${name}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, content); fs.renameSync(tmp, path.join(CONFIG_OVERRIDE_DIR, name));
      } else fs.rmSync(path.join(CONFIG_OVERRIDE_DIR, name), { force: true });
      applyNewConfig();
      return sendJson(res, 200, { ok: true, name, overridden: configOverridden(name), online: clients.size });
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
  if (url.pathname !== WS_PATH || !allowedOrigin(req)) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
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
  const state = getState(user.id);
  if (!state) { socket.close(4004, "角色尚未创建"); return; }
  const playerEngine = getEngine(user.id);
  const advanced = playerEngine.advance(state, Date.now()); persist(user.id, advanced.state);
  const saved = q.save.get(user.id);
  const client = { socket, userId: user.id, engine: playerEngine, state: advanced.state, revision: saved?.revision || 1, lastPersist: Date.now(), rateWindow: Date.now(), rateCount: 0, nextCheck: Math.min(Date.now() + CHECK_MS, (advanced.nextDue || 0) + DUE_MARGIN_MS), lastPush: 0, lastSent: null, seq: 0 };
  clients.set(user.id, client); receipts.set(socket, new Map());
  pushState(client, Date.now(), advanced.logs, true, true);

  socket.on("message", raw => {
    const now = Date.now();
    if (now - client.rateWindow >= 1000) { client.rateWindow = now; client.rateCount = 0; }
    let msg; try { msg = JSON.parse(raw.toString("utf8")); } catch { send(socket, { type: "error", error: "消息格式错误" }); return; }
    if (++client.rateCount > 12) {   // 带上操作编号，客户端马上提示，不用等 15 秒超时
      const rid = msg && msg.type === "action" ? String(msg.id || "") : "";
      send(socket, rid ? { type: "result", id: rid, ok: false, error: "操作过于频繁，请稍后重试", serverNow: now, revision: client.revision } : { type: "error", error: "操作过于频繁，请稍后重试" }); return;
    }
    if (msg && msg.type === "resync") {
      // 客户端从后台切回来会发 resync：先把到现在为止的进度结算完，再推完整状态
      let logs = [];
      try { const o = client.engine.advance(client.state, now); client.state = o.state; logs = o.logs || []; client.nextCheck = Math.min(now + CHECK_MS, Math.max(now + 50, (o.nextDue || 0) + DUE_MARGIN_MS)); } catch (err) { console.error("resync advance failed:", err?.stack || err); }
      pushState(client, now, logs, true, true); return;
    }
    if (!msg || msg.type !== "action") { send(socket, { type: "error", error: "未知消息类型" }); return; }
    const id = String(msg.id || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) { send(socket, { type: "error", id, error: "操作编号无效" }); return; }
    const seen = receipts.get(socket);
    if (seen.has(id)) { const { patch, base, state, ...cached } = seen.get(id); send(socket, { ...cached, ...statePayload(client, true) }); return; }
    try {
      const action = String(msg.action || ""), args = msg.args;
      if (!ACTIONS.has(action)) throw new Error("此操作未授权");
      if (!Array.isArray(args) || args.length > 20) throw new Error("操作参数无效");
      validateValue(args);
      const t0 = performance.now();
      const working = structuredClone(client.state);   // 出错时 client.state 保持原样
      const t1 = performance.now();
      const outcome = client.engine.act(working, action, args, Date.now());   // 引擎直接改 working，另返回一份副本
      const t2 = performance.now();
      client.state = outcome.state;
      client.revision += 1;
      const reply = { type: "result", id, ok: true, serverNow: outcome.serverNow, revision: client.revision, logs: outcome.logs, result: outcome.result, battles: outcome.battles || [], ...statePayload(client, false, working) };
      client.lastPush = Date.now(); client.nextCheck = Date.now();
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
      const t3 = performance.now();
      // 先回复玩家，再存档（存档在同一轮事件里马上做，服务器重启不会丢进度）
      setImmediate(() => {
        const t4 = performance.now();
        try { persist(user.id, client.state); client.lastPersist = Date.now(); } catch (err) { console.error("save failed", err?.message || err); }
        const t5 = performance.now(), total = t3 - t0 + t5 - t4;
        if (total >= SLOW_MS) console.warn(`[慢操作] ${action} 共${total.toFixed(0)}ms：复制${(t1 - t0).toFixed(0)} 执行${(t2 - t1).toFixed(0)} 补丁+发送${(t3 - t2).toFixed(0)} 存档${(t5 - t4).toFixed(0)}`);
      });
    } catch (err) {
      const reply = { type: "result", id, ok: false, error: err.message || "操作失败", serverNow: Date.now(), revision: client.revision, ...statePayload(client) };   // 出错：client.state 没变，补丁为空
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
    }
  });
  socket.on("close", () => {
    if (clients.get(user.id)?.socket === socket) {
      try { persist(user.id, client.state); } catch (err) { console.error("final save failed", err); }
      clients.delete(user.id);
      engines.delete(user.id);
    }
  });
  socket.on("error", err => console.warn("WebSocket error:", err.message));
});

// 服务器推送：只在状态变化时推，最多 10 秒一次心跳。
// 每 100ms 检查一次是否到了下一个结算点（修炼周期 / 探索步 / 劫雷），到点立刻结算推送，
// 进度条走满就能马上看到结算；其它计时系统每秒检查一次。
const PUSH_IDLE_MS = 10_000, CHECK_MS = 1_000, DUE_MARGIN_MS = 15, SLOW_MS = Number(process.env.XIU_SLOW_MS) || 80;   // 操作超过 SLOW_MS 毫秒在日志里打印各步耗时
function pushState(client, now, logs = [], force = false, full = false, snap = null) {
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
    const readme = `# 问道长生 存档备份\n\n- 备份：${latest.name}\n- 压缩后：${(gz.length / 1024).toFixed(0)} KB\n\n恢复：解压 xiu-online.sqlite3.gz，停服后替换 /var/lib/xiu-online/xiu-online.sqlite3（并删除同目录的 -wal、-shm 文件），再启动。\n`;
    const blob = async (buf) => (await ghApi(cfg.token, "POST", `${R}/git/blobs`, { content: buf.toString("base64"), encoding: "base64" })).sha;
    let fileSha;
    try { fileSha = await blob(gz); }
    catch (err) {
      if (err.status !== 409) throw err;   // 空仓库（没有任何提交）不能直接建 blob：先放一个 README 初始化
      await ghApi(cfg.token, "PUT", `${R}/contents/README.md`, { message: "初始化", content: Buffer.from(readme).toString("base64") });
      fileSha = await blob(gz);
    }
    const readmeSha = await blob(Buffer.from(readme));
    const tree = await ghApi(cfg.token, "POST", `${R}/git/trees`, { tree: [{ path: "xiu-online.sqlite3.gz", mode: "100644", type: "blob", sha: fileSha }, { path: "README.md", mode: "100644", type: "blob", sha: readmeSha }] });
    const commit = await ghApi(cfg.token, "POST", `${R}/git/commits`, { message: `备份 ${latest.name}`, tree: tree.sha, parents: [] });
    const branch = repo.default_branch || "main";
    try { await ghApi(cfg.token, "PATCH", `${R}/git/refs/heads/${branch}`, { sha: commit.sha, force: true }); }
    catch (err) { if (err.status !== 404 && err.status !== 422) throw err; await ghApi(cfg.token, "POST", `${R}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha }); }
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
    ghRunning = false; await backupDb(); ghRunning = true;
    restoring = true;
    clearInterval(timer);
    for (const [, client] of clients) { try { client.socket.close(1012, "服务器正在恢复存档"); } catch {} }
    clients.clear();
    db.close();
    fs.renameSync(tmp, DB_FILE);
    for (const f of [DB_FILE + "-wal", DB_FILE + "-shm"]) fs.rmSync(f, { force: true });
    console.log(`restored database from github ${repo}: ${info.users} users, ${info.saves} saves; restarting`);
    setTimeout(() => process.exit(75), 500);
    return info;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
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

let lastHousekeeping = 0;
const timer = setInterval(() => {
  const now = Date.now();
  for (const [userId, client] of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    try {
      if (now >= client.nextCheck) {
        const old = client.state, outcome = client.engine.advance(old, now); client.state = outcome.state;   // old 已被引擎改成和新状态一样，拿来当 lastSent
        client.nextCheck = Math.min(now + CHECK_MS, Math.max(now + 50, (outcome.nextDue || 0) + DUE_MARGIN_MS));
        pushState(client, now, outcome.logs, false, false, old);
        if (now - client.lastPersist >= 30_000) {
          persist(userId, client.state); client.lastPersist = now;
          client.revision += 1;
        }
      } else if (now - client.lastPush >= PUSH_IDLE_MS) pushState(client, now, [], true);
    } catch (err) { console.error("game tick failed:", err?.stack || err); client.socket.close(1011, "游戏结算失败"); }
  }
  if (now - lastHousekeeping >= 1000) {
    lastHousekeeping = now;
    for (const [ticket, item] of tickets) if (item.expiresAt < now) tickets.delete(ticket);
    for (const [userId, entry] of engines) if (!clients.has(userId) && now - entry.lastUsed > 120_000) engines.delete(userId);
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
  console.log(`database: ${DB_FILE}`);
  console.log(`loaded ${validationEngine.G.modules.length} game modules; ${ACTIONS.size} whitelisted actions`);
});
