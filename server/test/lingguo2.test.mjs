import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const mk = () => { const e = new GameEngine(), G = e.G, now = Date.now(); const s = e.createState("灵果2", now); e.bindState(s, now); G.after = () => {}; G.silent = true; G.s = s; ENG = e; return { e, G, D: e.DATA, s }; };
// 引擎跑在 vm 里，用的是 e.random（不是这里的 Math.random），固定种子要设到引擎上
let ENG = null;
const seeded = fn => { let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); const R = ENG.random; ENG.random = rnd; try { return fn(); } finally { ENG.random = R; } };

test("灵果：防御、法力生效；属性伤害真的加进法术伤害", () => {
  const { G, D, s } = mk();
  const d0 = G.stats().def, m0 = G.stats().mana;
  G.addLg(15, 2); G.addLg(17, 3);
  G.eatLg(s.bag.findIndex(x => x && x.t === "lg" && x.k === 15), 99); G.eatLg(s.bag.findIndex(x => x && x.t === "lg" && x.k === 17), 99);
  assert.equal(G.stats().def - d0, 54); assert.equal(G.stats().mana - m0, 270);
  // 法术伤害
  const src = Object.keys(D.gfSrcById)[0], el = D.gfSrcById[src].el, sp = D.spellId(src, el);
  s.gongfa[sp] = 1; s.spellSlots = [sp]; s.mana = 1e9;
  const elId = el.id || el, k = D.LG().list.findIndex(x => x.k === "dmg_" + elId);
  const run = () => seeded(() => { const m = G.makeMob(0, 0, "boss"); m.hp = 1e13; m.atk = 1; m.def = 0; m.mf = []; m.tf = []; m.shield = null; m.dodge = 0; m.res = {}; s.mana = 1e9; s.hp = G.stats().hp;
    const r = G.battle(m, {}); return r.detail.log.filter(x => x[1] === 0 && x[2] === 1).map(x => x[5]); });
  const a = run();
  s.lgEat[k] = 40;   // +1000 该系属性伤害
  const b = run();
  assert.ok(a.length > 0, "法术要打出来");
  console.log("spell hits before/after:", a.slice(0, 3), b.slice(0, 3));
  assert.ok(Math.abs(b[0] - a[0] - 1000) <= 1, "属性伤害最后直接加 1000，不吃加成");
});

test("灵果田：离线结算也能收获；灵果种子随秘境结算发放；存档重载后服用记录保留", () => {
  const { e, G, D, s } = mk(); s.stone = 1e9; s.ling = 3e6;
  const g = D.LG_BASE + 7; G.addSeed(g, 1); G.openField(); G.plantField(0, g);
  s.ling = 3e6; s.fields[0].start -= G.fieldTime(g) + 1000; G.tickAll(true);
  assert.ok(s.bag.some(x => x && x.t === "lg" && x.k === 7), "离线收获");
  const loot = G.newLoot(); loot.seed = { [D.LG_BASE + 3]: 2 }; G.giveLoot(loot);
  assert.equal(G.seedCount(D.LG_BASE + 3), 2);
  s.lgEat = { 14: 5 };
  const raw = JSON.parse(JSON.stringify(s)); const s2 = e.createState("灵果3", Date.now()); Object.assign(s2, raw); e.bindState(s2, Date.now()); G.s = s2;
  assert.equal(G.lgBonus().atk, 135);
  assert.equal(Object.keys(s2.lgYs).length, 18);
});

test("灵果减伤：受到该系属性伤害直接减少，不是加抗性", () => {
  const { G, D, s } = mk();
  const run = () => seeded(() => { const m = G.makeMob(0, 0, "boss"); m.hp = 1e13; m.atk = 5000; m.el = "huo"; m.spell = { chance: 100, pct: 100, mana: [0, 1] }; m.fabao = null; m.mf = []; m.tf = []; m.shield = null; m.mana = 1e9;
    s.hp = 1e12; const r = G.battle(m, {}); return r.detail.log.filter(x => x[1] === 1 && x[4] === 0).map(x => x[5]); });
  const avg = () => { let t = [], i = 0; while (i++ < 8) t = t.concat(run()); return t.reduce((a, b) => a + b, 0) / t.length; };
  const a = avg(); const k = D.LG().list.findIndex(x => x.k === "dr_huo"); s.lgEat = { [k]: 40 }; const b = avg();
  console.log("taken avg before/after:", a, b);
  assert.ok(Math.abs(a - b - 1000) <= 200, "受到火系伤害最后直接减 1000");
  assert.equal(G.stats().res.huo, (() => { s.lgEat = {}; G._cache = null; return G.stats().res.huo; })());
});
