import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

// 2026-11-04 审计修复中不属于战斗三项的部分：S-16 别名取表、#5 讲道星级、#7 叛出清免费房。

function newPlayer() {
  const engine = new GameEngine();
  const G = engine.G;
  const now = Date.now();
  const st = engine.createState("audit-fix-test", now);
  engine.bindState(st, now);
  G.after = () => {};
  G.silent = true;
  return { engine, G, st };
}

test("S-16 craftNeed 别名取表：xling 2 阶按灵植夫本表算", () => {
  const { G } = newPlayer();
  assert.equal(G.craftNeed("xling", 2), 1487);
  assert.equal(G.craftNeed("ling", 2), 1487);
  assert.equal(G.craftNeed("xdan", 2), G.craftNeed("dan", 2));
});

test("#5 讲道奖励按听讲时的门派星级结算，不按结算时的星级", () => {
  const { engine, G, st } = newPlayer();
  const DATA = engine.DATA;
  const s1 = DATA.sects.find(x => x.star === 1);
  const sHi = DATA.sects.reduce((a, b) => (b.star > a.star ? b : a));
  assert.ok(s1 && sHi && sHi.star > s1.star, "需要 1 星和更高星门派");
  st.sect = s1.id;
  st.contrib = 1e9;
  G.jdState();   // 生成当天名单：第 1 个是炼丹
  G.listenJiang(0);
  const d = st.jd;
  assert.ok(d.cur, "听讲后应有进行中的讲道");
  assert.equal(d.cur.star, s1.star, "听讲时应把门派星级写进 cur");
  // 转投高星门派后再结算：奖励仍按 1 星算
  st.sect = sHi.id;
  d.cur.end = 1;   // 已到结算时间
  engine.random = () => 0;   // 游戏内 Math.random 走引擎随机：jdRoll 取区间下限，断言精确值
  G.jdSettle();
  const expect = G.jdExp("dan", s1.star)[0];
  assert.match(d.log[0].t, new RegExp(`炼丹经验提高了：${expect}点`));
});

test("#7 叛出门派清掉免费修炼室/练功房会话", () => {
  const { engine, G, st } = newPlayer();
  const DATA = engine.DATA;
  st.sect = DATA.sects[0].id;
  st.contrib = 1e9;
  st.freeCult = { day: G.bjDay(), used: 1, left: 2, on: true };
  st.freeGf = { day: G.bjDay(), used: 1, end: Date.now() + 3600e3 };
  G.leaveSect();   // 引擎沙箱里 confirm 恒真，不用另外 stub
  assert.equal(st.sect, null);
  assert.equal(st.freeCult.left, 0);
  assert.equal(st.freeCult.on, false);
  assert.equal(st.freeGf.end, 0);
});
