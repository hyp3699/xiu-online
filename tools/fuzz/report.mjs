// 汇总多个种子的结果：按问题类型合并，列出次数、出现在哪些操作、一个复现样例
import fs from "node:fs"; import path from "node:path";
const dir = process.argv[2] || "tools/fuzz/out", all = {};
const runs = fs.readdirSync(dir).filter(f => /^(test|boost|normal)-\d+\.json$/.test(f));
for (const f of runs) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  console.log(`# ${f}: ${d.sum.steps} 步 ${d.sum.sec}s 境界 ${d.sum.realm} 肉身 ${d.sum.body} 成功 ${d.sum.ok} 失败 ${d.sum.err}`);
  for (const [k, n] of Object.entries(d.sum.kinds)) { const x = all[k] || (all[k] = { n: 0, acts: new Set(), ex: null }); x.n += n; }
  for (const it of d.found) { const k = Object.keys(d.sum.kinds).find(k => k.startsWith(it.kind + ":")); const key = Object.keys(all).find(K => K.startsWith(it.kind + ":") && K.includes(it.msg.replace(/\d+/g, "#").slice(0, 40))) || k;
    if (!key) continue; const x = all[key]; if (it.extra && it.extra.act) x.acts.add(it.extra.act); if (!x.ex) x.ex = { seed: f, step: it.step, extra: it.extra, stack: it.stack.split("\n").slice(0, 4).join(" | ") }; }
}
const order = k => /卡死|复制|NaN|负数/.test(k) ? 0 : /^操作报错/.test(k) ? 1 : /日志/.test(k) ? 2 : 3;
for (const [k, x] of Object.entries(all).sort((a, b) => order(a[0]) - order(b[0]) || b[1].n - a[1].n)) {
  console.log(`\n[${x.n}] ${k}\n  操作: ${[...x.acts].join(", ")}\n  例: ${x.ex ? JSON.stringify(x.ex.extra).slice(0, 200) + "\n  栈: " + x.ex.stack.slice(0, 400) : ""}`);
}
