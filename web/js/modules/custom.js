/* =====================================================================
 * 模块：自定义物品（物品定义在 js/content/items.js 的 ITEMS.list，只有杂物）
 * ---------------------------------------------------------------------
 * 背包里存成 { t: "cu", name, n }；只能出售，或被别的系统按名字消耗（肉身突破，见 body.js）
 * 坊市（ITEMS.shop）见 world.js，宗门宝库（ITEMS.treasury）见 sect.js
 * ===================================================================== */
window.ITEMS = window.ITEMS || {};

G.module({
  id: "custom",

  api: {
    cuDef(name) { return (ITEMS.list || {})[name] || (this.bmStoneDef ? this.bmStoneDef(name) : null); },   // 本命熔炼石见 bag.js bmStoneDef
    // 放进背包（叠放）
    addCustom(name, n = 1) {
      if (!this.cuDef(name) || n <= 0) return false;
      return this.bagAdd(x => x.t === "cu" && x.name === name, k => ({ t: "cu", name, n: k }), n, "背包已满，物品遗失了。");
    },
    // 背包弹窗内容（bag.js 的 openItem 调用）
    customItemHtml(i, it, sell) {
      const d = this.cuDef(it.name);
      if (!d) return `<p>此物已失传（物品库里没有这个名字）。</p><div class="btns"><button onclick="G.removeAt(${i},${it.n});G.closeModal();G.after()">丢弃</button></div>`;
      return `<p>${d.herb ? "药材" : d.ore ? "矿石" : "杂物"}${d.desc ? "<br>" + d.desc : ""}</p><div class="btns">${(d.sell || 0) > 0 ? sell : ""}</div>`;
    },
  },
});
