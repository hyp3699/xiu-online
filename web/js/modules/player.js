/* =====================================================================
 * 模块：人物（境界、属性、生命法力自动恢复）
 * 开局为“凡人”，修为满 100 突破为练气期一层。
 * ---------------------------------------------------------------------
 * 属性计算公式（computeStats）：
 *   生命 = 凡人基础 + 修为突破合计 + 装备 + 真经
 *   攻击 =  凡人基础 + 修为突破合计 + 装备 + 功诀
 *   防御 =  凡人基础 + 修为突破合计 + 装备 + 心法
 *   法力 =  凡人基础 + 修为突破合计 + 装备 + 法诀
 *   （功法加成都是固定数值；以上各项再加 属性丹 永久加成）
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

  // 每 10 秒：生命、法力各恢复上限的 1%
  tick() {
    const st = this.stats(), s = this.s;
    const R = this.regen(false);   // 平时恢复：每 10 秒 % 上限
    if (s.hp < st.hp) s.hp = Math.min(st.hp, s.hp + st.hp * R.hp / 100);
    if (s.mana < st.mana) s.mana = Math.min(st.mana, s.mana + st.mana * R.mana / 100);
    if (Array.isArray(s.mailbox) && s.mailbox.length && this.mailboxPrune) this.mailboxPrune();   // 传音 10 天到期清理
  },

  api: {
    r() { return Math.floor(this.s.L / DATA.LAYERS); },          // 当前大境界序号
    layer() { return this.s.L % DATA.LAYERS; },
    // 境界够不够：req = -1 凡人即可，否则需要（非凡人且）大境界 ≥ req
    realmOK(req) { return req < 0 || DATA.isTest() || (!this.s.mortal && this.r() >= req); },   // 测试模式不限境界                    // 当前层（0~9）
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
      if (this.inFight()) return { hp: 0, mana: 0 };   // v201 战斗进行中（历练 / 探索 / 出窍 / 秘境 / 灵地 / 渡劫，休养不算）：平时恢复 1% 和 养血 / 养灵都不生效，只靠 斗血 / 斗灵
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
      const add = (key, a) => { const v = DATA.brLayerGain(body, T, a) * (Math.random() * 2 - 1) * P / (100 + fp(a)); o[key] = Math.round(((o[key] || 0) + v) * 100) / 100; };
      for (const a in g) { if (a === "cultivate" || (body && a === "mana")) continue; if (a === "res") DATA.elements.forEach(e => add("res:" + e.id, a)); else add(a, a); }
    },
    // 老存档：已突破的层按现在的规则重新掷一次（s.brRandV = 2 标记，只做一次）
    brFill(s) {
      if (s.brRandV === 2) return; s.brRand = {};
      if (!s.mortal) for (let t = 0; t <= (s.L || 0); t++) this.brRoll("xw", t, s);
      for (let t = 0; t <= (s.bodyL === undefined ? -1 : s.bodyL); t++) this.brRoll("rs", t, s);
      s.brRandOk = 1; s.brRandV = 2;
    },
    brRand(kind, a) { const r = this.s.brRand; return (r && r[kind] && r[kind][a]) || 0; },
    computeStats() {
      const L = this.s.mortal ? -1 : this.s.L, F = DATA.playerFixed, R = k => DATA.plRealmStat(L, k) + (L < 0 ? 0 : this.brRand("xw", k));   // 修为突破随机加减（brRoll）   // 修为突破属性（config/realm.js 的 GAIN）
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
      const sw = this.swPct ? this.swPct() : {};   // 神界主神纹：百分比（shenjie.js）
      for (const k of ["hp", "atk", "def", "dodge"]) if (sw[k]) out[k] *= 1 + sw[k] / 100;
      if (sw.res) for (const e in out.res) out.res[e] *= 1 + sw.res / 100;
      return out;
    },
  },
});
