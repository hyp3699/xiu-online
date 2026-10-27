/* =====================================================================
 * 模块：战斗设置（世界 → 战斗）
 * ---------------------------------------------------------------------
 * 存档 s.bset：
 *   foe     v241 按对手类型的战斗方式 { mob 怪物 / elite 精英 / boss 首领 / xj 星君: "norm" 正常攻击（默认）/ "atk" 只能普通攻击 }，优先于 r
 *   r       第一 ~ 三回合（每回合第一次出手）：[ "auto" 按出手方式 / "atk" 普通攻击 / "sp:法术id" / "fb:法宝栏序号" ] × 3
 *   mode    剩余回合（第四回合起）："rot" 法术、法宝轮流 / "sp" 优先法术 / "fb" 优先法宝 / "max" 伤害最高优先 / "cheap" 消耗最低优先  / "list" 按列表顺序 / "atk" 普通攻击
 *   order   列表顺序 [key]（「按列表顺序」用）
 *   lowPct  生命低于百分之几时（0 = 不用）……
 *   lowKey  ……先用这个法宝 / 法术（例如盾）；可以动用保留的法力
 *   goHp / goMp  v242 生命 / 法力高于上限的这个 % 才继续自动探索（低于就原地休养，恢复到了再继续）；原「保留法力」已去掉
 *   off     不使用的法术 / 法宝 [key]
 * 战斗逻辑在 world.js 的 battle()。
 * ===================================================================== */
G.module({
  id: "battleset",

  defaults: () => ({ bset: { foe: {}, r: ["auto", "auto", "auto"], mode: "rot", lowPct: 0, lowKey: "", goHp: 30, goMp: 0, off: [], order: [] } }),

  api: {
    bsetGet() {
      const b = this.s.bset || (this.s.bset = {});
      if (!Array.isArray(b.off)) b.off = [];
      if (!Array.isArray(b.order)) b.order = [];
      if (!b.foe || typeof b.foe !== "object") b.foe = {};
      if (!Array.isArray(b.r)) b.r = ["auto", "auto", "auto"];
      if (!["rot", "sp", "fb", "max", "cheap", "list", "atk"].includes(b.mode)) b.mode = "rot";
      if (b.goHp === undefined) b.goHp = 30; if (b.goMp === undefined) b.goMp = 0;
      return b;
    },
    // 列表顺序：现有招式按 order 排，没排过的放后面
    bsetSorted() { const b = this.bsetGet(), acts = this.bsetActs(), ix = a => { const i = b.order.indexOf(a.key); return i < 0 ? 999 + acts.indexOf(a) : i; };
      return acts.slice().sort((x, y) => ix(x) - ix(y)); },
    bsetMove(key, dir) {
      const b = this.bsetGet(), L = this.bsetSorted().map(a => a.key), i = L.indexOf(key), j = i + dir;
      if (i < 0 || j < 0 || j >= L.length) return;
      [L[i], L[j]] = [L[j], L[i]]; b.order = L; this.dirty(); this.render();
    },
    bsetFoe(k, v) {
      if (!['mob', 'elite', 'boss', 'xj'].includes(k) || !['norm', 'atk'].includes(v)) throw new Error('无效的对手战斗方式');
      this.bsetGet().foe[k] = v; this.dirty(); this.render();
    },
    bsetRound(i, v) {
      i = Number(i);
      if (!Number.isInteger(i) || i < 0 || i > 2) throw new Error('无效的回合设置');
      const choices = new Set(['auto', 'atk', ...this.bsetActs().map(a => a.key)]);
      if (!choices.has(v)) throw new Error('无效的回合设置');
      this.bsetGet().r[i] = v; this.dirty(); this.render();
    },
    // 现在法术栏、法宝栏里生效的招式 [{ key, name, shield }]
    bsetActs() {
      const s = this.s, n = this.slotCount(), out = [];
      s.spellSlots.slice(0, n).forEach(id => { const g = id && DATA.spellInfo(id, s.gongfa[id]); if (g) out.push({ key: "sp:" + id, name: `法术·${g.name}` }); });
      s.fabao.slice(0, n).forEach((e, i) => { if (e && e.attrs) { const f = DATA.fabaoInfo(e); out.push({ key: "fb:" + i, name: `法宝·${f.name}`, shield: !!f.shield }); } });
      return out;
    },
    bsetSet(k, v) {
      const b = this.bsetGet();
      if (!['mode', 'lowPct', 'lowKey', 'goHp', 'goMp'].includes(k)) throw new Error('无效的战斗设置');
      if (k === 'mode') {
        if (!['rot', 'sp', 'fb', 'max', 'cheap', 'list', 'atk'].includes(v)) throw new Error('无效的战斗方式');
        b.mode = v;
      } else if (k === 'lowKey') {
        if (typeof v !== 'string' || (v && !this.bsetActs().some(a => a.key === v))) throw new Error('无效的保命招式');
        b.lowKey = v;
      } else {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error('无效的战斗阈值');
        b[k] = Math.max(0, Math.min(100, Math.floor(n)));
      }
      this.dirty(); this.render();
    },
    bsetToggle(key) { const b = this.bsetGet(), i = b.off.indexOf(key); if (i >= 0) b.off.splice(i, 1); else b.off.push(key); this.dirty(); this.render(); },
    // 游戏风格的下拉选择（代替浏览器自带的 select）：key 唯一名字，opts [[值, 显示]]，cur 当前值，fn(值) 选中后调用
    selBox(key, opts, cur, fn) {
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      (this._sels || (this._sels = {}))[key] = { opts, cur, fn };
      const o = opts.find(x => String(x[0]) === String(cur)) || opts[0] || ["", ""];
      return `<button class="sel" data-sel="${esc(key)}" onclick="G.openSel('${esc(key)}')"><span${o[2] ? ` class="${o[2]}"` : ""}>${esc(o[1])}</span><i>▾</i></button>`;   // o[2]：显示颜色 class
    },
    openSel(key) {
      const o = (this._sels || {})[key]; if (!o) return;
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      this.modal(`<div class="sel-list">${o.opts.map(([v, t, c], i) => `<button class="${String(v) === String(o.cur) ? "on" : ""} ${c || ""}" onclick="G.pickSel('${key}',${i})">${esc(t)}</button>`).join("")}</div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
      const cur = document.querySelector(".sel-list button.on"); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "center" });
    },
    pickSel(key, i) {
      const o = (this._sels || {})[key]; this.closeModal(); if (!o || !o.opts[i]) return;
      const [v, t, c] = o.opts[i];
      // 先在界面上显示选中的项（不等服务器往返），服务器结果回来后会按真实状态重绘
      o.cur = v;
      const span = typeof document !== "undefined" && document.querySelector && [...document.querySelectorAll("button.sel")].find(b => b.dataset && b.dataset.sel === key)?.querySelector("span");
      if (span) { span.textContent = t; span.className = c || ""; }
      o.fn(v);
    },
    bsetView() {
      const b = this.bsetGet(), acts = this.bsetActs(), esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const opt = (opts, cur) => opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur || "") ? "selected" : ""}>${esc(t)}</option>`).join("");
      const sel = (k, opts) => this.selBox("bs:" + k, opts, b[k], v => this.bsetSet(k, v));
      const num = k => `<input type="number" min="0" max="100" value="${b[k] || 0}" onchange="G.bsetSet('${k}',this.value)" style="width:5em">%`;
      const lost = key => key && key !== "auto" && key !== "atk" && !acts.some(a => a.key === key) ? `<small class="q5">已不在法术栏 / 法宝栏</small>` : "";
      const actOpts = acts.map(a => [a.key, a.name]);
      const FOE = [["mob", "怪物"], ["elite", "精英"], ["boss", "首领"]];   // 星君等不受战斗设置影响
      return `<div class="card"><h3>战斗方式<small>只对探索、出窍、历练生效（考核、试炼塔、测试、天将、星君、界主不受影响）</small></h3>
        ${FOE.map(([k, t]) => `<div class="line"><div>${t}</div>${this.selBox("bs:foe" + k, [["norm", "正常攻击", "c-green"], ["atk", "普通攻击", "c-red"]], b.foe[k] || "norm", v => this.bsetFoe(k, v))}</div>`).join("")}</div>
        <div class="card"><h3>战斗设置</h3>
        ${["第一回合", "第二回合", "第三回合"].map((t, i) => `<div class="line"><div>${t}${lost(b.r[i])}</div>${this.selBox("bs:r" + i, [["auto", "按出手方式"], ["atk", "普通攻击"], ...actOpts], b.r[i], v => this.bsetRound(i, v))}</div>`).join("")}
        <div class="line"><div>剩余回合</div>${sel("mode", [["rot", "法术、法宝轮流"], ["sp", "优先法术"], ["fb", "优先法宝"], ["max", "伤害最高优先"], ["cheap", "消耗最低优先"], ["list", "按列表顺序"], ["atk", "普通攻击"]])}</div>
        <div class="line"><div>生命低于</div>${num("lowPct")}</div>
        <div class="line"><div>先使用${lost(b.lowKey)}</div>${sel("lowKey", [["", "不使用"], ...acts.filter(a => a.shield).map(a => [a.key, a.name]), ...acts.filter(a => !a.shield).map(a => [a.key, a.name])])}</div>
        <div class="line"><div>生命高于</div><div>${num("goHp")} 继续探索</div></div>
        <div class="line"><div>法力高于</div><div>${num("goMp")} 继续探索</div></div></div>
        <div class="card"><h3>法术、法宝列表</h3>${this.bsetSorted().map((a, i, L) => { const on = !b.off.includes(a.key), k = esc(a.key);
          return `<div class="line"><div>${i + 1}. ${esc(a.name)}</div><div><button class="sm" onclick="G.bsetMove('${k}',-1)" ${i ? "" : "disabled"}>↑</button><button class="sm" onclick="G.bsetMove('${k}',1)" ${i < L.length - 1 ? "" : "disabled"}>↓</button><button class="sm ${on ? "on" : ""}" onclick="G.bsetToggle('${k}')">${on ? "使用" : "不使用"}</button></div></div>`; }).join("")}</div>`;
    },
  },
});
