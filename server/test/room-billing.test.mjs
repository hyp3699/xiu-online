import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

const T0 = 1_800_001_000_000, MIN = 60_000;
const base = (contrib = 10_000) => {
  const e = new GameEngine(), D = e.DATA;
  let s = e.createState("扣费", T0);
  s.sect = Object.keys(D.sectById).find(id => D.sectById[id].star === 1); s.rank = 0; s.contrib = contrib;
  return { e, D, s, act: (a, args, t) => (s = e.act(s, a, args, t).state), adv: t => (s = e.advance(s, t).state), get: () => s };
};
const stepTo = (h, from, to) => { for (let t = from; t <= to; t += 10_000) h.adv(t); };

test("离开再进：重新立刻扣，倒计时从头算", () => {
  const h = base(), R = h.D.rooms[0].cost;
  h.act("enterRoom", [0], T0 + 1000);                 // -R
  h.adv(T0 + 50_000);
  h.act("enterRoom", [0], T0 + 50_000);               // 离开，不扣
  h.act("enterRoom", [0], T0 + 55_000);               // 再进 -R，下次 1:55
  assert.equal(h.get().contrib, 10_000 - 2 * R);
  assert.equal(h.get().roomAt, T0 + 55_000 + MIN);
  h.adv(T0 + 110_000); assert.equal(h.get().contrib, 10_000 - 2 * R);   // 1:50 还没到
  h.adv(T0 + 120_000); assert.equal(h.get().contrib, 10_000 - 3 * R);   // 2:00 扣了
});

test("换房间：按新房间价格立刻扣，之后按新价格每分钟扣", () => {
  const h = base(), D = h.D;
  h.act("enterRoom", [0], T0);
  h.act("enterRoom", [3], T0 + 30_000);
  assert.equal(h.get().room, 3);
  assert.equal(h.get().contrib, 10_000 - D.rooms[0].cost - D.rooms[3].cost);
  h.adv(T0 + 30_000 + 10 * MIN);
  assert.equal(h.get().contrib, 10_000 - D.rooms[0].cost - 11 * D.rooms[3].cost);
});

test("两个房间各自计时，互不影响", () => {
  const h = base(), R = h.D.rooms[2].cost, G = h.D.gfRooms[1].cost;
  h.act("enterRoom", [2], T0);
  h.act("enterGfRoom", [1], T0 + 25_000);
  h.adv(T0 + 60_000); assert.equal(h.get().contrib, 10_000 - 2 * R - G);   // 修炼室 1:00 到，练功房 1:25 没到
  h.adv(T0 + 90_000); assert.equal(h.get().contrib, 10_000 - 2 * R - 2 * G);
  h.act("enterGfRoom", [1], T0 + 95_000);             // 只离开练功房
  h.adv(T0 + 30 * MIN); assert.equal(h.get().contrib, 10_000 - 31 * R - 2 * G);
});

test("贡献刚好够 / 差 1：刚好够的那次扣完才离开", () => {
  const R = new GameEngine().DATA.rooms[1].cost;
  const h = base(R * 4);                               // 进入 1 次 + 3 分钟
  h.act("enterRoom", [1], T0);
  h.adv(T0 + 3 * MIN); assert.equal(h.get().room, 1); assert.equal(h.get().contrib, 0);
  h.adv(T0 + 4 * MIN); assert.equal(h.get().room, -1); assert.equal(h.get().contrib, 0);
  const h2 = base(R * 4 - 1);
  h2.act("enterRoom", [1], T0);
  h2.adv(T0 + 3 * MIN); assert.equal(h2.get().room, -1); assert.equal(h2.get().contrib, R - 1);
});

test("长时间离线（3 天）一次补算：扣到没贡献为止，和逐个结算一致", () => {
  const D = new GameEngine().DATA, R = D.rooms[0].cost, G = D.gfRooms[0].cost;
  const run = step => { const h = base(3000); h.act("enterRoom", [0], T0); h.act("enterGfRoom", [0], T0);
    if (step) stepTo(h, T0 + 10_000, T0 + 3 * 86_400_000); else h.adv(T0 + 3 * 86_400_000); return h.get(); };
  const a = run(false), b = run(true);
  assert.equal(a.contrib, b.contrib); assert.equal(a.room, b.room); assert.equal(a.gfRoom, b.gfRoom);
  assert.equal(a.room, -1); assert.equal(a.gfRoom, -1);
  assert.ok(a.contrib < Math.min(R, G) || a.contrib >= 0);
  assert.equal(3000 - a.contrib, Math.floor(3000 / (R + G)) * (R + G) + (3000 % (R + G) >= R ? R : 0));
});

test("事务（普通任务）+ 修炼 + 功法 + 两个房间同时，离线 1 天一次补算和逐个结算一致", () => {
  const run = step => { const h = base(50); h.act("startAffair", [0], T0); h.adv(T0 + 3_000); h.get().auto = true;
    h.act("enterRoom", [1], T0 + 7_000); h.act("enterGfRoom", [1], T0 + 13_000);
    if (step) stepTo(h, T0 + 20_000, T0 + 86_400_000); else h.adv(T0 + 86_400_000); return h.get(); };
  const a = run(false), b = run(true);
  assert.equal(a.contrib, b.contrib); assert.equal(a.room, b.room); assert.equal(a.gfRoom, b.gfRoom);
  assert.equal(a.affair.count, b.affair.count); assert.equal(a.affair.count, 288);   // 5 分钟一次 × 24 小时
});

test("中途停掉事务：之后只扣不加", () => {
  const h = base(1000), R = h.D.rooms[0].cost;
  h.act("startAffair", [0], T0); h.act("enterRoom", [0], T0);
  h.adv(T0 + 10 * MIN);
  const AC = h.e.G.affairContrib(0);
  assert.equal(h.get().contrib, 1000 + 2 * AC - 11 * R);
  h.act("startAffair", [0], T0 + 10 * MIN + 1);       // 停止
  h.adv(T0 + 30 * MIN);
  assert.equal(h.get().contrib, 1000 + 2 * AC - 31 * R);
});

test("叛出宗门：两个房间都清掉，不再扣；重新加入不会残留房间", () => {
  const h = base(10_000);
  h.act("enterRoom", [0], T0); h.act("enterGfRoom", [0], T0);
  const G = h.e.G; G.s = h.get(); globalThis.confirm = () => true;
  h.act("leaveSect", [], T0 + 30_000);
  const s = h.get(); assert.equal(s.sect, null); assert.equal(s.room, -1); assert.equal(s.gfRoom, -1);
  const c = s.contrib; h.adv(T0 + 20 * MIN); assert.equal(h.get().contrib, c);
});

test("旧存档（在房间里但没有扣费时间）：不重复立刻扣，从现在起 1 分钟后开始扣", () => {
  const h = base(1000), R = h.D.rooms[0].cost;
  const s = h.get(); s.room = 0; delete s.roomAt;
  h.adv(T0 + 10_000); assert.equal(h.get().contrib, 1000); assert.equal(h.get().roomAt, T0 + 10_000 + MIN);
  h.adv(T0 + 70_000); assert.equal(h.get().contrib, 1000 - R);
  const h2 = base(1000); h2.get().room = 0; delete h2.get().roomAt;
  h2.adv(T0 + 3 * 86_400_000);                         // 旧存档直接离线 3 天：也能正常补扣
  assert.equal(h2.get().contrib, 1000 % R); assert.equal(h2.get().room, -1);   // 3 天要扣 4000 多次，1000 贡献扣完就离开
});

test("进入免费修炼室：付费修炼室自动离开，不再扣；练功房照常扣", () => {
  const h = base(1000), R = h.D.rooms[0].cost, G = h.D.gfRooms[0].cost;
  h.act("enterRoom", [0], T0); h.act("enterGfRoom", [0], T0);
  h.act("enterFreeRoom", [], T0 + 20_000);
  assert.equal(h.get().room, -1);
  h.adv(T0 + 10 * MIN);
  assert.equal(h.get().contrib, 1000 - R - 11 * G);
});

test("页面倒计时：每 10 秒结算后秒数正确，到点扣完重新从 60 倒数", () => {
  const h = base(1000);
  h.act("enterRoom", [0], T0);
  for (let k = 1; k <= 12; k++) {
    h.adv(T0 + k * 10_000);
    const left = h.e.G.roomNextSec("room"), want = (60 - (k * 10) % 60) || 60;
    assert.equal(left, want, `${k * 10} 秒`);
  }
});

test("倒计时到 0 立刻扣贡献，不等下一个 10 秒周期", () => {
  const h = base(), R = h.D.rooms[0].cost;
  h.act("enterRoom", [0], T0 + 1000);                 // 下次 1:01
  h.adv(T0 + 60_500);
  assert.equal(h.e.nextDue(h.get()), T0 + 61_000);
  h.adv(T0 + 61_000);                                  // 10 秒周期在 1:10，这里已经扣
  assert.equal(h.get().contrib, 10_000 - 2 * R);
  assert.equal(h.get().roomAt, T0 + 61_000 + MIN);
  h.adv(T0 + 70_000); assert.equal(h.get().contrib, 10_000 - 2 * R);
});

test("功法修炼倒计时到 0 立刻升层，不等下一个 10 秒周期", () => {
  const e = new GameEngine(); let s = e.createState("功法", T0);
  const id = "s1_0:mijue"; s.gongfa[id] = 1; s.ling = 1e9;
  s.gfStudy = { id, total: 15_000, done: 0, at: T0 + 3000, per: 1, spent: 0, stone: 0, sc: 0, su: 0, ling: 1 };
  s = e.advance(s, T0 + 17_000).state; assert.equal(s.gongfa[id], 1);
  assert.equal(e.nextDue(s), T0 + 18_000);
  s = e.advance(s, T0 + 18_000).state; assert.equal(s.gongfa[id], 2);
});
