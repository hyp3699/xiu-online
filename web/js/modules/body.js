/* =====================================================================
 * 模块：修炼肉身（数值在 config/body.js）
 * ---------------------------------------------------------------------
 * 需要学会炼体秘诀（宗门功法殿，gongfa 类型 tijue）。每 10 秒消耗灵气转化肉身修为，可开关自动修炼。
 * 肉身境界 bodyL：-1 = 凡体，0 = 第一境界一层 …… 29 境界 × 10 层。每层手动突破，不需要雷劫。
 * 突破扣除攒够的气血（肉身修为），另消耗灵石、药材；每突破一层增加属性（bodyBonus，加进 player.js computeStats）。
 * ===================================================================== */
G.module({
  id: "body",

  defaults: () => ({
    bodyL: -1,        // 肉身境界层序（-1 凡体）
    bodyExp: 0,       // 肉身修为
    bodyAuto: false,  // 自动修炼肉身
  }),

  tick() {
    const s = this.s, B = CFG.body;
    if (!s.bodyAuto || !this.hasTijue() || this.exBlocksCult() || this.bodyMax()) return;
    // 修为没在修炼时，修炼室的次数 / 贡献由肉身修炼来扣（免费最后一次也吃到加速）
    let freeEnd = false;
    if (!this.cultRoomOn()) {
      if (this.freeCultOn()) { if (--s.freeCult.left <= 0) { s.freeCult.left = 1; freeEnd = true; } }
      else if (s.room >= 0 && s.sect) { const c = this.roomCost(s.room); if (s.contrib >= c) s.contrib -= c; else { s.room = -1; this.dirty(); this.log("门派贡献不足，已离开修炼室。", "bad"); } }
    }
    const sp = this.bodySpeed().total, rate = Math.max(0.0001, B.LING_RATE || 1), red = this.wdRed("body");   // red：神魂之道减掉的灵气消耗
    // 灵气不够且开了聚灵阵自动补充：用灵石补（和修为修炼一样）
    if (s.ling < sp * rate - red && s.array && s.array.autoRefill && s.stone >= 1) {
      const per = this.lingPerStone(), pay = Math.min(Math.ceil((sp * rate - red - s.ling) / per), Math.floor(s.stone));
      s.stone -= pay; s.ling += pay * per;
    }
    const per = Math.max(0, sp * rate - red) / Math.max(1e-9, sp), gain = per > 0 ? Math.min(sp, Math.floor(s.ling / per)) : sp;   // 每点肉身修为的灵气，按比例
    if (freeEnd) { s.freeCult.left = 0; s.freeCult.on = false; this.dirty(); this.log(`${CFG.sect.freeRoom.name}次数已用完。`, "sys"); }
    if (gain <= 0) return;
    s.ling = Math.max(0, s.ling - gain * per); s.bodyExp += gain;
  },

  api: {
    // 肉身此刻是否在自动修炼（进度条用）
    bodyActive() { return !!this.s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax() && this.s.ling >= 1; },
    hasTijue() { return this.hasGfStat("body"); },   // 任意一本炼体秘诀（tijue / tijue2 / tijue3 …）
    bodyMaxL() { return CFG.body.names.length * DATA.LAYERS - 1; },
    bodyMax() { return this.s.bodyL >= this.bodyMaxL(); },
    // 肉身境界名：凡体 / 淬皮一层
    bodyName(L) { if (L === undefined) L = this.s.bodyL; return L < 0 ? "凡体" : CFG.body.names[Math.floor(L / DATA.LAYERS)] + DATA.layerNames[L % DATA.LAYERS]; },
    // 升到第 T 层（= bodyL + 1）需要的肉身修为
    bodyNeed(T) { if (T === undefined) T = this.s.bodyL + 1; return Math.round(DATA.brNeed(CFG.realm.BODY_EXP, T, CFG.realm.BODY_EXP_RATE) * DATA.brRate()); },   // config/realm.js 的 BODY_EXP
    // 肉身修炼速度（每 10 秒）
    // 修为修炼正在跑（由它扣修炼室）
    cultRoomOn() { return !!(this.isCultivating && this.isCultivating() && this.hasMijue() && !this.exBlocksCult()); },
    bodyRunning() { const s = this.s; return !!s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax(); },
    // 修炼室加成生效：修为或肉身任一在修炼
    roomActive() { return this.cultRoomOn() || this.bodyRunning(); },
    bodySpeed() {
      const s = this.s, base = (CFG.body.BASE_SPEED || 0) * Math.pow(CFG.body.SPEED_GROW, s.mortal ? 0 : s.L);
      const M = this.mifaBonus(), gf = this.gongfaBonus().body || 0, mf = M.bodySpeed || 0;
      // 修炼室加成同样作用于肉身修炼（免费修炼室优先，和修为修炼一致）。
      // 修为修炼在跑时由 cultivate.tick() 扣次数 / 贡献；只开肉身时由 body tick 自己扣（bodyRoomCharge），不会白嫖。
      const room = this.roomActive() ? (this.freeCultOn && this.freeCultOn() ? this.freeCultPct() : s.room >= 0 && s.sect && this.roomPct ? this.roomPct(s.room) : 0) : 0;
      const arr = this.arrayFactor ? Math.max(0, (this.arrayFactor() - 1) * 100) : 0;   // 聚灵阵效率 %，同修为修炼
      const pct = (M.bodySpeedPct || 0) + (this.servantPct ? this.servantPct("cult") : 0) + room + arr;   // 炼体秘法圆满额外 % + 道童辅助修炼 % + 修炼室 % + 聚灵阵 %
      const jm = this.jmFull ? this.jmFull().body : 0;   // 经脉穴位冲满：直接加数值（jingmai.js）
      return { base, gf, mf, room, arr, pct, jm, total: Math.floor(((base + gf + mf) * (1 + pct / 100) + jm) * 100) / 100 };   // 保留两位小数：速度很小时修炼室等百分比加成也能生效
    },
    // 突破到第 T 层的消耗
    bodyCost(T) {
      const B = CFG.body, s = this.s; if (T === undefined) T = s.bodyL + 1;
      if (DATA.isTest()) return { stone: 0, herbs: [] };   // 测试模式不要灵石、药材
      const ri = Math.floor(T / DATA.LAYERS), seg = (B.HERB_SEG || []).find(g => ri >= g.from && ri <= g.to);
      let n, herbs;
      if (seg) {   // 分段规则：(base + step × 段内层数) × 凡界 / 仙界倍率
        const k = T - seg.from * DATA.LAYERS, mult = seg.mult === "xian" ? B.HERB_MULT_XIAN : B.HERB_MULT_FAN;
        n = Math.max(1, Math.round((seg.base + seg.step * k) * (mult === undefined ? 1 : mult))); herbs = seg.herbs;
      } else {     // 不在分段里的境界（神体及以上）：HERB_XIAN_BASE × HERB_RATE^(T − HERB_FROM × 10)
        n = Math.max(1, Math.round(B.HERB_XIAN_BASE * Math.pow(B.HERB_RATE, T - B.HERB_FROM * DATA.LAYERS))); herbs = B.HERBS_XIAN;
      }
      return { stone: Math.floor(B.STONE_BASE * Math.pow(B.STONE_RATE, T)),
        herbs: herbs.map(name => ({ name, n })) };
    },
    // 按名字数 / 扣药材（凡界药材或 content/items.js 的自定义物品）
    herbCount(name) { const m = DATA.matByName[name]; if (m) return this.countMat(m.kind, m.g); return this.s.bag.reduce((a, it) => a + (it.t === "cu" && it.name === name ? it.n : 0), 0); },
    herbTake(name, n) {
      n = Math.floor(+n); if (!(n >= 1)) return;
      const m = DATA.matByName[name]; if (m) return this.takeMat(m.kind, m.g, n);
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) { const it = this.s.bag[i]; if (it.t !== "cu" || it.name !== name) continue; const k = Math.min(n, it.n); this.removeAt(i, k); n -= k; }
    },
    bodyBlock() {
      const s = this.s; if (this.bodyMax()) return "已达肉身极境";
      const c = this.bodyCost();
      if (s.bodyExp < this.bodyNeed()) return `气血未满，还差 ${U.fmt(this.bodyNeed() - s.bodyExp)}`;
      if (s.stone < c.stone) return "灵石不足";
      if (c.herbs.some(h => this.herbCount(h.name) < h.n)) return "药材不足";
      return "";
    },
    bodyBreak() {
      const s = this.s, why = this.bodyBlock(); if (why) return this.log(why + "。", "sys");
      const c = this.bodyCost();
      s.bodyExp -= this.bodyNeed(); s.stone -= c.stone;
      c.herbs.forEach(h => this.herbTake(h.name, h.n));
      s.bodyL++; this.brRoll("rs", s.bodyL); this.dirty();
      this.log(`肉身突破至【${this.bodyName()}】！`, s.bodyL % DATA.LAYERS === 0 ? "gold" : "good");
      this.after();
    },
    toggleBodyAuto() { this.s.bodyAuto = !this.s.bodyAuto; this.log(this.s.bodyAuto ? "开启自动修炼肉身。" : "停止自动修炼肉身。", "sys"); this.after(); },
    // 肉身突破加的属性合计（config/realm.js 的 BODY_GAIN，每层固定值）+ 宗门炼体池
    bodyBonus() {
      const n = (this.s.bodyL === undefined ? -1 : this.s.bodyL) + 1, out = { hp: 0, atk: 0, def: 0, mana: 0, speed: 0, hit: 0, dodge: 0, crit: 0, res: 0 };
      const pg = this.s.poolGain || {}; for (const k in out) out[k] += (pg[k] || 0) + DATA.plBodyStat(n, k) + (n > 0 ? this.brRand("rs", k) : 0);   // 宗门炼体池加的（sect.js）；brRand 突破随机
      out.resEl = Object.fromEntries(DATA.elements.map(e => [e.id, n > 0 ? this.brRand("rs", "res:" + e.id) : 0]));   // 抗性随机六系各不同
      return out;
    },
    // 突破弹窗：点人物右下「突破」才显示需要的气血、灵石、药材
    openBodyBreak() {
      const s = this.s, max = this.bodyMax(); if (max) return this.modal(`<h2>肉身突破</h2><p class="desc">已达肉身极境。</p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
      const need = this.bodyNeed(), c = this.bodyCost(), why = this.bodyBlock(), ok = (a, b) => a >= b ? "" : "q5";
      this.modal(`<h2>肉身突破<small>${this.bodyName()} → ${this.bodyName(s.bodyL + 1)}</small></h2>
        <div class="line"><div>气血</div><b class="${ok(s.bodyExp, need)}">${U.fmt(s.bodyExp)} / ${U.fmt(need)}</b></div>
        <div class="line"><div>灵石</div><b class="${ok(s.stone, c.stone)}">${U.fmt(s.stone)} / ${U.fmt(c.stone)}</b></div>
        ${c.herbs.map(h => { const hv = this.herbCount(h.name); return `<div class="line"><div>${h.name}</div><b class="${ok(hv, h.n)}">${U.fmt(hv)} / ${U.fmt(h.n)}</b></div>`; }).join("")}
        <div class="btns"><button class="primary" data-refresh="openBodyBreak" onclick="G.bodyBreak()" ${why ? "disabled" : ""}>${why || "突 破"}</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 修炼肉身页：上面人物打坐（左上肉身境界，左下自动修炼，右下突破），下面肉身加成，底部返回修炼
    bodyView() {
      const s = this.s, sp = this.bodySpeed(), has = this.hasTijue(), max = this.bodyMax();
      const need = this.bodyNeed(), bb = this.bodyBonus();
      const warn = !has ? "未学炼体秘诀（宗门 → 功法殿）" : !s.bodyAuto ? "" : this.exBlocksCult() ? "历练 / 探索中，无法修炼" : s.ling < 1 ? "灵气耗尽" : "";
      const run = s.bodyAuto && has && !warn && !max;
      const names = { hp: "生命", atk: "攻击", def: "防御", mana: "法力", speed: "速度", hit: "命中", dodge: "闪避", crit: "暴击%" };
      // 抗性：每系（金木水火土雷）单独一行
      const bonus = Object.keys(names).filter(k => bb[k]).map(k => `<div><span>${names[k]}</span>+${k === "crit" ? U.num(bb[k]) : U.fmt(bb[k])}</div>`).join("")
        + (bb.res ? DATA.elements.map(e => `<div><span>${e.name}抗性</span>+${U.fmt(bb.res + (bb.resEl[e.id] || 0))}</div>`).join("") : "");
      return `<div class="bd-page">
        <div class="bd-stg${run ? " on" : ""}">
          <div class="cult-aura bd-aura"></div>
          <img class="cult-hero" src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt="">
          <div class="bd-realm">${this.bodyName()}</div>
          <button class="cult-orb l${s.bodyAuto ? " on" : ""}" onclick="G.toggleBodyAuto()"><span>${s.bodyAuto ? "停止<br>修炼" : "自动<br>修炼"}</span></button>
          <button class="cult-orb r" onclick="G.openBodyBreak()"><span>${max ? "极境" : "突破"}</span></button>
          <div class="cult-info">
            <div class="cult-eff">肉身修炼：<b>${U.num(sp.total)}</b> / 10秒</div>
            <div class="cult-tick"><div id="body-bar"></div></div>
            <div class="cult-total"><span>气血：</span><b>${U.fmt(s.bodyExp)}${max ? "" : ` / ${U.fmt(need)}`}</b></div>
            ${warn ? `<p class="cult-wish bad">${warn}</p>` : ""}
          </div>
        </div>
        <div class="card"><h3>肉身加成</h3>${bonus ? `<div class="stats">${bonus}</div>` : `<p class="desc">尚未突破，突破后每层增加属性。</p>`}</div>
        <div class="btns"><button onclick="G.openBody(false)">返回修炼</button></div>
      </div>`;
    },
  },
});
