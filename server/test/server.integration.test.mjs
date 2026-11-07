import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function applyPatch(target, patch) {
  if (!patch || patch.$p !== 1) return patch;
  for (const k of patch.d || []) delete target[k];
  for (const [k, v] of Object.entries(patch.s || {})) target[k] = v && v.$p === 1 ? applyPatch(target[k], v) : v;
  return target;
}

// Rebuilds full state from the server's full snapshots and diffs, in arrival order.
function messageQueue(socket) {
  const messages = [];
  const waiters = [];
  let state = null, seq = 0;
  socket.on("message", raw => {
    const message = JSON.parse(raw.toString("utf8"));
    if (message.state) state = message.state;
    else if ("patch" in message) {
      assert.equal(message.base, seq, "diff must apply to the previous message");
      if (message.patch) state = applyPatch(state, message.patch);
      message.diff = true;
    }
    if (message.seq) seq = message.seq;
    if (state && (message.type === "snapshot" || message.type === "result")) message.state = JSON.parse(JSON.stringify(state));
    const i = waiters.findIndex(w => w.predicate(message));
    if (i >= 0) { const [waiter] = waiters.splice(i, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    else messages.push(message);
  });
  return (predicate, timeout = 8000) => {
    const i = messages.findIndex(predicate);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1);
        reject(new Error("timed out waiting for WebSocket message"));
      }, timeout) };
      waiters.push(waiter);
    });
  };
}

async function waitHealth(base, child) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function post(base, route, token, payload = {}) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Token": token } : {}) },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${data.error || response.status}`);
  return data;
}

test("HTTP auth and WebSocket actions use authoritative server state", { timeout: 30_000 }, async t => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiu-online-test-"));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(HERE, "../server.mjs")], {
    cwd: path.join(HERE, ".."),
    env: { ...process.env, XIU_HOST: "127.0.0.1", XIU_PORT: String(port), XIU_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  let socket, socket2;
  t.after(async () => {
    socket?.close();
    socket2?.close();
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitHealth(base, child);
  const registered = await post(base, "/api/register", null, { username: `test_${Date.now()}`, password: "test-password-123" });
  const token = registered.token;
  assert.ok(token);
  const initial = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(initial.data, null);
  assert.ok(initial.actions.includes("toggleAuto"));

  const character = await post(base, "/api/character", token, { name: "服务器新档" });
  assert.equal(character.data.name, "服务器新档");
  assert.equal(character.data.auto, false);

  const { ticket } = await post(base, "/api/ws-ticket", token);
  socket = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket)}`);
  const waitFor = messageQueue(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const first = await waitFor(m => m.type === "snapshot");
  assert.equal(first.state.name, "服务器新档");

  const id = "test-action-0001";
  socket.send(JSON.stringify({ type: "action", id, action: "toggleAuto", args: [] }));
  const success = await waitFor(m => m.type === "result" && m.id === id);
  assert.equal(success.ok, true);
  assert.equal(success.diff, true, "action results carry only the changed fields");
  assert.equal(success.state.auto, true);

  const combatSettings = [
    { id: "test-bset-round-1", action: "bsetRound", args: [0, "atk"], check: state => assert.equal(state.bset.r[0], "atk") },
    { id: "test-bset-mode-1", action: "bsetSet", args: ["mode", "atk"], check: state => assert.equal(state.bset.mode, "atk") },
  ];
  for (const action of combatSettings) {
    socket.send(JSON.stringify({ type: "action", id: action.id, action: action.action, args: action.args }));
    const result = await waitFor(m => m.type === "result" && m.id === action.id);
    assert.equal(result.ok, true, result.error);
    action.check(result.state);
  }
  const invalidSettingId = "test-bset-invalid1";
  socket.send(JSON.stringify({ type: "action", id: invalidSettingId, action: "bsetSet", args: ["mode", "unknown"] }));
  const invalidSetting = await waitFor(m => m.type === "result" && m.id === invalidSettingId);
  assert.equal(invalidSetting.ok, false);
  assert.equal(invalidSetting.state.bset.mode, "atk");
  const persistedSettings = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(persistedSettings.data.bset.r[0], "atk");
  assert.equal(persistedSettings.data.bset.mode, "atk");

  // A duplicate operation id returns its original receipt and cannot toggle twice.
  socket.send(JSON.stringify({ type: "action", id, action: "toggleAuto", args: [] }));
  const duplicate = await waitFor(m => m.type === "result" && m.id === id);
  assert.equal(duplicate.state.auto, true);

  socket.send(JSON.stringify({ type: "action", id: "test-action-0002", action: "openCultSet", args: [] }));
  const rejected = await waitFor(m => m.type === "result" && m.id === "test-action-0002");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.auto, true);

  const persisted = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(persisted.data.auto, true);

  const users = await fetch(`${base}/api/admin/users`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(users.list[0].admin, true);
  assert.equal(typeof users.reg_open, "boolean");
  // Admin rename: any account can be renamed; password and saves are untouched (they hang off user_id).
  const adminName = users.list[0].username;
  const renameOld = `rn_${String(Date.now()).slice(-8)}`, renameNew = `rm_${String(Date.now()).slice(-8)}`;
  await post(base, "/api/register", null, { username: renameOld, password: "test-password-789" });
  const renameId = (await fetch(`${base}/api/admin/users`, { headers: { "X-Token": token } }).then(r => r.json())).list.find(u => u.username === renameOld).id;
  const renamed = await post(base, "/api/admin/user/rename", token, { id: renameId, username: renameNew });
  assert.equal(renamed.username, renameNew);
  const usersAfter = await fetch(`${base}/api/admin/users`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.ok(usersAfter.list.some(u => u.username === renameNew));
  assert.ok(!usersAfter.list.some(u => u.username === renameOld));
  await assert.rejects(post(base, "/api/login", null, { username: renameOld, password: "test-password-789" }), /账号或密码错误/);
  const relogin = await post(base, "/api/login", null, { username: renameNew, password: "test-password-789" });
  assert.ok(relogin.token);
  await assert.rejects(post(base, "/api/admin/user/rename", token, { id: renameId, username: adminName }), /账号已存在/);
  const nonAdminToken = relogin.token;
  await assert.rejects(post(base, "/api/admin/user/rename", nonAdminToken, { id: renameId, username: `nope_${Date.now()}` }));
  const usersFinal = await fetch(`${base}/api/admin/users`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.ok(usersFinal.list.some(u => u.username === renameNew));
  await post(base, "/api/admin/gift", token, { code: "SERVERTESTGIFT", items: [{ c: "stone", n: 25 }], uses: 1 });
  const gifts = await fetch(`${base}/api/admin/gifts`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(gifts.list[0].code, "SERVERTESTGIFT");
  const gift = await post(base, "/api/gift", token, { code: "SERVERTESTGIFT" });
  assert.equal(gift.state.stone, persisted.data.stone + 25);
  assert.equal(gift.got.length, 1);

  // Admin config editing: invalid code is rejected, valid code is served and used immediately.
  const cfgList = await fetch(`${base}/api/admin/config`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.ok(cfgList.list.some(f => f.name === "start.js"));
  const original = await fetch(`${base}/api/config/start.js`).then(r => r.text());
  const loaderBefore = await fetch(`${base}/api/config-loader.js`).then(r => r.text());
  assert.match(loaderBefore, /api\/config-bundle\.js\?h=[0-9a-f]{12}/);
  const bad = await fetch(`${base}/api/admin/config/save`, { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token }, body: JSON.stringify({ name: "start.js", content: "CFG.start = {" }) });
  assert.equal(bad.status, 400);
  const edited = original + "\n// edited-by-admin-test\n";
  const configNotice = waitFor(m => m.type === "config", 30_000);   // 参数保存后才广播：保存要同步校验（现建引擎），满载时 8 秒默认等待不够
  await post(base, "/api/admin/config/save", token, { name: "start.js", content: edited });
  await configNotice;
  assert.equal(await fetch(`${base}/api/config/start.js`).then(r => r.text()), edited);
  const loaderAfter = await fetch(`${base}/api/config-loader.js`).then(r => r.text());
  assert.notEqual(loaderAfter.match(/config-bundle\.js\?h=\w+/)[0], loaderBefore.match(/config-bundle\.js\?h=\w+/)[0], "edited config gets a new URL");
  assert.ok((await fetch(`${base}/api/config-bundle.js`).then(r => r.text())).includes("// edited-by-admin-test"), "edited config is served in the bundle immediately");
  const notAdmin = await fetch(`${base}/api/admin/config/file?name=start.js`).then(r => r.status);
  assert.equal(notAdmin, 401);
  await post(base, "/api/admin/config/reset", token, { name: "start.js" });
  assert.equal(await fetch(`${base}/api/config/start.js`).then(r => r.text()), original);

  // A second user has a separate VM and state even while the first socket is live.
  const secondToken = (await post(base, "/api/register", null, { username: `test2_${Date.now()}`, password: "test-password-456" })).token;
  const secondChar = await post(base, "/api/character", secondToken, { name: "隔离账号" });
  assert.equal(secondChar.data.auto, false);
  const ticket2 = (await post(base, "/api/ws-ticket", secondToken)).ticket;
  socket2 = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket2)}`);
  const waitFor2 = messageQueue(socket2);
  await new Promise((resolve, reject) => { socket2.once("open", resolve); socket2.once("error", reject); });
  assert.equal((await waitFor2(m => m.type === "snapshot")).state.name, "隔离账号");
  socket2.send(JSON.stringify({ type: "action", id: "second-player-01", action: "toggleAuto", args: [] }));
  assert.equal((await waitFor2(m => m.type === "result" && m.id === "second-player-01")).state.auto, true);
  const firstAgain = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(firstAgain.data.auto, true);
  // 测试模式（config/rates.js TEST: 1）对管理员生效：重新载入时灵石被填成测试值，礼包加的不保留
  const testOn = /\bTEST:\s*1\b/.test((await fs.readFile(new URL("../../web/js/config/rates.js", import.meta.url), "utf8")));
  if (!testOn) assert.equal(firstAgain.data.stone, persisted.data.stone + 25);
});

test("审计修复：服务端容灾、校验、级联与限流", { timeout: 120_000 }, async t => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiu-online-test-"));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(HERE, "../server.mjs")], {
    cwd: path.join(HERE, ".."),
    env: { ...process.env, XIU_HOST: "127.0.0.1", XIU_PORT: String(port), XIU_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  let socket;
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const rawPost = (route, token, payload) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Token": token } : {}) }, body: JSON.stringify(payload) });
  const waitClose = sock => new Promise(resolve => sock.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  const waitWsError = sock => new Promise(resolve => sock.once("error", err => resolve(err)));

  await waitHealth(base, child);
  const admin = await post(base, "/api/register", null, { username: `adm_${Date.now()}`, password: "admin-password-123" });
  assert.equal(admin.admin, true);
  const adminToken = admin.token;
  const adminId = (await fetch(`${base}/api/admin/users`, { headers: { "X-Token": adminToken } }).then(r => r.json())).list[0].id;
  await post(base, "/api/character", adminToken, { name: "审计主档" });

  // #1 损坏存档：连 WS 应收 4005，服务器不崩、/health 仍活
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path.join(dataDir, "xiu-online.sqlite3"));
  db.prepare("UPDATE saves SET data=? WHERE user_id=?").run("corrupt{", adminId);
  const ticket1 = (await post(base, "/api/ws-ticket", adminToken)).ticket;
  const badSocket = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket1)}`);
  const closed = await waitClose(badSocket);
  assert.equal(closed.code, 4005);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  db.prepare("DELETE FROM saves WHERE user_id=?").run(adminId);
  await post(base, "/api/character", adminToken, { name: "审计主档" });

  // #2 参数语义校验：空文件、数字变字符串都 400；合法改动 200；S-35 写盘权限 0o640
  const craftsman = await fetch(`${base}/api/config/craftsman.js`).then(r => r.text());
  assert.ok(craftsman.includes("RATE_BASE: 86"), "基线 craftsman.js 应含 RATE_BASE: 86");
  assert.equal((await rawPost("/api/admin/config/save", adminToken, { name: "craftsman.js", content: "" })).status, 400);
  assert.equal((await rawPost("/api/admin/config/save", adminToken, { name: "craftsman.js", content: craftsman.replace("RATE_BASE: 86", "RATE_BASE: \"86\"") })).status, 400);
  const editedCraftsman = craftsman + "\n// edited-by-audit-test\n";
  assert.equal((await rawPost("/api/admin/config/save", adminToken, { name: "craftsman.js", content: editedCraftsman })).status, 200);
  assert.equal(await fetch(`${base}/api/config/craftsman.js`).then(r => r.text()), editedCraftsman);
  assert.equal((await fs.stat(path.join(dataDir, "config", "craftsman.js"))).mode & 0o777, 0o640);
  await post(base, "/api/admin/config/reset", adminToken, { name: "craftsman.js" });
  assert.equal(await fetch(`${base}/api/config/craftsman.js`).then(r => r.text()), craftsman);

  // #11 多文件原子保存：一份坏了两份都不生效；两份都好了一次生效
  const rates = await fetch(`${base}/api/config/rates.js`).then(r => r.text());
  const realm = await fetch(`${base}/api/config/realm.js`).then(r => r.text());
  assert.equal((await rawPost("/api/admin/config/save-multi", adminToken, { files: [{ name: "rates.js", content: "CFG.rates = {" }, { name: "realm.js", content: realm + "\n// audit-multi\n" }] })).status, 400);
  assert.equal(await fetch(`${base}/api/config/realm.js`).then(r => r.text()), realm);
  const multi = await post(base, "/api/admin/config/save-multi", adminToken, { files: [{ name: "rates.js", content: rates + "\n// audit-multi\n" }, { name: "realm.js", content: realm + "\n// audit-multi\n" }] });
  assert.deepEqual(multi.names, ["rates.js", "realm.js"]);
  assert.match(await fetch(`${base}/api/config/rates.js`).then(r => r.text()), /audit-multi/);
  assert.match(await fetch(`${base}/api/config/realm.js`).then(r => r.text()), /audit-multi/);
  await post(base, "/api/admin/config/reset", adminToken, { name: "rates.js" });
  await post(base, "/api/admin/config/reset", adminToken, { name: "realm.js" });

  // S-34 礼包创建校验：重名码、非法类别都 400
  await post(base, "/api/admin/gift", adminToken, { code: "AUDITGIFT", items: [{ c: "stone", n: 5 }], uses: 1 });
  await assert.rejects(post(base, "/api/admin/gift", adminToken, { code: "AUDITGIFT", items: [{ c: "stone", n: 5 }], uses: 1 }), /礼包码已存在/);
  await assert.rejects(post(base, "/api/admin/gift", adminToken, { code: "AUDITGIFT2", items: [{ c: "nope", n: 5 }], uses: 1 }), /类别无效/);
  await assert.rejects(post(base, "/api/admin/gift", adminToken, { code: "AUDITGIFT3", items: [{ c: "dan" }], uses: 1 }), /缺少 item/);

  // #3 删主号连同小号一起删（第二个管理员由 SQL 直插，绕开“只能首个注册是管理员”）
  const salt = "0".repeat(32), hash = "0".repeat(64);
  const main2 = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)").run("audit_main2", salt, hash, 1, Date.now()).lastInsertRowid;
  const sub2 = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at,owner_id) VALUES(?,?,?,?,?,?)").run("audit_main2#2", salt, hash, 1, Date.now(), main2).lastInsertRowid;
  await post(base, "/api/admin/user/del", adminToken, { id: Number(main2) });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE id IN (?,?)").get(main2, sub2).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE id=?").get(adminId).n, 1);

  // #13 小号不能直接改名
  const sub1 = (await post(base, "/api/admin/char/new", adminToken, {})).id;
  await assert.rejects(post(base, "/api/admin/user/rename", adminToken, { id: sub1, username: "newname1" }), /小号不能直接改名/);

  // #6 改密后已连 WS 被关（4003），旧令牌失效
  const user6 = await post(base, "/api/register", null, { username: `pw_${Date.now()}`, password: "old-password-123" });
  await post(base, "/api/character", user6.token, { name: "改密档" });
  const ticket6 = (await post(base, "/api/ws-ticket", user6.token)).ticket;
  socket = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket6)}`);
  const waitFor6 = messageQueue(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  await waitFor6(m => m.type === "snapshot");
  const close6 = waitClose(socket);
  await post(base, "/api/password", user6.token, { old: "old-password-123", new: "new-password-456" });
  assert.equal((await close6).code, 4003);
  assert.equal(await fetch(`${base}/api/session`, { headers: { "X-Token": user6.token } }).then(r => r.status), 401);
  socket = null;

  // S-4 登录限流：10 次错密码后 429，正确密码也被挡
  const brute = `brute_${Date.now()}`;
  await post(base, "/api/register", null, { username: brute, password: "right-password-123" });
  for (let i = 0; i < 10; i++) assert.equal((await rawPost("/api/login", null, { username: brute, password: "wrong" })).status, 401);
  assert.equal((await rawPost("/api/login", null, { username: brute, password: "wrong" })).status, 429);
  assert.equal((await rawPost("/api/login", null, { username: brute, password: "right-password-123" })).status, 429);

  // S-6 错误 Origin 的票作废：403 后同票从合法来源再连变 401（票已被删）
  const ticket6b = (await post(base, "/api/ws-ticket", adminToken)).ticket;
  const evil = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket6b)}`, { origin: "http://evil.example" });
  assert.match((await waitWsError(evil)).message, /403/);
  const evil2 = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket6b)}`);
  assert.match((await waitWsError(evil2)).message, /401/);
  db.close();
});
