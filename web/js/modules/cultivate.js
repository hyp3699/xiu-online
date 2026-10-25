/* =====================================================================
 * 模块：修炼（灵气 → 修为、突破、丹药加速）
 * ---------------------------------------------------------------------
 * 修炼速度 = 基础修炼速度 × (1 + (聚灵阵% + 丹药% + 修炼室%) / 100)（百分比加成全部相加，不连乘）
 *   基础修炼速度 = 境界基础 + 秘诀（开局不再随机灵根）
 * 聚灵阵开关在本页；开关只影响修炼速度（关闭后没有聚灵阵倍率），不影响聚灵。
 * 修炼前提：学会至少一部秘诀，且不在自动探索中。
 * 每 10 秒修炼一次：消耗 灵气 = 修炼速度，获得同等修为（1 灵气 = 1 修为）
 * 灵气不够时，只能把剩下的灵气全部转化；灵气为 0 时无法修炼（进度条不走）。
 * 修为满了不会自动突破，必须手动点“突破”。修为会继续累积，不会浪费。
 * 渡劫：从 config/trib.js 的 START 层开始（默认突破筑基期一层起），每层突破都要渡劫：
 *   点「突破」进渡劫准备页，开始后撑过劫云 TIME 秒没倒 = 突破成功（详见 modules/trib.js）。
 * 没有雷劫的突破：小境界 100% 成功；大境界有成功率，失败损失 30% 修为。
 * ===================================================================== */
G.module({
  id: "cultivate",
  tab: "cultivate",

  defaults: () => ({
    auto: false,      // 自动修炼开关
    buffs: {},        // 丹药效果 { juqi: {pct, left} }，left = 剩余修炼次数
    autoPill: { juqi: false, juling: false, peiyuan: false }, // 自动服丹开关
    lackWarned: false,
    trib: null,       // 正在进行（或刚结束未关闭）的渡劫（modules/trib.js）
    // 修炼设置：自动修炼中，灵石 < low 且灵气不足 → 去 tgt（"k:地图" 灵矿 / "e:地图:区域" 自动探索）；灵气 ≥ 上限的 pct% → 停止探索回来修炼
    cultSet: { on: false, low: 1000, mul: 10, tgt: "", went: false },
  }),

  tick(offline) {
    const s = this.s;
    if (s.trib) this.advanceTrib(); // 渡劫（离线也会算完）
    this.cultSetCheck();
    if (!this.isCultivating()) return;
    if (!this.hasMijue() || this.exBlocksCult()) return; // 未学秘诀 / 探索中（出窍除外）：不能修炼

    // 1. 自动服丹：效果用完就吃背包里能吃的最高品质
    for (const t in DATA.pills) {
      const b = s.buffs[t];
      if (s.autoPill[t] && (!b || b.left <= 0)) {
        const i = this.bestPillIndex(t);
        if (i >= 0) this.usePill(i, true);
      }
    }

    // 2. 修炼室：免费修炼室（每天 N 次，每次若干次修炼）优先，用完再按付费修炼室扣
    if (this.freeCultOn()) {
      if (--s.freeCult.left <= 0) { s.freeCult.left = 0; s.freeCult.on = false; this.dirty(); this.log(`${CFG.sect.freeRoom.name}次数已用完。`, "sys"); }
    } else if (s.room >= 0 && s.sect) {
      const c = this.roomCost(s.room);
      if (s.contrib >= c) s.contrib -= c;
      else { s.room = -1; this.dirty(); this.log("门派贡献不足，已离开修炼室。", "bad"); }
    }

    // 3. 灵气不足且开了自动补充：用灵石补
    const sp = this.speed().total, red = this.wdRed("exp");   // red：神魂之道减掉的灵气消耗
    if (s.ling < sp - red && s.array.autoRefill && s.stone >= 1) {
      const rate = this.lingPerStone();
      const pay = Math.min(Math.ceil((sp - red - s.ling) / rate), Math.floor(s.stone));
      s.stone -= pay; s.ling += pay * rate;
    }

    // 4. 灵气转修为
    // 每点修为的灵气 = (速度 − 减少量) ÷ 速度；灵气不够时按比例只修一部分（没灵气就修不了）
    const per = Math.max(0, sp - red) / Math.max(1e-9, sp), gain = per > 0 ? Math.min(sp, Math.floor(s.ling / per)) : sp;
    if (gain <= 0) {           // 没有灵气，本次修炼不生效
      if (!s.lackWarned) { this.log("灵气耗尽，无法修炼。请开启聚灵阵或用灵石补充灵气。", "bad"); s.lackWarned = true; }
      return;
    }
    s.ling = Math.max(0, s.ling - gain * per); s.exp += gain;
    if (gain < sp * 0.999) {
      if (!s.lackWarned) { this.log("灵气不足，修炼受阻。请开启聚灵阵或用灵石补充灵气。", "bad"); s.lackWarned = true; }
    } else s.lackWarned = false;

    // 5. 丹药持续次数 -1
    for (const t in s.buffs) {
      const b = s.buffs[t];
      if (b.left > 0 && --b.left === 0) { this.dirty(); this.log(`${DATA.pills[t].name}药力耗尽。`, "sys"); }
    }
  },

  api: {
    isCultivating() { return this.s.auto; },
    // 有灵气（或开了自动补充且有灵石）才能修炼
    // 探索、历练中不能修炼；元婴出窍探索时可以继续修炼
    exBlocksCult() { return !!(this.s.explore && !this.s.explore.cq); },
    canCultivate() { return this.hasMijue() && !this.exBlocksCult() && (this.s.ling >= 1 || (this.s.array.autoRefill && this.s.stone >= 1) || this.wdRed("exp") >= this.speed().total); },
    // 不能修炼的原因（能修炼返回空）
    cultivateBlock() {
      if (!this.hasMijue()) return "未学秘诀，无法修炼（门派功法殿学习）";
      if (this.exBlocksCult()) return this.s.explore.once ? "历练中，无法修炼" : "自动探索中，无法修炼";
      if (!this.canCultivate()) return "灵气耗尽，修炼停滞";
      return "";
    },

    computeSpeed() {
      const st = this.stats(), s = this.s;
      const mifa = this.mifaBonus().expSpeed || 0;          // 宗门秘法「聚元」：固定加基础修炼速度
      const base = st.cultivate + this.gongfaBonus().cultivate + mifa;
      const arr = this.arrayFactor();                     // 聚灵阵常开
      let pill = 0;
      for (const t in s.buffs) { const b = s.buffs[t]; if (b && b.left > 0) pill += b.pct; }
      const room = this.freeCultOn() ? this.freeCultPct() : s.room >= 0 && s.sect ? this.roomPct(s.room) : 0;
      // 所有百分比加成相加后再乘：总速度 = 基础 × (1 + (聚灵阵% + 丹药% + 修炼室%) / 100)，避免数值连乘爆炸
      const arrPct = (arr - 1) * 100, mfPct = this.mifaBonus().expSpeedPct || 0, svPct = this.servantPct("cult");   // 聚元秘法圆满额外 %、道童辅助修炼 %
      return { base, arr, pill, room, mifa, mfPct, svPct, total: base * (1 + (arrPct + pill + room + mfPct + svPct) / 100),
        gather: this.gatherAmount() };                                     // 每 10 秒聚灵（开关不影响）
    },

    /* ---------- 修炼设置：灵石不够自动去探索 / 挖矿，够了回来修炼 ---------- */
    cultLack() { return this.s.ling < this.speed().total - this.wdRed("exp"); },   // 灵气不够修炼一次
    cultTargets() {   // [[值, 名称]]：开放的灵矿 + 历练通过的区域
      const out = [];
      DATA.maps.forEach((m, a) => {
        if (!this.mapOpen(a)) return;
        out.push([`k:${a}`, this.kuangName(a)]);
        for (let r = 0; r < DATA.regionCount; r++) if (this.isTrained(a, r)) out.push([`e:${a}:${r}`, DATA.regionName(a, r)]);
      });
      return out;
    },
    cultSetCheck() {
      const s = this.s, c = s.cultSet; if (!c || !c.on || !c.tgt || !s.auto) return;
      if (c.mul === undefined) { c.mul = 10; delete c.pct; }   // 旧存档：「灵气高于 %」改成「灵气高于修炼速度几倍」
      const x = s.explore, p = c.tgt.split(":").map(Number), kuang = c.tgt[0] === "k";
      const mine = x && !x.cq && !x.once && x.map === p[1] && (kuang ? x.kuang : !x.kuang && x.reg === p[2]);
      if (mine && c.went) {
        if (s.ling >= Math.min(this.lingCap(), this.speed().total * Math.max(1, c.mul || 10))) {   // 灵气 ≥ 修炼速度 × 倍数（最多到灵气上限）
          c.went = false; this.stopExplore("灵气已恢复，停止探索");
          this.log("开始修炼。", "sys"); this.dirty();   // v208 不再重置结算计时（会丢聚灵）
        }
        return;
      }
      // 修炼设置自动去的探索，但「前往」已改成别处（例如从灵矿改成青云山林东）：停下当前的，下面按新地点重新出发
      if (x && !x.cq && !x.once && (x.cs || c.went)) { c.went = false; this.stopExplore("前往地点已更改"); }
      else if (x) return;   // 别的探索 / 出窍中：不管
      if (s.stone < c.low && this.cultLack() && this.hasMijue()) {
        if (!this.cultTargets().some(t => t[0] === c.tgt)) return;
        if (kuang) this.toggleKuang(p[1]); else this.toggleExplore(p[1], p[2], false);
        if (this.s.explore) { c.went = true; this.s.explore.cs = 1; this.exploreOpen = false; this.log("灵石不足且灵气不够修炼，自动前往探索。", "sys"); }
      }
    },
    openCultSet() {
      const s = this.s, c = s.cultSet, T = this.cultTargets(), a = s.array;
      this.modal(`<h2>修炼设置</h2>
        <p class="desc">自动修炼时，灵石低于下限且灵气不足，自动去探索或挖矿；灵气恢复到修炼速度（每次修炼消耗）的设定倍数以上，停止探索回来修炼。</p>
        <div class="line"><div>自动探索 / 挖矿</div><button data-refresh="openCultSet" class="sm ${c.on ? "on" : ""}" onclick="G.cultSetSave('on')">${c.on ? "开" : "关"}</button></div>
        <div class="line"><div>灵石低于</div><input id="cs-low" type="number" min="0" value="${c.low}" style="width:130px" onchange="G.cultSetSave()"></div>
        <div class="line"><div>灵气高于修炼速度（倍）<small>当前修炼速度 ${U.fmt(this.speed().total)}</small></div><input id="cs-high" type="number" min="1" value="${c.mul === undefined ? 10 : c.mul}" style="width:130px" onchange="G.cultSetSave()"></div>
        <div class="line"><div>前往</div><button class="sm" onclick="G.openAtPick('tgt')">${(T.find(t => t[0] === c.tgt) || T[0] || [0, "暂无可去的地方"])[1]} ▾</button></div>
        <div class="line"><div>聚灵阵灵气不足时自动用灵石补充</div><button data-refresh="openCultSet" class="sm ${a.autoRefill ? "on" : ""}" onclick="G.toggleRefill()">${a.autoRefill ? "开" : "关"}</button></div>
        <h3 style="margin-top:14px">自动执行任务</h3>
        ${this.autoTaskHtml(T)}
        <div class="btns"><button class="primary" onclick="G.closeModal()">确定</button></div>`);
      if (!c.tgt && T.length) c.tgt = T[0][0];
    },
    // v229 自动执行任务（逻辑见 modules/sect.js runAutoTask）
    autoTaskHtml(T) {
      const A = this.autoTask(), sw = k => `<button class="sm ${A[k] ? "on" : ""}" onclick="G.autoTaskSet('${k}')">${A[k] ? "开" : "关"}</button>`;
      // v232 选择不用系统下拉框：点按钮弹出游戏风格的选择列表（atPick）
      const sel = (k, list, v) => { const c = list.find(([x]) => String(x) === String(v)) || list[0]; return `<button class="sm" style="margin-left:8px" onclick="G.openAtPick('${k}')">${c ? c[1] : "暂无"} ▾</button>`; };
      const P = this.atList("poolI"), W = ((CFG.wudaoRoom || {}).daos || []);
      const dn = id => (W.find(d => d.id === id) || {}).name || id;
      return `<div class="line"><div>${CFG.sect.freeRoom.name}</div>${sw("free")}</div>
        <div class="line"><div>${CFG.sect.freeGfRoom.name}</div>${sw("gf")}</div>
        <div class="line"><div>${CFG.sect.pool.name}${sel("poolI", P, A.poolI)}</div>${sw("pool")}</div>
        <div class="line"><div>${dn("xiulian")}悟道</div>${sw("xiulian")}</div>
        <div class="line"><div>${dn("shenhun")}悟道</div>${sw("shenhun")}</div>
        <div class="line"><div>${dn("zhandou")}悟道</div>${sw("zhandou")}</div>
        <div class="line"><div>自动出窍${sel("cqT", this.atList("cqT"), A.cqT)}</div>${sw("cq")}</div>`;
    },
    atList(k) { return k === "poolI" ? CFG.sect.pool.list.map((d, i) => [i, d.name]) : this.cultTargets(); },
    // 前往 / 自动出窍：「隐藏」按钮进入隐藏模式，逐个地图点隐藏 / 显示；隐藏的地图平时不列出（s.atHide[k] 存隐藏的目标）
    openAtPick(k, mode) {
      if (mode !== undefined) this._atHideMode = !!mode;
      const A = k === "tgt" ? this.s.cultSet : this.autoTask(), L = this.atList(k), cur = A[k] === "" || A[k] === undefined ? (L[0] || [])[0] : A[k];
      const canHide = k !== "poolI", hm = canHide && this._atHideMode, H = canHide ? ((this.s.atHide || {})[k] || []) : [], hid = x => H.includes(String(x));
      const rows = L.map(([x, n], i) => hm
        ? `<div class="line"><div class="${hid(x) ? "muted" : ""}">${n}${hid(x) ? "（已隐藏）" : ""}</div><button class="sm ${hid(x) ? "on" : ""}" onclick="G.atHideSet('${k}',${i})">${hid(x) ? "显示" : "隐藏"}</button></div>`
        : hid(x) ? "" : `<div class="line"><div>${n}</div><button class="sm ${String(x) === String(cur) ? "on" : ""}" onclick="G.atPickSet('${k}',${i})">${String(x) === String(cur) ? "已选" : "选择"}</button></div>`).join("");
      this.modal(`<h2>${k === "poolI" ? CFG.sect.pool.name : k === "tgt" ? "前往" : "自动出窍"}${hm ? "<small>点地图右边按钮隐藏 / 显示</small>" : ""}</h2>
        ${rows || `<p class="desc">${L.length ? "地图都已隐藏，点「隐藏」可以重新显示" : "暂无可选"}</p>`}
        <div class="btns">${canHide ? `<button class="${hm ? "on" : ""}" onclick="G.openAtPick('${k}',${hm ? 0 : 1})">${hm ? "完成" : "隐藏"}</button>` : ""}<button onclick="G._atHideMode=false;G.openCultSet()">返回</button></div>`);
    },
    atHideSet(k, i) {
      const it = this.atList(k)[i]; if (!it || k === "poolI") return;
      const s = this.s; s.atHide = s.atHide || {}; const H = s.atHide[k] = s.atHide[k] || [], x = String(it[0]), j = H.indexOf(x);
      if (j >= 0) H.splice(j, 1); else H.push(x);
      this.openAtPick(k); this.after();
    },
    atPickSet(k, i) { const it = this.atList(k)[i]; if (it) (k === "tgt" ? this.s.cultSet : this.autoTask())[k] = it[0]; this.openCultSet(); this.after(); },
    autoTaskSet(k) {
      const A = this.autoTask(), L = this.atList("cqT");
      if (A.cqT === "" && L.length) A.cqT = L[0][0];   // 没选过地图就用第一个
      if (k) { A[k] = !A[k]; this.openCultSet(); }
      this.after();
    },
    cultSetSave(k, low, high) {
      const c = this.s.cultSet, v = id => $(id) && $(id).value;
      c.low = Math.max(0, Math.floor(+(low === undefined ? v("#cs-low") : low) || 0)); c.mul = Math.max(1, Math.floor(+(high === undefined ? v("#cs-high") : high) || 10)); delete c.high; delete c.pct;
      if (k === "on") { c.on = !c.on; c.went = false; this.openCultSet(); }
      this.after();
    },

    toggleAuto() {
      this.s.auto = !this.s.auto;
      if (this.s.auto) this._lastTick = Date.now();
      this.log(this.s.auto ? "开启自动修炼。" : "停止自动修炼。", "sys");
      this.after();
    },
    // 修炼肉身界面（modules/body.js）
    openBody(on) { this.cultView = on ? "body" : ""; this.render(); },
    // 人物头像：人物属性（原来在修炼页下方，现在点头像打开）
    openProfile() {
      const s = this.s, st = this.stats(), sp = this.speed(), R0 = this.regen(false), R1 = this.regenStep();
      this.modal(`<h2>${s.name}<small>${this.realmName()}</small></h2>
        <div class="stats">
          <div><span>生命</span>${U.fmt(s.hp)}/${U.fmt(st.hp)}</div><div><span>法力</span>${U.fmt(s.mana)}/${U.fmt(st.mana)}</div>
          <div><span>攻击</span>${U.fmt(st.atk)}</div><div><span>防御</span>${U.fmt(st.def)}</div>
          <div><span>命中</span>${U.num(st.hit)}</div><div><span>闪避</span>${U.num(st.dodge)}</div>
          <div><span>速度</span>${U.fmt(st.speed)}</div><div><span>暴击</span>${st.crit.toFixed(1)}%</div>
          ${DATA.elements.map(e => `<div><span>${e.name}抗</span>${U.fmt(st.res[e.id])}</div>`).join("")}
          <div style="grid-column:1/3"><span>修炼速度</span>${U.fmt(sp.total)} / 10秒</div>
        </div>
        <p class="desc" style="margin-top:6px">平时每 10 秒恢复 生命 ${U.num(R0.hp)}% · 法力 ${U.num(R0.mana)}%；历练/探索每走一步恢复 生命 ${U.num(R1.hp)}%${R1.hpFlat ? ` + ${U.fmt(R1.hpFlat)}` : ""} · 法力 ${U.num(R1.mana)}%${R1.manaFlat ? ` + ${U.fmt(R1.manaFlat)}` : ""}</p>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 顶部设置按钮：修炼设置（从修炼卡片移到这里）
    openSettings() {
      const c = this.s.cultSet;
      this.modal(`<h2>设置</h2>
        <div class="line"><div>修炼设置<small>自动探索 / 挖矿、自动执行任务、灵气不足自动补灵石${c && c.on ? " · 已开启" : ""}</small></div><button class="sm ${c && c.on ? "on" : ""}" onclick="G.openCultSet()">打开</button></div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 修炼加成（弹窗）：修炼速度构成 + 丹药
    openBoost() {
      const s = this.s, st = this.stats(), sp = this.speed(), arrPct = (this.arrayFactor() - 1) * 100;
      this.modal(`<h2>修炼加成<small> · ${U.num(sp.total)} 修为 / 10秒</small></h2>
        <div class="line"><div>基础修炼速度<small>境界 ${U.num(st.cultivate)} + 秘诀 ${U.num(this.gongfaBonus().cultivate)} + 秘法 ${U.num(sp.mifa)}</small></div><b>${U.num(sp.base)}</b></div>
        <div class="line"><div>聚灵阵<small>${s.array.lv} 级</small></div><b>+${U.num(arrPct)}%</b></div>
        <div class="line"><div>聚元秘法圆满</div><b>+${U.num(sp.mfPct)}%</b></div>
        <div class="line"><div>道童辅助修炼</div><b>+${U.num(sp.svPct)}%</b></div>
        <div class="line"><div>丹药</div><b>+${Math.round(sp.pill)}%</b></div>
        <div class="line"><div>修炼室<small>${this.freeCultOn() ? `${CFG.sect.freeRoom.name}（剩余 ${s.freeCult.left} 次）` : s.room >= 0 && s.sect ? DATA.rooms[s.room].name : "未使用"}</small></div><b>+${Math.round(sp.room)}%</b></div>
        <h3 style="margin-top:10px">丹药</h3>
        ${Object.keys(DATA.pills).map(t => {
          const b = s.buffs[t], on = b && b.left > 0, i = this.bestPillIndex(t);
          const cnt = s.bag.filter(x => x.t === "pill" && x.type === t && this.canUsePill(x.g)).reduce((a, x) => a + x.n, 0);
          if (!on && !cnt) return "";   // v42：没生效、也没有能吃的就不显示
          return `<div class="line"><div><img src="${DATA.pillIcon(t)}" alt="" style="width:30px;height:30px;float:left;margin-right:6px">${DATA.pills[t].name}<small>${on ? `+${Math.round(b.pct)}%，剩余 ${b.left} 次修炼` : "未生效"} · 可用 ${cnt} 枚</small></div>
          <div><button data-refresh="openBoost" class="sm" onclick="G.manualPill('${t}')" ${i < 0 ? "disabled" : ""}>服用</button>
          <button data-refresh="openBoost" class="sm ${s.autoPill[t] ? "on" : ""}" onclick="G.toggleAutoPill('${t}')">自动${s.autoPill[t] ? "开" : "关"}</button></div></div>`;
        }).join("")}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },

    canBreak() { return this.s.exp >= this.needExp() && (this.s.mortal || this.s.L < DATA.realms.length * DATA.LAYERS - 1); },
    isMajor() { return !this.s.mortal && this.layer() === DATA.LAYERS - 1; },
    // 这次突破是否要渡雷劫（突破后的层序 ≥ trib.START）
    needTrib() { return !this.s.mortal && !DATA.isTest() && this.s.L + 1 >= CFG.trib.START; },   // 测试模式不渡劫

    // 渡劫（准备页、劫云、结算）在 modules/trib.js

    // 手动突破
    breakthrough() {
      if (this.s.trib) return this.openTrib();
      if (!this.canBreak()) return;
      const s = this.s, major = this.isMajor();
      if (this.needTrib()) return this.openTrib();   // 进渡劫准备页
      if (s.mortal) { // 凡人 → 练气期一层
        s.exp -= this.needExp(); s.mortal = false; this.brRoll("xw", s.L); this.dirty();
        const st = this.stats(); s.hp = st.hp; s.mana = st.mana;
        this.log("引气入体，你正式踏入仙途——【练气期一层】！", "gold");
        return this.after();
      }
      // 不需要渡劫的突破：修为够了直接成功
      s.exp -= this.needExp(); s.L++; this.brRoll("xw", s.L);
      this.dirty();
      const st = this.stats(); s.hp = st.hp; s.mana = st.mana;
      this.log(major ? `天地异象！你成功踏入【${this.realmName()}】！` : `突破至【${this.realmName()}】。`, major ? "gold" : "good");
      this.after();
    },

    /* ---------- 丹药（只加修炼速度） ---------- */
    canUsePill(grade) { return grade === this.r(); }, // 只能服用与当前境界对应品质的丹药
    // 找背包里能吃的最高品质丹药
    bestPillIndex(type) {
      let best = -1;
      this.s.bag.forEach((it, i) => {
        if (it.t === "pill" && it.type === type && this.canUsePill(it.g) && (best < 0 || it.g > this.s.bag[best].g)) best = i;
      });
      return best;
    },
    usePill(i, silent) {
      const it = this.s.bag[i];
      if (!it || it.t !== "pill") return false;
      if (!this.canUsePill(it.g)) { this.log(`${this.itemName(it)}品质过低，你已无法服用。`, "sys"); return false; }
      const p = DATA.pills[it.type], pct = DATA.pillPct(it.type, it.g), b = this.s.buffs[it.type];
      // 同类丹药效果不叠加加成，取较高值，持续次数累加
      if (b && b.left > 0) { b.pct = Math.max(b.pct, pct); b.left += p.dur; }
      else this.s.buffs[it.type] = { pct, left: p.dur };
      this.log(`服下${this.itemName(it)}，修炼速度 +${Math.round(pct)}%（剩余${this.s.buffs[it.type].left}次修炼）`, "good");
      this.removeAt(i);
      this.dirty();
      if (!silent) this.after();
      return true;
    },
    manualPill(t) {
      const i = this.bestPillIndex(t);
      if (i < 0) return this.log(`背包里没有可服用的${DATA.pills[t].name}，可去 世界→坊市 购买。`, "sys");
      this.usePill(i);
    },
    toggleAutoPill(t) { this.s.autoPill[t] = !this.s.autoPill[t]; this.after(); },
  },

  view() {
    const s = this.s, st = this.stats(), sp = this.speed(), cap = this.lingCap();
    if (this.cultView === "body") return this.bodyView();   // 修炼肉身（modules/body.js）
    if (this.cultView === "shenshi") return this.shenshiView();   // 神识（modules/shenshi.js）
    const can = this.canBreak(), major = this.isMajor();
    const next = s.mortal ? "引气入体（突破至练气期）" : major ? `突破至${DATA.realmLabel(this.r() + 1)}` : "突破";
    const block = this.isCultivating() ? this.cultivateBlock() : "";
    const boost = sp.pill || sp.room || this.arrayFactor() > 1 || sp.mifa;
    return `
    <div class="cult-stage"><div class="ys-aura"></div><img class="ys-hero" src="img/wd_hero.webp?v=${DATA.IMG_V}" alt=""></div>
    <div class="card">
      <h3>${this.realmName()}<small>${this.needTrib() ? "下次突破需渡劫" : ""}</small></h3>
      <div class="row small"><span>修炼速度 <b class="q4">${U.num(sp.total)}</b> 修为 / 10秒</span>
        <div class="cult-sbtn"><button class="sm ${boost ? "on" : ""}" onclick="G.openBoost()">修炼加成</button></div></div>
      <div class="row small"><span>本次修炼</span><span>${!this.isCultivating() ? "未修炼" : block ? `<b class='q5'>${block}</b>` : `${s.auto ? "自动修炼中" : "修炼中"} · <b id="tick-left"></b>`}</span></div>
      <div class="bar tick"><div id="tick-bar"></div></div>
      <div class="row small"><span>灵气</span><span>${U.fmt(s.ling)} / ${U.fmt(cap)}</span></div>
      <div class="bar ling"><div style="width:${Math.min(100, s.ling / cap * 100)}%"></div></div>
      <div class="btns">
        <button class="b3 ${s.auto ? "on" : "primary"}" onclick="G.toggleAuto()">自动修炼：${s.auto ? "开" : "关"}</button>
        <button class="b3" onclick="G.openShenshi(true)">神识</button>
        <button class="b3" onclick="G.openBody(true)">修炼肉身</button>
        <button class="primary" style="flex-basis:100%" onclick="G.breakthrough()" ${can || s.trib ? "" : "disabled"}>
          ${s.trib ? (s.trib.result ? "查看渡劫结果" : "渡劫中…查看劫云") : can ? next : `修为未满，还差 ${U.fmt(this.needExp() - s.exp)}`}</button>
      </div>
      <div class="row small" style="margin-top:8px"><span>修为</span><span>${U.fmt(s.exp)} / ${U.fmt(this.needExp())}</span></div>
      <div class="bar"><div style="width:${Math.min(100, s.exp / this.needExp() * 100)}%"></div></div>
    </div>`;
  },
});
