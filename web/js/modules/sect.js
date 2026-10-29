/* =====================================================================
 * 模块：门派
 * ---------------------------------------------------------------------
 * 未入门：按 1~10 星浏览 120 个门派，境界够了即可拜入。
 * 入门后有九个去处：
 *   宗门大殿  晋升职务（外门弟子 → 宗主），每天领取职务俸禄（灵石）
 *   功法殿    用贡献学习本门功法、法术（学会为第 1 层，之后去“功法”页修炼）
 *   事务堂    每个职务一个任务；点任务后循环自动执行（离线也会进行）
 *   练功房    修炼时消耗贡献，增加修炼速度
 *   宗门宝库  用贡献兑换：杂物（一阶炼丹炉、一阶炼器炉、灵石）/ 凡界全部药材矿石（可输入数量）/ 灵药种子 / 炉子图纸
 *             种子、图纸只能兑换不高于门派星级的（一星 = 一阶）；炉子、图纸兑换后放进背包
 *   炼丹房    学习丹方（贡献 + 时间），学会后在洞府炼丹房炼制（见 craft.js）
 *   炼器室    学习炼器（暂未开放）
 *   试炼塔    100 层，逐层挑战，首次通关得贡献
 *   讲道室    每天随机长老讲道（炼丹、炼器必出 + 随机功法），听 10 分钟加技艺经验或属性；每天一次免费，其余要贡献
 * 数值都在 js/config/ 下的数值文件 的 sect。
 * ===================================================================== */
G.module({
  id: "sect",
  tab: "sect",

  defaults: () => ({
    sect: null,       // 门派 id
    contrib: 0,       // 门派贡献
    rank: 0,          // 职务（DATA.ranks 下标）
    room: -1,         // 正在使用的修炼室（原练功房），-1 为未使用
    gfRoom: -1,       // v27：宗门练功房（加快功法修炼）
    merit: 0,         // v27：功德
    salaryDay: "",    // 上次领取俸禄的日期
    affair: { task: -1, start: 0, count: 0 },     // 事务堂：正在循环执行的任务（-1 = 无）
    affairDay: "",    // 事务堂物品 / 特殊任务的生成日期（北京时间）
    affairItems: [],  // 物品任务 [{ kind, g, n, done }]
    affairFights: [], // 特殊任务 [{ name, grp, realm, lay, pct, gf, done }]
    towers: {},       // 各星级试炼塔已通关层数 { 星级: 层数 }
    rankPass: -1,     // 已通过考验、可以晋升的职务序号（-1 = 没有）
    freeCult: { day: "", used: 0, left: 0, on: false },   // 免费修炼室：今天用了几次、本次剩余修炼次数
    freeGf: { day: "", used: 0, end: 0 },
    pool: null,       // 炼体池：{ i 池子, end 结束时间, gain 泡完加的属性, day, used }
    poolGain: {},     // 炼体池累计加的肉身属性                 // 免费练功房：今天用了几次、本次结束时间
    cqZj: [],         // 已学会的出窍真诀卷号（1~3），每卷地图每步 −CFG.cqzj.SEC 秒
    cqzjL: null,      // 正在学习的出窍真诀 { v 卷号, end 学会时间 }（不进功法学习队列，学会就生效，不用修炼）
    cqLearn: 0,       // 1 = 已学会元婴出窍秘法（每天次数 = 神识强度 ssPow）
    cqDay: "", cqUsed: 0,   // 元婴出窍：今天已用次数
    qlDay: "",        // v213 宗主清灵丹：上次领取日期
    qlEaten: {},      // 各门派清灵丹已服用颗数 { 门派id: 颗数 }
    ccDay: "",        // v213 宗门传承：上次领悟日期
    ccGot: {},        // 各门派已领悟的传承功法 { 门派id: [功法id…] }（门派之间互不通用）
    jd: null,         // 讲道室 { day, list:[{nm, k:"dan"/"qi"/功法类别, book, done}], free: 免费用掉的日期, cur: {i, end}, got: {属性: 值}, log: [] }
  }),

  // 每 10 秒：事务堂任务到时间就结算一次，并自动开始下一次（离线也会补算）
  tick(offline) {
    this.freeRoomDaily(); this.poolTick(); this.jdSettle(); this.cqzjTick();
    if (this.s.sect) this.affairGen();
    this.autoTaskCheck();   // v229 每天北京时间 0:05 自动执行任务（修炼设置）；v230 离线补算到 0:05 也执行
    const s = this.s, a = s.affair;
    if (!s.sect || !a || a.task === undefined || a.task < 0) return;
    const t = DATA.affairs[a.task]; if (!t) { a.task = -1; return; }
    const T = t.time * 60000, now = this.now();
    let guard = 0;
    while (now >= a.start + T && guard++ < 1e5) { a.start += T; a.count++; this.affairReward(a.task); }
  },

  api: {
    sectInfo() { return DATA.sectById[this.s.sect]; },
    // 星级倍率、职务倍率（config/sect.js 的 STAR_MULT / RANK_MULT）
    starMul() { const v = (CFG.sect.STAR_MULT || [])[this.sectInfo().star - 1]; return v === undefined ? this.sectInfo().star : v; },
    rankMul(i = this.s.rank) { const v = (CFG.sect.RANK_MULT || [])[i]; return v === undefined ? 1 : v; },
    roomPct(i) { return DATA.rooms[i].pct * this.starMul(); },
    roomCost(i) { return DATA.rooms[i].cost; },   // v99：写多少就是多少，不乘星级
    roomLocked(i) { return (DATA.rooms[i].rank || 0) > this.s.rank; },
    gfRoomPct(i) { return DATA.gfRooms[i].pct; },   // v97：减少修炼时间 %，不乘星级
    gfRoomCost(i) { return DATA.gfRooms[i].cost; },   // v98：写多少就是多少，不乘星级
    gfRoomUnits() { return Math.max(1, Math.round((CFG.sect.gfRoomSec || 5) / DATA.STUDY_STEP)); },   // 几个 5 秒单位扣一次贡献
    gfRoomSec() { return this.gfRoomUnits() * DATA.STUDY_STEP; },
    gfRoomLocked(i) { return (DATA.gfRooms[i].rank || 0) > this.s.rank; },
    // 当前练功房：{ name, pct, mul, cost, cur: "contrib" } 或 null
    // pct = 减少修炼时间 %；mul = 修炼进度倍率 = 100 ÷ (100 − pct)
    gfRoomNow() {
      const s = this.s, M = p => 100 / (100 - Math.min(95, Math.max(0, p)));
      if (this.freeGfOn()) { const p = this.freeGfPct(); return { name: CFG.sect.freeGfRoom.name, pct: p, mul: M(p), cost: 0, cur: "contrib", free: true }; }
      if (s.gfRoom >= 0 && s.sect && DATA.gfRooms[s.gfRoom]) { const p = this.gfRoomPct(s.gfRoom); return { name: DATA.gfRooms[s.gfRoom].name, pct: p, mul: M(p), cost: this.gfRoomCost(s.gfRoom), cur: "contrib" }; }
      return null;
    },
    leaveGfRoom(why) { const r = this.gfRoomNow(); this.s.gfRoom = -1; if (r && why) this.log(`${why}，已离开${r.name}。`, "bad"); this.dirty(); },
    setSectStar(n) { this.sectStar = n; this.render(); },
    setSectTab(t) { this.sectTab = t; this.render(); },

    /* ---------- 入门 / 叛出 ---------- */
    joinSect(id) {
      const x = DATA.sectById[id];
      if (!this.realmOK(x.reqRealm)) return;
      Object.assign(this.s, { sect: id, rank: 0, room: -1, rankPass: -1, affair: { task: -1, start: 0, count: 0 } });
      this.sectTab = "hall";
      const O = CFG.origin || {}, yr = this.oriSum ? this.oriSum("sectRank") : 0;   // 出身「宗门遗孤」：第一次加入 SECT_STAR 星宗门直接是真传，加贡献
      if (yr > 0 && !this.s.oriSect && x.star === (O.SECT_STAR || 1)) {
        this.s.oriSect = 1; this.s.rank = Math.min(DATA.ranks.length - 1, yr); const c = this.oriSum("contrib"); this.s.contrib = (this.s.contrib || 0) + c;
        this.log(`你拜入${x.name}（${x.star}星），师门念旧，直接成为${DATA.ranks[this.s.rank].name}${c ? `，贡献 +${U.fmt(c)}` : ""}。`, "gold"); return this.after();
      }
      this.log(`你拜入${x.name}（${x.star}星），成为外门弟子。`, "gold"); this.after();
    },
    leaveCost() { const x = this.sectInfo(); return DATA.isTest() ? 0 : x ? ((CFG.sect.LEAVE_COST || [])[x.star - 1] || 0) : 0; },   // 叛出门派扣的贡献
    leaveSect() {
      const c = this.leaveCost();
      if (this.s.contrib < c) return this.log(`贡献不足，叛出门派需要 ${U.fmt(c)}。`, "sys");
      if (!confirm(`叛出门派将扣除贡献 ${U.fmt(c)}、清空职务（已学功法保留），确定？`)) return;
      this.log(`你离开了${this.sectInfo().name}，扣除贡献 ${U.fmt(c)}。`, "bad");
      this.s.contrib -= c;
      this.s.sect = null; this.s.room = -1; this.s.affair = { task: -1, start: 0, count: 0 }; this.s.rank = 0; this.s.rankPass = -1; this.after();
    },

    /* ---------- 宗门大殿 ---------- */
    // 职务需要的境界：外门弟子 = 门派入门境界；其余 = config/mobs.js 该星宗门考官的第 1 个数
    rankReqRealm(i) {   // 晋升需要的境界 = 考官境界；config/mobs.js 的 sect 写了「晋升需」按它
      const I = this.sectInfo(); if (i <= 0) return I.reqRealm;
      const g = DATA.mobPick(CFG.mobs.sect, I.star + "星", I.star - 1) || {}, o = (g["晋升需"] || {})[DATA.ranks[i] && DATA.ranks[i].name];
      if (o !== undefined) return o;
      const t = DATA.mobExam(I.star, i); return t ? t[0] : I.reqRealm;
    },
    rankCost(i) { return Math.floor(DATA.ranks[i].cost * this.starMul()); },
    promote() {
      const i = this.s.rank + 1; if (i >= DATA.ranks.length) return;
      if (!this.realmOK(this.rankReqRealm(i)) || this.s.contrib < this.rankCost(i)) return;
      if (this.s.rankPass !== i && !DATA.isTest()) return this.log("需先通过晋升考验。", "sys");   // 测试模式不用考核
      this.s.contrib -= this.rankCost(i); this.s.rank = i; this.s.rankPass = -1;
      this.log(`晋升为【${DATA.ranks[i].name}】！`, "gold"); this.after();
    },
    /* ---------- 晋升考验（config/sect.js 的 sect.rankTrial） ---------- */
    rankTrialCost(i) { return Math.floor(((CFG.sect.rankTrial.cost || [])[i] || 0) * this.starMul()); },
    makeRankGuard(i) {
      const b = DATA.mobStats(DATA.mobExam(this.sectInfo().star, i), DATA.mobCrit("考官")), v = (x, k) => x * DATA.mobRnd(k);   // config/mobs.js 的 sect
      return this.addMagic({ name: `${DATA.ranks[i].name}考官`, img: this.npcImg(`考官${this.sectInfo().star}_${i}`, "rn"), boss: false, hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, "考核");
    },
    challengeRank() {
      const s = this.s, i = s.rank + 1; if (i >= DATA.ranks.length || s.rankPass === i) return;
      if (!this.realmOK(this.rankReqRealm(i))) return;
      const c = this.rankTrialCost(i);
      if (s.contrib < c) return this.log(`贡献不足，参加考验需要 ${U.fmt(c)}。`, "sys");
      if (s.hp < this.stats().hp * CFG.battle.TOWER_HP_MIN) return this.log("生命不足三成，先休养片刻。", "sys");
      s.contrib -= c;
      const res = this.battle(this.makeRankGuard(i));
      let txt;
      if (res.win) { s.rankPass = i; txt = `${res.rounds}回合击败${DATA.ranks[i].name}考官，通过晋升考验！`; }
      else { txt = `${DATA.ranks[i].name}晋升考验失败${res.timeout ? "（回合耗尽，未能击败）" : ""}。`; }
      this.after();
      this.playBattle(res.detail, `晋升考验 · ${DATA.ranks[i].name}`, txt, res.win);   // 见 world.js
    },
    salary() { return Math.floor(DATA.ranks[this.s.rank].daily * this.starMul() * this.rankMul()); },
    today() { return this.bjDay(); },   // 每日次数统一按北京时间 0 点换日（服务器和手机时区不同也一致）
    bjDay() { return new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10); },   // 北京时间日期：免费修炼室、免费练功房、出窍次数每天北京时间 0 点重置
    claimSalary() {
      if (this.s.salaryDay === this.today()) { this.log("今天的俸禄已经领过了，北京时间 0 点后再来。"); this.after(); return; }
      const n = this.salary();
      this.s.salaryDay = this.today(); this.s.stone += n;
      this.log(`领取${DATA.ranks[this.s.rank].name}俸禄，灵石 +${U.fmt(n)}。`, "good"); this.after();
    },

    /* ---------- v213 宗主专属：清灵丹、宗门传承（config/sect.js 的 qingling / chuancheng） ---------- */
    isMaster() { return !!this.s.sect && this.s.rank === DATA.ranks.length - 1; },
    claimQl() {
      const s = this.s; if (!this.isMaster() || s.qlDay === this.today()) return;
      if (!this.bagAdd(x => x.t === "ql" && x.sect === s.sect, k => ({ t: "ql", sect: s.sect, n: k }), 1, "背包已满，领取失败。")) return;
      s.qlDay = this.today(); this.log(`领取宗主俸禄：${DATA.qlName(s.sect)} ×1。`, "good"); this.after();
    },
    eatQl(i, n) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "ql") return;
      s.qlEaten = s.qlEaten || {};
      const used = s.qlEaten[it.sect] || 0; n = Math.min(n, it.n, DATA.qlLimit(it.sect) - used);
      if (n <= 0) return this.log(`${DATA.qlName(it.sect)}已达服用上限。`, "sys");
      s.qlEaten[it.sect] = used + n;
      const v = DATA.qlVals(it.sect);
      this.log(`服下${DATA.qlName(it.sect)} ×${n}，${Object.keys(v).map(k => `${DATA.QL_LABEL[k] || k} +${U.num(v[k] * n)}`).join("、")}。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    qlBonus() {   // 所有门派清灵丹加的属性（danBonus 里加上）
      const b = {}, E = this.s.qlEaten || {};
      for (const sid in E) { const v = DATA.qlVals(sid); for (const k in v) b[k] = (b[k] || 0) + v[k] * E[sid]; }
      return b;
    },
    ccGotOf(sid = this.s.sect) { return (this.s.ccGot || {})[sid] || []; },
    ccLeft() { const got = this.ccGotOf(); return DATA.ccIds(this.s.sect).filter(id => !got.includes(id)); },
    ccWudao() {   // 领悟：每天 1 次，随机一本没领悟过的
      const s = this.s; if (!this.isMaster() || s.ccDay === this.today()) return;
      const left = this.ccLeft(); if (!left.length) return this.log("本门传承功法已全部领悟。", "sys");
      const id = left[Math.floor(Math.random() * left.length)];
      s.ccGot = s.ccGot || {}; s.ccGot[s.sect] = [...this.ccGotOf(), id]; s.ccDay = this.today();
      this.log(`静坐宗门大殿，领悟传承功法《${DATA.skillInfo(id).name}》！`, "gold"); this.after();
    },
    learnCc(id) {
      const s = this.s, g = DATA.skillInfo(id);
      if (!g || g.src !== "cc" || !this.isMaster() || g.sect.sectId !== s.sect || !this.ccGotOf().includes(id) || this.hasGongfa(id) || s.contrib < g.cost) return;
      if (!this.lqCan("gf", id)) return;
      if (!this.lsCheck(id)) return;
      s.contrib -= g.cost; this.startGfLearn(id); this.after();
    },
    ccCard() {
      const s = this.s, all = DATA.ccIds(s.sect), got = this.ccGotOf(), left = all.length - got.length, done = s.ccDay === this.today();
      const head = `<div class="line"><div>领悟传承<small>每天 1 次，随机领悟一本 · 已领悟 ${got.length} / ${all.length}</small></div>
        <button class="sm" onclick="G.ccWudao()" ${done || !left ? "disabled" : ""}>${!left ? "已全部领悟" : done ? "今日已领悟" : "领悟"}</button></div>`;
      const rows = U.doneLast(got.map(id => { const g = DATA.skillInfo(id), has = this.hasGongfa(id);
        const eff = g.kind === "sp" ? `${this.spellDmgTxt(g)} · 耗法力 ${U.fmt(g.mana)}` : `每层${g.label} +${this.gfValue(g, g.perLv)}`;
        return [has, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${g.kind === "sp" ? "法术" : g.type.name}</span><small>${eff} · ${U.fmt(g.cost)} 贡献 · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>${this.gfLearnBtn(g, `G.learnCc('${g.id}')`, s.contrib < g.cost)}</div>`]; }));
      return `<div class="card"><h3>${DATA.GF_CATS.cc}<small>宗主专属</small></h3>${head}${rows}</div>`;
    },

    /* ---------- 功法殿 ---------- */
    setLibEl(e) { this.libEl = e; this.render(); },
    learnGongfa(id) {
      const g = DATA.skillInfo(id);
      if (!g || g.src !== "sect" || this.hasGongfa(id) || this.s.contrib < g.cost) return;
      if (!this.lqCan("gf", id)) return;   // v173 学习队列
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      this.s.contrib -= g.cost; this.startGfLearn(id); this.after();
    },

    /* ---------- 事务堂 ---------- */
    affairContrib(i) { return Math.floor(DATA.affairs[i].contrib * this.starMul() * this.rankMul()); },
    affairStone(i) { return Math.floor(DATA.affairs[i].stone * this.starMul() * this.rankMul()); },
    affairReward(i) {
      const c = this.affairContrib(i), st = this.affairStone(i);
      this.s.contrib += c; this.s.stone += st;
      if (this._off) { this._off.afN++; this._off.afStone += st; this._off.afContrib += c; } // 离线账本
      this.log(`完成「${DATA.affairs[i].name}」，贡献 +${U.fmt(c)}，灵石 +${U.fmt(st)}。`, "good");
    },
    // 点任务：开始循环执行；再点一次停止（停止时本次进度作废）
    startAffair(i) {
      const a = this.s.affair;
      if (a.task === i) { a.task = -1; this.log("停止执行事务。", "sys"); return this.after(); }
      if (DATA.affairs[i].rank > this.s.rank) return this.log(`需要职务【${DATA.ranks[DATA.affairs[i].rank].name}】。`, "sys");
      Object.assign(a, { task: i, start: this.now(), count: 0 });
      this.log(`开始执行「${DATA.affairs[i].name}」，完成后自动继续。`, "good"); this.after();
    },

    /* ---------- 事务堂 · 物品任务 / 特殊任务（config/sect.js 的 affairItem / affairFight，每天北京时间 0 点重置） ---------- */
    affairGen() {
      const s = this.s, day = this.bjDay(); if (!s.sect || s.affairDay === day) return;
      const x = this.sectInfo(), I = CFG.sect.affairItem, F = CFG.sect.affairFight, SP = CFG.matsOther.SPECIAL || [];
      const pool = kind => { const L = kind === "herb" ? DATA.herbs : DATA.ores, fn = kind === "herb" ? DATA.FAN_HERB_N : DATA.FAN_ORE_N;
        return L.map((n, g) => g).filter(g => x.star <= I.FAN_STAR ? g < fn : g >= fn && !SP.includes(L[g])); };
      const pick = (list, k) => { const a = list.slice(), o = []; while (o.length < k && a.length) o.push(a.splice(U.rand(0, a.length - 1), 1)[0]); return o; };
      const cnt = () => { let r = Math.random() * 100; for (const [p, n] of I.N) { if ((r -= p) < 0) return n; } return I.N[I.N.length - 1][1]; };
      s.affairItems = [...pick(pool("herb"), I.HERB).map(g => ({ kind: "herb", g })), ...pick(pool("ore"), I.ORE).map(g => ({ kind: "ore", g }))]
        .map(o => Object.assign(o, { n: cnt(), done: false }));
      const mobs = DATA.maps.slice(0, DATA.FAN_MAP_N).flatMap((m, a) => (m.monsters || []).map(name => ({ name, a }))), R = a => U.rand(a[0], a[a.length - 1]);
      s.affairFights = [];
      F.GROUPS.forEach((G0, gi) => { for (let k = 0; k < G0.n; k++) s.affairFights.push({ ...(mobs[U.rand(0, mobs.length - 1)] || { name: "妖兽", a: 0 }), grp: gi,
        realm: Math.min(DATA.realms.length - 1, x.reqRealm + G0.realm), lay: R(G0.lay), pct: R(G0.pct), gf: R(G0.gf), done: false }); });
      s.affairDay = day;
    },
    affairItemContrib() { const I = CFG.sect.affairItem; return I.CONTRIB + this.s.rank * I.RANK_ADD; },
    submitAffairItem(i) {
      this.affairGen(); const s = this.s, t = (s.affairItems || [])[i]; if (!s.sect || !t || t.done) return;
      const nm = DATA.matName(t.kind, t.g), have = this.countMat(t.kind, t.g);
      if (have < t.n) return this.log(`${nm}不足，需要 ${t.n} 个（现有 ${have}）。`, "sys");
      this.takeMat(t.kind, t.g, t.n); t.done = true;
      const c = this.affairItemContrib(); s.contrib += c;
      this.log(`提交 ${nm} ×${t.n}，贡献 +${U.fmt(c)}。`, "good"); this.after();
    },
    affairFightMul(t) { return (CFG.sect.affairFight.GROUPS[t.grp] || {}).mul || 1; },
    affairFightWin(t) { const W = CFG.sect.affairFight.WIN, m = this.affairFightMul(t); return { stone: W.stone * m * this.sectInfo().star, contrib: W.contrib * m }; },
    affairFightRow(t) { return [t.realm, t.lay, 0, [1, t.pct, t.gf], [2, 0, 0], [3, 0, 0], 1]; },
    fightAffair(i) {
      this.affairGen(); const s = this.s, t = (s.affairFights || [])[i]; if (!s.sect || !t || t.done || t.failed) return;
      if (s.hp < this.stats().hp * CFG.battle.TOWER_HP_MIN) return this.log("生命不足三成，先休养片刻。", "sys");
      const b = DATA.mobRoll(this.affairFightRow(t), CFG.sect.affairFight.CRIT), v = (x, k) => x * DATA.mobRnd(k);
      const a = t.a >= 0 ? t.a : DATA.maps.findIndex(m => (m.monsters || []).includes(t.name));   // 地图序号：战斗画面按它找怪物图
      const m = this.addMagic({ name: t.name, a, boss: false, hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, "normal");
      const res = this.battle(m); let txt;
      if (res.win) { const w = this.affairFightWin(t); t.done = true; s.stone += w.stone; s.contrib += w.contrib;
        txt = `${res.rounds}回合击杀${t.name}，灵石 +${U.fmt(w.stone)}，贡献 +${U.fmt(w.contrib)}。`; }
      else { t.failed = true;   // 失败不扣灵石、贡献，但当天不能再执行
        txt = `未能击杀${t.name}${res.timeout ? "（回合耗尽）" : ""}，任务失败，今日无法再执行。`; }
      this.log(txt, res.win ? "good" : "bad");
      this.after();
      this.playBattle(res.detail, "特殊任务", txt, res.win, null, false, { tname: t.name });
    },
    setAffairTab(t) { this.affairTab = t; this.render(); },

    /* ---------- 免费修炼室 / 免费练功房（config/sect.js 的 freeRoom / freeGfRoom） ---------- */
    freeCultPct() { const p = CFG.sect.freeRoom.pct; return p ? p * this.starMul() : this.roomPct(0); },
    freeGfPct() { const p = CFG.sect.freeGfRoom.pct; return p ? p : this.gfRoomPct(0); },
    freeCultOn() { const f = this.s.freeCult; return !!(this.s.sect && f && f.on && f.left > 0); },
    freeGfOn() { const f = this.s.freeGf; return !!(this.s.sect && f && this.now() < f.end); },
    freeUsed(f) { return f && f.day === this.bjDay() ? f.used || 0 : 0; },
    /* ---------- 炼体池（config/sect.js 的 sect.pool） ---------- */
    poolCost(i) { const P = CFG.sect.pool, p = P.list[i]; return { contrib: Math.floor(p.contrib * P.STAR_MULT[this.sectInfo().star - 1]), hp: p.hp }; },
    poolGainOf(i, rnd) {
      // v237 基础值（GAIN 第 i 行）× STAR_GAIN^(宗门星级 − 1)；rnd = true 时每种再随机 ± RAND（进入炼体池时定下）
      const P = CFG.sect.pool, G0 = P.GAIN || [], g = G0[i] || G0[G0.length - 1] || [], o = {};
      const mul = Math.pow(P.STAR_GAIN === undefined ? 1.2 : P.STAR_GAIN, Math.max(0, this.sectInfo().star - 1)), R = P.RAND || 0;
      (P.list[i].keys || P.KEYS || ["hp", "atk", "def"]).forEach((k, j) => { if (!g[j]) return;
        const v = Math.round(g[j] * mul) + (rnd && R ? U.rand(-R, R) : 0); if (v > 0) o[k] = v; });
      return o;
    },
    poolUsed() { const p = this.s.pool; return p && p.day === this.bjDay() ? p.used || 0 : 0; },
    poolOn() { const p = this.s.pool; return !!(p && p.end > 0); },
    enterPool(i) {
      const s = this.s, P = CFG.sect.pool, d = P.list[i]; if (!d || !s.sect || this.poolOn()) return;
      if ((d.rank || 0) > s.rank) return this.log(`需要职务【${DATA.ranks[d.rank].name}】。`, "sys");
      if (this.poolUsed() >= P.DAILY) return this.log(`${P.name}今天已用过。`, "sys");
      const c = this.poolCost(i);
      if (s.contrib < c.contrib) return this.log("门派贡献不足。", "sys");
      if ((s.bodyExp || 0) < c.hp) return this.log("气血不足。", "sys");   // 消耗肉身气血
      s.contrib -= c.contrib; s.bodyExp -= c.hp;
      s.pool = { i, end: this.now() + P.MINUTES * 60000, gain: this.poolGainOf(i, true), day: this.bjDay(), used: this.poolUsed() + 1 };
      this.log(`进入${d.name}，消耗${c.contrib ? `贡献 ${U.fmt(c.contrib)}、` : ""}气血 ${U.fmt(c.hp)}。`, "good"); this.after();
    },
    poolTick() {
      const s = this.s, p = s.pool; if (!p || !p.end || this.now() < p.end) return;
      if (!s.poolGain) s.poolGain = {};
      const names = { hp: "生命", atk: "攻击", def: "防御", mana: "法力", hit: "命中", dodge: "闪避", crit: "暴击%", res: "抗性" }, txt = [];
      for (const k in p.gain || {}) { s.poolGain[k] = (s.poolGain[k] || 0) + p.gain[k]; txt.push(`${names[k] || k} +${U.fmt(p.gain[k])}`); }
      p.end = 0; this.dirty();
      this.log(`${(CFG.sect.pool.list[p.i] || {}).name || CFG.sect.pool.name}修炼完毕，肉身 ${txt.join("、")}。`, "gold");
    },
    // 北京时间 0 点：正在用的免费修炼室恢复满次数、免费练功房恢复满时长（算作当天那一次）
    freeRoomDaily() {
      const s = this.s, day = this.bjDay(), D = 86400000, B = 8 * 3600000, mid = Math.floor((this.now() + B) / D) * D - B;   // 今天北京时间 0 点
      const fc = s.freeCult, fg = s.freeGf;
      if (fc && fc.day && fc.day !== day && fc.left > 0) { Object.assign(fc, { day, used: 1, left: CFG.sect.freeRoom.times }); this.dirty(); }
      if (fg && fg.day && fg.day !== day && fg.end > mid) { Object.assign(fg, { day, used: 1, end: mid + CFG.sect.freeGfRoom.minutes * 60000 }); this.dirty(); }
    },
    /* ---------- v229 自动执行任务（修炼设置里开关）：每天北京时间 0:05 后执行一次；离线错过的话下次上线执行 ---------- */
    autoTask() {
      return this.s.autoTask || (this.s.autoTask = { day: "", free: false, gf: false, pool: false, poolI: 0, xiulian: false, shenhun: false, zhandou: false, ex: false, exT: "", cq: false, cqT: "" });
    },
    autoTaskAny() { const A = this.s.autoTask; return !!A && ["free", "gf", "pool", "xiulian", "shenhun", "zhandou", "cq"].some(k => A[k]); },
    autoTaskCheck() {
      if (!this.autoTaskAny()) return;
      const A = this.autoTask(), day = this.bjDay(), t = new Date(this.now() + 8 * 3600000);
      if (A.day === day || t.getUTCHours() * 60 + t.getUTCMinutes() < 5) return;
      A.day = day; this.runAutoTask(); this.dirty();
    },
    runAutoTask() {
      const s = this.s, A = this.autoTask(), log = m => this.log("【自动任务】" + m, "sys");
      if (s.sect) {
        if (A.free && !this.freeCultOn() && this.freeUsed(s.freeCult) < CFG.sect.freeRoom.daily) this.enterFreeRoom();
        if (A.gf && !this.freeGfOn() && this.freeUsed(s.freeGf) < CFG.sect.freeGfRoom.daily) this.enterFreeGfRoom();
        if (A.pool && !this.poolOn()) this.enterPool(A.poolI || 0);
      } else if (A.free || A.gf || A.pool) log("未加入宗门，跳过宗门任务。");
      this._autoQuiet = true;
      try { for (const d of ["xiulian", "shenhun", "zhandou"]) if (A[d] && this.wdCheck(d)) this.wudaoDone(d); } finally { this._autoQuiet = false; }
      const go = (tgt, cq) => { const p = (tgt || "").split(":").map(Number); if (!tgt) return log("没有选择地图。");
        if (cq) { const r = tgt[0] === "k" ? -1 : p[2];
          if (s.cq || (s.explore && s.explore.cq)) return log("正在出窍，跳过自动出窍。");
          if (!s.cqLearn || this.cqLeftToday() <= 0 || !this.realmOK(CFG.chuqiao.REALM)) return log("出窍条件不足或今天次数已用完。");
          if (r < 0 ? !this.mapOpen(p[1]) : !this.isTrained(p[1], r)) return log("所选地方还不能出窍。");
          this.startChuqiao(p[1], r, this.cqLeftToday());
        } else { if (s.explore) return log("正在探索，跳过自动探索。");
          if (!this.isTrained(p[1], p[2])) return log("所选区域还没历练通过。");
          this.toggleExplore(p[1], p[2], false); }
      };
      if (A.cq) go(A.cqT, true);            // v231 去掉了自动探索，只剩自动出窍
      this.after();
    },
    enterFreeRoom() {
      const s = this.s, C = CFG.sect.freeRoom;
      if (!s.freeCult) s.freeCult = { day: "", used: 0, left: 0, on: false };
      const f = s.freeCult;
      if (f.left > 0) { f.on = !f.on; if (f.on) s.room = -1; return this.after(); }              // 本次还没用完：进入 / 离开（进入时自动离开付费修炼室）
      if (this.freeUsed(f) >= C.daily) return this.log(`${C.name}今天已用过。`, "sys");
      Object.assign(f, { day: this.bjDay(), used: this.freeUsed(f) + 1, left: C.times, on: true }); s.room = -1;   // 自动离开付费修炼室
      this.log(`进入${C.name}，可修炼 ${C.times} 次。`, "good"); this.after();
    },
    enterFreeGfRoom() {
      const s = this.s, C = CFG.sect.freeGfRoom;
      if (!s.freeGf) s.freeGf = { day: "", used: 0, end: 0 };
      const f = s.freeGf;
      if (this.freeGfOn()) return;
      if (this.freeUsed(f) >= C.daily) return this.log(`${C.name}今天已用过。`, "sys");
      Object.assign(f, { day: this.bjDay(), used: this.freeUsed(f) + 1, end: this.now() + C.minutes * 60000 }); s.gfRoom = -1;   // 自动离开付费练功房
      this.log(`进入${C.name}，持续 ${C.minutes} 分钟。`, "good"); this.after();
    },

    /* ---------- 练功房 ---------- */
    enterRoom(i) {
      if (this.s.room !== i && this.roomLocked(i)) return this.log(`需要职务【${DATA.ranks[DATA.rooms[i].rank].name}】。`, "sys");
      this.s.room = this.s.room === i ? -1 : i;
      if (this.s.room >= 0 && this.s.freeCult) this.s.freeCult.on = false;   // 换到付费修炼室：免费修炼室暂停（剩余次数保留）
      this.after();
    },
    enterGfRoom(i) {
      if (this.s.gfRoom !== i && this.gfRoomLocked(i)) return this.log(`需要职务【${DATA.ranks[DATA.gfRooms[i].rank].name}】。`, "sys");
      this.s.gfRoom = this.s.gfRoom === i ? -1 : i; this.after();
    },
    /* ---------- 宗门宝库 ---------- */
    treasuryCost(it) { return it.kind === "chuqiao" ? this.cqCost() : it.kind === "cqzj" ? (CFG.cqzj.COST || [])[it.v - 1] || 0 : it.cost; },
    // 出窍真诀：第 v 卷名字 / 是否学会 / 已学会的卷合计减少的地图每步秒数
    cqzjName(v) { return `${CFG.cqzj.NAME}·第${"一二三四五六七八九十"[v - 1] || v}卷`; },
    cqzjHas(v) { return (this.s.cqZj || []).includes(v); },
    // 出窍真诀学到时间就学会（离线也补算）
    cqzjTick() { const s = this.s, L = s.cqzjL; if (!L || this.now() < L.end) return;
      s.cqzjL = null; s.cqZj = s.cqZj || []; if (!s.cqZj.includes(L.v)) s.cqZj.push(L.v);
      this.log(`习得${this.cqzjName(L.v)}！地图每步时间 -${U.num2(CFG.cqzj.SEC)} 秒。`, "gold"); this.dirty(); },
    cqzjSec() { return (this.s.cqZj || []).filter(v => v >= 1 && v <= (CFG.cqzj.COST || []).length).length * (CFG.cqzj.SEC || 0); },
    // 元婴出窍秘法（config/sect.js 的 CFG.chuqiao）
    cqCost() { return CFG.chuqiao.LEARN_CONTRIB; },
    cqMaxRuns() { return this.s.cqLearn ? this.s.ssPow || 0 : 0; },   // 每天次数 = 神识强度（shenshi.js 养神）
    // 今天还能出窍几次（开始出窍时就扣，停止不退）
    cqLeftToday() { const s = this.s; return Math.max(0, this.cqMaxRuns() - (s.cqDay === this.bjDay() ? s.cqUsed || 0 : 0)); },
    cqUse(n) { const s = this.s; if (s.cqDay !== this.bjDay()) { s.cqDay = this.bjDay(); s.cqUsed = 0; } s.cqUsed += n; },
    cqRefund(n) { const s = this.s; if (n > 0 && s.cqDay === this.bjDay()) s.cqUsed = Math.max(0, (s.cqUsed || 0) - n); },   // 跨天了就不用退（已经重置）
    // 杂物页货单：content/items.js 的 ITEMS.treasury
    treasuryList() { return ITEMS.treasury; },
    treasuryName(it) {
      if (it.item) return it.item;
      if (it.kind === "furnace") return DATA.furnaceName(it.fk, it.g);
      if (it.kind === "pill") return `${DATA.realms[this.r()]}·${DATA.pills[it.type].name}`;
      if (it.kind === "chuqiao") return CFG.chuqiao.NAME;
      if (it.kind === "cqzj") return this.cqzjName(it.v);
      return it.name || "灵石";
    },
    exchange(i) {
      const it = this.treasuryList()[i], c = this.treasuryCost(it);
      if (!it || !this.sectInfo() || this.s.contrib < c || (it.star || 1) > this.sectInfo().star) return;
      if (it.kind === "chuqiao") {
        const C = CFG.chuqiao;
        if (this.s.cqLearn || C.STAR > this.sectInfo().star) return;
        if (!this.realmOK(C.REALM)) return this.log(`${C.NAME}需要${DATA.realmLabel(C.REALM)}。`, "sys");
        this.s.contrib -= c; this.s.cqLearn = 1;
        this.log(`习得${C.NAME}！在世界地图点「出窍」探索，每天可出窍次数 = 神识强度（「修炼 → 神识」养神提升）。`, "gold");
        return this.after();
      }
      if (it.kind === "cqzj") {   // 出窍真诀：扣贡献后进功法学习队列，学完生效
        if (!(it.v >= 1 && it.v <= (CFG.cqzj.COST || []).length) || this.cqzjHas(it.v)) return;
        this.cqzjTick();
        if (this.s.cqzjL) return this.log(`正在学习${this.cqzjName(this.s.cqzjL.v)}，学完才能学下一卷。`, "sys");
        this.s.contrib -= c; this.s.cqzjL = { v: it.v, end: this.now() + (CFG.cqzj.LEARN_MIN || 10) * 60000 };
        this.log(`开始学习${this.cqzjName(it.v)}，需 ${U.dur((CFG.cqzj.LEARN_MIN || 10) * 60)}。`, "good");
        return this.after();
      }
      if (it.kind === "furnace") { if (!this.addFurnaceItem(it.fk, it.g)) return; }
      else if (it.kind === "pill") { if (!this.addPill(it.type, this.r())) return; }
      else this.s.stone += Math.floor(it.n * this.starMul());
      this.s.contrib -= c;
      this.log("兑换成功。", "good"); this.after();
    },
    setTreasuryTab(t) { this.treasuryTab = t; this.render(); },
    treasuryMaxG() { return this.sectInfo().star - 1; }, // 可兑换的最高 品/阶 序号
    // v42 宗门宝库的药材、矿石、种子：凡界全部 + 四界通用（matsOther.STAR 星起；特色药材、矿石不能换）
    //   返回 [{ g, lock }]，lock = 需要的星级（0 = 可换）
    treasuryMatList(kind) {
      const fanN = kind === "herb" ? DATA.FAN_HERB_N : DATA.FAN_ORE_N, names = kind === "herb" ? DATA.herbs : DATA.ores, O = CFG.matsOther || {}, star = this.sectInfo().star;
      return names.map((n, g) => g < fanN ? { g, lock: 0 } : (O.SPECIAL || []).includes(n) ? null : { g, lock: star >= (O.STAR || 6) ? 0 : (O.STAR || 6) }).filter(x => x && !x.lock);   // 本宗门星级兑换不了的不显示
    },
    treasuryMatOK(kind, g) { const x = this.treasuryMatList(kind).find(m => m.g === g); return !!x && !x.lock; },
    // 兑换材料（药材、矿石，凡界全部可换）；n 不填就用输入框里的数量
    exchangeMat(kind, g, n) {
      n = Math.floor(n || +($("#tr-n") && $("#tr-n").value) || 1);
      if (n <= 0 || !this.treasuryMatOK(kind, g)) return;
      const c = DATA.matContrib(kind, g) * n;
      if (this.s.contrib < c) return this.log(`贡献不足，需要 ${U.fmt(c)}。`, "sys");
      if (!this.addMat(kind, DATA.matName(kind, g), g, n)) return;
      this.s.contrib -= c; this.trN = n;
      this.log(`兑换${DATA.matFull(kind, g)} ×${U.fmt(n)}，贡献 -${U.fmt(c)}。`, "good"); this.after();
    },
    // 贡献兑换窗口：输入数量（数量记在 G.trN）
    openExchangeMat(kind, g) {
      if (!this.treasuryMatOK(kind, g)) return;
      const c = DATA.matContrib(kind, g), max = Math.floor(this.s.contrib / Math.max(1, c)), n = Math.max(1, Math.min(Math.floor(this.trN) || 1, max || 1)); this.trN = n;
      this.modal(`<h2>兑换${DATA.matName(kind, g)}</h2>
        <div class="line"><div>${DATA.li(DATA.matImg(kind, g))}${DATA.matFull(kind, g)}<small>${U.fmt(c)} 贡献/个 · 已有 ${U.fmt(this.countMat(kind, g))}</small></div></div>
        <div class="line"><div>兑换数量<small>需要贡献 ${U.fmt(c * n)} · 现有 ${U.fmt(this.s.contrib)} · 最多 ${U.fmt(max)}</small></div></div>
        <input type="number" min="1" max="${max}" value="${n}" oninput="G.trN=+this.value" onchange="G.openExchangeMat('${kind}',${g})">
        <div class="btns"><button class="primary" onclick="G.exchangeMat('${kind}',${g},G.trN)" ${max < 1 ? "disabled" : ""}>兑换</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 宝库材料互换：mode "two" 二换一（宝库可换的同类材料）；"four" 四界换凡界（SWAP_FOUR_STAR 星起）
    matSwapRate(mode) { const C = CFG.sect; return Math.max(1, mode === "four" ? C.SWAP_FOUR_RATE ?? 1 : C.SWAP_RATE ?? 2); },
    matSwapFourOK() { return this.sectInfo().star >= (CFG.sect.SWAP_FOUR_STAR ?? 6); },
    // 可拿去换 to 的材料：二换一 = 同一界的其他（凡界换凡界，四界通用换四界通用）；四界换凡界 = 所有四界（含特色），to 须是凡界
    matSwapFrom(kind, mode, to) {
      const fanN = kind === "herb" ? DATA.FAN_HERB_N : DATA.FAN_ORE_N, names = kind === "herb" ? DATA.herbs : DATA.ores;
      if (!this.treasuryMatOK(kind, to)) return [];
      if (mode === "four") return to < fanN && this.matSwapFourOK() ? names.map((n, g) => g).filter(g => g >= fanN) : [];
      return this.treasuryMatList(kind).map(x => x.g).filter(g => g !== to && (g < fanN) === (to < fanN));
    },
    matSwap(kind, mode, from, to, n) {
      if (!this.s.sect || !["herb", "ore"].includes(kind) || !["two", "four"].includes(mode)) return;
      from = +from; to = +to; n = Math.floor(+n || 0);
      if (n <= 0 || !this.matSwapFrom(kind, mode, to).includes(from)) return this.log("请选择要换的材料。", "sys");
      const r = this.matSwapRate(mode), need = r * n;
      if (this.countMat(kind, from) < need) return this.log(`${DATA.matName(kind, from)}不足，需要 ${U.fmt(need)} 个。`, "sys");
      this.takeMat(kind, from, need);
      if (!this.addMat(kind, DATA.matName(kind, to), to, n)) { this.addMat(kind, DATA.matName(kind, from), from, need); return; }
      this.log(`${DATA.matName(kind, from)} ×${U.fmt(need)} 换得 ${DATA.matName(kind, to)} ×${U.fmt(n)}。`, "good"); this.after();
    },
    // 互换窗口：上面是可拿出的材料（跟背包一样显示数量，点选），下面输入换得数量；选择存在 G.msw，不走服务器
    openMatSwap(kind, mode, to) {
      const w = this.msw = this.msw && this.msw.kind === kind && this.msw.mode === mode && this.msw.to === to ? this.msw : { kind, mode, to, from: -1, n: 1 };
      const froms = this.matSwapFrom(kind, mode, to), r = this.matSwapRate(mode), kn = DATA.matKinds[kind];
      if (!froms.includes(w.from) || this.countMat(kind, w.from) < r) w.from = froms.find(g => this.countMat(kind, g) >= r) ?? -1;
      const max = w.from >= 0 ? Math.floor(this.countMat(kind, w.from) / r) : 0;
      w.n = Math.max(1, Math.min(Math.floor(w.n) || 1, max || 1));
      const re = `G.openMatSwap('${kind}','${mode}',${to})`;
      const cells = froms.map(g => { const c = this.countMat(kind, g);
        return `<div class="cell q${Math.min(5, Math.floor(g / 2))}${g === w.from ? " sel" : ""}${c < r ? " off" : ""}" ${c >= r ? `onclick="G.msw.from=${g};${re}"` : ""}><img class="mi" src="${DATA.matImg(kind, g)}" alt="">${DATA.matName(kind, g)}<span class="n">${U.fmt(c)}</span></div>`; }).join("");
      this.modal(`<h2>兑换${DATA.matName(kind, to)}</h2>
        <p class="desc">${mode === "four" ? `${r} 个四界${kn}换 1 个${DATA.matName(kind, to)}` : `${r} 个相同的其他${kn}换 1 个${DATA.matName(kind, to)}`}，点选要拿出的${kn}</p>
        <div class="grid">${cells}</div>
        <div class="line"><div>兑换数量<small>${w.from >= 0 ? `消耗 ${DATA.matName(kind, w.from)} ×${U.fmt(w.n * r)} · 最多 ${U.fmt(max)}` : `没有足够的${kn}`}</small></div></div>
        <input type="number" min="1" max="${max}" value="${w.n}" oninput="G.msw.n=+this.value" onchange="${re}">
        <div class="btns"><button class="primary" onclick="G.matSwap('${kind}','${mode}',G.msw.from,${to},G.msw.n)" ${max < 1 ? "disabled" : ""}>兑换</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 兑换种子（每种一次，永久可种）
    exchangeSeed(g) {
      if (!this.treasuryMatOK("herb", g) || this.s.seeds.includes(g)) return;
      const c = DATA.seedCost(g); if (this.s.contrib < c) return;
      this.s.contrib -= c; this.s.seeds.push(g);
      this.log(`获得${DATA.herbs[g]}种子，可在洞府灵药园种植。`, "gold"); this.after();
    },
    // 兑换图纸：放进背包，点「学习」才能炼制
    exchangeBlueprint(kind, g) {
      const c = DATA.blueprintCost(kind, g), bp = this.s.blueprints[kind];
      if (DATA.blueprintStar(kind, g) > this.sectInfo().star || bp.includes(g) || this.s.contrib < c) return;
      if (this.s.bag.some(it => it.t === "bp" && it.kind === kind && it.g === g)) return this.log("背包里已有这张图纸。", "sys");
      if (!this.addBlueprintItem(kind, g)) return;
      this.s.contrib -= c;
      this.log(`获得${DATA.furnaceName(kind, g)}图纸，已放进背包（点击「学习」）。`, "gold"); this.after();
    },

    /* ---------- 试炼塔（v25：1~10 星，层数见 config/sect.js 的 sect.trial） ---------- */
    towerFloor() { return this.s.towers[this.sectInfo().star] || 0; },
    towerMax() { return DATA.towerMax(this.sectInfo().star); },
    // 守关者属性：config/mobs.js 的 tower（v221 按层数公式算，2 星起叠加上一星塔顶），见 DATA.towerStage
    makeTowerGuard(floor) {
      const tw = DATA.towerStage(this.sectInfo().star, floor, this.towerMax()), m = {};
      for (const k of DATA.REF_KEYS) m[k] = k === "res" ? tw[k] : tw[k] * DATA.mobRnd(k);   // 抗性在 addMagic 里每系单独随机
      m.crit = tw.crit; m.manaBr = tw.manaBr; m.L = tw.L; if (tw.resEl) m.res = tw.resEl;   // 六系分开
      const ER = CFG.mobs.tower.EL_RED || {}, er = ER[floor % 10]; if (er && ER.PCT) { m.elRed = {}; er.forEach(e => m.elRed[e] = ER.PCT); }   // 层数尾数对应的几系伤害减少
      return this.addMagic(Object.assign(m, { name: `第${floor}层守关者`, img: this.npcImg(`塔${this.sectInfo().star}_${floor}`, "rn"), boss: false }), "tower");
    },
    // 第 f 层的额外奖励：{ kind: "mijue", id } 试炼塔秘诀 / { kind: "ring", r } / { kind: "rbp", g } / { kind: "extra" }（v223）
    towerBonus(star, f) {
      const T = CFG.sect.trial, E = T.EVERY || 10, bk = DATA.towerBookAt(star, f);
      if (bk) return { kind: "mijue", id: bk };
      if (f % E) return null;
      const k = f / E, r = (T.RING || [])[star - 1];
      if (r !== undefined && r >= 0 && DATA.ringNames[r]) {
        if (k === 1) return { kind: "ring", r };       // 第 10 层：一阶戒指
        if (k <= 10) return { kind: "rbp", r, g: k - 1 }; // 第 20~100 层：二阶 ~ 十阶图纸
      }
      return { kind: "extra" };
    },
    towerDesc(star) {   // v223 塔的奖励说明
      const T = CFG.sect.trial, r = (T.RING || [])[star - 1], M = T.MIJUE || {}, i = star - 1, ev = (M.EVERY || [])[i] || 0, last = (M.LAST || [])[i] || 0, out = [];
      if (r !== undefined && r >= 0 && DATA.ringNames[r]) out.push(`第 10 层奖励${DATA.ringName(r, 0)}，第 20~100 层依次奖励它的二星~十星升级图纸`);
      if (ev > 0 && ((M.PCT || [])[i] || 0) > 0) out.push(`每 ${ev} 层奖励一本试炼塔秘诀`);
      if (last > 0) out.push(`登顶奖励一本试炼塔秘诀`);
      out.push(`其余每 ${T.EVERY || 10} 层奖励${DATA.HX} / 耀石 / 功德随机一种`);
      return "本塔" + out.join("，") + "。";
    },
    towerHasBook(id) { return !!(this.s.gongfa[id] || this.lqHas("gf", id) || this.s.bag.some(x => x.t === "gfb" && x.id === id)); },
    towerBonusText(b) { return !b ? "" : b.kind === "ring" ? DATA.ringName(b.r, 0) : b.kind === "rbp" ? DATA.ringBpName(b.g, b.r)
      : b.kind === "mijue" ? `《${DATA.gongfaInfo(b.id, 1).name}》` : `${DATA.HX} / 耀石 / 功德 随机一种`; },
    // 试炼塔秘诀：每次给下一本，放进背包（在背包里学习，占用神识；之后在「功法」页修炼升层）；给完后 火髓 / 耀石 / 功德 随机一种（config/sect.js 的 trial.EXTRA）
    giveTowerMijue(star, id) {   // v223 id = 这一层的秘诀（已有或没写 = 改给 火髓 / 耀石 / 功德）
      const s = this.s; if (id && this.towerHasBook(id)) id = null;
      if (id) { const nm = `《${DATA.gongfaInfo(id, 1).name}》`; if (this.bagFull()) return `${nm}（背包已满，未能放入）`; s.bag.push({ t: "gfb", id, n: 1 }); this.dirty(); return `${nm}（已放入背包）`; }
      const X = CFG.sect.trial.EXTRA || {}, kinds = ["fire", "ys", "merit"].filter(k => X[k]), k = kinds[U.rand(0, kinds.length - 1)];
      if (!k) return "";
      const r = X[k][star - 1] || X[k][X[k].length - 1], n = U.rand(r[0], r[1]);
      if (k === "merit") { s.merit = (s.merit || 0) + n; return `功德 +${U.fmt(n)}`; }
      if (k === "fire") return this.addFire(n) ? `${DATA.HX} ×${U.fmt(n)}` : "（背包已满）";
      const ft = U.rand(0, 5), name = DATA.smName("ys", ft);
      return this.addSm("ys", n, ft) ? `${name} ×${U.fmt(n)}` : "（背包已满）";
    },
    // 第 f 层首通的药材 / 矿石个数（各）和火髓个数：按段数，见 config/sect.js trial.floor
    towerMatFire(star, f) {
      const T = CFG.sect.trial, F = T.floor, tot = T.FLOORS[star - 1] || 100;
      const seg = n => Math.min(n, Math.max(1, Math.ceil(f / (tot / n))));
      const MS = F.MAT_SEG || 20, FS = F.FIRE_SEG || 10;
      return { mat: Math.round((F.MAT_BASE ?? 3) * star * seg(MS)), fire: Math.round((F.FIRE_BASE ?? 1) * star * seg(FS)) };
    },
    // 药材 / 矿石的序号池：1~FAN_STAR 星凡界 6 种（0~5），以上四界通用（6 起，不含各界特色）
    towerMatPool(star, kind) {
      const fan = Object.keys(CFG.mats[kind]).length, sp = (CFG.matsOther || {}).SPECIAL || [], all = kind === "herb" ? DATA.herbs : DATA.ores;
      if (star <= (CFG.sect.trial.floor.FAN_STAR ?? 5)) return [...Array(fan).keys()];
      const L = []; for (let g = fan; g < all.length; g++) if (!sp.includes(all[g])) L.push(g);
      return L.length ? L : [...Array(fan).keys()];
    },
    // 首通第 f 层的奖励，返回文字
    towerReward(f) {
      const s = this.s, star = this.sectInfo().star, T = CFG.sect.trial, F = T.floor, i = star - 1, out = [];
      const c = DATA.towerReward(f, star); s.contrib += c; out.push(`贡献 +${U.fmt(c)}`);
      const R = this.towerMatFire(star, f);
      if (R.fire && this.addFire(R.fire)) out.push(`${DATA.HX} ×${R.fire}`);
      const st = Math.floor((F.stone || 0) * this.starMul() * f); if (st) { s.stone += st; out.push(`灵石 +${U.fmt(st)}`); }
      for (const kind of ["herb", "ore"]) {
        if (!R.mat) continue;
        const pool = this.towerMatPool(star, kind), g = pool[U.rand(0, pool.length - 1)], name = DATA.matName(kind, g);
        if (this.addMat(kind, name, g, R.mat)) out.push(`${name} ×${R.mat}`);
      }
      const b = this.towerBonus(star, f);
      if (b && b.kind === "ring") { const e = DATA.rollForged("ring", 0, b.r); if (this.addEquip(e)) out.push(`<span class="q${e.q}">${DATA.ringName(b.r, 0)}</span>`); }
      else if (b && b.kind === "rbp") {
        if (this.ringKnown(b.r, b.g) || s.bag.some(x => x.t === "rbp" && x.g === b.g && x.r === b.r)) out.push(this.giveTowerMijue(star));   // 已有这张图纸 → 改给秘诀
        else if (this.bagFull()) out.push(this.giveTowerMijue(star));
        else { s.bag.push({ t: "rbp", r: b.r, g: b.g }); out.push(DATA.ringBpName(b.g, b.r)); }
      }
      else if (b) out.push(this.giveTowerMijue(star, b.kind === "mijue" ? b.id : null));
      return out.join("，");
    },
    // 点「挑战」：立即算出结果，打开战斗画面逐回合播放（3 秒后可跳过）
    /* ---------- v158 实力测试（试炼塔下面）：选境界 + 层，属性同地图普通怪；不扣生命、不自动结束 ---------- */
    // 同境界的地图普通怪那一行（功法星级 / 来源 / 层 / 倍率照抄），没有就用低一点境界的
    // v178 选凡界地图（9 张 × 东西南北）+ 怪物种类（普通 / 精英 / 首领），属性 = 该区域该种怪
    testPick() { if (!this._tp || this._tp.a === undefined) this._tp = { a: 0, k: "normal" }; return this._tp; },
    setTestPick(k, v) { this.testPick()[k] = v; this.render(); },
    testMapOpts() { const o = []; for (let a = 0; a < DATA.FAN_MAP_N; a++) DATA.regionDirs.forEach((d, r) => o.push([a * 4 + r, `${DATA.maps[a].name}·${d}`])); return o; },
    testMobT() { const p = this.testPick(), R = DATA.region(Math.floor(p.a / 4), p.a % 4); return (R._t || {})[p.k] || DATA.MOB_NONE; },
    testMobName() { const p = this.testPick(), o = this.testMapOpts().find(x => x[0] === p.a); return `${o ? o[1] : ""}·${DATA.MOB_KIND[p.k]}`; },
    // 怪物学的功法：按来源分组 [[来源名（宗门 / 坊市 / 功德司）, [功法名…], 类别, 学%]]，学 0% 的类别不列
    testMobGf(t) {
      const R = DATA.mobRow(t), out = [];
      for (const C of R.cats) { const ps = DATA.mobParts(C); if (!ps.length) continue;
        for (const sc of DATA.mobCatSrcs(C.c)) { const P = ps.find(([lo, hi]) => sc.star >= lo && sc.star <= hi); if (!P) continue; const l = [];
          for (const ty of DATA.gfTypesOf(sc.src, sc.star)) { if (sc.src === "shop" && ty.sectOnly) continue;
            const g = DATA.gongfaInfo(DATA.gongfaId(sc.id, ty.id), P[2].gf[1]); if (g) l.push(g.name); }
          if (l.length) out.push([sc.name, l, C.c, P[2].pct]); } }
      return out;
    },
    testFight() {
      const t = this.testMobT(), kd = this.testPick().k, b = DATA.mobRoll(t, DATA.mobCrit(DATA.MOB_KIND[kd]));   // v168 学哪些功法、每本几层随机
      const v = (x, k) => x * DATA.mobRnd(k);   // 和地图普通怪一样每项随机浮动
      const p = this.testPick(), a = Math.floor(p.a / 4), r = p.a % 4, mp = DATA.maps[a];   // v180 名字 / 图同地图里的怪（图按名字找）
      const nm = kd === "boss" ? DATA.regionBoss(a, r) : (kd === "elite" ? "精英·" : "") + U.pick(mp.monsters);
      const m = this.addMagic({ name: nm, a, kind: kd, elKey: kd === "boss" ? `b:${a}:${r}` : "", boss: kd === "boss", elite: kd === "elite", hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, kd);
      const res = this.battle(m, { test: true, foe: kd === "boss" ? "boss" : kd === "elite" ? "elite" : "mob" });
      this.playBattle(res.detail, "实力测试", "", true, [], false, { test: true, tname: this.testMobName() });
    },
    testView() {
      const p = this.testPick(), t = this.testMobT(), b = DATA.mobStats(t, DATA.mobCrit(DATA.MOB_KIND[p.k])), gf = this.testMobGf(t), M = (CFG.mobs.magic || {})[p.k] || {};
      const kOpts = Object.keys(DATA.MOB_KIND).map(k => [k, DATA.MOB_KIND[k]]), R = DATA.mobRow(t), rg = a => a[0] === a[1] ? `${a[0]}` : `${a[0]}~${a[1]}`;
      const n = gf.reduce((a, x) => a + x[1].length, 0);
      const st = [["生命", b.hp], ["攻击", b.atk], ["防御", b.def], ["速度", b.speed], ["命中", b.hit], ["闪避", b.dodge], ["法力", b.mana], ["抗性", b.res]].map(([k, v]) => `${k} ${U.fmt(v)}`).join("　") + `　暴击 ${U.num(b.crit)}%`;
      return `<div class="card"><h3>实力测试</h3>
        <div class="line"><div>对手</div><div class="sg-btns">${this.selBox("testA", this.testMapOpts(), p.a, v => this.setTestPick("a", +v))}${this.selBox("testK", kOpts, p.k, v => this.setTestPick("k", v))}</div></div>
        <p class="desc">${this.testMobName()}：${DATA.realms[R.realm] || ""}${R.lay[0] === R.lay[1] ? DATA.layerNames[R.lay[0] - 1] : `${rg(R.lay)}层随机`}（属性为平均值，战斗时攻击 ×${DATA.mobRandOf("atk").join("~")}、生命 ×${DATA.mobRandOf("hp").join("~")}、其他各项按配置单独随机）<br>${st}</p>
        <p class="desc">法术：每回合 ${M.spell ? M.spell.chance : 0}% 几率，伤害 攻击×${M.spell ? M.spell.pct : 0}%　法宝：每回合 ${M.fabao ? M.fabao.chance : 0}% 几率，伤害 攻击×${M.fabao ? M.fabao.pct : 0}%</p>
        ${n ? (() => { return `<details class="desc"><summary>功法：${R.cats.map(C => DATA.mobParts(C).map(([lo, hi, P]) => `${DATA.MOB_GF_CAT[C.c]} ${lo === hi ? lo : `${lo}~${hi}`}星每种学 ${rg(P.pct)}%、每本 ${rg(P.gf)} 层`).join("，")).filter(x => x).join("；")}（共 ${n} 部可选，显示属性为平均值）</summary>${gf.map(([nm, l]) => `<p><b>${nm}</b>：${l.join("、")}</p>`).join("")}</details>`; })() : `<p class="desc">功法：无</p>`}
        <div class="btns"><button onclick="G.testFight()">开始测试</button></div></div>`;
    },
    challengeTower() {
      if (!this.sectInfo()) return this.log("尚未加入门派。", "sys");
      const star = this.sectInfo().star, f = this.towerFloor() + 1; if (f > this.towerMax()) return;
      const st = this.stats();
      if (this.s.hp < st.hp * CFG.battle.TOWER_HP_MIN) return this.log("生命不足三成，先休养片刻。", "sys");
      const m = this.makeTowerGuard(f);
      const res = this.battle(m);
      let txt;
      if (res.win) {
        this.s.towers[star] = f;
        txt = `${res.rounds}回合击败${star}星试炼塔第 ${f} 层守关者，获得 ${this.towerReward(f)}。`;
      } else { txt = `挑战试炼塔第 ${f} 层失败${res.timeout ? "（回合耗尽，未能击败）" : ""}。`; }
      this.after();
      this.playBattle(res.detail, `试炼塔 · 第 ${f} 层`, txt, res.win, null, false, { tname: "" });   // v228 标题不再显示守关者名字   // 见 world.js
    },

    /* ---------- 讲道室（config/sect.js 的 jiangdao） ---------- */
    jdCfg() { return CFG.sect.jiangdao; },
    jdCost() { return (this.jdCfg().COST || 0) * this.sectInfo().star; },
    jdStatOf(k) { if (k.startsWith("res_")) return k; const t = DATA.gongfaTypes.find(x => x.id === k); return t ? t.stat : ""; },
    jdLabel(st) { return st.startsWith("res_") ? ((DATA.elById[st.slice(4)] || {}).name || "") + "抗" : DATA.QL_LABEL[st] || st; },
    jdVal(k) { const P = this.jdCfg().STAT || [25, 45], n = this.sectInfo().star; return [P[0] * n, P[1] * n]; },   // 加的属性 = 门派星数 × STAT 随机
    jdNeed(k) { const C = CFG.craftsman, c = this.craftInfo(k), E = C[k].EXP || C.EXP; return c.lv >= this.craftMax(k) ? 0 : E[c.lv - 1] ?? (64 + 32 * (c.lv - 1)) * 13 * c.lv; },
    jdExp(k) { const n = this.jdNeed(k), P = this.jdCfg().EXP_PCT || [5, 10]; return [Math.floor(n * P[0] / 100), Math.floor(n * P[1] / 100)]; },
    jdRoll(r) { return Math.floor(r[0] + Math.random() * (r[1] - r[0] + 1)); },
    jdRange(r) { return r[0] === r[1] ? U.fmt(r[0]) : `${U.fmt(r[0])}~${U.fmt(r[1])}`; },
    // 当天的长老按「日期 + 角色名 + 门派」固定随机：客户端、服务器算出来一样，刷新页面也不变
    jdRng(day) {
      let h = 2166136261; for (const c of `${day}|${this.s.name}|${this.s.sect}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
      return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },
    jdName(R) {
      const X = this.jdCfg().XING, fu = ["司马","上官","欧阳","夏侯","诸葛","闻人","东方","赫连","皇甫","尉迟","公羊","澹台","公冶","宗政","濮阳","淳于","单于","太叔","申屠","公孙","仲孙","轩辕","令狐","钟离","宇文","长孙","慕容","司徒","司空","端木","万俟"];
      const single = [...X.replace(new RegExp(fu.join("|"), "g"), "")];
      const pk = a => a[Math.floor(R() * a.length)];
      return (R() < 0.1 ? pk(fu) : pk(single)) + "长老";
    },
    jdBook(k, R) {   // 讲的功法名：本门星级随机门派的这一类功法（抗性 = 该属性门派的真经）
      const el = k.startsWith("res_") ? k.slice(4) : "", t = DATA.gongfaTypes.find(x => x.id === (el ? "zhenjue" : k)), all = DATA.sects.filter(x => x.star === this.sectInfo().star);
      const list = el && all.some(x => x.el === el) ? all.filter(x => x.el === el) : all;
      return t && list.length ? DATA.gongfaName(list[Math.floor(R() * list.length)], t) : t ? t.name : "";
    },
    jdState() {
      const s = this.s, day = this.bjDay(), J = this.jdCfg();
      if (!s.jd) s.jd = { log: [], got: {} };
      const d = s.jd;
      if (d.day !== day && !d.cur) {
        const R = this.jdRng(day), types = [...J.TYPES].map(k => [R(), k]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, J.LECTURES || 4);
        d.day = day;
        d.list = [{ k: "dan" }, { k: "qi" }, ...types.map(k => ({ k }))].map(x => Object.assign(x, { nm: this.jdName(R), book: x.k === "dan" ? "炼丹心得" : x.k === "qi" ? "炼器心得" : this.jdBook(x.k, R) }));
      }
      return d;
    },
    jdLeft() { const d = this.jdState(); return Math.max(0, (this.jdCfg().DAILY || 3) - d.list.filter(x => x.done).length); },
    listenJiang(i) {
      const s = this.s; if (!s.sect) return;
      this.jdSettle();
      const d = this.jdState(), L = d.list[i], day = this.bjDay();
      if (!L || L.done || d.cur) return;
      if (!this.jdLeft()) return this.log("今日听讲次数已用完。", "sys");
      const free = d.free !== day, c = free ? 0 : this.jdCost();
      if (s.contrib < c) return this.log("贡献不足。", "sys");
      s.contrib -= c; if (free) d.free = day;
      L.done = 1; d.cur = { i, end: this.now() + (this.jdCfg().MIN || 10) * 60000, k: L.k, nm: L.nm, book: L.book };
      this.log(`前往讲道室听取${L.nm}讲道${free ? "（今日免费）" : `，消耗贡献 ${U.fmt(c)}`}。`, "sys"); this.after();
    },
    jdSettle() {
      const d = this.s.jd; if (!d || !d.cur || this.now() < d.cur.end || !this.s.sect) return;
      const c = d.cur; d.cur = null;
      let gain;
      if (c.k === "dan" || c.k === "qi") {
        const n = this.jdRoll(this.jdExp(c.k)); this.addCraftExp(c.k, n);
        gain = `${c.k === "dan" ? "炼丹" : "炼器"}经验提高了：${U.fmt(n)}点`;
      } else {
        const st = this.jdStatOf(c.k), v = this.jdRoll(this.jdVal(c.k));
        d.got = d.got || {}; d.got[st] = (d.got[st] || 0) + v;
        gain = `自身${this.jdLabel(st)}提高了：${U.fmt(v)}点`;
      }
      const txt = `你在讲道室中听取${c.nm}分享的${c.k === "dan" || c.k === "qi" ? c.book : `修炼《${c.book}》的感悟心得`}，心有所感，大有收获，${gain}。`;
      d.log = [{ at: c.end, t: txt }, ...(d.log || [])].slice(0, this.jdCfg().LOG || 20);
      if (!this.silent) this.log(txt, "gold");
    },
    jdBonus() { return (this.s.jd && this.s.jd.got) || {}; },
  },

  view() {
    const s = this.s;
    // ---------- 未加入门派：按星级浏览 ----------
    if (!s.sect) {
      const star = this.sectStar || 1;
      const stars = Array.from({ length: DATA.SECT_STARS }, (_, i) => `<button class="${star === i + 1 ? "active" : ""}" onclick="G.setSectStar(${i + 1})">${i + 1}★</button>`).join("");
      return `<div class="room-grid five">${stars}</div><div class="card"><h3>${star} 星门派<small>需${DATA.realmLabel(DATA.sectReq(star))}</small></h3>` +
        DATA.sects.filter(x => x.star === star).map(x => {
          const lock = !this.realmOK(x.reqRealm);
          return `<div class="line"><div>${x.name}<span class="tag">${DATA.elById[x.el].name}</span><small>${DATA.elById[x.el].name}属性功法、法术 · 可学本星级全部门派功法</small></div>
            <button class="sm" onclick="G.joinSect('${x.id}')" ${lock ? "disabled" : ""}>${lock ? "境界不足" : "拜入"}</button></div>`;
        }).join("") + `</div>`;
    }

    // ---------- 已入门 ----------
    const x = this.sectInfo(), tab = this.sectTab || "hall";
    const TABS = [["hall", "宗门大殿"], ["lib", "功法殿"], ["affair", "事务堂"], ["room", "修炼室"], ["gfroom", "练功房"], ["pool", "炼体池"], ["treasury", "宗门宝库"],
                  ["alchemy", "炼丹房"], ["forge", "炼器室"], ["wudao", "秘法殿"], ["tower", "试炼塔"], ["jiangdao", "讲道室"]]
      .map(([k, n]) => [k, DATA.nmPick(CFG.names.sectHall, k, n)]);   // 名字在 config/names.js 的 sectHall
    let h = `<div class="card"><h3>${x.name} <span class="tag">${x.star}星</span><span class="tag">${DATA.elById[x.el].name}</span><small>${DATA.ranks[s.rank].name} · 贡献 ${U.fmt(s.contrib)}</small></h3></div>
      <div class="room-grid">${TABS.map(([k, n]) => `<button class="${tab === k ? "active" : ""}" onclick="G.setSectTab('${k}')">${n}</button>`).join("")}</div>`;

    if (tab === "hall") {
      const next = s.rank + 1 < DATA.ranks.length ? s.rank + 1 : -1, got = s.salaryDay === this.today();
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "hall", "宗门大殿")}<small>当前：${DATA.ranks[s.rank].name}</small></h3>
        <div class="line"><div>每日俸禄<small>${U.fmt(this.salary())} 灵石</small></div>
        <button class="sm" onclick="G.claimSalary()" ${got ? "disabled" : ""}>${got ? "今日已领" : "领取"}</button></div>
        ${this.isMaster() ? `<div class="line"><div>宗主俸禄 · ${DATA.qlName(s.sect)}<small>每天 1 颗 · ${DATA.qlTxt(s.sect)} · 已服 ${(s.qlEaten || {})[s.sect] || 0} / ${DATA.qlLimit(s.sect)}</small></div>
        <button class="sm" onclick="G.claimQl()" ${s.qlDay === this.today() ? "disabled" : ""}>${s.qlDay === this.today() ? "今日已领" : "领取"}</button></div>` : ""}
        ${next < 0 ? `<p class="desc">你已是一宗之主。</p>` : `<div class="line"><div>晋升【${DATA.ranks[next].name}】
          <small>需${DATA.realmLabel(this.rankReqRealm(next))} · ${U.fmt(this.rankCost(next))} 贡献 · ${s.rankPass === next ? "已通过考验" : "需先通过考验"}</small></div>
          <button class="sm" onclick="G.promote()" ${(s.rankPass !== next && !DATA.isTest()) || !this.realmOK(this.rankReqRealm(next)) || s.contrib < this.rankCost(next) ? "disabled" : ""}>晋升</button></div>
          <div class="line"><div>晋升考验 · ${DATA.ranks[next].name}考官<small>每次消耗 ${U.fmt(this.rankTrialCost(next))} 贡献 · 战斗胜利后才能晋升</small></div>
          <button class="sm ${s.rankPass === next ? "on" : ""}" onclick="G.challengeRank()" ${s.rankPass === next || !this.realmOK(this.rankReqRealm(next)) || s.contrib < this.rankTrialCost(next) ? "disabled" : ""}>${s.rankPass === next ? "已通过" : "考验"}</button></div>`}</div>
        ${this.isMaster() ? this.ccCard() : ""}
        <div class="card"><h3>职务一览</h3>${DATA.ranks.map((r, i) => `<div class="line"><div>${r.name}<small>俸禄 ${U.fmt(Math.floor(r.daily * this.starMul() * this.rankMul(i)))} 灵石 · 晋升 ${U.fmt(this.rankCost(i))} 贡献</small></div>${i === s.rank ? "<b>当前</b>" : i < s.rank ? "<small>已历</small>" : ""}</div>`).join("")}</div>
        <div class="btns"><button onclick="G.leaveSect()" ${s.contrib < this.leaveCost() ? "disabled" : ""}>叛出门派（贡献 ${U.fmt(this.leaveCost())}）</button></div>`;
    } else if (tab === "lib") {
      // 功法殿：本星级及以下全部门派的功法、法术（高星在前）；按 属性 筛选
      const el = this.libEl && this.libEl !== "all" ? this.libEl : x.el;
      const btn = g => this.gfLearnBtn(g, `G.learnGongfa('${g.id}')`, s.contrib < g.cost);
      const sects = DATA.sects.filter(o => o.star <= x.star && (el === "all" || o.el === el)).sort((p, q) => q.star - p.star);
      h += this.lqCard("gf") + `<div class="room-grid six">${DATA.elements.map(e => [e.id, e.name]).map(([k, n]) =>
          `<button class="${el === k ? "active" : ""}" onclick="G.setLibEl('${k}')">${n}</button>`).join("")}</div>` +
        U.doneCards(sects.map(o => ({ head: `<h3>${o.name}<span class="tag">${o.star}星</span><span class="tag">${DATA.elById[o.el].name}</span></h3>`, rows:
          DATA.gfTypesOf("sect", o.star).map(t => {
            const g = DATA.gongfaInfo(DATA.gongfaId(o.id, t.id));
            return [this.hasGongfa(g.id), `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${t.name}</span><small>每层${g.label} +${this.gfValue(g, g.perLv)}${g.label2 ? ` · ${g.label2} +${this.gfValue(g, g.perLv2)}` : ""} · ${U.fmt(g.cost)} 贡献 · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>${btn(g)}</div>`];
          }).concat([(() => {
            const g = DATA.spellInfo(DATA.spellId(o.id, o.el));
            return [this.hasGongfa(g.id), `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">法术</span><small>${this.spellDmgTxt(g)} · 耗法力 ${U.fmt(g.mana)} · ${U.fmt(g.cost)} 贡献 · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>${btn(g)}</div>`];
          })()]) })));
    } else if (tab === "affair") {
      const at = this.affairTab || "normal", fresh = s.affairDay === this.bjDay();
      h += `<div class="room-grid three">${[["normal", "普通任务"], ["item", "物品任务"], ["fight", "特殊任务"]].map(([k, n]) => `<button class="${at === k ? "active" : ""}" onclick="G.setAffairTab('${k}')">${n}</button>`).join("")}</div>`;
      if (at === "item") {
        h += `<div class="card"><h3>物品任务</h3>` +
          (!fresh ? `<p class="desc">任务刷新中…</p>` : s.affairItems.map((t, i) => { const nm = DATA.matName(t.kind, t.g), have = this.countMat(t.kind, t.g);
            return `<div class="line"><div>提交${t.kind === "herb" ? "药材" : "矿石"} · ${nm} ×${t.n}<small>现有 ${U.fmt(have)} · 贡献 +${U.fmt(this.affairItemContrib())}</small></div>
              <button class="sm" onclick="G.submitAffairItem(${i})" ${t.done || have < t.n ? "disabled" : ""}>${t.done ? "已完成" : have < t.n ? "数量不足" : "提交"}</button></div>`; }).join("")) + `</div>`;
      } else if (at === "fight") {
        h += `<div class="card"><h3>特殊任务</h3>` +
          (!fresh ? `<p class="desc">任务刷新中…</p>` : s.affairFights.map((t, i) => { const w = this.affairFightWin(t);
            return `<div class="line"><div>击杀 · ${t.name}<span class="tag">${DATA.realmLabel(t.realm)}</span><small>奖励 ${U.fmt(w.stone)} 灵石 ${U.fmt(w.contrib)} 贡献</small></div>
              <button class="sm" onclick="G.fightAffair(${i})" ${t.done || t.failed ? "disabled" : ""}>${t.done ? "已完成" : t.failed ? "已失败" : "执行"}</button></div>`; }).join("")) + `</div>`;
      } else {
      const a = s.affair, cur = a.task >= 0 ? DATA.affairs[a.task] : null;
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "affair", "事务堂")}<small>点任务开始，完成后自动继续，离线也进行</small></h3>` +
        (cur ? (() => { const T = cur.time * 60000, p = Math.min(100, (Date.now() - a.start) / T * 100);
          return `<div class="row small"><span>执行中：${cur.name}（已完成 ${a.count} 次）</span><span>${U.cd(Math.max(0, a.start + T - Date.now()) / 1000)}</span></div>
            <div class="bar tick"><div style="width:${p}%"></div></div>`; })() : `<p class="desc">当前没有执行任务。</p>`) +
        DATA.affairs.map((t, i) => { const lock = t.rank > s.rank, on = a.task === i;
          return `<div class="line"><div>${t.name}<span class="tag">${DATA.ranks[t.rank].name}</span><small>每次 ${U.dur(t.time * 60)} · 贡献 +${U.fmt(this.affairContrib(i))} · 灵石 +${U.fmt(this.affairStone(i))}</small></div>
            <button class="sm ${on ? "on" : ""}" onclick="G.startAffair(${i})" ${lock ? "disabled" : ""}>${lock ? "职务不足" : on ? "停止" : "执行"}</button></div>`; }).join("") + `</div>`;
      }
    } else if (tab === "room") {
      const FC = CFG.sect.freeRoom, fc = s.freeCult || {}, fcOn = this.freeCultOn(), fcLeft = fc.left > 0, fcDone = !fcLeft && this.freeUsed(fc) >= FC.daily;
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "room", "修炼室")}<small>加快修炼 · 每次修炼消耗贡献</small></h3>
        <div class="line"><div>${FC.name}<span class="tag">+${U.num(this.freeCultPct())}%</span><small>${fcLeft ? `本次剩余 ${fc.left} 次修炼` : `每天 ${FC.daily} 次 · 每次 ${FC.times} 次修炼 · 不消耗贡献`}</small></div>
          <button class="sm ${fcOn ? "on" : ""}" onclick="G.enterFreeRoom()" ${fcDone ? "disabled" : ""}>${fcOn ? "使用中" : fcDone ? "今日已用" : "进入"}</button></div>` + DATA.rooms.map((r, i) => {
        const on = s.room === i, lock = !on && this.roomLocked(i);
        return `<div class="line"><div>${r.name}<span class="tag">+${U.num(this.roomPct(i))}%</span>${r.rank ? `<span class="tag">${DATA.ranks[r.rank].name}专用</span>` : ""}<small>每次修炼消耗 ${U.fmt(this.roomCost(i))} 贡献</small></div>
          <button class="sm ${on ? "on" : ""}" onclick="G.enterRoom(${i})" ${lock ? "disabled" : ""}>${on ? "使用中" : lock ? "职务不足" : "进入"}</button></div>`;
      }).join("") + `</div>`;
    } else if (tab === "gfroom") {
      const FG = CFG.sect.freeGfRoom, fg = s.freeGf || {}, fgOn = this.freeGfOn(), fgDone = !fgOn && this.freeUsed(fg) >= FG.daily;
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "gfroom", "练功房")}<small>减少功法修炼时间 · 修炼功法时每 ${this.gfRoomSec()} 秒消耗贡献</small></h3>
        <div class="line"><div>${FG.name}<span class="tag">修炼时间 -${U.num(this.freeGfPct())}%</span><small>${fgOn ? `剩余 ${U.cd(Math.ceil((fg.end - this.now()) / 1000))}` : `每天 ${FG.daily} 次 · 每次 ${FG.minutes} 分钟 · 不消耗贡献`}</small></div>
          <button class="sm ${fgOn ? "on" : ""}" onclick="G.enterFreeGfRoom()" ${fgOn || fgDone ? "disabled" : ""}>${fgOn ? "使用中" : fgDone ? "今日已用" : "进入"}</button></div>` + DATA.gfRooms.map((r, i) => {
        const on = s.gfRoom === i, lock = !on && this.gfRoomLocked(i);
        return `<div class="line"><div>${r.name}<span class="tag">修炼时间 -${U.num(this.gfRoomPct(i))}%</span>${r.rank ? `<span class="tag">${DATA.ranks[r.rank].name}专用</span>` : ""}<small>每 ${this.gfRoomSec()} 秒消耗 ${U.fmt(this.gfRoomCost(i))} 贡献</small></div>
          <button class="sm ${on ? "on" : ""}" onclick="G.enterGfRoom(${i})" ${lock ? "disabled" : ""}>${on ? "使用中" : lock ? "职务不足" : "进入"}</button></div>`;
      }).join("") + `<p class="desc">只在功法修炼队列有功法在修炼时才消耗；功法修炼时间缩短，消耗的修为不变。</p></div>`;
    } else if (tab === "pool") {
      const P = CFG.sect.pool, p = s.pool, on = this.poolOn(), done = !on && this.poolUsed() >= P.DAILY;
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "pool", P.name)}<small>每天 ${P.DAILY} 次 · 每次 ${P.MINUTES} 分钟</small></h3>` + P.list.map((d, i) => {
        const me = on && p.i === i, lock = (d.rank || 0) > s.rank, c = this.poolCost(i), gn = this.poolGainOf(i);
        const gt = Object.keys(gn).map(k => ({ hp: "生命", atk: "攻击", def: "防御", mana: "法力", hit: "命中", dodge: "闪避", crit: "暴击%", res: "抗性" }[k] || k)).join("、");
        const gtx = gt ? `增加${gt}` : "";
        return `<div class="line"><div>${d.name}${d.rank ? `<span class="tag">${DATA.ranks[d.rank].name}专用</span>` : ""}<small>${me ? `剩余 ${U.cd(Math.ceil((p.end - this.now()) / 1000) + 59)} · ` : ""}${gtx} · 消耗${c.contrib ? `贡献 ${U.fmt(c.contrib)} ` : ""}气血 ${U.fmt(c.hp)}</small></div>
          <button class="sm ${me ? "on" : ""}" onclick="G.enterPool(${i})" ${on || done || lock ? "disabled" : ""}>${me ? "修炼中" : lock ? "职务不足" : done ? "今日已用" : "进入"}</button></div>`;
      }).join("") + `</div>`;
    } else if (tab === "treasury") {
      const tt = this.treasuryTab || "pill", maxG = this.treasuryMaxG();
      h += `<div class="sub-tabs">${[["pill", "杂物"], ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore], ["seed", "种子"], ["bp", "图纸"]].map(([k, n]) =>
        `<button class="${tt === k ? "active" : ""}" onclick="G.setTreasuryTab('${k}')">${n}</button>`).join("")}</div>`;
      if (tt === "pill") {
        h += `<div class="card"><h3>杂物<small>以贡献兑换 · 炉子放进背包后点「使用」</small></h3>` + U.doneLast(this.treasuryList().map((it, i) => {
          if (!it) return [0, ""];
          if (it.kind === "chuqiao") {
            const C = CFG.chuqiao, has = !!s.cqLearn, c = this.cqCost(), rl = !this.realmOK(C.REALM), sl = C.STAR > x.star;
            return [has, `<div class="line"><div>${DATA.li(DATA.iconImg("mifa"))}<span class="q4">${C.NAME}</span>
              <small>出窍探索时可继续修炼 · 每天出窍次数 = 神识强度 · 需${DATA.realmLabel(C.REALM)} · ${U.fmt(c)} 贡献</small></div>
              <button class="sm" onclick="G.exchange(${i})" ${has || rl || sl || s.contrib < c ? "disabled" : ""}>${has ? "已学会" : sl ? `${C.STAR}星宗门可兑换` : rl ? "境界不足" : "兑换"}</button></div>`];
          }
          if (it.kind === "cqzj") {
            const has = this.cqzjHas(it.v), c = this.treasuryCost(it), L = s.cqzjL, me = L && L.v === it.v, ms = (CFG.cqzj.LEARN_MIN || 10) * 60000, left = me ? Math.max(0, L.end - this.now()) : 0;
            return [has, `<div class="line"><div>${DATA.li(DATA.iconImg("mifa"))}<span class="q4">${this.cqzjName(it.v)}</span>
              <small>学会后地图每步时间 -${U.num2(CFG.cqzj.SEC)} 秒 · 学习 ${U.dur((CFG.cqzj.LEARN_MIN || 10) * 60)} · ${U.fmt(c)} 贡献</small></div>
              ${has ? `<button class="sm" disabled>已学会</button>` : me ? `<button class="sm pg" disabled>${this.pgFill(left, ms)}<span>学习中 ${U.cd(left / 1000)}</span></button>`
                : `<button class="sm" onclick="G.exchange(${i})" ${L || s.contrib < c ? "disabled" : ""}>${L ? "学习中" : "学习"}</button>`}</div>`];
          }
          const c = this.treasuryCost(it), lock = (it.star || 1) > x.star;
          const desc = it.kind === "furnace" ? `${it.fk === "dan" ? "炼丹" : "炼器"}时间 -${DATA.furnaceBonus(it.fk, it.g)}% · `
            : "";
          const img = it.kind === "furnace" ? DATA.furnaceIcon(it.fk) : it.kind === "pill" ? DATA.pillIcon(it.type) : DATA.iconImg("stone");
          return [0, `<div class="line"><div>${DATA.li(img)}${this.treasuryName(it)}<small>${desc}${U.fmt(c)} 贡献</small></div>
            <button class="sm" onclick="G.exchange(${i})" ${lock || s.contrib < c ? "disabled" : ""}>${lock ? `${it.star}星宗门可兑换` : "兑换"}</button></div>`];
        })) + `</div>`;
      } else if (tt === "seed") {
        h += `<div class="card"><h3>灵药种子<small>每种兑换一次</small></h3>` + this.treasuryMatList("herb").map(({ g, lock }) => { const n = DATA.herbs[g], c = DATA.seedCost(g), has = s.seeds.includes(g);
          return `<div class="line"><div>${DATA.li(DATA.matImg("herb", g))}${n}种子<small>${U.fmt(c)} 贡献 · ${U.dur(DATA.growTime(g) / 1000)}成熟</small></div>
            <button class="sm" onclick="G.exchangeSeed(${g})" ${has || lock || s.contrib < c ? "disabled" : ""}>${has ? "已拥有" : lock ? `${lock}星宗门可兑换` : "兑换"}</button></div>`; }).join("") + `</div>`;
      } else if (tt === "bp") {
        h += U.doneCards(DATA.FURNACE_KINDS.map(k => ({ head: `<h3>${DATA.furnaces[k].name}图纸<small>放进背包后点「学习」</small></h3>`, rows: DATA.JIE.slice(0, DATA.DAN_JIE_N).map((jn, g) => g).filter(g => DATA.blueprintStar(k, g) <= x.star).map(g => {   // 只显示本宗门星级能兑换的
          const c = DATA.blueprintCost(k, g), has = s.blueprints[k].includes(g) || s.bag.some(it => it.t === "bp" && it.kind === k && it.g === g), need = DATA.blueprintStar(k, g), lock = need > x.star;
          return [s.blueprints[k].includes(g), `<div class="line"><div>${DATA.li(DATA.iconImg("bp"))}${DATA.furnaceName(k, g)}图纸<small>${U.fmt(c)} 贡献</small></div>
            <button class="sm" onclick="G.exchangeBlueprint('${k}',${g})" ${has || lock || s.contrib < c ? "disabled" : ""}>${has ? (s.blueprints[k].includes(g) ? "已学会" : "在背包") : lock ? `${need}星宗门可兑换` : "兑换"}</button></div>`]; }) })));
      } else {
        const kn = DATA.matKinds[tt], ml = this.treasuryMatList(tt), fanN = tt === "herb" ? DATA.FAN_HERB_N : DATA.FAN_ORE_N;
        const row = (g, sub, btn) => `<div class="line"><div>${DATA.li(DATA.matImg(tt, g))}${DATA.matFull(tt, g)}<small>${sub} · 已有 ${U.fmt(this.countMat(tt, g))}</small></div>${btn}</div>`;
        h += `<div class="card"><h3>贡献兑换<small>贡献 ${U.fmt(s.contrib)}</small></h3>` + ml.map(({ g, lock }) => { const c = DATA.matContrib(tt, g);
          return row(g, `${U.fmt(c)} 贡献/个`, `<button class="sm" onclick="G.openExchangeMat('${tt}',${g})" ${lock || s.contrib < c ? "disabled" : ""}>${lock ? `${lock}星宗门可兑换` : "兑换"}</button>`); }).join("") + `</div>`;
        h += `<div class="card"><h3>二换一<small>${this.matSwapRate("two")} 个相同的其他${kn}换 1 个</small></h3>` + ml.map(({ g }) =>
          row(g, `${this.matSwapRate("two")} 个其他${g < fanN ? "凡界" : "四界"}${kn}换 1 个`, `<button class="sm" onclick="G.openMatSwap('${tt}','two',${g})">兑换</button>`)).join("") + `</div>`;
        if (this.matSwapFourOK()) h += `<div class="card"><h3>四界换凡界<small>${this.matSwapRate("four")} 个四界${kn}换 1 个凡界${kn}</small></h3>` + ml.filter(({ g }) => g < fanN).map(({ g }) =>
          row(g, `${this.matSwapRate("four")} 个四界${kn}换 1 个`, `<button class="sm" onclick="G.openMatSwap('${tt}','four',${g})">兑换</button>`)).join("") + `</div>`;
      }
    } else if (tab === "alchemy") {
      h += this.sectAlchemyView(); // 见 craft.js
    } else if (tab === "wudao") {
      h += this.sectWudaoView();   // 见 wudao.js
    } else if (tab === "forge") {
      h += this.sectForgeView();   // 见 craft.js
    } else if (tab === "tower") {
      const star = x.star, cur = this.towerFloor(), max = this.towerMax(), f = cur + 1, done = cur >= max, T = CFG.sect.trial, F = T.floor;
      // 下一个每 10 层的奖励
      const E = T.EVERY || 10, nb = Math.ceil(f / E) * E, bonus = nb <= max ? this.towerBonus(star, nb) : null;
      h += `<div class="card"><h3>${star}星试炼塔<small>已通关 ${cur} / ${max} 层</small></h3>
        ${done ? `<p class="desc">你已登顶试炼塔！</p>` : `<div class="line"><div>第 ${f} 层守关者<small>首通：贡献 +${U.fmt(DATA.towerReward(f, star))}、${DATA.HX} ×${this.towerMatFire(star, f).fire}、灵石 +${U.fmt(Math.floor((F.stone || 0) * this.starMul() * f))}、药材 ×${this.towerMatFire(star, f).mat}、矿石 ×${this.towerMatFire(star, f).mat}</small></div>
        <button class="sm" onclick="G.challengeTower()">挑战</button></div>`}
        ${bonus ? `<p class="desc">第 ${nb} 层额外奖励：${this.towerBonusText(bonus)}</p>` : ""}
        <p class="desc">进度按门派星级记录，换门派不会重置。${this.towerDesc(star)}</p></div>`;
      h += this.testView();
    } else if (tab === "jiangdao") {
      this.jdSettle();
      const d = this.jdState(), day = this.bjDay(), free = d.free !== day, c = this.jdCost(), cur = d.cur, left = this.jdLeft();
      h += `<div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "jiangdao", "讲道室")}<small>今日还可听 ${left} 次 · ${free ? "本次免费" : `每次 ${U.fmt(c)} 贡献`}</small></h3>
        <p class="desc">每天都有长老在讲道室分享修炼心得，每天可听 ${this.jdCfg().DAILY || 3} 位不同长老，第一次免费，每次听讲 ${this.jdCfg().MIN || 10} 分钟。炼丹、炼器长老每天必到，其余长老讲授功法感悟。</p>
        ${cur ? `<p class="desc">正在听取${cur.nm}讲道 · 约 ${U.cd(Math.max(0, cur.end - this.now()) / 1000)} 后结束</p>` : ""}` +
        d.list.map((L, i) => {
          const craft = L.k === "dan" || L.k === "qi";
          const btn = L.done ? `<button class="sm" disabled>${cur && cur.i === i ? "听讲中" : "已听讲"}</button>` :
            `<button class="sm" onclick="G.listenJiang(${i})" ${cur || !left || (!free && s.contrib < c) ? "disabled" : ""}>${free ? "免费听讲" : "听讲"}</button>`;
          return `<div class="line"><div>${L.nm}<span class="tag">${craft ? (L.k === "dan" ? "炼丹" : "炼器") : "功法"}</span>
            <small>${L.nm}将会分享${craft ? `自身${L.book}` : `自身修炼《${L.book}》的心得感悟`}，有意者可前往听取。</small></div>${btn}</div>`;
        }).join("") + `</div>`;
      const log = d.log || [];
      h += `<div class="card"><h3>闻道日志</h3>${log.length ? log.map(x => `<p class="desc">${x.t}</p>`).join("") : `<p class="desc">还没有听过讲道。</p>`}</div>`;
    }
    return h;
  },
});
