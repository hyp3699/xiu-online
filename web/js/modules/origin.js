/* =====================================================================
 * 模块：出身（数值在 config/start.js 的 CFG.origin）
 * ---------------------------------------------------------------------
 * 创建角色时选最多 PICK 个出身，存进 s.ori（id 数组），之后不能改。
 * 开局一次性奖励在 oriApply（服务器 createState 调用）；永久效果用 oriSum(键) 读，
 * 各处接入：wudao.js mifaBonus（探索每步、功法 / 法术修炼时间、炼丹/炼器成功率、修炼 / 肉身速度）、gongfa.js（修炼时间显示）、
 * craft.js（炼丹额外出丹）、trib.js（雷属性伤害、失败不掉修为）、world.js（秘境收益、元婴出窍收益）、data/gongfa.js（坊市价格）、
 * jingmai.js oriEl（灵体伤害 / 减伤）、shenshi.js（灵识点、神识强度）、sect.js joinSect（宗门遗孤）。
 * 存档：ori [id...]，oriExtra 礼包码加的出身点，oriSect 1 = 宗门遗孤已经用过，oriSs 1 = 已加过出身神识强度，
 *   oriFreeGf 出身送的不占灵识点功法，sy 寿元
 * ===================================================================== */
G.module({
  id: "origin",

  defaults: () => ({ ori: [] }),

  api: {
    oriList() { return ((CFG.origin || {}).LIST || []).filter(o => o && o.id); },
    oriPick() { return Math.max(0, Math.floor((CFG.origin || {}).PICK ?? 4)) + Math.max(0, Math.floor(this.s ? +this.s.oriExtra || 0 : +this._oriExtra || 0)); },   // + 礼包码出身点
    oriOf(s = this.s) { const L = this.oriList(); return ((s && s.ori) || []).map(id => L.find(o => o.id === id)).filter(Boolean); },
    // 选中的出身里某个数值键加起来
    oriSum(k) { let t = 0; for (const o of this.oriOf()) t += +o[k] || 0; return t; },
    // 一次性加神识强度（出身「残魂附体」）；s.oriSs = 已加过，老存档在 tick 里补
    oriSsFix() { const s = this.s; if (!s || s.oriSs) return; s.oriSs = 1; const v = this.oriSum("ssPow"); if (v > 0) s.ssPow = (s.ssPow || 0) + v; },
    // 出身灵体：k = "Dmg"（造成该系伤害 +%）或 "Cut"（受到该系伤害 −%）
    oriEl(k, el) { if (!el) return 0; let t = 0; for (const o of this.oriOf()) t += (o.el === el ? +o["el" + k] || 0 : 0) + (+o["allEl" + k] || 0); return t; },
    // 人物头像弹窗里点出身按钮：弹窗内浮层显示具体效果（用户定）
    oriTip(id) { const o = this.oriList().find(x => x.id === id), b = $("#modal-box"); if (!o || !b) return; const old = b.querySelector(".ori-tip"); if (old) old.remove();
      const d = document.createElement("div"); d.className = "ori-tip"; d.onclick = e => { if (e.target === d) d.remove(); };
      d.innerHTML = `<div class="ori-tip-box"><h3>${o.name}</h3><p>${o.desc || ""}</p><div class="btns"><button onclick="this.closest('.ori-tip').remove()">关闭</button></div></div>`; b.appendChild(d); },
    // ---------- 寿元（CFG.origin.SY）：存档 sy = { at 开启时间, cut 扣掉的寿元上限年数, ext 延寿丹加的年数, dead 死亡时间 } ----------
    syOn(s = this.s) { return !!(s && s.sy); },
    syDead(s = this.s) { return !!(s && s.sy && s.sy.dead); },
    syLife() { const L = ((CFG.origin || {}).SY || {}).LIFE || [], r = this.r(); return r < L.length ? (+L[r] || Infinity) + (+(this.s.sy || {}).ext || 0) - (+(this.s.sy || {}).cut || 0) : Infinity; },   // 修为境界 + 延寿丹 − 扣掉的寿元（扣上限，用户定）
    syYearMs() { return (+CFG.player.YEAR_MIN || 60) * 60000; },
    syAge(t = this.now()) { const y = this.s.sy; return (+((CFG.origin || {}).SY || {}).AGE0 || 0) + Math.max(0, t - y.at) / this.syYearMs(); },
    syDeathAt() { const y = this.s.sy, life = this.syLife(); if (!y || y.dead || !isFinite(life)) return Infinity; return y.at + (life - (+((CFG.origin || {}).SY || {}).AGE0 || 0)) * this.syYearMs(); },
    syStart() {   // 创建角色时开启：送灵石、背包格子
      const s = this.s, C = (CFG.origin || {}).SY || {};
      s.sy = { at: this.now(), cut: 0 }; s.stone += +C.STONE || 0; s.bagCap += +C.BAG || 0; this.dirty();
      this.log(`开启寿元：灵石 +${U.fmt(+C.STONE || 0)}，背包 +${+C.BAG || 0} 格。`, "gold");
    },
    syCut(y, why) { const s = this.s; if (!this.syOn() || this.syDead() || !(y > 0)) return; s.sy.cut = (+s.sy.cut || 0) + y; this.log(`${why}，寿元 -${y >= 1 ? y + " 年" : Math.round(y * 12) + " 个月"}。`, "bad"); this.syCheck(); },
    syCheck(t = this.now()) { const s = this.s; if (!this.syOn() || this.syDead()) return false; if (this.syAge(t) < this.syLife()) return false; s.sy.dead = t; this.log("寿元已尽，人物已死亡。", "bad"); this.dirty(); return true; },
    syText() { if (!this.syOn()) return ""; const life = this.syLife(); return `${Math.floor(this.syAge())} 岁 / ${isFinite(life) ? (life % 1 ? (Math.round(life * 10) / 10).toFixed(1) : U.fmt(life)) + " 岁" : "无限"}`; },
    // 死亡画面：只提示 + 删档按钮（不自动删档）
    syDeadView() { if (this._syShown && $("#modal-box .sy-dead")) return; this._syShown = true; this._lockModal = true;
      this.modal(`<div class="sy-dead"><h2>寿元到了</h2><p>${this.s.name} 寿元已尽，人物已死亡。</p><div class="btns"><button class="primary" onclick="G._lockModal=false;G.restart()">删档</button></div></div>`); },
    oriNames(s = this.s) { return this.oriOf(s).map(o => o.name).join("、"); },
    // 清洗客户端传来的选择：出身 id + 出身功法「gf:功法id」，不重复；出身每个 1 点、功法每本 GF.COST 点，合计不超过 oriPick()
    oriClean(ids) {
      const L = this.oriList(), out = [], gf = [], cost = this.oriGfCost(); let used = 0;
      for (const x of Array.isArray(ids) ? ids : []) {
        const k = String(x);
        if (k.startsWith("gf:")) { const id = k.slice(3); if (DATA.isOriGf(id) && !gf.includes(id) && used + cost <= this.oriPick()) { gf.push(id); used += cost; } }
        else if (L.some(o => o.id === k) && !out.includes(k) && used + 1 <= this.oriPick()) { out.push(k); used++; }
      }
      return { ori: out, gf };
    },
    oriGfCost() { const c = (((CFG.origin || {}).GF) || {}).COST; return Math.max(0, c === undefined ? 1 : +c || 0); },
    // 创建角色页已用的出身点（出身 + 买的功法）
    oriUsed() { return (this._oriSel || []).length + (this._oriGf || []).length * this.oriGfCost(); },
    // 开局奖励（只在新建角色时调用一次）
    oriApply(ids) {
      const s = this.s, C = CFG.origin || {}, got = [];
      const cl = this.oriClean(ids); s.ori = cl.ori;
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
        for (const gx of o.gf || []) {   // 功法：GF_STAR 星（或写明的星级）宗门随机一个，直接学会第 1 层；[类别, 星级, 1] 第三项 = 不占灵识点
          const [ty, star, free] = Array.isArray(gx) ? gx : [gx, C.GF_STAR || 1, 0];
          const srcs = DATA.sects.filter(x => x.star === star && DATA.gfTypesOf(x.src, x.star).some(t => t.id === ty));
          if (!srcs.length) continue;
          const id = DATA.gongfaId(pick(srcs).id, ty); if (!DATA.skillInfo(id)) continue;
          if (!s.gongfa[id]) { s.gongfa[id] = 1; if (this.gfAutoKick) this.gfAutoKick(); }
          if (free && !(s.oriFreeGf = s.oriFreeGf || []).includes(id)) s.oriFreeGf.push(id);
          got.push(`《${DATA.skillInfo(id).name}》`);
        }
        for (const [k, g] of o.furnace || []) if (this.addFurnaceItem) this.addFurnaceItem(k, g);
        if (o.wuzhen > 0) this.addDan("wuzhen", 0, o.wuzhen);
        if (o.bodyL) { for (let i = 0; i < o.bodyL; i++) { s.bodyL++; if (this.brRoll) this.brRoll("rs", s.bodyL); } }
      }
      for (const id of cl.gf) {   // 出身功法：放进传音（用户定 2026-11-27），领取后在背包里学习；不占灵识点
        if (!(s.oriFreeGf = s.oriFreeGf || []).includes(id)) s.oriFreeGf.push(id);
        this.mailboxAdd({ t: "gfb", id, n: 1 }, true, "出身功法"); got.push(`《${DATA.gongfaInfo(id, 1).name}》（传音）`);
      }
      this.oriSsFix();
      this.dirty();
      if (s.ori.length || cl.gf.length) this.log(`${s.ori.length ? `出身：${this.oriNames()}。` : ""}${got.length ? "获得 " + got.join("、") + "。" : ""}`, "gold");
    },

    // 创建角色页：出身选择（界面状态 this._oriSel）
    oriToggle(id) {
      const a = this._oriSel || (this._oriSel = []), i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else if (this.oriUsed() + 1 <= this.oriPick()) a.push(id);
      this.oriPaint();
    },
    // 出身页「功法」面板：用出身点买出身功法（再点一次退掉）
    oriGfToggle(id) {
      const a = this._oriGf || (this._oriGf = []), i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else if (DATA.isOriGf(id) && this.oriUsed() + this.oriGfCost() <= this.oriPick()) a.push(id);
      this.oriPaint(); this.oriGfPaint();
    },
    oriGfPaint() {
      const box = $("#ori-gf-list"); if (!box) return;
      const C = (CFG.origin || {}).GF || {}, a = this._oriGf || [], P = this.oriPick(), U0 = this.oriUsed(), cost = this.oriGfCost();
      const n = $("#ori-gf-n"); if (n) n.textContent = `已用 ${U0} / ${P}`;
      box.innerHTML = (C.TYPES || ["xinfa", "gongjue"]).map(t => {
        const ty = DATA.gongfaTypes.find(x => x.id === t);
        return `<h3>${ty ? ty.name : t}</h3>` + DATA.oriGfSources.map(o => { const id = DATA.gongfaId(o.id, t), g = DATA.gongfaInfo(id, 1); if (!g) return "";
          const on = a.includes(id), off = !on && U0 + cost > P;
          return `<div class="line"><div>《${g.name}》<span class="tag">${g.star}星</span><small>每层${g.label} +${U.num(g.perLv)} · 学习 ${U.dur(DATA.gfLearnMsOf(g) / 1000)} · 不占灵识点 · ${cost} 出身点</small></div>
            <button class="sm${on ? "" : " primary"}" onclick="G.oriGfToggle('${id}')" ${off ? "disabled" : ""}>${on ? "已购买" : "购买"}</button></div>`; }).join("");
      }).join("");
    },
    oriPaint() {
      const box = $("#ori-box"); if (!box) return;
      const a = this._oriSel || [], P = this.oriPick(), U0 = this.oriUsed();
      box.innerHTML = `<div class="ori-pk"><span class="desc">出身点（已用 ${U0} / ${P}）</span><span class="ori-pk-r"><button class="ori-rs-btn${this._oriSy ? " primary" : ""}" onclick="G._oriSy=!G._oriSy;G.oriPaint()">${this._oriSy ? "已开启寿元" : "开启寿元"}</button><button class="ori-rs-btn${(this._oriGf || []).length ? " primary" : ""}" onclick="G.introPn('gf')">功法${(this._oriGf || []).length ? " " + this._oriGf.length : ""}</button><button class="ori-rs-btn" onclick="G.introPn('gift')">增加出身点</button></span></div>` + this.oriList().map(o => {
        const on = a.includes(o.id), off = !on && U0 + 1 > P;
        return `<div class="ori-it${on ? " on" : ""}${off ? " off" : ""}" onclick="G.oriToggle('${o.id}')"><b>${o.name}</b><small>${o.desc || ""}</small></div>`;
      }).join("");
      // 出身可以不选满（基础和礼包码出身点都是，用户定）；没选满开始时弹确认
      const b = $("#start-btn"); if (b) { b.disabled = false; b.textContent = "开始修仙"; }
    },
  },
});
