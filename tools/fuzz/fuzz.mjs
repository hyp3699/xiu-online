// 自动狂点机器人：直接调引擎，随机做大量白名单操作，每步检查不变量。
// 用法：node tools/fuzz/fuzz.mjs [--seed N] [--steps N] [--mode test|boost|normal] [--out dir]
//   test   = 调试人物测试模式（炼制 1 秒、不限境界、四界全开），最快跑到后期内容
//   boost  = 正常规则，但定期给大量灵石 / 灵气 / 材料 / 装备、提升境界、拨快时间
//   normal = 不作弊，只拨快时间
// 发现问题写到 out/<seed>.json（含复现用的操作序列），同类问题只记前几次。
import { GameEngine } from "../../server/game-engine.mjs";
import fs from "node:fs";
import path from "node:path";

const argv = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, A) => (!x.startsWith("--") ? a : x.includes("=") ? a.concat([[x.slice(2, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]]) : a.concat([[x.slice(2), A[i + 1]]])), []));   // --seed 5 和 --seed=5 都认
const SEED = +(argv.seed ?? Date.now() % 1e9), STEPS = +(argv.steps ?? 20000), MODE = argv.mode || "test";
const OUT = argv.out || path.join(path.dirname(new URL(import.meta.url).pathname), "out");
fs.mkdirSync(OUT, { recursive: true });

// ---------- 可复现的随机 ----------
let rs = (SEED * 2654435761) >>> 0 || 1;
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];

const e = new GameEngine();
let gs = (SEED ^ 0x9e3779b9) >>> 0 || 7;
e.seedRandom = function () { this.random = () => { gs ^= gs << 13; gs >>>= 0; gs ^= gs >>> 17; gs ^= gs << 5; gs >>>= 0; return gs / 4294967296; }; };
if (MODE === "test") e.setDebug(true);
const G = e.G, D = e.DATA;
let now = 1_800_000_000_000;
let s = e.createState("狂点" + SEED, now);
e.bindState(s, now); s = e.G.s;

const WL = JSON.parse(fs.readFileSync(new URL("../../server/action-whitelist.json", import.meta.url), "utf8"))
  .filter(a => typeof G[a] === "function");
// 不点的：重置存档（会把进度清掉，单独低频点）
const RARE = new Set(["doReset", "leaveSect", "forgetGongfa", "xjResign", "svFire"]);
const WL_COMMON = WL.filter(a => !RARE.has(a));
const params = {};
for (const a of WL) { const m = G[a].toString().match(/^[^(]*\(([^)]*)\)/); params[a] = m ? m[1].split(",").map(x => x.trim().replace(/\s*=.*$/, "")).filter(Boolean) : []; }

// ---------- 参数池（按参数名猜） ----------
const SLOTS = D.equipSlots.concat(["fb0", "fb1", "fb2", "fb3", "fb4", "fabao", "ring"]);
const ELS = D.elements.map(x => x.id);
const KINDS = ["eq", "ring", "ss", "dan", "qi", "xdan", "sdan", "fabao", "lz", "herb", "ore", "gf", "ling", "sm", "ys", "lj", "rlx", "hp", "atk", "def", "mana", "exp", "body", "stone", "juqi", "juling", "peiyuan", "auto", "rot"];
const uids = () => { const o = []; const add = x => { if (x && x.uid) o.push(x.uid); };
  (s.bag || []).forEach(it => it && it.e && add(it.e)); Object.values(s.equip || {}).forEach(add); (s.fabao || []).forEach(add); (s.mailbox || []).forEach(m => m && o.push(m.id)); return o; };
const bagIdx = () => { const o = []; (s.bag || []).forEach((x, i) => x && o.push(i)); return o; };
const ids = () => [...Object.keys(s.lgYs || {}), ...Object.keys(s.gongfa || {}), ...Object.keys(s.ysFav || {}), ...(s.recipes || []).map(String), ...(s.forgeKnown || [])];
function genArg(name) {
  const n = name.toLowerCase(), r = rnd();
  if (r < 0.05) return pick([null, -1, 0, 1, 999, "", "x"]);   // 少量垃圾参数
  if (/uid/.test(n)) { const u = uids(); return u.length ? pick(u) : "none"; }
  if (n === "el") return pick(ELS);
  if (/^(slot|sl|key|k2)$/.test(n)) return rnd() < .7 ? pick(SLOTS) : ri(0, 6);
  if (/^(kind|type|t|ch|what|cat)$/.test(n)) return pick(KINDS);
  if (/^(g|grade|tier|lv|star)$/.test(n)) return ri(0, 14);
  if (/^(n|cnt|num|count|qty|amt)$/.test(n)) return pick([1, 1, 2, 5, 10, 100, 1000]);
  if (/^(i|idx|bi|j|from|to|src|dst|pos|at)$/.test(n)) { const b = bagIdx(); return rnd() < .7 && b.length ? pick(b) : ri(0, 30); }
  if (/^(id|gid|sid|yid|mid)$/.test(n)) { const I = ids(); return rnd() < .6 && I.length ? pick(I) : ri(0, 60); }
  if (/^(on|v|flag|b|val|yes)$/.test(n)) return pick([true, false, 0, 1, 10, 50]);
  if (/^(a|r|area|map|reg)$/.test(n)) return ri(0, 12);
  if (/^(ft|f|shape)$/.test(n)) return ri(0, 6);
  return pick([0, 1, 2, 3, 5, 10, ri(0, 40), pick(ELS), pick(SLOTS), pick(KINDS), ...(bagIdx().slice(0, 3))]);
}

// ---------- 加速 ----------
function boost() {
  s.stone = Math.max(s.stone || 0, 1e13); s.ling = Math.max(s.ling || 0, 1e13); s.contrib = Math.max(s.contrib || 0, 1e9); s.merit = Math.max(s.merit || 0, 1e7);
  for (const k in (s.ysFav || {})) s.ysFav[k] = Math.max(s.ysFav[k] || 0, 1e6);
  try {
    for (let q = 0; q < 6; q++) { const kind = pick(["herb", "ore"]), L = kind === "herb" ? D.herbs : D.ores, g = ri(0, L.length - 1); G.addMat(kind, L[g], g, ri(100, 5000)); }
    if (G.addSeed) G.addSeed(rnd() < .5 ? ri(0, D.herbs.length - 1) : D.LG_BASE + ri(0, 17), ri(1, 20));
    if (G.addLg && D.lgN) G.addLg(ri(0, D.lgN() - 1), ri(1, 5));
    if (G.addStone) G.addStone(ri(0, 11));
    if (rnd() < .5) G.addEquip(D.rollForged(pick(["helmet", "armor", "weapon", "legs", "boots", "pendant", "fabao"]), ri(0, 10), ri(0, 6), pick(ELS)));
  } catch (err) { report("boost", err, []); }
  if (MODE === "boost" && rnd() < .3) { s.mortal = false; s.L = Math.min((s.L || 0) + ri(1, 10), (D.realms ? D.realms.length * 10 : 300) - 1); s.bodyL = Math.min((s.bodyL ?? -1) + 1, 230); G._cache = null; }
}

// ---------- 不变量检查 ----------
const seen = {}, found = [];
const trail = [];
function report(kind, err, extra) {
  const msg = String(err && err.message || err).slice(0, 300), key = kind + ":" + (kind === "日志异常" ? msg.replace(/：.*/, "").replace(/\d+/g, "#") : msg.replace(/\d+/g, "#"));
  seen[key] = (seen[key] || 0) + 1; if (seen[key] > 3) return;
  found.push({ kind, msg, stack: err && err.stack ? String(err.stack).split("\n").slice(0, 6).join("\n") : "", step: step, extra, trail: trail.slice(-30) });
  console.log(`[${SEED}] #${step} ${kind}: ${msg}`);
}
function scan(o, p, out, depth = 0) {
  if (depth > 12 || out.length > 5) return;
  if (typeof o === "number") { if (!Number.isFinite(o)) out.push(["NaN/Infinity", p]); return; }
  if (!o || typeof o !== "object") return;
  for (const k in o) {
    if (k === "log" || k === "_nm") continue;
    const v = o[k], q = p + "." + k;
    if (typeof v === "number" && v < 0 && /^(n|c|stone|ling|contrib|merit|lingye|exp|bodyExp|cnt)$/.test(k) && !/(_|bset)/.test(p)) out.push(["负数", q + "=" + v]);
    scan(v, q, out, depth + 1);
  }
}
function checkState(act) {
  const bad = []; scan(s, "s", bad);
  bad.forEach(([k, p]) => report(k, p, CUR));
  // 同一件装备出现两次（复制 bug）
  const u = {}, dup = [];
  const see = (x, where) => { if (!x || !x.uid) return; if (u[x.uid]) dup.push(`${x.uid} @${u[x.uid]} & ${where}`); else u[x.uid] = where; };
  (s.bag || []).forEach((it, i) => it && it.e && see(it.e, "bag" + i));
  Object.entries(s.equip || {}).forEach(([k, x]) => see(x, "equip." + k));
  (s.fabao || []).forEach((x, i) => see(x, "fabao" + i));
  for (const q of [s.forgeJob, ...(s.forgeQueue || [])]) if (q) { see(q.prev, "forge.prev"); if (!q.worn) see(q.item, "forge.item"); see(q.mat, "forge.mat"); }
  (s.mailbox || []).forEach((m, i) => m && m.it && m.it.e && see(m.it.e, "mail" + i));
  if (s.bm && s.bm.e) see(s.bm.e, "bm");
  dup.forEach(d => report("物品复制", d, CUR));
  let broken = bad.length > 0 || dup.length > 0;
  try { e.advance(structuredClone(s), now + 60000); e.bindState(s, now); s = e.G.s; } catch (err) { report("结算报错（存档卡死）", err, CUR); broken = true; e.bindState(s, now); s = e.G.s; }
  // 背包：格子数、堆叠数
  if ((s.bag || []).length > (s.bagCap || 0) + 400) report("背包越界", `bag ${s.bag.length} cap ${s.bagCap}`, { act });
  (s.bag || []).forEach((it, i) => { if (it && it.n !== undefined && !(it.n > 0)) report("空堆叠", `bag${i} ${JSON.stringify(it).slice(0, 120)}`, { act }); });
  // 日志里出现 undefined / NaN / [object Object]
  for (const L of (e.logs || [])) { const m = typeof L === "string" ? L : (L && (L.m || L.msg || L.text)) || ""; if (/undefined|NaN|\[object Object\]/.test(m)) report("日志异常", m.slice(0, 200), CUR); }
  for (const L of (s.log || []).slice(-5)) { const m = L && L.m || ""; if (/undefined|NaN|\[object Object\]/.test(m)) { report("日志异常", m.slice(0, 200), CUR); L.m = "(已报告)"; } }
  return broken;
}

// ---------- 主循环 ----------
let step = 0, CUR = {};
const junky = args => args.some(a => a === null || a === "" || a === "x" || a === 999 || a === -1);
const t0 = Date.now(), stats = { ok: 0, err: 0, perAct: {} };
for (step = 0; step < STEPS; step++) {
  if (MODE !== "normal" && step % 150 === 0) boost();
  // 拨快时间：多数操作间隔几秒，偶尔跳几分钟到几小时（推动炼制、种田、修炼、离线结算）
  const r = rnd(); now += r < .7 ? ri(1, 20) * 1000 : r < .95 ? ri(1, 30) * 60000 : ri(1, 12) * 3600000;
  let act = pick(WL); if (RARE.has(act) && rnd() > .02) act = pick(WL_COMMON);   // 稀有操作只保留 2%（原来判断和取用的是两次不同的随机，等于没节流）
  const args = params[act].map(genArg);
  trail.push([now, act, args]); if (trail.length > 60) trail.shift();
  // 和服务器一样：在副本上执行，出错就丢弃副本（存档不变）
  const backup = structuredClone(s);
  try { e.act(s, act, args, now); s = e.G.s; stats.ok++; CUR = { act, args }; }
  catch (err) {
    stats.err++;
    const m = String(err && err.message || err), st = String(err && err.stack || "");
    const tick = /runTicks|advance \(|exAdvance|tickAll|advanceExplore|advanceTrib/.test(st);
    if (m === "操作数据异常，已取消") report("被兜底拦下（应在操作里处理）", err.detail || m, { act, args });
    else if (m === "操作参数无效" && err.cause) { const c = err.cause; report(junky(args) ? "坏参数报错（服务器会回滚）" : "操作报错", c, { act, args }); }
    else if (tick) report("结算报错（存档卡死）", err, { act, args });
    else if (!/未知操作|不允许调用/.test(m) && ["TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(err && err.name)) report(junky(args) ? "坏参数报错（服务器会回滚）" : "操作报错", err, { act, args });
    s = backup; e.bindState(s, now); s = e.G.s;
  }
  (stats.perAct[act] = stats.perAct[act] || 0), stats.perAct[act]++;
  try { if (checkState(act)) { s = backup; e.bindState(s, now); s = e.G.s; } }   // 坏状态：记下后回到操作前，免得一个错连锁卡死后面
  catch (err) { report("检查出错", err, { act }); }
  // 存档往返：序列化再读回（模拟重启服务器 / 重新登录）
  if (step % 500 === 499) {
    try { const j = JSON.parse(JSON.stringify(s)); e.bindState(j, now); s = e.G.s; e.advance(s, now + 1000); now += 1000; }
    catch (err) { report("存档读回报错", err, {}); }
  }
  if (step % 2000 === 1999) save();   // 中途也存，机器被停也不丢结果
}
save(true);
function save(end) {
const sum = { seed: SEED, mode: MODE, steps: step, sec: Math.round((Date.now() - t0) / 1000), realm: s.L, mortal: s.mortal, body: s.bodyL, ok: stats.ok, err: stats.err, issues: found.length, kinds: seen };
fs.writeFileSync(path.join(OUT, `${MODE}-${SEED}.json`), JSON.stringify({ sum, found }, null, 1));
if (end) console.log(JSON.stringify(sum));
}
