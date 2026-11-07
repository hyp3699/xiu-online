import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const mk = () => { const e = new GameEngine(), G = e.G; const s = e.createState("灵果", 1_800_004_000_000); e.bindState(s, 1_800_004_000_000); G.s = s; return { e, G, D: e.DATA, C: e.CFG || globalThis.CFG, s }; };

test("灵果：服用永久加属性，无上限；修为 / 气血速度加数值；可出售 100", () => {
  const { G, D, s } = mk();
  const idx = n => D.LG().list.findIndex(x => x.name === n);
  const a0 = G.stats().atk, hp0 = G.stats().hp, r0 = G.stats().res.huo, c0 = G.computeSpeed().base, b0 = G.bodySpeed().gf;
  for (const [n, c] of [["赤龙果", 3], ["长生果", 2], ["冰魄花", 1], ["玄元果", 1], ["血菩提", 1], ["火灵枣", 4]]) G.addLg(idx(n), c);
  const eatAll = n => { const i = s.bag.findIndex(x => x && x.t === "lg" && x.k === idx(n)); G.eatLg(i, 99); };
  ["赤龙果", "长生果", "冰魄花", "玄元果", "血菩提", "火灵枣"].forEach(eatAll);
  assert.equal(G.stats().atk - a0, 81); assert.equal(G.stats().hp - hp0, 360); assert.equal(G.stats().res.huo - r0, 0); assert.equal(G.lgBonus().dr.huo, 25);
  assert.equal(G.computeSpeed().base - c0, 120); assert.equal(G.bodySpeed().gf - b0, 120);
  assert.equal(G.lgDmg("huo"), 100);
  G.addLg(0, 1); assert.equal(G.sellPrice(s.bag.find(x => x && x.t === "lg")), 100);
  G.addSeed(D.LG_BASE + 3, 1); assert.equal(G.sellPrice(s.bag.find(x => x && x.t === "seed")), 100);
});

test("灵果种植：72 小时、扣 240 万灵气和 1 颗种子，收获 1~3 颗进背包", () => {
  const { G, D, s } = mk(); s.stone = 1e9; s.ling = 3e6;
  const g = D.LG_BASE + 5; G.addSeed(g, 2); G.openField(); G.plantField(0, g);
  assert.equal(s.fields[0].g, g); assert.equal(s.ling, 600000); assert.equal(G.seedCount(g), 1);
  assert.equal(D.growTime(g), 72 * 3600000);
  s.ling = 3e6; s.fields[0].start -= G.fieldTime(g) + 1000; G.tickAll(false);
  const got = s.bag.filter(x => x && x.t === "lg" && x.k === 5).reduce((t, x) => t + x.n, 0);
  assert.ok(got >= 1 && got <= 3); assert.equal(G.seedCount(g), 0);
});

test("灵果种子：秘境掉落（金丹以上、每人每天每种最多 2）；隐世宗门 18 个各一种，每天一次扣 10 好感", () => {
  const { G, D, C, s } = mk();
  C.garden.LINGGUO.DROP_PCT = 100;
  const lo = C.mijing.list.findIndex(d => (d.realm || 0) < 2), hi = C.mijing.list.findIndex(d => (d.realm || 0) >= 2);
  let x = { mj: lo, loot: G.newLoot() }; G.rollLgSeed(x); assert.equal(x.loot.seed, undefined);
  let total = 0; for (let k = 0; k < 60; k++) { x = { mj: hi, loot: G.newLoot() }; G.rollLgSeed(x); total += Object.values(x.loot.seed || {}).reduce((a, b) => a + b, 0); }
  assert.equal(total, 36); assert.ok(Object.values(s.lgDrop.n).every(n => n === 2));
  C.garden.LINGGUO.DROP_PCT = 40;
  const map = s.lgYs; assert.equal(Object.keys(map).length, 18); assert.equal(new Set(Object.values(map)).size, 18);
  const id = Object.keys(map)[0]; G.ysFound = () => true; s.ysFav = { [id]: 25 };
  G.ysBuyLgSeed(id); G.ysBuyLgSeed(id);
  assert.equal(G.seedCount(D.LG_BASE + map[id]), 1); assert.equal(s.ysFav[id], 15);
});
