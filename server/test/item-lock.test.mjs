import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

test("物品加锁：锁上后出售页不显示、不能出售；装备的锁跟着物品走", () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("加锁", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  s.bag = [{ t: "mat", kind: "ore", g: 0, name: D.matName ? D.matName("ore", 0) : "矿", n: 5 }, { t: "eq", e: D.rollForged("weapon", 2) }];
  G.itemLock("b0"); G.itemLock("b1");
  assert.equal(G.isLocked(s.bag[0]), true); assert.equal(G.isLocked(s.bag[1]), true);
  const st = s.stone; G.sellItem(0, 5); G.sellItem(1, 1);
  assert.equal(s.stone, st); assert.equal(s.bag[0].n, 5); assert.ok(s.bag[1]);
  assert.equal(G.sellPageView(() => true).includes("openSellPick"), false);
  assert.equal(G.views.bag.call(G).includes("itemLock"), false);   // 格子上不显示锁
  let mh = ""; G.modal = h => { mh = h; }; G.openItem(0); assert.ok(mh.includes("G.itemLock('b0')") && mh.includes("ilk on"));
  G.itemLock("b0"); assert.equal(G.isLocked(s.bag[0]), false);
  assert.ok(G.sellPageView(() => true).includes("openSellPick(0)"));
  const w = s.bag[1].e; s.equip.weapon = w; s.bag[1] = null;
  G.openEquip("weapon"); assert.ok(mh.includes("G.itemLock('weapon')"));
  G.itemLock("weapon"); assert.equal(!!w.lk, false); G.itemLock("weapon"); assert.equal(w.lk, 1);
});

test("加锁的材料不能拿去宗门换养神露", () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("加锁2", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  const nm = D.matName("ore", 0);
  s.bag = [{ t: "mat", kind: "ore", g: 0, name: nm, n: 50 }, { t: "mat", kind: "ore", g: 0, name: nm, n: 30 }];
  G.itemLock("b0");
  assert.equal(G.countMat("ore", 0), 80); assert.equal(G.countMat("ore", 0, true), 30);
  G.takeMat("ore", 0, 30, true); assert.equal(s.bag[0].n, 50); assert.equal(G.countMat("ore", 0, true), 0);
  assert.equal(G.luFroms({}).length, 0);
});
