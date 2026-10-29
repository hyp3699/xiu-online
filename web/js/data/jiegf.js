/* =====================================================================
 * 数据：仙魔冥神 坊市功法、功德司功法（每张地图一个坊市、一个功德司，四界共 40 张图）
 * ---------------------------------------------------------------------
 * 每处每类功法一本（含炼体秘诀，没有法术）；名字 = 地图名 + 后缀（梵度天秘诀 / 梵度天功德秘诀）
 * 星级：仙冥魔每界第 1、2 张图 6 星，3、4 张 7 星 …… 9、10 张 10 星；神界第 1~5 张 11 星，6~10 张 12 星（id 加 s：js地图序号 / ds地图序号）
 *   神界以前的 6~10 星（j/d 地图序号）不再出售，只留着让已学会的功法照常生效（old: true）
 * 属性（金木水火土雷）：每类功法在 40 张图里平均分配、打乱顺序（固定，每次一样）
 * 效果、价格见 config/gongfa.js 的 jshop / gd；id：坊市 j地图序号，功德司 d地图序号
 * ===================================================================== */
DATA.JIE_GF_WORLDS = ["xian", "mo", "ming", "shen"];
DATA.jieGf = { jshop: [], gd: [] };
(() => {
  const word = DATA.nmPick(CFG.names, "gdGfWord", "功德");
  for (const [kind, pre] of [["jshop", "j"], ["gd", "d"]]) {
    const list = DATA.jieGf[kind];
    DATA.JIE_GF_WORLDS.forEach(w => (DATA.worldMapIdx[w] || []).forEach((a, i) => {
      const m = DATA.maps[a], mk = (id, star, old) => ({ id, src: kind, map: a, w, star, plain: true, old,
        prefix: m.name + (kind === "gd" ? word : ""), name: m.name + (kind === "gd" ? "功德司" : "坊市"), reqRealm: DATA.mapReq(a), els: {} });
      if (w === "shen") { list.push(mk(pre + a, Math.min(10, 6 + Math.floor(i / 2)), true)); list.push(Object.assign(mk(pre + "s" + a, i < 5 ? 11 : 12), { nw: true })); }   // 神界：旧 6~10 星只保留已学的；新 11、12 星
      else list.push(mk(pre + a, Math.min(10, 6 + Math.floor(i / 2))));
    }));
    for (const [grp, salt] of [[list.filter(o => !o.nw), ""], [list.filter(o => o.nw), "shen11"]]) DATA.gongfaTypes.forEach(t => {   // 属性平均分配后打乱（原有 40 处顺序不变；神界新 11、12 星单独分）
      const seq = grp.map((_, i) => DATA.elements[i % 6].id);
      let h = 7; for (const c of kind + t.id + salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      for (let i = seq.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [seq[i], seq[j]] = [seq[j], seq[i]]; }
      grp.forEach((o, i) => { o.els[t.id] = seq[i]; });
    });
    const E = DATA.elements;   // 真经 6 本：第 1 本属性不变，后面 5 本依次补齐金木水火土雷（每处六种抗性各一本）
    list.forEach(o => { const b0 = E.findIndex(e => e.id === o.els.zhenjue); for (let b = 2; b <= 6; b++) if (("zhenjue" + b) in o.els) o.els["zhenjue" + b] = E[(b0 + b - 1) % E.length].id; });
    list.forEach(o => { o.el = o.els.mijue; DATA.gfSrcById[o.id] = o; });
  }
})();
DATA.jieGfOf = (kind, a) => { const p = kind === "gd" ? "d" : "j"; return DATA.gfSrcById[p + "s" + a] || DATA.gfSrcById[p + a]; };   // 神界取新的 11、12 星
