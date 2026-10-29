/* =====================================================================
 * 模块：灵根（金 木 水 火 土 雷 六种）
 * ---------------------------------------------------------------------
 * 每种灵根可单独升级（消耗灵石 + 同属性灵元），最高 CFG.lingen.MAX 级：
 *   - 每 STEP 级一段，每段的每级效果、消耗单独设置（config/lingen.js：每段每级加成 SPELL / GONGFA，升级灵石 COST_FIRST → COST_LAST、灵元 LY_FIRST → LY_LAST 等比）
 *   - 对应属性的法术伤害 +% = 已升各级的 SPELL 相加
 *   - 对应属性的功法效果 +% = 已升各级的 GONGFA 相加
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
    lingenCost(lv) { const C = CFG.lingen; return DATA.geoStep(C.COST_FIRST ?? 1000, C.COST_LAST ?? 300000, lv, C.MAX); },
    lingenLy(el, lv) { const C = CFG.lingen; return DATA.geoStep(C.LY_FIRST ?? 1, C.LY_LAST ?? 1200, lv, C.MAX); },
    // lv 级的总加成 %
    lingenPct(lv, kind) { return DATA.segSum(CFG.lingen, kind === "sp" ? "SPELL" : "GONGFA", lv); },
    // 加成倍率（1 = 无加成）
    lingenSpell(el) { return 1 + this.lingenPct((this.s.lingen || {})[el] || 0, "sp") / 100; },
    lingenGongfa(el) { return 1 + this.lingenPct((this.s.lingen || {})[el] || 0, "gf") / 100; },
    // 升级 el 灵根，最多 times 级
    upgradeLingen(el, times) {
      times = Math.floor(+times);   // 小数向下取整，负数/0 走下面循环 0 次，只提示
      const s = this.s; let n = 0, why = "灵石不足。";
      while (n < times && s.lingen[el] < CFG.lingen.MAX) {
        const c = this.lingenCost(s.lingen[el]), ly = this.lingenLy(el, s.lingen[el]), ft = DATA.elIdx(el);
        if (s.stone < c) { why = "灵石不足。"; break; }
        if (ly && this.smCount("ly", ft) < ly) { why = `${DATA.smName("ly", ft)}不足（要 ${U.fmt(ly)} 个）。`; break; }
        if (ly) this.takeSm("ly", ly, ft);
        s.stone -= c; s.lingen[el]++; n++;
      }
      if (!n) return this.log(s.lingen[el] >= CFG.lingen.MAX ? "此灵根已达极限。" : why, "sys");
      this.log(`${DATA.elById[el].name}灵根提升至 ${s.lingen[el]} 级。`, "good");
      this.dirty(); this.after();
    },
  },
});

/* 洞府 · 灵根 页面 */
G.caveViews.lingen = function () {
    const s = this.s, C = CFG.lingen;
    return `<div class="card"><h3>${DATA.caveName("lingen")}<small>灵石 ${U.fmt(s.stone)}</small></h3>
      <p class="desc">提升对应属性的法术伤害、功法效果。最高 ${C.MAX} 级。</p></div>` +
      DATA.elements.map(e => {
        const lv = s.lingen[e.id] || 0, max = lv >= C.MAX, c = this.lingenCost(lv), ly = this.lingenLy(e.id, lv), ft = DATA.elIdx(e.id), have = ly ? this.smCount("ly", ft) : 0, ok = s.stone >= c && have >= ly;
        return `<div class="card"><div class="line"><div><b>${e.name}灵根</b><span class="tag">${lv} / ${C.MAX} 级</span>
          <small>${e.name}系法术伤害 +${U.dec(this.lingenPct(lv, "sp"))}% · ${e.name}系功法效果 +${U.dec(this.lingenPct(lv, "gf"))}%</small></div></div>
          <div class="btns">${max ? `<button disabled>已达极限</button>` :
            `<button onclick="G.upgradeLingen('${e.id}',1)" ${ok ? "" : "disabled"}>升级（${U.fmt(c)} 灵石${ly ? `、${DATA.smName("ly", ft)} ${U.fmt(ly)}` : ""}）</button>
             <button onclick="G.upgradeLingen('${e.id}',10)" ${ok ? "" : "disabled"}>升 10 级</button>`}</div>
          ${max || !ly ? "" : `<p class="desc">${DATA.li(DATA.smIcon("ly", ft))}${DATA.smName("ly", ft)}：有 ${U.fmt(have)} 个</p>`}</div>`;
      }).join("");
};
