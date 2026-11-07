import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

test("种子：宝库无限兑换进背包，种植和续种各扣 1 颗，可出售，特色药材不兑换", () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("种子", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  s.sect = Object.keys(D.sectById).find(id => D.sectById[id].star === 1); s.rank = 0; s.contrib = 1000; s.ling = 1e9; s.stone = 1e9;
  assert.equal(D.seedCost(0), D.matPrice("herb", 0) * 5);
  G.exchangeSeed(0, 3); G.exchangeSeed(0, 2);
  assert.equal(G.seedCount(0), 5); assert.equal(s.contrib, 1000 - 5 * D.seedCost(0));
  const it = s.bag.find(x => x && x.t === "seed");
  assert.equal(G.sellPrice(it), D.matPrice("herb", 0) * 3);
  const qh = D.herbs.indexOf("琼华仙草"); assert.ok(qh >= 0 && D.herbGrow(qh) && D.seedDropOnly(qh));
  assert.equal(G.seedList().some(x => x.g === qh), false);
  G.openField(); G.plantField(0, 0);
  assert.equal(s.fields[0].g, 0); assert.equal(G.seedCount(0), 4);
  const f = s.fields[0]; f.start -= G.fieldTime(0) + 1000;
  G.tickAll(false);   // 成熟收获，自动续种再扣 1 颗
  assert.equal(G.seedCount(0), 3); assert.ok(G.countMat("herb", 0) > 0); assert.equal(f.wait, false);
  G.takeSeed(0, 3); f.start -= G.fieldTime(0) + 1000; G.tickAll(false);
  assert.equal(f.wait, "seed");   // 没种子就停
  G.addSeed(0, 1); G.tickAll(false); assert.equal(f.wait, false); assert.equal(G.seedCount(0), 0);
  G.addSeed(1, 1); G.plantField(0, 1); assert.equal(f.next, 1);   // 约好换种
  G.plantField(0, 0); assert.equal(f.next, null);                 // 当前药材没种子也能取消换种
});

test("种子掉落：地图探索走完按几率掉，特色药材只在本界地图掉", () => {
  const e = new GameEngine(), D = e.DATA, G = e.G, C = e.CFG || globalThis.CFG;
  const s = e.createState("种子2", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  C.garden.SEED_DROP = 100; C.garden.SEED_DROP_SPECIAL = 100;
  const a = D.worldMapIdx.xian[0], x = { map: a, loot: G.newLoot() };
  G.rollSeedDrop(x);
  const gs = Object.keys(x.loot.seed).map(Number);
  assert.ok(gs.includes(D.herbs.indexOf("琼华仙草"))); assert.equal(gs.length, 2);
  const y = { map: 0, loot: G.newLoot() }; G.rollSeedDrop(y);
  assert.equal(Object.keys(y.loot.seed).length, 1); assert.ok(+Object.keys(y.loot.seed)[0] < D.FAN_HERB_N);
  G.giveLoot(x.loot); assert.ok(s.bag.filter(b => b && b.t === "seed").length >= 1);
  C.garden.SEED_DROP = 6; C.garden.SEED_DROP_SPECIAL = 12;
});

test("种子掉落：每人每天每种最多 SEED_DROP_DAY_MAX 颗", () => {
  const e = new GameEngine(), G = e.G, C = e.CFG || globalThis.CFG;
  const s = e.createState("种子3", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  C.garden.SEED_DROP = 100; C.garden.SEED_DROP_SPECIAL = 0;
  const tot = {};
  for (let i = 0; i < 300; i++) { const x = { map: 0, loot: G.newLoot() }; G.rollSeedDrop(x); for (const k in x.loot.seed || {}) tot[k] = (tot[k] || 0) + x.loot.seed[k]; }
  const n = Object.keys(tot).length; assert.ok(n >= 1);
  for (const k in tot) assert.equal(tot[k], 9);
  s.seedDrop.day = -1; const y = { map: 0, loot: G.newLoot() }; G.rollSeedDrop(y);   // 换日重置
  assert.equal(Object.keys(y.loot.seed || {}).length, 1);
  C.garden.SEED_DROP = 6; C.garden.SEED_DROP_SPECIAL = 12;
});
