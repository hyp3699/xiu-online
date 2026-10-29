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
  assert.equal(engine.G.modules.length, 26);
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
  const per = 300, perHit = 50, n = 30;
  assert.ok(seen.length >= 35);
  for (const R of [1, 2, 10, 30, 31, 35]) {
    const k = Math.min(R, n);
    assert.equal(Math.round(seen[R - 1].atk - base.atk), per * k, `atk round ${R}`);
    assert.equal(Math.round(seen[R - 1].def - base.def), per * k, `def round ${R}`);
    assert.equal(Math.round(seen[R - 1].hit - base.hit), perHit * k, `hit round ${R}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(r.detail.ps)), { atk: 9000, def: 9000, hit: 1500, dodge: 1500, speed: 1500 });
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
  for (let R = C + 1; R <= C + 9; R++) near(seen[R - 1].atk, (base.atk + 300 * Math.min(R, 30)) * 1.2, `buff+passive round ${R}`);
  for (const R of [C + 10, 30, 35]) near(seen[R - 1].atk, base.atk + 300 * Math.min(R, 30), `passive only round ${R}`);
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
