/* =====================================================================
 * 模块：灵药园 · 灵田（洞府）
 * ---------------------------------------------------------------------
 * - 用灵石开启灵田，最多 30 块
 * - 种子是背包物品：宗门宝库用贡献兑换（不限次数）、地图探索 / 出窍掉落；每开始一季（含自动续种）消耗 1 颗（config/garden.js PLANT_SEED）
 * - 每种一季消耗灵气；灵气不够就等着，够了自动开始
 * - 成熟后自动收获（药材进背包，数量在范围内随机），并自动继续种同一种
 * - 灵田管理：更换种植类型（等当前这一季成熟后才换）、铲除（立即清空，本季作废）
 * - 每种药材的 成熟时间 / 收获数量 / 消耗灵气 / 种子贡献 在 js/config/ 数值文件 的 garden.herbs
 * - 灵植夫（config/craftsman.js）阶数越高生长越快、收获越多；宗门秘法「育灵 / 丰灵」再叠加
 * - 按 G.now() 计时，写在 tick 里，离线也会继续
 * 存档：
 *   seeds  旧版永久解锁（已作废，不再使用）
 *   fields [{ g: 序号|-1, start, next, wait }] g=-1 空地；next = 本季结束后换种；wait = 等灵气 / 种子中（"seed" = 缺种子）
 * ===================================================================== */
G.module({
  id: "garden",

  defaults: () => ({ seeds: [], fields: [] }),

  tick() {
    const s = this.s, now = this.now(), l0 = s.ling;
    let nNew = 0;   // v206 本次新开始的季数（扣灵气），记日志，免得灵气突然少一截看不出原因
    s.fields.forEach(f => {
      if (f.g < 0) return;
      if (f.wait) { if (!this.payField(f, now)) return; nNew++; }
      let guard = 0;
      while (!f.wait && now >= f.start + this.fieldTime(f.g) && guard++ < 1e4) {
        const end = f.start + this.fieldTime(f.g), Y = DATA.herbGrow(f.g).yield, lg = DATA.isLg(f.g);
        const n = lg ? this.lgYieldRoll() : Math.floor(U.rand(Y[0], Y[1]) * (1 + this.plantYieldPct(f.g) / 100)), ck = this.plantCraft(f.g);
        if (lg) this.addLg(f.g - DATA.LG_BASE, n); else this.addMat("herb", DATA.herbs[f.g], f.g, n);   // 背包满时进传音暂存，不再丢药材却照算经验
        { const K = CFG.craftsman[ck], IE = K.ITEM_EXP, lm = CFG.craftsman.LING_EXP_MULT ?? 1; this.addCraftExp(ck, n * (IE ? ((lg ? IE[(DATA.LG().EXP_TIER ?? 15) - 1] : IE[f.g]) ?? IE[IE.length - 1] ?? 0) : (f.g + 1) * (K.EXP_RATE || 0)) * lm); }   // 每株 ITEM_EXP[品级−1]，再 × 种植经验总倍率   // 品级按药材总序号（仙界药材接在凡界后面）
        if (f.next != null) { f.g = f.next; f.next = null; } // 当季结束才换种
        if (this.payField(f, end)) nNew++;                   // 下一季：扣灵气
      }
    });
    const used = l0 - s.ling;
    if (nNew && used > 0) this.log(`${DATA.caveName ? DATA.caveName("garden") : "灵药园"}开始新一季（${nNew} 块灵田），消耗灵气 ${U.fmt(used)}。`, "sys");
  },

  api: {
    // 生长时间缩短 %（灵植夫 + 秘法，没上限）、收获增加 %
    //   g = 药材序号：凡界药材按灵植夫，仙界药材（序号 ≥ 凡界种数）按仙植师（v42）
    plantCraft() { return "ling"; },   // 灵植夫统一 1~30 阶（11~20 阶显示为仙植师，21~30 阶神植师）
    plantCut(g = 0) { const k = this.plantCraft(g), L = CFG.craftsman[k]; return (L.GROW_CUT[this.craftLv(k) - 1] || 0) + (this.mifaBonus().plantTime || 0) + this.servantPct("ling"); },   // 种植速度 %（没上限）
    plantYieldPct(g = 0) { const k = this.plantCraft(g); return (CFG.craftsman[k].YIELD_ADD[this.craftLv(k) - 1] || 0) + (this.mifaBonus().plantYield || 0) + (this.servantPct ? this.servantPct("ling", "YIELD_") : 0); },   // 技艺 + 丰灵秘法 + 道童
    fieldTime(g) { return Math.ceil(DATA.growTime(g) / (1 + Math.max(0, this.plantCut(g)) / 100)); },   // 生长时间 ÷ (1 + 种植速度%)
    // 开始新的一季：扣灵气，不够就等待
    payField(f, at) {
      const need = DATA.herbGrow(f.g).ling, sn = this.plantSeedN();
      if (this.seedCount(f.g) < sn) {
        // 勾了「自动更换」：随机换一种够种子的作物（药材、灵果都算）
        const alt = f.auto ? this.seedsHave().filter(g => g !== f.g && this.seedCount(g) >= sn) : [];
        if (!alt.length) { f.wait = "seed"; return false; }
        const old = f.g; f.g = alt[Math.floor(Math.random() * alt.length)]; f.next = null;
        this.log(`${DATA.cropName(old)}种子用完，灵田自动改种${DATA.cropName(f.g)}。`, "sys");
        return this.payField(f, at);
      }
      if (this.s.ling < need) { f.wait = true; return false; }
      if (sn) this.takeSeed(f.g, sn);
      this.s.ling -= need; f.wait = false; f.start = at; return true;
    },
    /* ---------- 灵果（config/garden.js LINGGUO）：背包 { t: "lg", k: 序号, n }；服用记在 s.lgEat[序号]，每颗永久加一次 ---------- */
    addLg(k, n = 1) { return this.bagAdd(x => x.t === "lg" && x.k === k, c => ({ t: "lg", k, n: c }), n, "背包已满，灵果遗失了。"); },
    lgEatN(k) { return ((this.s.lgEat || {})[k]) || 0; },
    eatLg(i, n) {
      if (this.tribBusy && this.tribBusy()) return this.log("渡劫中不能服用。", "sys");
      const it = this.s.bag[i]; if (!it || it.t !== "lg" || it.lq) return; const d = DATA.lgDef(it.k); if (!d) return;
      n = Math.min(Math.floor(+n) || 1, it.n || 1); if (n <= 0) return;
      if (!this.s.lgEat || typeof this.s.lgEat !== "object") this.s.lgEat = {};
      this.s.lgEat[it.k] = this.lgEatN(it.k) + n;
      this.removeAt(i, n); this._cache = null;
      this.log(`服用${d.name} ×${n}，${DATA.lgLab(d.k)} +${U.fmt(d.v * n)}（累计 +${U.fmt(d.v * this.lgEatN(it.k))}）。`, "good"); this.closeModal(); this.after();
    },
    // 灵果属性合计：{ atk, def, hp, mana, cult, body, dr: { 属性: 受到该系属性伤害减少 N }, dmg: { 属性: N } }
    lgBonus() {
      const b = { atk: 0, def: 0, hp: 0, mana: 0, cult: 0, body: 0, dr: {}, dmg: {} }, E = this.s.lgEat || {};
      for (const k in E) { const d = DATA.lgDef(+k), n = +E[k] || 0; if (!d || n <= 0) continue; const v = (d.v || 0) * n;
        if (d.k.startsWith("dmg_")) b.dmg[d.k.slice(4)] = (b.dmg[d.k.slice(4)] || 0) + v;
        else if (d.k.startsWith("dr_")) b.dr[d.k.slice(3)] = (b.dr[d.k.slice(3)] || 0) + v;
        else if (d.k in b) b[d.k] += v; }
      return b;
    },
    lgDmg(el) { return (this.lgBonus().dmg || {})[el] || 0; },   // 该系属性伤害（法术 / 神通 / 法宝伤害直接加）
    // 灵果每季收获颗数：config/garden.js LINGGUO.YIELD [[颗数, 几率%], ...]
    lgYieldRoll() { const T = DATA.LG().YIELD || [[1, 100]], sum = T.reduce((a, x) => a + x[1], 0); let r = Math.random() * sum; for (const [n, p] of T) { if ((r -= p) < 0) return n; } return T[T.length - 1][0]; },
    lgYieldTxt() { const T = DATA.LG().YIELD || [[1, 100]]; return `${Math.min(...T.map(x => x[0]))}~${Math.max(...T.map(x => x[0]))}颗`; },
    plantSeedN() { return Math.max(0, Math.floor((CFG.garden || {}).PLANT_SEED ?? 1)); },
    seedCount(g) { return this.bagNum(x => x.t === "seed" && x.g === g); },
    addSeed(g, n = 1) { return this.bagAdd(x => x.t === "seed" && x.g === g, k => ({ t: "seed", g, n: k }), n, "背包已满，种子遗失了。"); },
    takeSeed(g, n) { return this.bagTake(x => x.t === "seed" && x.g === g, n); },
    // 背包里有的种子（药材序号，去重排序）
    seedsHave() { return [...new Set(this.s.bag.filter(x => x && x.t === "seed" && x.n > 0 && DATA.herbGrow(x.g)).map(x => x.g))].sort((a, b) => a - b); },
    openField() {
      const s = this.s, i = s.fields.length, c = DATA.fieldCost(i);
      if (i >= DATA.GARDEN_MAX) return this.log("灵田已达上限。", "sys");
      if (s.stone < c) return this.log("灵石不足。", "sys");
      s.stone -= c; s.fields.push({ g: -1, start: 0, next: null, wait: false });
      this.log(`开辟第 ${i + 1} 块灵田。`, "good"); this.gardenPage = Math.floor(i / Math.max(1, CFG.garden.PAGE || 20)); this.after();
    },
    openFieldMenu(i) {
      const s = this.s, f = s.fields[i];
      const have = this.seedsHave();
      if (!have.length && f.g < 0) return this.log("没有种子，可在门派 → 宗门宝库兑换，或探索、出窍时掉落。", "sys");
      if (f.g >= 0 && f.next != null && !have.includes(f.g)) have.unshift(f.g);   // 已约好换种：当前药材没种子也要能点它取消换种
      const seeds = have.map(g => { const H = DATA.herbGrow(g);
        return `<button onclick="G.plantField(${i},${g})" ${f.g === g && f.next == null ? "disabled" : ""}><img class="mi" src="${DATA.seedImg(g)}" alt="" style="width:36px">${DATA.cropName(g)}<small>种子 ${U.fmt(this.seedCount(g))} · 每季消耗灵气${U.fmt(H.ling)}</small></button>`; }).join("");
      let info = "";
      if (f.g >= 0) {
        const T = this.fieldTime(f.g), now = this.now(), H = DATA.herbGrow(f.g), k = 1 + this.plantYieldPct(f.g) / 100, p = f.wait ? 0 : Math.min(100, (now - f.start) / T * 100);
        info = `<div class="line"><div>剩余时间</div><b>${f.wait === "seed" ? "缺少种子，等待中" : f.wait ? "灵气不足，等待中" : U.cd(Math.max(0, f.start + T - now) / 1000)}</b></div>
          <div class="bar"><div style="width:${p}%"></div></div>
          <div class="line"><div>产量</div><b>${DATA.isLg(f.g) ? this.lgYieldTxt() : `${Math.floor(H.yield[0] * k)}~${Math.floor(H.yield[1] * k)} 株`}</b></div>
          ${f.next != null ? `<div class="line"><div>本季结束后改种</div><b>${DATA.cropName(f.next)}</b></div>` : ""}`;
      }
      this.modal(`<h2>${f.g < 0 ? "空地" : DATA.cropName(f.g)}</h2>${info}
        <h3 style="margin-top:8px">${f.g < 0 ? "种植" : "更换种植"}</h3>
        <div class="room-grid">${seeds || `<p class="desc">背包里没有种子。</p>`}</div>
        <label style="display:flex;align-items:center;justify-content:flex-start;gap:6px;margin:8px 0;width:100%;max-width:100%;overflow:hidden;white-space:nowrap;font-size:13px;text-align:left"><input type="checkbox" style="margin:0;padding:0;flex:0 0 18px;width:18px;min-width:0;height:18px" ${f.auto ? "checked" : ""} onchange="G.fieldAuto(${i},this.checked)"><span style="flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis">种子用完自动随机改种有种子的作物</span></label>
        <div class="btns">${f.g >= 0 ? `<button onclick="G.ask('铲除后本季作物作废，确定？').then(ok=>ok&&G.clearField(${i},true))">铲除</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    plantField(i, g) {
      const f = this.s.fields[i];
      // 种子是“每种兑换一次”的永久解锁：没种子、种不了的药材直接拒绝，不能先写进
      // 田里再在 payField 里对 undefined 取 .ling 抛错、把灵田卡死
      if (!Number.isInteger(i) || !f) return;
      if (!DATA.herbGrow(g)) return this.log("这种药材无法种植。", "sys");
      const cancel = f.g === g && f.next != null && !f.wait;   // 取消换种不需要种子
      if (!cancel && this.seedCount(g) < this.plantSeedN()) return this.log(`没有${DATA.seedName(g)}。`, "sys");
      if (f.g < 0) {
        f.g = g; f.next = null;
        this.payField(f, this.now());
        this.log(`第 ${i + 1} 块灵田种下${DATA.cropName(g)}${f.wait ? "，灵气不足，等待灵气中" : ""}。`, "good");
      } else if (f.wait) { f.g = g; f.next = null; this.payField(f, this.now()); } // 还没开始的直接换
      else { f.next = f.g === g ? null : g; this.log(f.next == null ? "已取消换种。" : `本季结束后改种${DATA.cropName(g)}。`, "sys"); }
      this.closeModal(); this.after();
    },
    fieldAuto(i, on) {
      if (!Number.isInteger(i)) return;   // 防止 "__proto__" 之类的下标改到数组原型上
      const f = this.s.fields[i]; if (!f) return;
      f.auto = on === true;
      if (f.auto && f.wait === "seed") this.payField(f, this.now());   // 正在缺种子等待的，立刻换
      this.after();
    },
    clearField(i, confirmed) {
      if (confirmed !== true) throw new Error("请先确认铲除灵田");
      const field = Number.isInteger(i) ? this.s.fields[i] : null; if (!field) return;
      Object.assign(field, { g: -1, start: 0, next: null, wait: false });
      this.closeModal(); this.after();
    },
  },
});

/* 洞府 · 灵药园 */
G.caveViews.garden = function () {
  const s = this.s, n = s.fields.length, P = Math.max(1, CFG.garden.PAGE || 20), pages = Math.max(1, Math.ceil(DATA.GARDEN_MAX / P));
  const CN = "一二三四五六七八九十", pg = Math.min(pages - 1, Math.max(0, this.gardenPage || 0));
  const cell = (f, i) => f.g < 0 ? `<div class="slot-eq field-cell" onclick="G.openFieldMenu(${i})"><span class="g">空地</span></div>`
    : `<div class="slot-eq field-cell q${Math.min(5, Math.floor(f.g / 2))}" onclick="G.openFieldMenu(${i})"><img class="si" src="${DATA.cropImg(f.g)}" alt=""><span>${DATA.cropName(f.g)}</span></div>`;
  const cells = s.fields.slice(pg * P, pg * P + P).map((f, j) => cell(f, pg * P + j)).join("");
  const tabs = pages > 1 ? `<div class="bag-tabs">${[...Array(pages).keys()].map(k => `<button class="${k === pg ? "active" : ""}" onclick="G.gardenPage=${k};G.render()">${DATA.caveName("garden")}${CN[k] || k + 1}</button>`).join("")}</div>` : "";
  const full = n >= DATA.GARDEN_MAX, c = DATA.fieldCost(n);
  return this.craftsmanCard("ling") + `<div class="card">${tabs}
    ${cells ? `<div class="equip four">${cells}</div>` : `<p class="desc">这一页还没有灵田。</p>`}
    <div class="btns"><button class="primary" onclick="G.openField()" ${full || s.stone < c ? "disabled" : ""}>${full ? "灵田已满" : `开辟灵田（${U.fmt(c)} 灵石）`}</button></div></div>`;
};
