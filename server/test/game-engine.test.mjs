import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "../game-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const actions = JSON.parse(fs.readFileSync(path.join(HERE, "../action-whitelist.json"), "utf8"));

test("server runtime loads the existing game modules and whitelisted handlers", () => {
  const engine = new GameEngine();
  assert.equal(engine.G.modules.length, 28);
  assert.ok(engine.G.runTicks);
  assert.ok(actions.length > 80);
  for (const name of actions) {
    assert.equal(typeof engine.G[name], "function", `missing handler ${name}`);
    assert.notEqual(engine.G[name].constructor.name, "AsyncFunction", `async UI handler should not be whitelisted: ${name}`);
  }
  assert.ok(!actions.includes("gdCreate"));
});

test("button-driven study, purchase, garden, and out-of-body actions are authoritative", () => {
  const required = ["buyGongfa", "learnBlueprint", "learnCc", "learnForge", "learnGfBook", "learnGongfa", "learnJieGf", "learnMifa", "learnRecipe", "learnRingBp", "openField", "stopChuqiao"];
  for (const name of required) assert.ok(actions.includes(name), `missing server action ${name}`);

  const engine = new GameEngine();
  const start = 1_800_000_200_000;
  const state = engine.createState("灵田操作测试", start);
  state.stone = 1_000_000_000;
  engine.bindState(state, start); [0, 1, 2].forEach(g => engine.G.addMat("ore", engine.DATA.ores[g], g, 5000));
  const opened = engine.act(state, "openField", [], start + 1);
  assert.equal(opened.state.fields.length, 1);

  assert.throws(() => engine.act(opened.state, "clearField", [0, false], start + 2), /请先确认铲除灵田/);
  const cleared = engine.act(opened.state, "clearField", [0, true], start + 3);
  assert.equal(cleared.state.fields[0].g, -1);
});

test("ticks and player actions mutate only the server-owned state", () => {
  const engine = new GameEngine();
  const start = 1_800_000_000_000;
  const state = engine.createState("服务端测试", start);
  const settled = engine.advance(state, start + 20_000);
  assert.equal(settled.processedTicks, 2);
  assert.equal(settled.state.last, start + 20_000);
  assert.equal(settled.state.name, "服务端测试");

  const changed = engine.act(settled.state, "toggleAuto", [], start + 20_001);
  assert.equal(changed.state.auto, true);
  assert.equal(changed.state.last, start + 20_000);

  const settings = engine.act(changed.state, "cultSetSave", [undefined, "125", "45"], start + 20_002);
  assert.equal(settings.state.cultSet.low, 125);
  assert.equal(settings.state.cultSet.mul, 45);
});

test("server module ticks complete due first-time gongfa learning", () => {
  const engine = new GameEngine();
  const start = 1_800_000_100_000;
  const state = engine.createState("功法结算测试", start);
  state.gfLearn = { id: "regression:test", k: "gf", ms: 5_000, end: start + 5_000 };

  const settled = engine.advance(state, start + 10_000);
  assert.equal(settled.state.gfLearn, null);
  assert.equal(settled.state.gongfa["regression:test"], 1);
  assert.ok(settled.logs.some(entry => entry.m.includes("习得功法")));
});

test("passive shentong grows atk/def/hit each round and caps at n rounds", () => {
  const engine = new GameEngine(); const G = engine.G, CFG = engine.context.CFG;
  const now = Date.now(); const st = engine.createState("pas-test", now); engine.bindState(st, now);
  const ids = ["lihuo", "wangui", "kuchan"];
  for (const id of ids) st.ysSt[id] = 120;
  st.stEq = ids; st.ssPow = 1000; G.ysStCfg().PAS_MAX = 3; CFG.battle.MAX_ROUNDS = 35;
  const base = G.stats(), m = G.makeMob(0, 0, "boss"); m.hp = 1e13; m.atk = 1; m.mf = []; m.tf = []; m.shield = null;
  const seen = [];
  const r = G.battle(m, { onRound: (R, a) => seen.push(a) });
  const per = 80, perHit = 30, n = 20;
  assert.ok(seen.length >= 35);
  for (const R of [1, 2, 10, 30, 31, 35]) {
    const k = Math.min(R, n);
    assert.equal(Math.round(seen[R - 1].atk - base.atk), per * k, `atk round ${R}`);
    assert.equal(Math.round(seen[R - 1].def - base.def), per * k, `def round ${R}`);
    assert.equal(Math.round(seen[R - 1].hit - base.hit), perHit * k, `hit round ${R}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(r.detail.ps)), { atk: 1600, def: 1600, hit: 600, dodge: 600, speed: 600 });
});

test("active shentong buff and passive growth stack in the same battle", () => {
  const engine = new GameEngine(); const G = engine.G, CFG = engine.context.CFG;
  const now = Date.now(); const st = engine.createState("stack-test", now); engine.bindState(st, now);
  const ids = ["lihuo", "wangui", "wanjian"];
  for (const id of ids) st.ysSt[id] = 120;
  st.stEq = ids; st.ssPow = 1000; G.ysStCfg().PAS_MAX = 3; CFG.battle.MAX_ROUNDS = 35;
  const base = G.stats(); let seen, cast;
  for (let i = 0; i < 20 && !cast; i++) {   // 主动神通可能被闪避（没命中不触发附加效果），重打直到命中
    const m = G.makeMob(0, 0, "boss"); m.hp = 1e13; m.atk = 1; m.mf = []; m.tf = []; m.shield = null; st.hp = base.hp; st.mana = base.mana;
    seen = []; const r = G.battle(m, { onRound: (R, a) => seen.push(a) });
    cast = r.detail.log.find(x => x[1] === 0 && x[12]);
  }
  assert.ok(cast, "active shentong was cast");
  const C = cast[0], near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1, `${msg}: ${a} vs ${b}`);
  for (let R = C + 1; R <= C + 9; R++) near(seen[R - 1].atk, (base.atk + 80 * Math.min(R, 20)) * 1.2, `buff+passive round ${R}`);
  for (const R of [C + 10, 30, 35]) near(seen[R - 1].atk, base.atk + 80 * Math.min(R, 20), `passive only round ${R}`);
});

test("shentong slots open by 神识 and passive capped at 2", () => {
  const engine = new GameEngine(); const G = engine.G;
  const now = Date.now(); const st = engine.createState("slot-test", now); engine.bindState(st, now); G.after = () => {};
  const ids = ["lihuo", "wangui", "kuchan", "jiuxiao", "wanjian"];
  for (const id of ids) st.ysSt[id] = 120;
  st.ssPow = 0; assert.equal(G.stSlotN(), 1);
  st.ssPow = 350; assert.equal(G.stSlotN(), 2);
  st.ssPow = 1000; assert.equal(G.stSlotN(), 4);
  for (const id of ids) G.stEquip(id);
  assert.deepEqual(G.stEqList(), ["lihuo", "wangui", "jiuxiao", "wanjian"]);
  st.ssPow = 700; assert.equal(G.stEqList().length, 3);
});

test("sect cultivation room and gongfa room bill contribution every minute", () => {
  const engine = new GameEngine(), D = engine.DATA, C = engine.CFG;
  const t0 = 1_800_000_300_000;
  let st = engine.createState("修炼室扣费测试", t0);
  const sid = Object.keys(D.sectById).find(id => D.sectById[id].star === 1);
  st.sect = sid; st.rank = 0; st.contrib = 1000;
  // 没有宗门进不去
  assert.equal(engine.act({ ...st, sect: null }, "enterRoom", [0], t0 + 1).state.room, -1);
  const rc = D.rooms[0].cost, gc = D.gfRooms[0].cost;
  assert.equal(C.sect.ROOM_BILL_SEC, 60);
  // 进入立刻扣一次
  let r = engine.act(st, "enterRoom", [0], t0 + 2);
  assert.equal(r.state.room, 0); assert.equal(r.state.contrib, 1000 - rc); assert.equal(r.state.roomAt, t0 + 2 + 60000);
  assert.equal(engine.G.roomNextSec("room"), 60);
  r = engine.act(r.state, "enterGfRoom", [0], t0 + 3);
  assert.equal(r.state.gfRoom, 0); assert.equal(r.state.contrib, 1000 - rc - gc);
  // 59 秒内不再扣
  let a = engine.advance(r.state, t0 + 59_000);
  assert.equal(a.state.contrib, 1000 - rc - gc);
  assert.equal(engine.G.roomNextSec("room"), 2);   // t0+2 进入 → t0+60002 再扣；t0+59000 时还剩 1.002 秒，向上取整为 2
  // 满 1 分钟（下一个 10 秒结算）各扣一次
  a = engine.advance(a.state, t0 + 70_000);
  assert.equal(a.state.contrib, 1000 - 2 * rc - 2 * gc);
  // 修炼 / 功法修炼本身不再扣贡献：开自动修炼跑 5 分钟，扣的正好是 5 次
  a.state.auto = true;
  const before = a.state.contrib;
  a = engine.advance(a.state, t0 + 70_000 + 300_000);
  assert.equal(before - a.state.contrib, 5 * (rc + gc));
  // 离线补扣 + 贡献不够自动离开
  a.state.contrib = rc * 3 + gc * 3 + 1;
  a = engine.advance(a.state, t0 + 70_000 + 300_000 + 600_000);
  assert.equal(a.state.room, -1); assert.equal(a.state.gfRoom, -1);
  assert.ok(a.state.contrib >= 0);
  // 离开后不扣；再次进入又立刻扣
  const c2 = a.state.contrib = 500;
  a = engine.advance(a.state, t0 + 2_000_000);
  assert.equal(a.state.contrib, c2);
  r = engine.act(a.state, "enterRoom", [0], t0 + 2_000_001);
  assert.equal(r.state.contrib, c2 - rc);
  // 再点一次 = 离开，不退不扣
  r = engine.act(r.state, "enterRoom", [0], t0 + 2_000_002);
  assert.equal(r.state.room, -1); assert.equal(r.state.contrib, c2 - rc);
  // 贡献不够进不去
  r.state.contrib = rc - 1;
  r = engine.act(r.state, "enterRoom", [0], t0 + 2_000_003);
  assert.equal(r.state.room, -1); assert.equal(r.state.contrib, rc - 1);
  // 一次补算（快速结算）和每 10 秒逐个结算结果一致
  const mk = () => { const e = new GameEngine(); let x = e.createState("对照", t0); x.sect = sid; x.contrib = 10_000; x.auto = true;
    x = e.act(x, "enterRoom", [1], t0 + 5).state; x = e.act(x, "enterGfRoom", [1], t0 + 7).state; return [e, x]; };
  const [e1, s1] = mk(), [e2, s2] = mk();
  const big = e1.advance(s1, t0 + 3_600_000).state;
  let small = s2; for (let t = t0 + 10_000; t <= t0 + 3_600_000; t += 10_000) small = e2.advance(small, t).state;
  assert.equal(big.contrib, small.contrib);
  assert.equal(big.contrib, 10_000 - 60 * (D.rooms[1].cost + D.gfRooms[1].cost));   // 进入 1 次 + 之后 59 次（第 60 次在 t0+3600005，还没到）
});

test("free cultivation room pauses paid room billing", () => {
  const engine = new GameEngine(), D = engine.DATA;
  const t0 = 1_800_000_400_000;
  let st = engine.createState("免费修炼室测试", t0);
  st.sect = Object.keys(D.sectById).find(id => D.sectById[id].star === 1); st.contrib = 1000;
  st = engine.act(st, "enterRoom", [0], t0 + 1).state;
  st.freeCult = { day: engine.G.bjDay(), used: 1, left: 999, on: true };
  const c = st.contrib;
  const a = engine.advance(st, t0 + 600_000).state;
  assert.equal(a.contrib, c);
  assert.equal(a.room, 0);
});

test("room billing interleaves with sect affair rewards in time order", () => {
  const D0 = new GameEngine().DATA, sid = Object.keys(D0.sectById).find(id => D0.sectById[id].star === 1);
  const t0 = 1_800_000_500_000;
  const setup = () => {
    const e = new GameEngine(); let x = e.createState("事务扣费测试", t0);
    x.sect = sid; x.rank = 0; x.contrib = 0;
    x = e.act(x, "startAffair", [0], t0).state;                  // 打扫山门：每 5 分钟 +贡献
    x.contrib = 2;
    x = e.act(x, "enterRoom", [0], t0 + 242_000).state;           // 4分02秒进修炼室：扣 1
    x = e.act(x, "enterGfRoom", [0], t0 + 242_000).state;         // 同时进练功房：扣 1 → 贡献 0
    return [e, x];
  };
  const [e, x] = setup();
  assert.equal(x.contrib, 0);
  const AC = e.G.affairContrib(0), RC = D0.rooms[0].cost, GC = D0.gfRooms[0].cost;
  // 5:00 事务奖励，5:02 扣费，在同一次 10 秒结算里：要先拿奖励再扣，不能被踢出去
  let a = e.advance(x, t0 + 310_000).state;
  assert.equal(a.room, 0); assert.equal(a.gfRoom, 0);
  assert.equal(a.contrib, AC - RC - GC);
  // 独立按时间顺序模拟 2 小时，和游戏结果逐分钟对照（一次补算 / 每 10 秒结算都要一致）
  const expect = until => {
    let c = 0, rAt = t0 + 302_000, gAt = t0 + 302_000, inR = true, inG = true, nextA = t0 + 300_000;
    const evs = [];
    for (let t = nextA; t <= until; t += 300_000) evs.push([t, "a"]);
    for (let t = rAt; t <= until; t += 60_000) evs.push([t, "r"]);
    evs.sort((p, q) => p[0] - q[0] || (p[1] === "a" ? -1 : 1));
    for (const [, k] of evs) {
      if (k === "a") c += AC;
      else { if (inR) { if (c >= RC) c -= RC; else inR = false; } if (inG) { if (c >= GC) c -= GC; else inG = false; } }
    }
    return { c, inR, inG };
  };
  for (const until of [t0 + 600_000, t0 + 1_800_000, t0 + 3_600_000, t0 + 7_200_000]) {
    const tick = Math.floor((until - t0) / 10_000) * 10_000 + t0;   // 游戏按 10 秒结算
    const want = expect(tick);
    const [e1, x1] = setup(), big = e1.advance(x1, until).state;
    const [e2, x2] = setup(); let small = x2; for (let t = t0 + 250_000; t <= until; t += 10_000) small = e2.advance(small, t).state;
    for (const r of [big, small]) {
      assert.equal(r.contrib, want.c, `贡献 @${(until - t0) / 60000}分钟`);
      assert.equal(r.room === 0, want.inR); assert.equal(r.gfRoom === 0, want.inG);
    }
  }
});
