import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

// 共用引擎（engine.use 切换玩家）和每人一个引擎，结果必须完全一样
const T0 = 1_800_002_000_000;
const counters = new Map();
GameEngine.prototype.seedRandom = function () {   // 测试用：按「玩家 + 第几次」确定随机数
  const k = String(this._owner), n = (counters.get(k) || 0) + 1; counters.set(k, n);
  let st = (n * 2654435761 + k.length * 97 + k.charCodeAt(k.length - 1)) >>> 0 || 1;
  this.random = () => { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; return (st >>> 0) / 0x1_0000_0000; };
};

function play(getE) {
  const ids = ["A", "B", "C"], st = {};
  for (const id of ids) st[id] = getE(id).use(id).createState("p" + id, T0);
  for (let h = 1; h <= 30; h++) {
    for (const id of ids) {
      const e = getE(id).use(id), now = T0 + h * 3600e3 + ids.indexOf(id) * 1000;
      st[id] = e.advance(st[id], now).state;
      if (h === 3) e.G.bagFilter = id === "A" ? "dan" : "herb";   // 界面字段：各人自己的
      if (h % 5 === 0) { try { st[id] = e.act(st[id], "toggleAuto", [], now + 10).state; } catch {} }
      if (h > 3) assert.equal(e.G.bagFilter, id === "A" ? "dan" : "herb", `h${h} ${id}`);
    }
  }
  return st;
}

test("共用引擎与每人一个引擎结果一致，界面字段不串号", () => {
  const shared = new GameEngine();
  counters.clear(); const a = play(() => shared);
  const own = { A: new GameEngine(), B: new GameEngine(), C: new GameEngine() };
  counters.clear(); const b = play(id => own[id]);
  for (const id of ["A", "B", "C"]) assert.deepEqual(JSON.parse(JSON.stringify(a[id])), JSON.parse(JSON.stringify(b[id])));
  shared.drop("A"); shared.use("A"); assert.equal(shared.G.bagFilter, undefined);
});
