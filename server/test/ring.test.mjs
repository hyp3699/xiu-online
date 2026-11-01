import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const T0 = 1_800_002_000_000;
const setup = (star = 6) => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("戒指", T0); e.bindState(s, T0);
  s.sect = star ? Object.keys(D.sectById).find(id => D.sectById[id].star === star) : null;
  s.contrib = 1_000_000; s.ysFav = { guanxing: 10_000, wanhua: 10_000 }; s.bag = [];
  G._cache = null; G.s = s;
  return { e, D, G, s };
};

test("保留 6 种戒指，主属性都是攻击/防御/生命/法力里的两种且互不相同", () => {
  const { D } = setup();
  const list = D.ringList();
  assert.deepEqual([...list].map(r => D.ringNames[r]), ["破军戒", "磐石戒", "长生戒", "灵犀戒", "烈阳戒", "玄武戒"]);
  const M = new GameEngine().CFG.forge.ring.main, ok = ["atk", "def", "hp", "mana"], pairs = new Set();
  for (const r of list) { const m = M[r]; assert.equal(m.length, 2); for (const k of m) assert.ok(ok.includes(k)); pairs.add([...m].sort().join()); }
  assert.equal(pairs.size, 6); assert.equal(D.ringNames.length, 6);
  for (let i = 0; i < 300; i++) assert.ok(list.includes(D.rollForged("ring", 0).r));   // 随机戒指不出删掉的
  for (const r of list) { const x = D.rollForged("ring", 3, r); assert.deepEqual([...x.attrs].filter(a => a.m).map(a => a.k), [...M[r]]); }
});

test("灵犀 +5% / 烈阳 +10% / 玄武 +20% 主属性，附加属性不加", () => {
  const { D } = setup();
  const val = (r, k, m) => D.attrBase({ k, c: 2, p: 0.5, m }, 5, { slot: "ring", r, g: 5, attrs: [] });
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, b), `${a} vs ${b}`);
  near(val(3, "mana", 1), val(2, "mana", 1) * 1.05);
  near(val(4, "hp", 1), val(2, "hp", 1) * 1.10);
  near(val(5, "def", 1), val(1, "def", 1) * 1.20);
  near(val(4, "def", 0), val(1, "def", 0));
  near(val(0, "atk", 1), val(3, "atk", 1) / 1.05);
});

test("灵犀戒图纸 / 灵犀晶：6 星以上宗门宝库，贡献 3000 起每星 +1000，材料 100 贡献", () => {
  let { G, s } = setup(5);
  G.buyRingBp(3, 0); assert.equal(s.bag.length, 0); assert.equal(s.contrib, 1_000_000);   // 5 星宗门不行
  ({ G, s } = setup(6));
  for (let g = 0; g < 10; g++) { const c0 = s.contrib; G.buyRingBp(3, g); assert.equal(c0 - s.contrib, 3000 + 1000 * g); }
  assert.equal(s.bag.filter(it => it.t === "rbp" && it.r === 3).length, 10);
  const c1 = s.contrib; G.buyRingBp(3, 4); assert.equal(s.contrib, c1);                  // 背包已有不能重复
  G.buyRingSm(3, 10); assert.equal(c1 - s.contrib, 1000); assert.equal(G.smCount("rlx"), 10);
  G.buyRingBp(4, 0); G.buyRingBp(3, 0, "guanxing"); assert.equal(s.contrib, c1 - 1000);   // 宝库买不了烈阳；隐世买不了灵犀
  s.contrib = 2999; G.buyRingBp(3, 0); assert.equal(s.contrib, 2999);
});

test("烈阳戒（观星阁）/ 玄武戒（万化神宫）图纸好感度 100/150 起每星 +10，材料 5 好感", () => {
  const { G, s } = setup(0);
  for (let g = 0; g < 10; g++) {
    const a = s.ysFav.guanxing, b = s.ysFav.wanhua;
    G.buyRingBp(4, g, "guanxing"); G.buyRingBp(5, g, "wanhua");
    assert.equal(a - s.ysFav.guanxing, 100 + 10 * g); assert.equal(b - s.ysFav.wanhua, 150 + 10 * g);
  }
  const a = s.ysFav.guanxing, b = s.ysFav.wanhua;
  G.buyRingBp(4, 0, "wanhua"); G.buyRingBp(5, 0, "guanxing"); G.buyRingBp(4, 0, "taiqing");
  assert.equal(s.ysFav.guanxing, a); assert.equal(s.ysFav.wanhua, b);
  G.buyRingSm(4, 7, "guanxing"); G.buyRingSm(5, 3, "wanhua");
  assert.equal(a - s.ysFav.guanxing, 35); assert.equal(b - s.ysFav.wanhua, 15);
  assert.equal(G.smCount("rly"), 7); assert.equal(G.smCount("rxw"), 3);
});

test("炼制：专用戒指一星直接炼（30 个专用材料），二星要一星戒指 + 40 个；普通戒指一星不能炼", () => {
  const { G, s, D } = setup(6);
  s.furnaceUse.qi = 9; s.forgeKnown.push("ring:3:0", "ring:3:1", "ring:0:0");
  const give = (g, r = 3) => { for (const m of D.ringMatsFor(r, g)) G.addMat(m.kind, D.matName(m.kind, m.g), m.g, m.n); G.addSm("ys", [10, 30][g], 0); };
  assert.equal(D.ringMatsFor(3, 0).length, 1); assert.equal(D.ringMatsFor(0, 3).length, 3);
  assert.equal(G.jobSm({ kind: "ring", g: 0, r: 3 }).find(x => x.k === "ys").n, 10);
  assert.equal(G.jobSm({ kind: "ring", g: 9, r: 5 }).find(x => x.k === "ys").n, 7680);
  assert.equal(G.jobSm({ kind: "ring", g: 9, r: 0 }).find(x => x.k === "ys").n, 7680);
  give(0); G.addSm("rlx", 29);
  G.craftFurnace("ring", 0, 3); assert.equal(s.forgeJob, null);                       // 专用材料差 1 个
  G.addSm("rlx", 1);
  G.craftFurnace("ring", 0, 0); assert.equal(s.forgeJob, null);                        // 破军一星不能炼
  G.craftFurnace("ring", 0, 3); assert.ok(s.forgeJob); assert.equal(G.smCount("rlx"), 0); assert.equal(G.smCount("ys", -1), 0);
  G.forgeRate = () => 1; G.finishForge(s.forgeJob); s.forgeJob = null;
  const r1 = s.bag.find(it => it.t === "eq" && it.e.slot === "ring"); assert.equal(r1.e.r, 3); assert.equal(r1.e.g, 0);
  r1.e.rj = 9;   // 精炼满（升星要十阶）
  give(1); G.addSm("rlx", 39);
  G.craftFurnace("ring", 1, 3); assert.equal(s.forgeJob, null);
  G.addSm("rlx", 1); G.craftFurnace("ring", 1, 3);
  assert.ok(s.forgeJob); assert.equal(s.forgeJob.prev.r, 3); assert.equal(G.smCount("rlx"), 0);
  assert.deepEqual(G.jobSm({ kind: "ring", g: 9, r: 5 }).find(x => x.k === "rxw").n, 120);
  assert.equal(G.jobSm({ kind: "ring", g: 5, r: 1 }).some(x => x.k.startsWith("r")), false);
});


test("戒指耀石同法宝翻倍；强化三类共用灵石 5000 起每 500 级 +5000、火髓 +6、耀石 +3；精研灵石 8000 起每 500 次 +8000", () => {
  const { G, D, s } = setup(6);
  for (const r of [0, 3]) assert.deepEqual([...Array(10).keys()].map(g => G.jobSm({ kind: "ring", g, r }).find(x => x.k === "ys").n), [10, 30, 60, 120, 240, 480, 960, 1920, 3840, 7680]);
  for (const slot of ["weapon", "ring", "fabao"]) {
    const e = { slot, g: 2, el: "huo", attrs: [], enh: 0 };
    let c = G.enhCost(e); assert.deepEqual([c.stone, c.fire, c.jj], [5000, 10, 5]);
    e.enh = 499; c = G.enhCost(e); assert.deepEqual([c.stone, c.fire, c.jj], [5000, 10, 5]);
    e.enh = 500; c = G.enhCost(e); assert.deepEqual([c.stone, c.fire, c.jj], [10000, 16, 8]);
    e.enh = 1200; c = G.enhCost(e); assert.deepEqual([c.stone, c.fire, c.jj], [15000, 22, 11]);
  }
  const e = { slot: "weapon", g: 0, attrs: [{ k: "atk", c: 0, p: 0, m: 1 }], enh: 0, name: "x" }; s.bag = [{ t: "eq", e }];
  s.stone = 4999; G.addFire ? G.addFire(100) : 0; G.addSm("ys", 100, 0);
  if (G.fireCount() >= 10) { G.doEnhance("b0"); assert.equal(s.stone, 4999); s.stone = 5000; G.craftRate = () => 1; G.doEnhance("b0"); assert.equal(s.stone, 0); assert.equal(e.enh, 1); }
  assert.equal(D.jyCost(1, 0).stone, 8000); assert.equal(D.jyCost(15, 499).stone, 8000);
  assert.equal(D.jyCost(1, 500).stone, 16000); assert.equal(D.jyCost(1, 1000).stone, 24000);
  assert.equal(D.jyCost(1, 499).xd, 10); assert.equal(D.jyCost(1, 500).xd, 20); assert.equal(D.jyCost(1, 1000).xd, 30);
});

test("强化加成不分星级：装备按部位、戒指按种类（+1 命中）；护盾法宝每级 +30 护盾，不能融合也不能被融合", () => {
  const { G, D, s } = setup(6), J = o => JSON.parse(JSON.stringify(o));
  for (const g of [0, 9]) {
    assert.deepEqual(J(D.eqEnhStats({ slot: "boots", g, attrs: [], enh: 3 })), { atk: 15, mana: 24, speed: 3 });
    assert.deepEqual(J(D.eqEnhStats({ slot: "legs", g, attrs: [], enh: 2 })), { atk: 10, hp: 20, dodge: 2 });
    assert.deepEqual(J(D.eqEnhStats({ slot: "weapon", g, attrs: [], enh: 1 })), { atk: 5, def: 5 });
    assert.deepEqual(J(D.eqEnhStats({ slot: "ring", r: 5, g, attrs: [], enh: 4 })), { def: 20, mana: 32, hit: 4 });
    assert.deepEqual(J(D.eqEnhStats({ slot: "ring", r: 2, g, attrs: [], enh: 1 })), { atk: 5, hp: 10, hit: 1 });
  }
  const sh = Object.keys(D.fabaoTypes).find(k => D.fabaoTypes[k].shield), dm = Object.keys(D.fabaoTypes).find(k => !D.fabaoTypes[k].shield);
  for (const g of [0, 9]) { assert.equal(D.fbEnh({ slot: "fabao", ft: sh, g, enh: 2 }), 60); assert.equal(D.fbEnh({ slot: "fabao", ft: dm, g, enh: 2 }), 24); }
  // 法宝融合已取消：不再有 fbFuse / fbFusable，护盾法宝每级 +30 护盾的断言在上面
});

test("心得灵石价格翻倍；炼丹师 / 炼器师 / 灵植夫升阶经验 × 总倍率 1.15", () => {
  const { e, G } = setup(6), C = e.CFG;
  assert.equal(C.craftsman.EXP_MULT, 1.15);
  assert.equal(G.craftNeed("dan", 1), Math.round(832 * 1.15)); assert.equal(G.craftNeed("dan", 29), Math.round(87516237 * 1.15));
  assert.equal(G.craftNeed("qi", 9), Math.round(87516237 * 1.15)); assert.equal(G.craftNeed("ling", 2), Math.round(1260 * 1.15));
  assert.deepEqual([...C.xinde.PRICE], [100000, 3000000]);
  const c = G.craftInfo("dan"); c.lv = 1; c.exp = 0; G.addCraftExp("dan", 900); assert.equal(c.lv, 1); G.addCraftExp("dan", 57); assert.equal(c.lv, 2); assert.equal(c.exp, 0);
});
