/* =====================================================================
 * 数据：地图格子游历的宝物、游历功法（数值全部在 config/youli.js）
 * ---------------------------------------------------------------------
 * 宝物：背包物品 { t: "ylb", k 种类序号, g 级（0 = 凡品一阶 …… 29 = 神品十阶）, n }，服用后永久加属性，存档 s.ybEaten["种类|级"] = 已服个数
 * 游历功法：来源 id yl凡界图序号 / ylx仙魔冥第几张图 / yls神界第几张图（src = "yl"），每处 12 本，掉落时放进背包（gfb）
 * ===================================================================== */
(() => {
  const C = CFG.youli || {};
  CFG.gongfa.yl = { PCT: C.GF_PCT === undefined ? 145 : C.GF_PCT, BOOKS: { zhenjue: 6 } };   // 真经 6 本 = 六种抗性各一本（gfBookN 用）
  DATA.YB = (C.YB || []).map(([name, stat, per], k) => ({ k, name, stat, per }));
  DATA.YB_MAX = C.YB_MAX || 100;
  DATA.YB_PIN = C.YB_PIN || ["凡品", "仙品", "神品"];
  DATA.ybGrade = g => `${DATA.YB_PIN[Math.floor(g / 10)] || ""}${DATA.gfCn(g % 10 + 1)}阶`;
  // 名字颜色：每 5 阶一档（凡品一~五阶 q0 白、六~十阶 q1 绿，仙品 q2 蓝 / q3 紫，神品 q4 金 / q5 橙）
  DATA.ybQ = g => Math.max(0, Math.min(5, Math.floor((g || 0) / 5)));
  DATA.ybName = (k, g) => `${DATA.ybGrade(g)}·${(DATA.YB[k] || {}).name || "宝物"}`;
  DATA.ybVal = (k, g) => ((DATA.YB[k] || {}).per || 0) * (g + 1);
  DATA.ybLabel = k => { const st = (DATA.YB[k] || {}).stat || "";
    if (st.startsWith("res_")) return ((DATA.elById[st.slice(4)] || {}).name || "") + "抗性";
    return { hp: "生命上限", mana: "法力上限", atk: "攻击", def: "防御" }[st] || st; };
  DATA.ybIcon = k => DATA.iconImg("yb" + k);
  // 地图 a 出哪几级宝物（凡界第 9 张图出九阶、十阶）
  DATA.ybGradesOf = a => { const m = DATA.maps[a]; if (!m) return [];
    if (m.w === "fan") return a >= 8 ? [8, 9] : [a];
    const i = m.wi || 0; return m.w === "shen" ? [20 + i] : [10 + i]; };

  /* ---------- 游历功法 ---------- */
  const EL_TYPE = { jin: "zhenjue", mu: "zhenjue2", shui: "zhenjue3", huo: "zhenjue4", tu: "zhenjue5", lei: "zhenjue6" };
  DATA.YL_GF_KEYS = ["gongjue", "xinfa", "zhenjing", "shenfa", "fajue", "dunshu", "jin", "mu", "shui", "huo", "tu", "lei"];
  DATA.ylTypeId = key => EL_TYPE[key] || key;
  DATA.gfSources.yl = { name: "游历", cfg: () => DATA.gfDerive(C.GF_PCT === undefined ? 145 : C.GF_PCT) };
  if (!DATA.GF_NEW_SRC.includes("yl")) DATA.GF_NEW_SRC.push("yl");
  DATA.GF_CAT_OF.yl = "yl";
  DATA.GF_CATS.yl = DATA.nmPick(CFG.names.gfCat, "yl", "游历功法");
  DATA.ylSources = [];
  const P = C.GF_PREFIX || {}, add = (id, grp, i, star) => {
    const o = { id, src: "yl", grp, idx: i, star, prefix: (P[grp] || [])[i] || id, name: "游历", reqRealm: -1, els: {} };
    DATA.gongfaTypes.forEach((t, n) => { o.els[t.id] = DATA.elements[(i + n) % 6].id; });
    for (const e in EL_TYPE) o.els[EL_TYPE[e]] = e;
    o.el = o.els.gongjue;
    DATA.ylSources.push(o); DATA.gfSrcById[id] = o;
  };
  for (let i = 0; i < 9; i++) add("yl" + i, "fan", i, Math.min(5, 1 + Math.floor(i / 2)));
  for (let i = 0; i < 10; i++) add("ylx" + i, "xmm", i, 6 + Math.floor(i / 2));
  for (let i = 0; i < 10; i++) add("yls" + i, "shen", i, 11 + Math.floor(i / 2));
  DATA.ylGfName = (o, type) => {
    const S = C.GF_SUFFIX || {}, key = type.fam === "zhenjue" ? (o.els || {})[type.id] : type.id;
    return o.prefix + (S[key] || type.suffix);
  };
  // 地图 a 的游历功法来源（仙魔冥同一序号共用一套）
  DATA.ylSrcOf = a => { const m = DATA.maps[a]; if (!m) return null;
    return DATA.gfSrcById[m.w === "fan" ? "yl" + a : m.w === "shen" ? "yls" + (m.wi || 0) : "ylx" + (m.wi || 0)] || null; };
  // 地图 a 的 r 域出的 3 本功法 id
  DATA.ylGfIds = (a, r) => { const o = DATA.ylSrcOf(a), D = (C.GF_DIR || [])[r] || [];
    return o ? D.map(k => DATA.gongfaId(o.id, DATA.ylTypeId(k))).filter(id => DATA.gongfaInfo(id, 1)) : []; };
})();
