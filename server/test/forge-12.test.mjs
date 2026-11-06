import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";
import fs from "node:fs";

const T0 = 1_800_003_000_000;
const setup = () => {
  const e = new GameEngine(), D = e.DATA, G = e.G, C = e.CFG || globalThis.CFG;
  const s = e.createState("十二星", T0); e.bindState(s, T0); G.s = s; G._cache = null;
  s.bag = []; G.craftFree = () => true; G.forgeRate = () => 1;
  return { D, G, s, C };
};

test("装备、法宝、戒指、空间石、炼器炉、炼器师到十二星", () => {
  const { D, G } = setup();
  assert.equal(D.XING.length, 12); assert.equal(D.XING[11], "十二星");
  assert.equal(D.forgeEqName("helmet", 11).includes("永恒圣冠"), true);
  assert.equal(D.fabaoName(0, 10), "斩道神剑");
  assert.equal(D.furnaceN("qi"), 12); assert.equal(D.furnaceN("dan"), 10);
  assert.equal(G.craftMax("qi"), 12);
  const w = D.rollForged("weapon", 11), f = D.rollForged("fabao", 11);
  assert.ok(w.attrs.length && f.attrs.length);
  assert.equal(D.stoneName(11), "十二阶" + D.SS);
});

test("神界隐世宗门炼器室兑换十一、十二星图谱图纸", () => {
  const { G, s } = setup();
  const T = id => JSON.stringify(G.ysBpTiers(id)); assert.equal(T("taichu"), "[10]"); assert.equal(T("dari"), "[11]"); assert.equal(T("taixu"), "[]");
  s.ysFav = { taichu: 100000 }; G.ysFav = id => (s.ysFav || {})[id] || 0; G.ysById = id => ({ id, name: id }); G.openYsPlace = () => {};
  G.ysFound = () => false; G.buyYsBp("taichu", "eq", 10, "weapon"); assert.equal(G.ysBpState("eq", 10, "weapon"), 0);   // 没发现的宗门不能兑换
  G.ysFound = () => true;
  const html = G.ysBpHtml("taichu"); assert.ok(html.includes("十一星"));
  G.buyYsBp("taichu", "eq", 10, "weapon"); assert.equal(G.ysBpState("eq", 10, "weapon"), 2);
  G.buyYsBp("taichu", "ring", 10, 0); assert.ok(s.bag.some(x => x && x.t === "rbp" && x.g === 10 && x.r === 0));
  G.buyYsBp("taichu", "fu", 10); assert.ok(s.bag.some(x => x && x.t === "bp" && x.kind === "qi" && x.g === 10));
  G.buyYsBp("taichu", "eq", 11, "weapon"); assert.equal(G.ysBpState("eq", 11, "weapon"), 0);   // 太初只有十一星
  assert.equal(s.ysFav.taichu, 100000 - 500 * 3);
});

test("炼器材料：1~4 星凡界、5~8 仙界、9~12 神界", () => {
  const { D } = setup();
  const band = g => D.forgeEqMats(g).map(m => D.matName(m.kind, m.g));
  assert.ok(band(3).every(n => ["铁精", "寒铁", "赤铜精", "玄冥铁", "星辰砂", "虚空石"].includes(n)));
  assert.ok(band(4).includes("天外陨铁")); assert.ok(band(11).includes("混元神石"));
  assert.equal(D.stoneMats(11).length, 3); assert.equal(D.ringMats(11).length, 3);
});

test("十一星装备、十二星空间石能炼，配方列表正常", () => {
  const { D, G, s } = setup();
  s.furnaceUse.qi = 11; s.furnaces.qi = [11]; s.forgeKnown.push("eq:weapon:10", "ss:11"); s.blueprints.qi.push(11);
  s.bag.push({ t: "eq", e: D.rollForged("weapon", 9) });
  const L = G.forgeItems(); assert.ok(L.some(x => x.key === "eq:weapon:10") && L.some(x => x.key === "ss:11") && L.some(x => x.key === "f:qi:11"));
  assert.ok(!L.map(x => x.info).join("").includes("undefined"));
  G.craftFurnace("eq", 10, "weapon"); assert.ok(s.forgeJob);
  G.now = () => T0 + 1e13; for (let k = 0; k < 3; k++) G.craftTick();
  assert.ok(s.bag.some(x => x && x.t === "eq" && x.e.slot === "weapon" && x.e.g === 10));
  G.fixCraft(); assert.ok(s.blueprints.qi.includes(11) && s.furnaces.qi.includes(11));
});

test("buyYsBp 在服务器白名单里（联机才能兑换）", () => {
  const list = JSON.parse(fs.readFileSync(new URL("../action-whitelist.json", import.meta.url), "utf8"));
  assert.ok(list.includes("buyYsBp"));
});

test("肉身 24 阶、灵地境界跟地图、炼器师最后一阶", () => {
  const { C } = setup();
  assert.equal(C.realm.BODY_EXP.length, 24); assert.equal(C.realm.BODY_GAIN.length, 24);
  for (let i = 1; i < 24; i++) { const a = C.realm.BODY_EXP[i - 1][2], b = C.realm.BODY_EXP[i][1]; assert.ok(b >= a * 0.99 && b <= a * 1.2, `肉身 ${i}`); }
  assert.equal(JSON.stringify(C.lingdi.list.map(d => C.mobs.lingdi[d.name]["普通"][0])), "[10,10,11,11,12,12,13,14,15,16,17,18]");
  const E = C.craftsman.qi.EXP; assert.equal(E.length, 11); assert.equal(E[10], 87516237);
  assert.equal(C.forge.YS_BP[10].COST, 500);
});
