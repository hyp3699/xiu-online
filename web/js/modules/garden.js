/* =====================================================================
 * 模块：灵药园 · 灵田（洞府）
 * ---------------------------------------------------------------------
 * - 用灵石开启灵田，最多 30 块
 * - 种子在 门派 → 宗门宝库 兑换，每种只需兑换一次（之后永久可种）
 * - 每种一季消耗灵气；灵气不够就等着，够了自动开始
 * - 成熟后自动收获（药材进背包，数量在范围内随机），并自动继续种同一种
 * - 灵田管理：更换种植类型（等当前这一季成熟后才换）、铲除（立即清空，本季作废）
 * - 每种药材的 成熟时间 / 收获数量 / 消耗灵气 / 种子贡献 在 js/config/ 数值文件 的 garden.herbs
 * - 灵植夫（config/craftsman.js）阶数越高生长越快、收获越多；宗门秘法「育灵 / 丰灵」再叠加
 * - 按 G.now() 计时，写在 tick 里，离线也会继续
 * 存档：
 *   seeds  [序号...]                          已拥有的种子（药材序号 0~5）
 *   fields [{ g: 序号|-1, start, next, wait }] g=-1 空地；next = 本季结束后换种；wait = 等灵气中
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
        const end = f.start + this.fieldTime(f.g), Y = DATA.herbGrow(f.g).yield;
        const n = Math.floor(U.rand(Y[0], Y[1]) * (1 + this.plantYieldPct(f.g) / 100)), ck = this.plantCraft(f.g);
        this.addMat("herb", DATA.herbs[f.g], f.g, n);   // 背包满时进传音暂存，不再丢药材却照算经验
        { const K = CFG.craftsman[ck], IE = K.ITEM_EXP; this.addCraftExp(ck, n * (IE ? (IE[f.g] ?? IE[IE.length - 1] ?? 0) : (f.g + 1) * (K.EXP_RATE || 0))); }   // 每株 ITEM_EXP[品级−1]   // 品级按药材总序号（仙界药材接在凡界后面）
        if (f.next != null) { f.g = f.next; f.next = null; } // 当季结束才换种
        if (this.payField(f, end)) nNew++;                   // 下一季：扣灵气
      }
    });
    const used = l0 - s.ling;
    if (nNew && used > 0) this.log(`${DATA.caveName ? DATA.caveName("garden") : "灵药园"}开始新一季（${nNew} 块灵田），消耗灵气 ${U.fmt(used)}。`, "sys");
  },

  api: {
    // 生长时间缩短 %（灵植夫 + 秘法，有上限）、收获增加 %
    //   g = 药材序号：凡界药材按灵植夫，仙界药材（序号 ≥ 凡界种数）按仙植师（v42）
    plantCraft() { return "ling"; },   // 灵植夫统一 1~30 阶（11~20 阶显示为仙植师，21~30 阶神植师）
    plantCut(g = 0) { const k = this.plantCraft(g), L = CFG.craftsman[k]; return (L.GROW_CUT[this.craftLv(k) - 1] || 0) + (this.mifaBonus().plantTime || 0) + this.servantPct("ling"); },   // 种植速度 %（没上限）
    plantYieldPct(g = 0) { const k = this.plantCraft(g); return (CFG.craftsman[k].YIELD_ADD[this.craftLv(k) - 1] || 0) + (this.mifaBonus().plantYield || 0) + (this.servantPct ? this.servantPct("ling", "YIELD_") : 0); },   // 技艺 + 丰灵秘法 + 道童
    fieldTime(g) { return Math.ceil(DATA.growTime(g) / (1 + Math.max(0, this.plantCut(g)) / 100)); },   // 生长时间 ÷ (1 + 种植速度%)
    // 开始新的一季：扣灵气，不够就等待
    payField(f, at) {
      const need = DATA.herbGrow(f.g).ling;
      if (this.s.ling < need) { f.wait = true; return false; }
      this.s.ling -= need; f.wait = false; f.start = at; return true;
    },
    openField() {
      const s = this.s, i = s.fields.length, c = DATA.fieldCost(i);
      if (i >= DATA.GARDEN_MAX) return this.log("灵田已达上限。", "sys");
      if (s.stone < c) return this.log("灵石不足。", "sys");
      s.stone -= c; s.fields.push({ g: -1, start: 0, next: null, wait: false });
      this.log(`开辟第 ${i + 1} 块灵田。`, "good"); this.after();
    },
    openFieldMenu(i) {
      const s = this.s, f = s.fields[i];
      if (!s.seeds.length) return this.log("没有种子，可在门派 → 宗门宝库兑换。", "sys");
      const seeds = s.seeds.slice().sort((a, b) => a - b).map(g => { const H = DATA.herbGrow(g), k = 1 + this.plantYieldPct(g) / 100;
        return `<button onclick="G.plantField(${i},${g})" ${f.g === g && f.next == null ? "disabled" : ""}><img class="mi" src="${DATA.matImg("herb", g)}" alt="" style="width:36px">${DATA.herbs[g]}<small>${U.dur(this.fieldTime(g) / 1000)} · ${Math.floor(H.yield[0] * k)}~${Math.floor(H.yield[1] * k)}株 · 灵气${U.fmt(H.ling)}</small></button>`; }).join("");
      let info = "";
      if (f.g >= 0) {
        const T = this.fieldTime(f.g), now = this.now(), H = DATA.herbGrow(f.g), k = 1 + this.plantYieldPct(f.g) / 100, p = f.wait ? 0 : Math.min(100, (now - f.start) / T * 100);
        info = `<div class="line"><div>剩余时间</div><b>${f.wait ? "灵气不足，等待中" : U.cd(Math.max(0, f.start + T - now) / 1000)}</b></div>
          <div class="bar"><div style="width:${p}%"></div></div>
          <div class="line"><div>产量</div><b>${Math.floor(H.yield[0] * k)}~${Math.floor(H.yield[1] * k)} 株</b></div>
          ${f.next != null ? `<div class="line"><div>本季结束后改种</div><b>${DATA.herbs[f.next]}</b></div>` : ""}`;
      }
      this.modal(`<h2>${f.g < 0 ? "空地" : DATA.herbs[f.g]}</h2>${info}
        <h3 style="margin-top:8px">${f.g < 0 ? "种植" : "更换种植"}</h3>
        <div class="room-grid">${seeds}</div>
        <div class="btns">${f.g >= 0 ? `<button onclick="G.ask('铲除后本季作物作废，确定？').then(ok=>ok&&G.clearField(${i},true))">铲除</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    plantField(i, g) {
      const f = this.s.fields[i];
      if (f.g < 0) {
        f.g = g; f.next = null;
        this.payField(f, this.now());
        this.log(`第 ${i + 1} 块灵田种下${DATA.herbs[g]}${f.wait ? "，灵气不足，等待灵气中" : ""}。`, "good");
      } else if (f.wait) { f.g = g; f.next = null; this.payField(f, this.now()); } // 还没开始的直接换
      else { f.next = f.g === g ? null : g; this.log(f.next == null ? "已取消换种。" : `本季结束后改种${DATA.herbs[g]}。`, "sys"); }
      this.closeModal(); this.after();
    },
    clearField(i, confirmed) {
      if (confirmed !== true) throw new Error("请先确认铲除灵田");
      const field = this.s.fields[i]; if (!field) return;
      Object.assign(field, { g: -1, start: 0, next: null, wait: false });
      this.closeModal(); this.after();
    },
  },
});

/* 洞府 · 灵药园 */
G.caveViews.garden = function () {
  const s = this.s, n = s.fields.length, now = Date.now();
  const cells = s.fields.map((f, i) => {
    if (f.g < 0) return `<div class="slot-eq field-cell" onclick="G.openFieldMenu(${i})"><span class="g">空地</span></div>`;
    return `<div class="slot-eq field-cell q${Math.min(5, Math.floor(f.g / 2))}" onclick="G.openFieldMenu(${i})"><img class="si" src="${DATA.matImg("herb", f.g)}" alt=""><span>${DATA.herbs[f.g]}</span></div>`;
  }).join("");
  const full = n >= DATA.GARDEN_MAX, c = DATA.fieldCost(n);
  return this.craftsmanCard("ling") + `<div class="card"><h3>${DATA.caveName("garden")}<small>灵田 ${n} / ${DATA.GARDEN_MAX} · 种子 ${s.seeds.length} 种 · 灵气 ${U.fmt(s.ling)}</small></h3>
    ${n ? `<div class="equip four">${cells}</div>` : `<p class="desc">还没有灵田。</p>`}
    <div class="btns"><button class="primary" onclick="G.openField()" ${full || s.stone < c ? "disabled" : ""}>${full ? "灵田已满" : `开辟灵田（${U.fmt(c)} 灵石）`}</button></div>
    <p class="desc">每季消耗灵气，成熟自动收获进背包并自动续种。点灵田可种植、换种、铲除。种子在门派宗门宝库兑换，每种只需一次。</p></div>`;
};
