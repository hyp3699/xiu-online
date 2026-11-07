import test from "node:test"; import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";
test("灵田勾选自动更换：种子用完随机换有种子的作物", () => {
  const e = new GameEngine(); let now = 1_800_000_000_000; const s = e.createState("t", now);
  e.bindState(s, now); const G = e.G; s.stone = 1e9; s.ling = 1e12;
  G.openField(); G.addSeed(0, 1); G.addSeed(1, 3); G.addSeed(2, 3);
  e.act(s, "plantField", [0, 0], now); const st = e.G.s;
  assert.equal(st.fields[0].g, 0);
  e.act(st, "fieldAuto", [0, true], now);
  now += 400 * 3600e3; e.act(st, "sortBagNow", [], now);
  assert.ok([1, 2].includes(e.G.s.fields[0].g), "应换成 1 或 2");
  assert.ok(e.G.G === undefined && e.G.seedCount(1) + e.G.seedCount(2) < 6, "换种后应接着种（消耗了 1、2 的种子）");
});
test("没勾选：缺种子就等待", () => {
  const e = new GameEngine(); let now = 1_800_000_000_000; const s = e.createState("t", now);
  e.bindState(s, now); const G = e.G; s.stone = 1e9; s.ling = 1e12;
  G.openField(); G.addSeed(0, 1); G.addSeed(1, 3);
  e.act(s, "plantField", [0, 0], now); now += 400 * 3600e3; e.act(e.G.s, "sortBagNow", [], now);
  assert.equal(e.G.s.fields[0].g, 0); assert.equal(e.G.s.fields[0].wait, "seed");
});
