import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const T0 = 1_800_002_000_000;
const setup = () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("精炼", T0); e.bindState(s, T0); G.s = s; G._cache = null;
  s.bag = []; G.craftFree = () => true; s.furnaceUse.qi = 0; G.forgeRate = () => 1;
  const w = D.rollForged("weapon", 2), f = D.rollForged("fabao", 2), b = D.rollForged("helmet", 1);
  s.equip.weapon = w; s.fabao = [f]; s.bag.push({ t: "eq", e: b });
  return { D, G, s, w, f, b };
};
const count = s => s.bag.filter(x => x && x.t === "eq").length + (s.fabao || []).filter(Boolean).length + Object.values(s.equip).filter(Boolean).length;

test("身上装备、法宝栏、背包都能精炼：精炼时拿走，出炉放回背包，不会多出一件", () => {
  const { G, s, w, f, b } = setup(), n0 = count(s);
  G.refineEq(w.uid); G.refineEq(f.uid); G.refineEq(b.uid);
  assert.equal(s.equip.weapon, null); assert.equal(s.fabao[0], null); assert.equal(s.bag[0], null); assert.equal(count(s), n0 - 3);
  G.refineEq(w.uid); assert.equal(s.forgeQueue.length, 2);   // 已拿走的不能再点
  G.now = () => T0 + 1e12; for (let k = 0; k < 6; k++) G.craftTick();
  assert.equal(count(s), n0); assert.equal(w.rj, 1); assert.equal(f.rj, 1); assert.equal(b.rj, 1);
  assert.equal(s.bag.filter(x => x && x.t === "eq").length, 3);
});

test("取消精炼放回背包，只放一件", () => {
  const { G, s, f, b } = setup(), n0 = count(s);
  G.refineEq(f.uid); G.refineEq(b.uid);
  G.cancelForgeQ(0); G.stopForge();
  assert.equal(count(s), n0); assert.ok(!f.rj && !b.rj);
});

test("出炉时同一件已在身上，就地 +1，不再放一件", () => {
  const { G, s, w } = setup(), n0 = count(s);
  G.refineEq(w.uid); s.equip.weapon = w;   // 模拟旧问题：拿走后原格还留着
  G.now = () => T0 + 1e12; G.craftTick();
  assert.equal(count(s), n0); assert.equal(w.rj, 1);
});
