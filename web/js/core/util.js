/* =====================================================================
 * 核心：通用工具函数
 * ===================================================================== */
const $ = s => document.querySelector(s);

const U = {
  // a~b 之间的随机整数（含两端）
  rand: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
  // 从数组里随机取一个
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  // 按权重随机，返回下标
  weighted(ws) {
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return i;
    return 0;
  },
  // 大数字显示：万、亿、兆、京……
  UNITS: [[1e48, "极"], [1e44, "载"], [1e40, "正"], [1e36, "涧"], [1e32, "沟"], [1e28, "穰"],
          [1e24, "秭"], [1e20, "垓"], [1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"]],
  fmt(n) {
    if (!isFinite(n)) return "∞";
    n = Math.floor(n);
    if (n >= 1e52) return n.toExponential(2).replace("e+", "e");
    for (const [v, u] of U.UNITS) if (n >= v) { const x = (n / v).toFixed(n / v >= 100 ? 0 : 2); return (x.includes(".") ? x.replace(/\.?0+$/, "") : x) + u; } // 只去掉小数部分末尾的 0（400万 不能变成 4万）
    return String(n);
  },
  // 完整数字（个位也显示）：每 4 位一个单位，如 12亿3456万7890；超过 1e16 精度不够，退回 fmt
  full(n) {
    if (!isFinite(n)) return "∞"; n = Math.floor(n); if (n < 0) return "-" + U.full(-n); if (n < 1e4) return String(n); if (n >= 1e16) return U.fmt(n);
    const u = ["", "万", "亿", "兆"]; let out = "", i = 0, lead = true;
    const parts = []; while (n > 0) { parts.push(n % 10000); n = Math.floor(n / 10000); }
    for (let k = parts.length - 1; k >= 0; k--) { const p = parts[k]; if (p === 0) continue; out += (lead ? String(p) : String(p).padStart(4, "0")) + u[k]; lead = false; }
    return out;
  },
  // 小数字保留 1 位小数（如 1.6），大数字同 fmt
  // 最多保留 2 位小数（0.8999999 → 0.9）
  dec(n) { return String(Math.round(n * 100) / 100); },
  num(n) { return n < 100 ? String(Math.floor(n * 10) / 10) : U.fmt(n); },
  num2(n) { return n < 100 ? String(Math.round(n * 100) / 100) : U.fmt(n); },   // 两位小数（秘法 0.25 秒这类）
  // 秒数 → “X天X小时X分”
  dur(sec) {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return (d ? d + "天" : "") + (h ? h + "小时" : "") + (m || (!d && !h) ? m + "分钟" : "");
  },
  // 会随时间变化的数值：放进固定宽度的框里，防止界面跟着跳动（只用于 HTML）
  // v155：框宽按当前文字算（每组数字按 2 位预留），文字占满框，只在单位变化时（如小时→分钟）才变宽窄
  // 精确到秒：1小时2分钟3秒 / 3分钟33秒 / 45秒
  durS(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return (h ? h + "小时" : "") + (m ? m + "分钟" : "") + (x || (!h && !m) ? x + "秒" : "");
  },
  cd(sec, bySec) { const t = bySec ? U.durS(sec) : U.dur(sec), w = t.replace(/\d+/g, m => "0".repeat(Math.max(2, m.length))).split("").reduce((n, c) => n + (/\d/.test(c) ? 0.6 : 1), 0); return `<span class="cd" style="min-width:${w.toFixed(1)}em">${t}</span>`; },
  fix(text) { return `<span class="cdn">${text}</span>`; },
  // v193 学习列表：list = [[已学会?, 一行 html], ...]，已学会的排到最后并变灰（.line.ld）
  doneLast(list) {
    const ld = h => h.replace(/^(\s*)<div class="line">/, '$1<div class="line ld">');
    return list.filter(x => !x[0]).map(x => x[1]).concat(list.filter(x => x[0]).map(x => ld(x[1]))).join("");
  },
  // v195 多张卡片的学习列表：cards = [{ head: 卡片标题 html, rows: [[已学会?, html], ...] }]
  //   每张卡片只放没学会的（全学会的卡片不显示），所有已学会的统一放到最后一张「已学会」卡片里（变灰）
  doneCards(cards, title = "已学会") {
    const done = [];
    const h = cards.map(c => { const todo = c.rows.filter(x => !x[0]); c.rows.forEach(x => { if (x[0]) done.push(x); });
      return todo.length ? `<div class="card">${c.head}${todo.map(x => x[1]).join("")}</div>` : ""; }).join("");
    return h + (done.length ? `<div class="card"><h3>${title}<small>${done.length} 项</small></h3>${U.doneLast(done)}</div>` : "");
  },
};
