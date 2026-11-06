import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

test("炼制物品出售价 = 所耗材料出售价合计 × 1.1", () => {
  const e = new GameEngine(), D = e.DATA, G = e.G, C = e.CFG || globalThis.CFG;
  const s = e.createState("售价", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  // 1 星装备：3 种凡界矿石各 300 个 × 3 + 1 个耀石 10 = 2710 → 2981
  const w = D.rollForged("weapon", 0);
  assert.equal(G.sellPrice({ t: "eq", e: w }), Math.floor(2710 * 1.1));
  // 精炼 3 次（1 星材料）再加 3 × 2700
  w.rj = 3; assert.equal(G.sellPrice({ t: "eq", e: w }), Math.floor((2710 + 3 * 2700) * 1.1));
  // 2 星装备 = 1 星 + 2 星材料
  const w2 = D.rollForged("weapon", 1), m2 = G.matsValue(D.forgeEqMats(1)) + 10 * C.forge.YAOSHI.equip[1];
  assert.equal(G.sellPrice({ t: "eq", e: w2 }), Math.floor((2710 + m2) * 1.1));
  // 空间石、丹药
  const ss = G.matsValue(D.stoneMats(0)) + 10 * C.forge.stone.special[0];
  assert.equal(G.sellPrice({ t: "ss", g: 0, n: 1 }), Math.floor(ss * 1.1));
  const t = Object.keys(D.recipes).find(k => !D.isSpeedRecipe(k) && !D.recipeItem(k) && k !== "wuzhen");
  assert.equal(G.sellPrice({ t: "dan", type: t, g: 0, n: 1 }), Math.floor(G.matsValue(D.danRecipe(t, 0)) * 1.1));
  for (const sl of ["helmet", "fabao"]) for (let g = 0; g < 12; g++) { const x = D.rollForged(sl, g, 0, "fire"); x.rj = (g + 1) * 10; assert.ok(G.sellPrice({ t: "eq", e: x }) > 0); }
  for (let r = 0; r < 6; r++) for (let g = 0; g < 12; g++) { const x = D.rollForged("ring", g, r); x.rj = (g + 1) * 10; assert.ok(Number.isFinite(G.sellPrice({ t: "eq", e: x }))); }
  assert.equal(G.matUnit({ kind: "sm", g: "lj", ft: 2, n: 1 }), 10);
});
