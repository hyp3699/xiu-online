/* =====================================================================
 * 模块：出身（数值在 config/start.js 的 CFG.origin）
 * ---------------------------------------------------------------------
 * 创建角色时选最多 PICK 个出身，存进 s.ori（id 数组），之后不能改。
 * 开局一次性奖励在 oriApply（服务器 createState 调用）；永久效果用 oriSum(键) 读，
 * 各处接入：wudao.js mifaBonus（探索每步、功法修炼时间、炼丹/炼器成功率、肉身速度）、gongfa.js lqAdd（功法学习时间）、
 * trib.js（雷属性伤害、失败不掉修为）、world.js incMul（秘境收益）、data/gongfa.js gfLearnCost + world.js 坊市（价格）、
 * shenshi.js lsTotal（神识）、sect.js joinSect（宗门遗孤）。
 * 存档：ori [id...]，oriSect 1 = 宗门遗孤已经用过
 * ===================================================================== */
G.module({
  id: "origin",

  defaults: () => ({ ori: [] }),

  api: {
    oriList() { return ((CFG.origin || {}).LIST || []).filter(o => o && o.id); },
    oriBase() { return Math.max(0, Math.floor((CFG.origin || {}).PICK ?? 4)); },
    oriPick() { return Math.max(0, Math.floor((CFG.origin || {}).PICK ?? 4)) + Math.max(0, Math.floor(this.s ? +this.s.oriExtra || 0 : +this._oriExtra || 0)); },   // + 礼包码出身点
    oriOf(s = this.s) { const L = this.oriList(); return ((s && s.ori) || []).map(id => L.find(o => o.id === id)).filter(Boolean); },
    // 选中的出身里某个数值键加起来
    oriSum(k) { let t = 0; for (const o of this.oriOf()) t += +o[k] || 0; return t; },
    // 一次性加神识强度（出身「残魂附体」）；s.oriSs = 已加过，老存档在 tick 里补
    oriSsFix() { const s = this.s; if (!s || s.oriSs) return; s.oriSs = 1; const v = this.oriSum("ssPow"); if (v > 0) s.ssPow = (s.ssPow || 0) + v; },
    // 出身灵体：k = "Dmg"（造成该系伤害 +%）或 "Cut"（受到该系伤害 −%）
    oriEl(k, el) { if (!el) return 0; let t = 0; for (const o of this.oriOf()) t += (o.el === el ? +o["el" + k] || 0 : 0) + (+o["allEl" + k] || 0); return t; },
    oriNames(s = this.s) { return this.oriOf(s).map(o => o.name).join("、"); },
    // 清洗客户端传来的选择：只要存在的 id，不重复，最多 PICK 个
    oriClean(ids) {
      const L = this.oriList(), out = [];
      for (const id of Array.isArray(ids) ? ids : []) if (L.some(o => o.id === id) && !out.includes(id)) out.push(id);
      return out.slice(0, this.oriPick());
    },
    // 开局奖励（只在新建角色时调用一次）
    oriApply(ids) {
      const s = this.s, C = CFG.origin || {}, got = [];
      s.ori = this.oriClean(ids);
      const pick = a => a[Math.floor(Math.random() * a.length)];
      for (const o of this.oriOf()) {
        if (o.stone) { s.stone += o.stone; }
        if (o.ling) { s.ling = (s.ling || 0) + o.ling; }
        for (const [t, g, n] of o.pills || []) if (DATA.pills[t]) this.addPill(t, g, n);
        for (let i = 0; i < (o.recipe || 0); i++) {   // 丹方：RECIPE_STAR 星宗门能学的凡丹一阶，没学过的随机一张
          const star = C.RECIPE_STAR || 1, pool = Object.keys(DATA.recipes).filter(t => ((DATA.recipes[t] || {}).cat || 0) === 0 && DATA.danStar(t, 0) <= star && !s.recipes.includes(t + "|0"));
          if (pool.length) { const t = pick(pool); s.recipes.push(t + "|0"); got.push(`丹方《${DATA.danName(t, 0)}》`); }
        }
        for (let i = 0; i < (o.eqBp || 0); i++) {   // 装备图谱：随机部位一阶
          const pool = DATA.eqSlots6.map(sl => `eq:${sl}:0`).filter(k => !(s.forgeKnown || []).includes(k));
          if (pool.length) { const k = pick(pool); (s.forgeKnown = s.forgeKnown || []).push(k); got.push(this.forgeKeyName(k)); }
        }
        for (const [g, n] of o.herbs || []) if (DATA.herbs[g]) this.addMat("herb", DATA.herbs[g], g, n);
        for (const [g, n] of o.ores || []) if (DATA.ores[g]) this.addMat("ore", DATA.ores[g], g, n);
        for (let i = 0; i < (o.field || 0); i++) s.fields.push({ g: -1, start: 0, next: null, wait: false });
        if (o.qiExp && this.addCraftExp) this.addCraftExp("qi", o.qiExp);
        for (let i = 0; i < (o.fabao || 0); i++) {
          const ft = Math.floor(Math.random() * DATA.fabaoTypes.length), el = pick(DATA.elements).id;
          this.addEquip(DATA.rollForged("fabao", C.FABAO_G || 0, ft, el));
        }
        for (const ty of o.gf || []) {   // 功法：GF_STAR 星宗门随机一个，直接学会第 1 层
          const srcs = DATA.sects.filter(x => x.star === (C.GF_STAR || 1) && DATA.gfTypesOf(x.src, x.star).some(t => t.id === ty));
          if (!srcs.length) continue;
          const id = DATA.gongfaId(pick(srcs).id, ty); if (!DATA.skillInfo(id)) continue;
          if (!s.gongfa[id]) s.gongfa[id] = 1;
          got.push(`《${DATA.skillInfo(id).name}》`);
        }
        for (const [k, g] of o.furnace || []) if (this.addFurnaceItem) this.addFurnaceItem(k, g);
        if (o.bodyL) { for (let i = 0; i < o.bodyL; i++) { s.bodyL++; if (this.brRoll) this.brRoll("rs", s.bodyL); } }
      }
      this.oriSsFix();
      this.dirty();
      if (s.ori.length) this.log(`出身：${this.oriNames()}。${got.length ? "获得 " + got.join("、") + "。" : ""}`, "gold");
    },

    // 创建角色页：出身选择（界面状态 this._oriSel）
    oriToggle(id) {
      const a = this._oriSel || (this._oriSel = []), i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else if (a.length < this.oriPick()) a.push(id);
      this.oriPaint();
    },
    oriPaint() {
      const box = $("#ori-box"); if (!box) return;
      const a = this._oriSel || [], P = this.oriPick();
      box.innerHTML = `<div class="ori-pk"><span class="desc">选择出身（${a.length} / ${P}）</span><button class="ori-rs-btn" onclick="G.introPn('gift')">增加出身点</button></div>` + this.oriList().map(o => {
        const on = a.includes(o.id), off = !on && a.length >= P;
        return `<div class="ori-it${on ? " on" : ""}${off ? " off" : ""}" onclick="G.oriToggle('${o.id}')"><b>${o.name}</b><small>${o.desc || ""}</small></div>`;
      }).join("");
      // 出身可以不选满（基础和礼包码出身点都是，用户定 2026-11-16）；没选满开始时弹确认
      const b = $("#start-btn"); if (b) { b.disabled = false; b.textContent = "开始修仙"; }
    },
  },
});
