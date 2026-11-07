import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const T0 = 1_800_003_000_000;
const setup = () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("炼器穿戴", T0); e.bindState(s, T0); G.s = s; G._cache = null;
  s.bag = []; G.craftFree = () => true; G.forgeRate = () => 1;
  s.furnaceUse.qi = 11; s.furnaces.qi = [11]; s.forgeKnown.push("eq:weapon:3");
  const mk = (slot, g) => { const x = D.rollForged(slot, g); x.uid = x.uid || D.newUid(); return x; };
  return { D, G, s, mk };
};
const done = (G, s) => { G.now = () => T0 + 1e13; for (let k = 0; k < 8; k++) G.craftTick(); };

test("升星列表：身上、背包的上一星全部列出", () => {
  const { G, s, mk } = setup();
  s.equip.weapon = mk("weapon", 2); s.bag.push({ t: "eq", e: mk("weapon", 2) }, { t: "eq", e: mk("weapon", 1) }, { t: "eq", e: mk("helmet", 2) });
  const L = G.prevList("weapon", 3);
  assert.equal(L.length, 2); assert.equal(L[0][1], "已装备"); assert.equal(L[1][1], "");
  let html = ""; G.modal = h => { html = h; }; G.openForgeN("eq", 3, "weapon");
  assert.equal((html.match(/G\.pickPrev\(/g) || []).length, 2); assert.ok(html.includes("已装备"));
});

test("选身上穿的那件：卸下炼制，炼好放背包", () => {
  const { G, s, mk } = setup();
  const worn = mk("weapon", 2), inBag = mk("weapon", 2); s.equip.weapon = worn; s.bag.push({ t: "eq", e: inBag });
  G.craftFurnace("eq", 3, "weapon", null, null, worn.uid);
  assert.equal(s.forgeJob.prev, worn); assert.equal(s.equip.weapon, null); assert.equal(s.bag[0].e, inBag);   // 背包那件没动
  done(G, s);
  assert.equal(s.equip.weapon, null);
  assert.ok(s.bag.some(x => x && x.t === "eq" && x.e.slot === "weapon" && x.e.g === 3 && x.e.uid === worn.uid));
  assert.equal(s.bag.filter(x => x && x.t === "eq").length, 2);   // 新的 3 星 + 没用的 2 星，没有多出来
});

test("选背包那件不动身上；失败、取消都退回背包；不对的 uid 不炼", () => {
  const { G, s, mk } = setup();
  const worn = mk("weapon", 2), inBag = mk("weapon", 2), wrong = mk("weapon", 1); s.equip.weapon = worn; s.bag.push({ t: "eq", e: inBag }, { t: "eq", e: wrong });
  G.craftFurnace("eq", 3, "weapon", null, null, wrong.uid); assert.equal(s.forgeJob, null);
  G.craftFurnace("eq", 3, "weapon", null, null, "nope"); assert.equal(s.forgeJob, null);
  G.craftFurnace("eq", 3, "weapon", null, null, inBag.uid); assert.equal(s.equip.weapon, worn); assert.equal(s.forgeJob.prev, inBag);
  G.craftFurnace("eq", 3, "weapon", null, null, worn.uid); assert.equal(s.equip.weapon, null);
  G.craftFurnace("eq", 3, "weapon", null, null, worn.uid); assert.equal(s.forgeQueue.length, 1);   // 同一件不能再用
  const q = s.forgeQueue.shift(); G.refundJob(q);
  assert.equal(s.equip.weapon, null); assert.equal(s.bag.filter(x => x && x.t === "eq" && x.e.uid === worn.uid).length, 1);
  G.forgeRate = () => 0; done(G, s);
  assert.equal(s.bag.filter(x => x && x.t === "eq" && x.e.uid === inBag.uid).length, 1);   // 失败退回背包，只一件
});

test("戒指、法宝栏的也能选，炼好进背包", () => {
  const { D, G, s, mk } = setup();
  const r = D.rollForged("ring", 1, 3); r.uid = D.newUid(); s.equip.ring2 = r; s.forgeKnown.push("ring:3:2");
  G.ringKnown = () => true;
  assert.equal(G.prevList("ring", 2, 3).length, 1);
  G.craftFurnace("ring", 2, 3, null, null, r.uid); assert.ok(s.forgeJob); assert.equal(s.equip.ring2, null);
  done(G, s); assert.ok(s.bag.some(x => x && x.t === "eq" && x.e.uid === r.uid && x.e.g === 2));
  const f = D.rollForged("fabao", 1, 0, "huo"); f.uid = D.newUid(); s.fabao[0] = f; s.forgeKnown.push("eq:fabao:2");
  assert.equal(G.prevList("fabao", 2, 0, "huo").length, 1); assert.equal(G.prevList("fabao", 2, 1, "huo").length, 0);
});

test("联机：act 传 JSON 参数（undefined 变 null）也能按 uid 炼身上那件", () => {
  const e = new GameEngine(), D = e.DATA;
  const s = e.createState("联机炼器", T0); s.bag = []; s.furnaceUse.qi = 11; s.furnaces.qi = [11]; s.forgeKnown.push("eq:weapon:3");
  const w = D.rollForged("weapon", 2); w.uid = D.newUid(); s.equip.weapon = w;
  e.G.craftFree = () => true;
  const args = JSON.parse(JSON.stringify(["eq", 3, "weapon", undefined, undefined, w.uid]));
  const out = e.act(s, "craftFurnace", args, T0 + 1000);
  const st = (out && out.state) || s;
  assert.equal(st.equip.weapon, null); assert.ok(st.forgeJob && st.forgeJob.prev.uid === w.uid);
});

test("装备 / 戒指可选耀石：指定那种只扣那种，不够不炼；不选按自动", () => {
  const { G, s, mk } = setup(); G.craftFree = () => false; G.hasMats = () => true; G.takeMat = () => {};
  G.addSm("ys", 1000, 0); G.addSm("ys", 1, 4); G.addSm("ys", 500, 2);
  const a = mk("weapon", 2), b = mk("weapon", 2), c = mk("weapon", 2); s.bag.push({ t: "eq", e: a }, { t: "eq", e: b }, { t: "eq", e: c });
  const per = G.jobSm({ kind: "eq", g: 3, slot: "weapon" })[0].n; assert.ok(per > 1);
  G.craftFurnace("eq", 3, "weapon", null, null, a.uid, 2);
  assert.equal(G.smCount("ys", 2), 500 - per); assert.equal(G.smCount("ys", 0), 1000);
  assert.equal(JSON.stringify(s.forgeJob.sm), JSON.stringify([{ k: "ys", ft: 2, n: per }]));
  G.craftFurnace("eq", 3, "weapon", null, null, b.uid, 4); assert.equal(s.forgeQueue.length, 0);   // 土耀石不够
  G.craftFurnace("eq", 3, "weapon", null, null, b.uid, "x");   // 非法值 = 自动：扣最多的金耀石
  assert.equal(G.smCount("ys", 0), 1000 - per); assert.equal(s.forgeQueue.length, 1);
  let html = ""; G.modal = h => { html = h; }; G.setYs("eq", 2); G.openForgeN("eq", 3, "weapon");
  assert.ok(html.includes("G.setYs('eq',2)")); G.pickPrev(c.uid);
  assert.equal(G.smCount("ys", 2), 500 - 2 * per);
});
