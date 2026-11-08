import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../game-engine.mjs";

// 离线分批结算的回归测试：advance(state, now, maxTicks) 被截断时，s.last 只能推进到
// 已算完的位置，剩下的下一轮接着算；原来收尾的 s.last 对齐到现在会把剩余离线时间丢掉
// （离线超过 1 天只算第 1 天，剩下 29 天永久丢失）。
const DAY_MS = 86400_000, TICK_MS = 10_000, CHUNK = 8640; // 8640 个 10 秒 = 1 天

test("offline advance in chunks never drops progress beyond the first day", () => {
  const engine = new GameEngine();
  const start = 1_800_000_000_000;
  const state = engine.createState("离线分批测试", start);
  const now = start + 30 * DAY_MS;

  // 第一轮：最多补 1 天，且 s.last 只推进到已算完的位置（约 29 天前），不是现在
  const first = engine.advance(state, now, CHUNK);
  assert.equal(first.processedTicks, CHUNK);
  assert.equal(first.truncated, true);
  const remainMs = now - first.state.last;
  assert.ok(remainMs > 28 * DAY_MS && remainMs < 30 * DAY_MS, `剩余离线时间应约 29 天，实际 ${remainMs / DAY_MS} 天`);

  // 第二轮：继续补算，不再是 0
  const second = engine.advance(first.state, now, CHUNK);
  assert.equal(second.processedTicks, CHUNK);
  assert.equal(second.truncated, true);

  // 分批补完：30 天共 259200 tick，8640/轮 = 30 轮
  let cur = second.state, total = CHUNK * 2;
  for (let i = 0; i < 40 && total < 30 * CHUNK; i++) {
    const o = engine.advance(cur, now, CHUNK);
    total += o.processedTicks; cur = o.state;
    if (!o.truncated) break;
  }
  assert.equal(total, 30 * CHUNK);
  assert.ok(now - cur.last < TICK_MS, "补完后 s.last 应约等于现在");
});

test("unlimited advance still settles the whole offline period at once", () => {
  const engine = new GameEngine();
  const start = 1_800_000_000_000;
  const state = engine.createState("离线全量测试", start);
  const now = start + 30 * DAY_MS;
  const o = engine.advance(state, now);
  assert.equal(o.processedTicks, 30 * CHUNK);
  assert.equal(o.truncated, false);
  assert.ok(now - o.state.last < TICK_MS);
});
