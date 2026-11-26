/* =====================================================================
 * 数据：仙魔冥神 坊市功法、功德司功法（每张地图一个坊市、一个功德司，四界共 40 张图）
 * ---------------------------------------------------------------------
 * 每处每类功法若干本（config/gongfa.js 的 jshop / gd 里 BOOKS、神界 SHEN_BOOKS；含炼体秘诀，没有法术）；名字 = 地图名 + 后缀（梵度天秘诀 / 梵度天功德秘诀）
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
        prefix: m.name + (kind === "gd" ? (w === "shen" ? "" : word) : ""), rw: kind === "gd" && w === "shen" || undefined, name: m.name + (kind === "gd" ? (w === "shen" ? "愿力祠" : "功德司") : w === "shen" ? "神市" : "坊市"), reqRealm: DATA.mapReq(a), els: {} });
      if (w === "shen") { list.push(mk(pre + a, Math.min(10, 6 + Math.floor(i / 2)), true)); list.push(Object.assign(mk(pre + "s" + a, i < 5 ? 11 : 12), { nw: true })); }   // 神界：旧 6~10 星只保留已学的；新 11、12 星
      else list.push(mk(pre + a, Math.min(10, 6 + Math.floor(i / 2))));
    }));
    for (const [grp, salt] of [[list.filter(o => !o.nw), ""], [list.filter(o => o.nw), "shen11"]]) DATA.gongfaTypes.forEach(t => {   // 属性平均分配后打乱（原有 40 处顺序不变；神界新 11、12 星单独分）
      const seq = grp.map((_, i) => DATA.elements[i % 6].id);
      let h = 7; for (const c of kind + t.id + salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      for (let i = seq.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [seq[i], seq[j]] = [seq[j], seq[i]]; }
      grp.forEach((o, i) => { o.els[t.id] = seq[i]; });
    });
    const E = DATA.elements;
    // 每类功法多本：第 1 本属性不变，后面依次补齐金木水火土雷（每类 6 本 = 六系各一本；用户定）
    const fams = [...new Set(DATA.gongfaTypes.map(t => t.fam))];
    list.forEach(o => fams.forEach(f => { const b0 = E.findIndex(e => e.id === o.els[f]); if (b0 < 0) return; for (let b = 2; b <= 12; b++) if ((f + b) in o.els) o.els[f + b] = E[(b0 + b - 1) % E.length].id; }));   // 第 7 本起再从第 1 本那系轮
    // 仙冥魔：同序号地图（第 i 张）三界每类各 2 本，合起来 6 本 = 金木水火土雷各一；仙界第 1 本属性不变，仙 → 魔 → 冥 依次往后排（用户定）
    const XMM = ["xian", "mo", "ming"];
    list.filter(o => o.w === "xian").forEach(ox => { const i = DATA.worldMapIdx.xian.indexOf(ox.map);
      fams.forEach(f => { const b0 = E.findIndex(e => e.id === ox.els[f]); if (b0 < 0) return;
        XMM.forEach((w, k) => { const o = list.find(x => x.w === w && DATA.worldMapIdx[w].indexOf(x.map) === i); if (!o) return;
          for (let b = 1; b <= 12; b++) { const key = b === 1 ? f : f + b; if (key in o.els) o.els[key] = E[(b0 + 2 * k + b - 1) % E.length].id; } }); }); });
    // 神界（新 11、12 星）：第 1、2 张图每类各 3 本，合起来 6 本 = 六系各一（3、4 张同理）；单数图第 1 本属性不变（用户定）
    const SM = DATA.worldMapIdx.shen || [], sOf = i => list.find(x => x.nw && x.map === SM[i]);
    for (let i = 0; i < SM.length; i += 2) { const o1 = sOf(i); if (!o1) continue;
      fams.forEach(f => { const b0 = E.findIndex(e => e.id === o1.els[f]); if (b0 < 0) return;
        [o1, sOf(i + 1)].forEach((o, k) => { if (!o) return; for (let b = 1; b <= 12; b++) { const key = b === 1 ? f : f + b; if (key in o.els) o.els[key] = E[(b0 + 3 * k + b - 1) % E.length].id; } }); }); }
    list.forEach(o => { o.el = o.els.mijue; DATA.gfSrcById[o.id] = o; });
  }
})();
DATA.jieGfOf = (kind, a) => { const p = kind === "gd" ? "d" : "j"; return DATA.gfSrcById[p + "s" + a] || DATA.gfSrcById[p + a]; };   // 神界取新的 11、12 星
