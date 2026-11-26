/* =====================================================================
 * 模块：人物（境界、属性、生命法力自动恢复）
 * 开局为“凡人”，修为攒够 needExp 突破为练气期一层。
 * ---------------------------------------------------------------------
 * 属性计算公式（computeStats）：
 *   生命 = 凡人基础 + 修为突破合计 + 装备 + 真经
 *   攻击 =  凡人基础 + 修为突破合计 + 装备 + 功诀
 *   防御 =  凡人基础 + 修为突破合计 + 装备 + 心法
 *   法力 =  凡人基础 + 修为突破合计 + 装备 + 法诀
 *   （功法加成都是固定数值；以上各项再加 属性丹、肉身突破、悟道室战斗之道、本命法宝等加成，神界真意按 % 乘突破属性）
 *   基础修炼速度 = 凡人基础 + 修为突破合计（不显示为属性）
 *   速度 = 凡人基础 + 修为突破合计 + 装备
 *   命中 = 凡人基础 + 修为突破合计 + 装备 + 身法 + 丹药；闪避 = 凡人基础 + 修为突破合计 + 装备 + 遁术 + 丹药
 *   暴击：固定基础值 + 装备 + 丹药，不随境界成长
 *   抗性（金木水火土雷各一）= RES_BASE + 修为突破合计 + 本系真诀；法术伤害按 防御 + 对应抗性 抵消
 * ===================================================================== */
G.module({
  id: "player",

  defaults: () => ({
    mortal: true, // 凡人（尚未踏入练气期）
    L: 0,        // 总层序（境界×10+层）
    exp: 0,      // 当前修为
    hp: CFG.player.base.hp,     // 当前生命
    mana: CFG.player.base.mana, // 当前法力
    kills: 0,    // 斩妖数
  }),

  // 每 10 秒：生命、法力按 regen(false) 恢复上限的 %
  tick() {
    const st = this.stats(), s = this.s;
    if (!s.born) s.born = this.now();   // 修炼年数起点（老存档从这次开始算，用户定）
    const R = this.regen(false);   // 平时恢复：每 10 秒 % 上限
    if (s.hp < st.hp) s.hp = Math.min(st.hp, s.hp + st.hp * R.hp / 100);
    if (s.mana < st.mana) s.mana = Math.min(st.mana, s.mana + st.mana * R.mana / 100);
    if (Array.isArray(s.mailbox) && s.mailbox.length && this.mailboxPrune) this.mailboxPrune();   // 传音 30 天到期清理
    this.realmRwCheck();   // 境界奖励（含以前没发的补发）
    this.yearRwCheck();    // 修炼年数奖励
    if (!s.oriSs && this.oriSsFix) this.oriSsFix();   // 出身「残魂附体」神识强度
  },

  api: {
    // 境界奖励：大境界 r 的某一项数量（config/realm.js REWARD，练气 → 圣人平均递增）
    realmRwVal(r, k) { const R = ((CFG.realm || {}).REWARD || {})[k]; if (!R) return 0; const n = Math.max(1, DATA.realms.length - 1); return Math.round(R[0] + (R[1] - R[0]) * Math.min(1, Math.max(0, r) / n)); },
    // 每到一个新的大境界发一次奖励到传音；s.rrw = 已发到第几个大境界（旧存档没有 = -1，上线后把已到达的境界全部补发）
    realmRwCheck() {
      const s = this.s; if (!s || s.mortal || !this.mailboxAdd) return;
      const r = this.r(), done = Number.isInteger(s.rrw) ? s.rrw : -1; if (done >= r) return;
      for (let i = done + 1; i <= r; i++) {
        const src = `${DATA.realmLabel(i)}境界奖励`, v = k => this.realmRwVal(i, k);
        if (v("stone") > 0) this.mailboxAdd({ t: "cur", k: "stone", n: v("stone") }, true, src);
        if (v("wuzhen") > 0) this.mailboxAdd({ t: "dan", type: "wuzhen", g: 0, n: v("wuzhen") }, true, src);
        if (v("fire") > 0) this.mailboxAdd({ t: "hx", n: v("fire") }, true, src);
        if (v("merit") > 0) this.mailboxAdd({ t: "cur", k: "merit", n: v("merit") }, true, src);
      }
      s.rrw = r;
      if (!this.silent) this.log(r - done > 1 ? `境界奖励已补发到传音（${DATA.realmLabel(done + 1)} ~ ${DATA.realmLabel(r)}），${this.MAILBOX_DAYS || 30} 天内领取。` : `到达${DATA.realmLabel(r)}，境界奖励已发到传音，${this.MAILBOX_DAYS || 30} 天内领取。`, "gold");
    },
    // 修炼年数奖励（config/player.js YEAR_RW）：发奖的年数列表（升序）
    yearRwList() { const out = [], Y = CFG.player.YEAR_RW || {}; for (const k of ["A", "B"]) { const c = Y[k]; if (c && c.step > 0) for (let y = c.from; y <= c.to; y += c.step) out.push([y, c.rw]); } return out.sort((a, b) => a[0] - b[0]); },
    yearNow() { const s = this.s, ym = (+CFG.player.YEAR_MIN || 15) * 60000; return s.born ? Math.max(0, Math.floor((this.now() - s.born) / ym)) : 0; },
    // 下一个发奖时刻（毫秒；没有 = Infinity），离线加速用
    yearRwNextAt() { const s = this.s; if (!s || !s.born || s.mortal) return Infinity; const ym = (+CFG.player.YEAR_MIN || 15) * 60000, d = s.yrwV === 60 ? +s.yrw || 0 : 0, n = this.yearRwList().find(x => x[0] > d); return n ? s.born + n[0] * ym : Infinity; },
    // s.yrw = 已发到第几年
    yearRwCheck() {
      const s = this.s; if (!s || s.mortal || !s.born || !this.mailboxAdd) return;
      if (s.yrwV !== 60) { s.yrw = 0; s.yrwV = 60; }   // 旧存档（年数口径不是 60 分钟 = 1 年）：已发过的奖励按新年数到时间再发一次（用户定）
      const y = this.yearNow(), d = +s.yrw || 0, L = this.yearRwList().filter(x => x[0] > d && x[0] <= y); if (!L.length) return;
      for (const [yr, rw] of L) {
        const src = `修炼${U.fmt(yr)}年奖励`;
        if (rw.stone > 0) this.mailboxAdd({ t: "cur", k: "stone", n: rw.stone }, true, src);
        if (rw.wuzhen > 0) this.mailboxAdd({ t: "dan", type: "wuzhen", g: 0, n: rw.wuzhen }, true, src);
        if (rw.merit > 0) this.mailboxAdd({ t: "cur", k: "merit", n: rw.merit }, true, src);
        if (rw.fire > 0) this.mailboxAdd({ t: "hx", n: rw.fire }, true, src);
        if (rw.yuanli > 0) this.mailboxAdd({ t: "cur", k: "yuanli", n: rw.yuanli }, true, src);
      }
      s.yrw = L[L.length - 1][0];
      if (!this.silent) this.log(`修炼满 ${U.fmt(s.yrw)} 年，奖励已发到传音，${this.MAILBOX_DAYS || 30} 天内领取。`, "gold");
    },
    r() { return Math.floor(this.s.L / DATA.LAYERS); },          // 当前大境界序号
    layer() { return this.s.L % DATA.LAYERS; },   // 当前层（0~9）
    // 境界够不够：req = -1 凡人即可，否则需要（非凡人且）大境界 ≥ req
    realmOK(req) { return req < 0 || DATA.isTest() || (!this.s.mortal && this.r() >= req); },   // 测试模式不限境界
    needExp() { return this.s.mortal ? DATA.needExp(-1) : DATA.needExp(this.s.L); },   // needExp(-1) = 凡人 → 练气一层
    realmName(L) {
      if (L === undefined) { if (this.s.mortal) return "凡人"; L = this.s.L; }
      return DATA.realmLabel(Math.floor(L / 10)) + DATA.layerNames[L % 10];
    },

    // 汇总装备加成
    equipTotal() {
      const add = { atk: 0, hp: 0, def: 0, mana: 0, crit: 0, hit: 0, dodge: 0, speed: 0 };
      const all = [...Object.values(this.s.equip), ...this.s.fabao.slice(0, this.slotCount()), this.bmEq ? this.bmEq() : null]; // 装备 + 法宝 + 本命法宝
      for (const e of all) if (e) {
        const st = this.equipStats(e);
        for (const k in st) if (k in add) add[k] += st[k];
      }
      return add;
    },

    // 历练/探索每走一步恢复的百分比 = config/explore.js HEAL_STEP + 宗门秘法「斗血 / 斗灵」（战斗中途不再恢复）
    regenStep() {
      const m = this.mifaBonus(), H = (CFG.explore.HEAL_STEP || 0) * 100;
      // hp / mana = 恢复上限的 %（HEAL_STEP + 斗血 / 斗灵圆满额外 %），hpFlat / manaFlat = 斗血 / 斗灵每步固定点数
      return { hp: H + (m.hpBattlePct || 0), mana: H + (m.mpBattlePct || 0), hpFlat: m.hpBattle || 0, manaFlat: m.mpBattle || 0 };
    },
    // 恢复百分比：battle = true 雷劫中每回合（秘法），false 平时每 10 秒（config/player.js + 宗门秘法）
    regen(battle) {
      const m = this.mifaBonus();
      if (battle) return { hp: m.hpBattlePct || 0, mana: m.mpBattlePct || 0, hpFlat: m.hpBattle || 0, manaFlat: m.mpBattle || 0 };   // 战斗中只有秘法恢复
      const b = CFG.player.REGEN_IDLE || {};
      if (this.inFight()) return { hp: 0, mana: 0 };   // 战斗进行中（历练 / 探索 / 出窍 / 秘境 / 灵地 / 渡劫，休养不算）：平时恢复和 养血 / 养灵都不生效，只靠 斗血 / 斗灵
      return { hp: (b.hp || 0) + m.hpIdle, mana: (b.mana || 0) + m.mpIdle };
    },
    // 战斗进行中：历练 / 探索 / 出窍 / 秘境 / 灵地（休养等待时不算），或正在渡劫
    inFight() {
      const s = this.s, x = s.explore, q = s.cq;
      return !!((x && !x.rest) || (q && !q.rest) || (s.trib && !s.trib.result));
    },
    // 突破随机属性：kind "xw" 修为 / "rs" 肉身，T = 刚突破到的层序；累计存 s.brRand（config/realm.js AUTO.RAND_PCT）
    //   每项属性随机 ±RAND_PCT 个百分点：例 修为 12% ±2% → 本层这项 = 一星功法 × (1 + 10%~14%)，后面境界按同样比例浮动；抗性六系各掷各的
    brRoll(kind, T, s = this.s) {
      const A = CFG.realm.AUTO || {}, P = +A.RAND_PCT || 0; if (P <= 0) return;
      const body = kind === "rs", FP0 = body ? A.BODY_FIRST_PCT : A.XW_FIRST_PCT, fp = a => typeof FP0 === "object" && FP0 ? +FP0[a] || 0 : +FP0 || 0;
      const g = (DATA.brRow(DATA.autoRows(body), Math.floor(Math.max(0, T) / DATA.LAYERS)) || [0, {}])[1] || {};
      const o = ((s.brRand = s.brRand || {})[kind] = s.brRand[kind] || {});
      const rec = {}, add = (key, a) => { const v = DATA.brLayerGain(body, T, a) * (Math.random() * 2 - 1) * P / (100 + fp(a)), o0 = o[key] || 0; o[key] = Math.round((o0 + v) * 100) / 100; rec[key] = Math.round((o[key] - o0) * 100) / 100; };
      for (const a in g) { if (a === "cultivate" || (body && a === "mana")) continue; if (a === "res") DATA.elements.forEach(e => add("res:" + e.id, a)); else add(a, a); }
      ((s.brRandL = s.brRandL || {})[kind] = s.brRandL[kind] || {})[T] = rec;   // 记下这层加了多少，跌落境界时扣回（brUnroll）
    },
    // 跌落境界：扣回第 T 层突破随机属性（没有记录的旧层不扣）
    brUnroll(kind, T, s = this.s) {
      const L = (s.brRandL || {})[kind] || {}, r = L[T]; if (!r) return;
      const o = ((s.brRand = s.brRand || {})[kind] = s.brRand[kind] || {});
      for (const k in r) o[k] = Math.round(((o[k] || 0) - r[k]) * 100) / 100;
      delete L[T];
    },
    // 死亡惩罚（config/battle.js CFG.battle.DEATH）：扣修为、气血，不够扣就跌落境界；地图战死和渡劫失败共用（用户定）
    //   o.noExp：不扣修为；o.head：日志开头（默认「被 who 击杀」）；返回扣除说明（没有扣返回空串）
    dieLoss(who, o = {}) {
      const s = this.s, C = CFG.battle.DEATH; if (!C) return "";
      const big = L => Math.floor(Math.max(0, L) / DATA.LAYERS), pct = (P, L) => Math.max(+C.MIN || 0, (+P || 0) - (+C.STEP || 0) * big(L)) / 100;
      const L0 = s.L, B0 = s.bodyL, mortal0 = s.mortal, msg = [];
      // 修为
      const X = o.noExp ? 0 : Math.round(this.needExp() * pct(C.EXP_PCT, s.mortal ? 0 : s.L));
      if (X > 0) { while (s.exp < X && !s.mortal && s.L > 0) { this.brUnroll("xw", s.L); s.L--; s.exp += DATA.needExp(s.L); }
        s.exp = Math.max(0, s.exp - X); msg.push(`修为 -${U.fmt(X)}`); }
      // 气血
      if (s.bodyL !== undefined) { const Y = this.bodyMax && this.bodyMax() ? Math.round(this.bodyNeed(s.bodyL) * pct(C.BODY_PCT, s.bodyL)) : Math.round(this.bodyNeed() * pct(C.BODY_PCT, s.bodyL));
        if (Y > 0) { while ((s.bodyExp || 0) < Y && s.bodyL > 0) { s.bodyExp = (s.bodyExp || 0) + this.bodyNeed(s.bodyL); this.brUnroll("rs", s.bodyL); s.bodyL--; }
          s.bodyExp = Math.max(0, (s.bodyExp || 0) - Y); msg.push(`气血 -${U.fmt(Y)}`); } }
      if (s.L !== L0 && !mortal0) msg.push(`修为境界跌落至【${this.realmName()}】`);
      if (s.bodyL !== B0) msg.push(`肉身境界跌落至【${this.bodyName()}】`);
      if (s.L !== L0 || s.bodyL !== B0) { this.dirty(); /* 先清缓存，按跌落后的新上限钳制 */ const st = this.stats(); s.hp = Math.min(s.hp, st.hp); s.mana = Math.min(s.mana, st.mana); }
      const head = o.head || (who ? `被${who}击杀` : "战死");
      if (msg.length && !o.noLog) this.log(`${head}，${msg.join("，")}。`, "bad");
      this.dirty(); return msg.join("，");
    },
    // 老存档：已突破的层按现在的规则重新掷一次（s.brRandV = 2 标记，只做一次）
    brFill(s) {
      if (s.brRandV === 2) return; s.brRand = {}; s.brRandL = {};
      if (!s.mortal) for (let t = 0; t <= (s.L || 0); t++) this.brRoll("xw", t, s);
      for (let t = 0; t <= (s.bodyL === undefined ? -1 : s.bodyL); t++) this.brRoll("rs", t, s);
      s.brRandOk = 1; s.brRandV = 2;
    },
    brRand(kind, a) { const r = this.s.brRand; return (r && r[kind] && r[kind][a]) || 0; },
    computeStats() {
      const L = this.s.mortal ? -1 : this.s.L, F = DATA.playerFixed, R = k => DATA.plRealmStat(L, k) + (L < 0 ? 0 : this.brRand("xw", k));   // 修为突破属性（config/realm.js 的 GAIN）+ 突破随机加减（brRoll）
      const eq = this.equipTotal(), gf = this.gongfaBonus(), dn0 = this.danBonus();
      const dn = {}; for (const k of ["hp", "atk", "def", "mana", "hit", "dodge", "crit"]) dn[k] = dn0[k] || 0; // 属性丹；gongfaBonus 见 gongfa.js，danBonus（属性丹）见 craft.js
      const bd = this.bodyBonus ? this.bodyBonus() : {}; for (const k of ["hp", "atk", "def", "mana", "hit", "dodge", "crit"]) dn[k] += bd[k] || 0;   // 肉身突破加成（body.js）
      const wb = this.wdBat ? this.wdBat() : {}; for (const k of ["hp", "atk", "def"]) dn[k] += wb[k] || 0;   // 悟道室战斗之道每悟道随机属性（wudaoshi.js）
      const bmb = this.bmBonus ? this.bmBonus() : {}; for (const k of ["hp", "atk", "def", "hit", "dodge"]) dn[k] += bmb[k] || 0;   // 本命法宝额外属性（bag.js）
      const out = {
        hp:      R("hp") + eq.hp + gf.hp + dn.hp,
        atk:     R("atk") + eq.atk + gf.atk + dn.atk,
        def:     R("def") + eq.def + gf.def + dn.def,
        mana:    R("mana") + eq.mana + gf.mana + dn.mana,
        cultivate: R("cultivate"),
        speed:   R("speed") + eq.speed + gf.speed + (bd.speed || 0) + (dn0.speed || 0) + (bmb.speed || 0),
        hit:     R("hit") + eq.hit + gf.hit + dn.hit,
        dodge:   R("dodge") + eq.dodge + gf.dodge + dn.dodge,
        crit:    Math.min(DATA.CRIT_CAP, F.crit + eq.crit + dn.crit),
        res:     Object.fromEntries(DATA.elements.map(e => [e.id, R("res") + (L < 0 ? 0 : this.brRand("xw", "res:" + e.id)) + (gf.res[e.id] || 0) + (bd.res || 0) + ((bd.resEl || {})[e.id] || 0) + (dn0.res || 0) + ((dn0.resEl || {})[e.id] || 0) + ((wb.res || {})[e.id] || 0) + ((bmb.res || {})[e.id] || 0)])),
      };
      const zp = this.sjPct ? this.sjPct() : {};   // 神界真意：百分比，只乘修为突破 + 肉身突破的属性（shenjie.js）
      for (const k of ["hp", "atk", "def", "mana"]) if (zp[k]) out[k] += (R(k) + (bd[k] || 0)) * zp[k] / 100;
      for (const e of DATA.elements) { const p = zp["res_" + e.id]; if (p) out.res[e.id] += (R("res") + (L < 0 ? 0 : this.brRand("xw", "res:" + e.id)) + (bd.res || 0) + ((bd.resEl || {})[e.id] || 0)) * p / 100; }
      return out;
    },
  },
});
