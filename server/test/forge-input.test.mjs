import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const T0 = 1_800_003_000_000;
const setup = () => {
  const e = new GameEngine(), D = e.DATA, G = e.G;
  const s = e.createState("炼器校验", T0); e.bindState(s, T0); G.s = s; G._cache = null;
  s.bag = []; s.forgeJob = null; s.forgeQueue = []; G.craftFree = () => true; G.forgeRate = () => 1;
  let picks = 0; G.openFabaoPick = () => { picks++; };
  return { D, G, s, picks: () => picks };
};
const jobs = s => (s.forgeJob ? 1 : 0) + s.forgeQueue.length;

test("craftFurnace 只接装备、戒指、空间石、炉子，灵珠/阵旗/精炼不能从这里绕过", () => {
  const { G, s } = setup();
  s.forgeKnown.push(G.forgeKey("lz", 0, 0));
  for (const k of ["lz", "zq", "rf", "abc", "__proto__", "toString"]) G.craftFurnace(k, 0, "0");
  assert.equal(jobs(s), 0);
  G.craftLz(0); assert.equal(jobs(s), 1);   // 正常灵珠入口照常能炼
});

test("炼法宝：属性只认六系 id、形状只认 0~N-1 整数，否则弹选择框", () => {
  const { D, G, s, picks } = setup();
  for (const el of ["toString", "constructor", "__proto__", "hasOwnProperty", "", null, undefined, "JIN"]) G.craftFurnace("eq", 0, "fabao", 0, el);
  for (const ft of [null, "", " ", -1, D.fabaoTypes.length, 1.5, "abc", "__proto__"]) G.craftFurnace("eq", 0, "fabao", ft, D.elements[0].id);
  assert.equal(jobs(s), 0); assert.equal(picks(), 16);
  assert.equal(D.fbFt("3"), 3); assert.equal(D.fbFt(0), 0); assert.equal(D.isEl(D.elements[2].id), true);
});

test("rollForged 遇到非法属性随机成六系之一，合法属性保留", () => {
  const { D } = setup();
  const ids = D.elements.map(x => x.id);
  for (let i = 0; i < 20; i++) assert.ok(ids.includes(D.rollForged("fabao", 0, 0, "toString").el));
  assert.equal(D.rollForged("fabao", 0, 0, ids[3]).el, ids[3]);
});
