/* =====================================================================
 * 数据：隐世宗门功法阁功法（数值在 config/yinshi.js）
 * 来源 id「ys_宗门id」（src = "ys"），每个宗门 12 本，星级 = list 里的 star，效果 = 同星级宗门功法 × GF_PCT%，不占灵识点
 * ===================================================================== */
(() => {
  const C = CFG.yinshi || {};
  const EL_TYPE = { jin: "zhenjue", mu: "zhenjue2", shui: "zhenjue3", huo: "zhenjue4", tu: "zhenjue5", lei: "zhenjue6" };
  CFG.gongfa.ys = { PCT: C.GF_PCT === undefined ? 195 : C.GF_PCT, BOOKS: { zhenjue: 6, mijue: 2, tijue: 2 } };
  DATA.gfSources.ys = { name: "隐世宗门", cfg: () => DATA.gfDerive(C.GF_PCT === undefined ? 195 : C.GF_PCT) };
  if (!DATA.GF_NEW_SRC.includes("ys")) DATA.GF_NEW_SRC.push("ys");
  DATA.GF_CAT_OF.ys = "ys";
  DATA.GF_CATS.ys = DATA.nmPick(CFG.names.gfCat, "ys", "隐世宗门功法");
  DATA.ysTypeId = key => EL_TYPE[key] || key;
  (C.list || []).forEach((y, i) => {
    const id = "ys_" + y.id, o = { id, src: "ys", ys: y.id, idx: i, star: y.star || 5, prefix: String(y.name || "").slice(0, 2), name: y.name, reqRealm: -1, els: {} };
    DATA.gongfaTypes.forEach((t, n) => { o.els[t.id] = DATA.elements[(i + n) % 6].id; });
    for (const e in EL_TYPE) o.els[EL_TYPE[e]] = e;
    o.el = o.els.gongjue;
    DATA.gfSrcById[id] = o;
  });
  DATA.ysGfName = (o, type) => { const S = C.GF_SUFFIX || {}, key = type.fam === "zhenjue" ? (o.els || {})[type.id] : type.id; return o.prefix + (S[key] || type.suffix); };
  // 宗门的 12 本功法 id（按 GF_KEYS 顺序）
  DATA.ysGfIds = ysId => (C.GF_KEYS || []).map(k => DATA.gongfaId("ys_" + ysId, DATA.ysTypeId(k))).filter(id => DATA.gongfaInfo(id, 1));
})();
