/* =====================================================================
 * 模块：灵根（金 木 水 火 土 雷 六种）
 * ---------------------------------------------------------------------
 * 每种灵根可单独升级（消耗灵石 + 同属性灵元），最高 CFG.lingen.MAX 级：
 *   - 每 STEP 级一段，每段的每级效果、消耗单独设置（config/lingen.js：每段每级加成 GONGFA，升级灵石 COST_FIRST → COST_LAST、灵元 LY_FIRST → LY_LAST 等比）
 *   - 灵根只对修炼速度类功法生效：对应属性的秘诀（修为修炼速度）、炼体秘诀（肉身修炼速度）效果 +% = 已升各级的 GONGFA 相加
 *   - 法术、其他功法、法力消耗不吃灵根
 * 页面在洞府里（洞府 → 灵根）。
 * 门派功法、法术的属性 = 门派属性（见 data/sects.js）。
 * 数值在 js/config/ 下的数值文件 的 lingen 部分。
 * 存档字段：lingen: { jin: 0, mu: 0, shui: 0, huo: 0, tu: 0, lei: 0 }
 * ===================================================================== */
G.module({
  id: "lingen",

  defaults: () => ({ lingen: { jin: 0, mu: 0, shui: 0, huo: 0, tu: 0, lei: 0 } }),

  api: {
    // 从 lv 升到 lv+1：灵石 COST_FIRST → COST_LAST、同属性灵元 LY_FIRST → LY_LAST，每次 × 同一倍率
    lingenCost(lv) { const C = CFG.lingen; return C.COST_POW ? DATA.powStep(C.COST_FIRST ?? 1000, C.COST_LAST ?? 300000, lv, C.MAX, +C.COST_POW) : DATA.geoStep(C.COST_FIRST ?? 1000, C.COST_LAST ?? 300000, lv, C.MAX); },
    lingenHerb(lv) { const C = CFG.lingen; return C.HERB_LAST ? DATA.geoStep(C.HERB_FIRST ?? 1, C.HERB_LAST, lv, C.MAX) : 0; },   // 元魂果、凝魂芝各要几个
    lingenStepPct(lv, tot) { const C = CFG.lingen, E = C.PCT_EVERY || 10; return tot ? Math.floor(Math.min(lv, C.MAX) / E) * tot / Math.floor(C.MAX / E) : 0; },   // 每 PCT_EVERY 级加一次，满级 = tot
    lingenSpPct(lv) { return this.lingenStepPct(lv, CFG.lingen.SPELL_TOTAL); },   // 本系法术伤害 +%
    lingenSp(el) { return 1 + this.lingenSpPct((this.s.lingen || {})[el] || 0) / 100; },
    lingenLy(el, lv) { const C = CFG.lingen; return DATA.geoStep(C.LY_FIRST ?? 1, C.LY_LAST ?? 1200, lv, C.MAX); },
    // lv 级的总加成 %（只走功法加成表）
    lingenPct(lv) { return DATA.segSum(CFG.lingen, "GONGFA", lv); },
    // 加成倍率（1 = 无加成）；灵根只对修炼速度类功法生效：stat 为 cultivate（修为修炼速度）或 body（肉身修炼速度）时才吃灵根，其他功法、法术返回 1
    lingenSpd(stat, el) { return stat === "cultivate" || stat === "body" ? this.lingenGongfa(el) : this.lingenOt(el); },   // 修炼速度类走 GONGFA；其他功法走 OTHER（用户定 2026-11-14）
    lingenOtPct(lv) { return this.lingenStepPct(lv, CFG.lingen.OTHER_TOTAL); },
    lingenOt(el) { return 1 + this.lingenOtPct((this.s.lingen || {})[el] || 0) / 100; },
    lingenGongfa(el) { return 1 + this.lingenPct((this.s.lingen || {})[el] || 0) / 100; },
    // 升级 el 灵根，最多 times 级
    upgradeLingen(el, times) {
      times = Math.floor(+times);   // 小数向下取整，负数/0 走下面循环 0 次，只提示
      const s = this.s; let n = 0, why = "灵石不足。";
      while (n < times && s.lingen[el] < CFG.lingen.MAX) {
        const c = this.lingenCost(s.lingen[el]), ly = this.lingenLy(el, s.lingen[el]), ft = DATA.elIdx(el), hb = this.lingenHerb(s.lingen[el]);
        if (s.stone < c) { why = "灵石不足。"; break; }
        if (ly && this.smCount("ly", ft) < ly) { why = `${DATA.smName("ly", ft)}不足（要 ${U.fmt(ly)} 个）。`; break; }
        const hLack = hb ? ["yhg", "nhz"].find(k => this.smCount(k) < hb) : null;
        if (hLack) { why = `${DATA.smName(hLack)}不足（要 ${U.fmt(hb)} 个）。`; break; }
        if (ly) this.takeSm("ly", ly, ft);
        if (hb) { this.takeSm("yhg", hb); this.takeSm("nhz", hb); }
        s.stone -= c; s.lingen[el]++; n++;
      }
      if (!n) return this.log(s.lingen[el] >= CFG.lingen.MAX ? "此灵根已达极限。" : why, "sys");
      this.log(`${DATA.elById[el].name}灵根提升至 ${s.lingen[el]} 级。`, "good");
      this.dirty(); this.after();
    },
  },
});

/* 洞府 · 灵根 页面（用户定 2026-11-14：列表不放图片，点「升级」弹窗显示所需物品） */
G.openLingenUp = function (el) {
    const s = this.s, C = CFG.lingen, e = DATA.elById[el], lv = s.lingen[el] || 0;
    if (lv >= C.MAX) return this.closeModal();
    const c = this.lingenCost(lv), ly = this.lingenLy(el, lv), ft = DATA.elIdx(el), hb = this.lingenHerb(lv);
    const rows = [["灵石", s.stone || 0, c, DATA.iconImg("stone")]];
    if (ly) rows.push([DATA.smName("ly", ft), this.smCount("ly", ft), ly, DATA.smIcon("ly", ft)]);
    if (hb) for (const k of ["yhg", "nhz"]) rows.push([DATA.smName(k), this.smCount(k), hb, DATA.smIcon(k)]);
    const ok = rows.every(r => r[1] >= r[2]);
    this.modal(`<h2>${DATA.li(DATA.iconImg("lg_" + el))}${e.name}灵根 ${lv} → ${lv + 1} 级</h2>
      <p class="desc">修炼速度类功法效果 +${U.dec(this.lingenPct(lv))}% → +${U.dec(this.lingenPct(lv + 1))}%<br>其他功法效果 +${U.dec(this.lingenOtPct(lv))}% → +${U.dec(this.lingenOtPct(lv + 1))}%<br>${e.name}系法术伤害 +${U.dec(this.lingenSpPct(lv))}% → +${U.dec(this.lingenSpPct(lv + 1))}%</p>
      ${rows.map(r => `<div class="line"><span>${DATA.li(r[3])}${r[0]}</span><span class="${r[1] >= r[2] ? "" : "q5"}">${U.fmt(r[1])} / ${U.fmt(r[2])}</span></div>`).join("")}
      <div class="btns"><button class="primary" onclick="G.upgradeLingen('${el}',1);G.openLingenUp('${el}')" ${ok ? "" : "disabled"}>升级</button><button onclick="G.closeModal()">关闭</button></div>`);
};
G.caveViews.lingen = function () {
    const s = this.s, C = CFG.lingen;
    return `<div class="card"><h3>${DATA.caveName("lingen")}<small>灵石 ${U.fmt(s.stone)}</small></h3></div>` +
      DATA.elements.map(e => {
        const lv = s.lingen[e.id] || 0, max = lv >= C.MAX;
        return `<div class="card"><div class="line"><div style="display:flex;align-items:center;gap:8px"><img src="${DATA.iconImg("lg_" + e.id)}" alt="" style="width:44px;height:44px;flex:0 0 44px"><div><b>${e.name}灵根</b><span class="tag">${lv} 级</span>
          <small style="display:block">修炼类秘诀 +${U.dec(this.lingenPct(lv))}% · 其他功法 +${U.dec(this.lingenOtPct(lv))}% · 法术伤害 +${U.dec(this.lingenSpPct(lv))}%</small></div></div>
          ${max ? `<button disabled>已达极限</button>` : `<button onclick="G.openLingenUp('${e.id}')">升级</button>`}</div></div>`;
      }).join("");
};
