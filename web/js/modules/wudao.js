/* =====================================================================
 * 模块：门派 · 秘法殿 · 宗门秘法
 * ---------------------------------------------------------------------
 * 秘法 1 ~ 10 星，同星级门派共用一套（每星 9 部，见 config/wudao.js、data/gongfa.js 的 mifaKinds）。
 * 在本门秘法殿首次学习（灵石 + 贡献），学会即第 1 层，之后在「功法」页修炼升层（修为 + 灵石）。
 * 学会的秘法离开门派也一直有效。
 * 存档：和功法放在一起 gongfa { "w3:mf:expSpeed": 层数 }
 * ===================================================================== */
G.module({
  id: "wudao",

  api: {
    // 全部已学秘法的效果合计 { mpBattle, mpIdle, hpBattle, hpIdle, spStudy, gfStudy, expSpeed, bodySpeed, explore }
    mifaBonus() {
      const out = Object.fromEntries(DATA.mifaKinds.map(k => [k.id, 0]));
      for (const id in this.s.gongfa) {
        if (!DATA.isMifa(id)) continue;
        const g = DATA.mifaInfo(id, this.s.gongfa[id]); if (g) out[g.mk.id] += g.value;
      }
      for (const K of DATA.mifaKinds) { const C = K.cfg && CFG.wudao[K.cfg]; out[K.id] = Math.round(Math.min(C && C.MAX !== undefined ? C.MAX : Infinity, out[K.id] || 0) * 1e6) / 1e6; }   // 战斗秘法几率上限；六位小数消浮点尘（如育灵 10 星全满 72.00000000000001）
      // 破军无视防御 %、金蝉伤害降低 %：按修满的星级相加
      const PJ = CFG.wudao.POJUN || {}, JC = CFG.wudao.JINCHAN || {}, full = k => { const r = []; for (let st = 1; st <= 10; st++) if ((this.s.gongfa[DATA.mifaId(st, k)] || 0) >= DATA.GONGFA_MAX) r.push(st); return r; };
      out.pojunIgn = Math.min(PJ.IGNORE_MAX === undefined ? 100 : PJ.IGNORE_MAX, full("pojun").reduce((t, st) => t + ((PJ.IGNORE || [])[st - 1] || 0), 0));
      const pctOf = (k, arr) => full(k).reduce((t, st) => t + ((arr || [])[st - 1] || 0), 0);
      out.expSpeedPct = pctOf("expSpeed", CFG.wudao.JUYUAN_PCT); out.bodySpeedPct = pctOf("bodySpeed", CFG.wudao.LIANTI_PCT);   // 聚元 / 炼体 圆满后额外 %
      out.hpBattlePct = pctOf("hpBattle", (CFG.wudao.DOUXUE || {}).PCT); out.mpBattlePct = pctOf("mpBattle", (CFG.wudao.DOULING || {}).PCT);   // 斗血 / 斗灵 圆满后每步额外恢复上限 %
      const ZH = CFG.wudao.ZHENHUN || {}, zf = full("zhenhun"); out.zhenhunR = zf.length ? ((ZH.ROUNDS || [])[zf[zf.length - 1] - 1] || 3) : 0;
      out.jinchanCut = Math.max(JC.CUT_MIN || 0, (JC.CUT_START || 0) - full("jinchan").reduce((t, st) => t + ((JC.CUT_STEP || [])[st - 1] || 0), 0));
      if (this.oriSum) {   // 出身（config/start.js CFG.origin）：探索每步秒、功法修炼时间 %、炼丹 / 炼器成功率 %、肉身速度 %
        out.explore = (out.explore || 0) + this.oriSum("explore"); out.gfStudy = (out.gfStudy || 0) + this.oriSum("gfStudyPct");
        out.danRate = (out.danRate || 0) + this.oriSum("danRate"); out.qiRate = (out.qiRate || 0) + this.oriSum("qiRate");
        out.bodySpeedPct = (out.bodySpeedPct || 0) + this.oriSum("bodyPct"); }
      return out;
    },
    mifaLearnMs(star) { const Q = CFG.gongfa.LEARN_Q || {}; return DATA.gfLearnMin(star) * (Q.MIFA_MUL === undefined ? 5 : Q.MIFA_MUL) * 60000; },
    learnMifa(kind, star) {   // star 不写 = 本宗门星级；可学本星及以下的秘法
      const s = this.s, sect = this.sectInfo(); if (!sect) return;
      star = Math.floor(+star || sect.star); if (star < 1 || star > sect.star || !DATA.mifaKindById[kind]) return;
      const id = DATA.mifaId(star, kind), c = DATA.mifaLearnCost(star, kind);
      if (s.gongfa[id]) return;
      if (!this.lqCan("gf", id)) return;   // v173 学习队列：首次学习要时间（同星级功法 × MIFA_MUL）
      if (s.stone < c.stone) return this.log("灵石不足。", "sys");
      if (s.contrib < c.contrib) return this.log("门派贡献不足。", "sys");
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      s.stone -= c.stone; s.contrib -= c.contrib;
      this.lqAdd("gf", { id, k: "mf", ms: this.mifaLearnMs(star) }); this.after();
    },
  },
});

/* 门派 · 秘法殿页面（sect.js 调用） */
G.sectWudaoView = function () {
  const s = this.s, x = this.sectInfo(), tot = this.mifaBonus();
  const fmt = (K, v) => `${K.sign}${U.num2(v)}${K.unit}`, hall = DATA.nmPick(CFG.names.sectHall, "wudao", "秘法殿");
  // N 星宗门显示 1~N 星秘法（高星在前）
  const cards = [];
  for (let st = x.star; st >= 1; st--) {
    const c = DATA.mifaLearnCost(st);
    cards.push({ head: `<h3>${hall} · ${st}星秘法</h3>`, rows: DATA.mifaKinds.map(K => {
      const id = DATA.mifaId(st, K.id), c = DATA.mifaLearnCost(st, K.id), lv = s.gongfa[id] || 0, g = DATA.mifaInfo(id, Math.max(1, lv));
      const eff = K.id === "explore" ? `圆满后每步 -${U.num2(g.perLv)} 秒` : K.id === "pojun" ? `圆满后 ${fmt(K, g.perLv)}，无视防御 ${U.num(((CFG.wudao.POJUN || {}).IGNORE || [])[st - 1] || 0)}%` : K.full ? `圆满后 ${fmt(K, g.perLv)}` : `每层 ${fmt(K, g.perLv)}`;
      const xp = DATA.mifaFullPct(K.id, st);   // 聚元 / 炼体 / 斗血 / 斗灵 圆满额外 %
      const effTxt = xp ? `${eff}，圆满${DATA.mifaFullTxt(K.id, xp)}` : eff;
      return [!!lv, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${st}星</span>${lv ? `<span class="tag">${lv}/${DATA.GONGFA_MAX}层</span>` : ""}
        <small>${K.label} · ${effTxt}${lv ? "" : ` · ${U.fmt(c.stone)} 灵石 + ${U.fmt(c.contrib)} 贡献 · 学习 ${U.dur(this.mifaLearnMs(st) / 1000)}`}</small></div>
        ${lv ? `<button class="sm" disabled>已学会</button>` : this.lqBtn("gf", id, `G.learnMifa('${K.id}',${st})`, s.stone < c.stone || s.contrib < c.contrib)}</div>`];
    }) });
  }
  return this.lqCard("gf") +
    U.doneCards(cards.map(c => ({ head: c.head, rows: c.rows.filter(x => !x[0]) }))) +   // 没学会的
    `<div class="card"><h3>秘法总加成</h3><div class="stats">${DATA.mifaKinds.map(K => `<div><span>${K.label}</span>${fmt(K, tot[K.id])}</div>`).join("")}<div><span>战斗每步回血上限</span>+${U.num(tot.hpBattlePct)}%</div><div><span>战斗每步回法力上限</span>+${U.num(tot.mpBattlePct)}%</div><div><span>破军无视防御</span>${U.num(tot.pojunIgn)}%</div><div><span>金蝉伤害降低</span>${tot.jinchan ? U.num(tot.jinchanCut) + "%" : "-"}</div></div></div>` +
    U.doneCard(cards.flatMap(c => c.rows));   // 已学会放最后
};
