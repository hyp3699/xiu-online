import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

test("传音发送：占格物品进传音，背包不变；灵石直接到账", () => {
  const e = new GameEngine(), G = e.G;
  const s = e.createState("传音", 1_800_003_000_000); e.bindState(s, 1_800_003_000_000); G.s = s; G._cache = null;
  const bag0 = JSON.stringify(s.bag), st = s.stone, m0 = G.mailboxList().length;
  assert.equal(G.giftMailGive({ c: "ore", g: 0, n: 3 }), true);
  assert.equal(G.giftMailGive({ c: "eq", slot: "weapon", g: 2, n: 2 }), true);
  assert.equal(G.giftMailGive({ c: "stone", n: 100 }), true);
  assert.equal(JSON.stringify(s.bag), bag0);
  assert.equal(G.mailboxList().length, m0 + 3);
  assert.equal(s.stone, st + 100);
});
