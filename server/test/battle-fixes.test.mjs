import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

// 2026-11-04 审计修复 #9 / #14 / #15 的战斗回归测试。
// 每个用例用自己的 GameEngine，互不干扰。

function newPlayer() {
  const engine = new GameEngine();
  const G = engine.G;
  const now = Date.now();
  const st = engine.createState("battle-fix-test", now);
  engine.bindState(st, now);
  G.after = () => {};
  G.silent = true;
  return { engine, G, st };
}

function bossMob(G) {
  const m = G.makeMob(0, 0, "boss");
  m.hp = 1e13; m.atk = 1; m.mf = []; m.tf = []; m.shield = null;
  return m;
}

test("#9 战斗设置里勾了“不使用”的法术，不能经低血/前三回合捷径打出", () => {
  const { engine, G, st } = newPlayer();
  const DATA = engine.DATA;
  const srcs = Object.keys(DATA.gfSrcById);
  assert.ok(srcs.length >= 2, "需要至少两个法术来源");
  const enabled = DATA.spellId(srcs[0], DATA.gfSrcById[srcs[0]].el);
  const disabled = DATA.spellId(srcs[1], DATA.gfSrcById[srcs[1]].el);
  assert.notEqual(enabled, disabled);
  // 新号法术栏位必须 ≥2，否则禁用的那招根本进不了 acts，测试就成空断言
  assert.ok(G.slotCount() >= 2, `slotCount=${G.slotCount()}`);
  st.gongfa[enabled] = 1; st.gongfa[disabled] = 1;
  st.spellSlots = [enabled, disabled];
  st.mana = 1e9;   // 新号法力只有 60 左右，法术一次要 591，不灌满根本放不出，测了也白测
  const disabledKey = "sp:" + disabled;
  st.bset = { foe: {}, r: [disabledKey, "auto", "auto"], mode: "rot", lowPct: 100, lowKey: disabledKey, goHp: 30, goMp: 0, off: [disabledKey], order: [] };
  const m = bossMob(G);
  const r = G.battle(m, { useSet: true });
  const spNames = r.detail.sp;
  const enabledName = DATA.spellInfo(enabled, 1).name, disabledName = DATA.spellInfo(disabled, 1).name;
  const enabledIdx = spNames.indexOf(enabledName), disabledIdx = spNames.indexOf(disabledName);
  assert.ok(enabledIdx >= 0 && disabledIdx >= 0, "两招都应在 acts 里，否则测试无效");
  const playerSpellHits = r.detail.log.filter(x => x[1] === 0 && x[2] === 1);
  assert.ok(playerSpellHits.some(x => x[3] === enabledIdx), "启用的法术应确实打出过");
  assert.ok(!playerSpellHits.some(x => x[3] === disabledIdx), "禁用的法术一次都不应出现");
});

test("#14 神佑复活时“共造成伤害”要扣掉复活回来的血", () => {
  const { engine, G, st } = newPlayer();
  const CFG = engine.context.CFG;
  CFG.battle.TALENT.SHENYOU.CHANCE = 100;   // 必定触发，否则这测例要看脸
  CFG.battle.MAX_ROUNDS = 1;
  const m = bossMob(G);
  m.hp = 3; m.def = 0; m.dodge = 0;   // 新号普攻约 3.8~4.2（暴击约 6），必一击致命
  m.tf = ["shenyou"];
  st.hp = G.stats().hp; st.mana = G.stats().mana;
  const r = G.battle(m, {});
  // 致命一击 d 点伤害，神佑复活 3×30%=0.9：共造成 = d − (0.9 − (3 − d)) = 2.1 → 显示 2
  assert.match(r.why, /共造成 2 伤害/);
});

test("#15 战斗总览先手与第 1 回合实际先手一致（被动加速度后）", () => {
  const { G, st } = newPlayer();
  st.ysSt.kuchan = 120; st.stEq = ["kuchan"]; st.ssPow = 1000;
  G.ysStCfg().PAS_MAX = 3; st.stUp = { kuchan: 100 };   // 枯蝉每回合速度 +30+100×30=3030
  const base = G.stats().speed;
  const m = bossMob(G);
  m.speed = base * 2;   // 不加被动时玩家必后手（速度随机 95%~105% 也追不上 2 倍）
  const r = G.battle(m, {});
  assert.equal(r.detail.first, 0, "第 1 回合被动加速度后玩家先手，总览也应是先手");
});
