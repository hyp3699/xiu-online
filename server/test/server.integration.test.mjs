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
    { id: "test-bset-foe-01", action: "bsetFoe", args: ["mob", "atk"], check: state => assert.equal(state.bset.foe.mob, "atk") },
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
  socket.send(JSON.stringify({ type: "action", id: invalidSettingId, action: "bsetFoe", args: ["unknown", "atk"] }));
  const invalidSetting = await waitFor(m => m.type === "result" && m.id === invalidSettingId);
  assert.equal(invalidSetting.ok, false);
  assert.equal(invalidSetting.state.bset.foe.mob, "atk");
  const persistedSettings = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(persistedSettings.data.bset.foe.mob, "atk");
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
  const configNotice = waitFor(m => m.type === "config");
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
