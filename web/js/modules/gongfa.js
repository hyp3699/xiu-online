/* =====================================================================
 * 模块：功法栏（功法 + 法术）
 * ---------------------------------------------------------------------
 * - 只显示已学会的，可按 心法/功诀/真经/秘诀/身法/法诀/法术 分类查看
 * - 已学会的功法全部生效，加成为固定数值
 * - 法术需放进背包“法术”栏才会在战斗中施放
 * - 每部 12 层，学会时为第 1 层
 * - 修炼升层需要时间，修炼期间每 5 秒消耗一次灵气（v246；灵气不够就暂停，等有灵气再继续）
 * - 修炼队列最多 15 个，当前这部练完自动开始下一个；离线也会继续
 * 存档字段：
 *   gongfa:  { "s1_0:mijue": 3, "s1_0:sp:huo": 1, ... }  已学 → 层数
 *   gfStudy: { id, total, done, at, per, spent } | null
 *            正在修炼：总时长、已修炼时长（毫秒）、上次结算时间、每 5 秒消耗、已消耗灵气
 *   gfQueue: [id, ...]   排队中的（同一部可排多次，每次升一层）
 * 学习入口在门派“功法殿”（modules/sect.js）。
 * ===================================================================== */
G.module({
  id: "gongfa",
  tab: "gongfa",

  defaults: () => ({ gongfa: {}, gfStudy: null, gfQueue: [], gfLearn: null, lq: { gf: [], dan: [], forge: [] } }),   // gfLearn：正在学习（首次习得）{ id, end }

  // 每 10 秒结算修炼：按 5 秒一步扣灵气、累计进度
  tick() {
    const s = this.s, STEP = DATA.STUDY_STEP * 1000;
    this.lqTick("gf");   // v173 学习（首次习得）+ 学习队列
    if (!s.gfStudy) this.nextStudy();
    while (s.gfStudy) {
      const st = s.gfStudy;
      if (st.ling !== 1) { const inf = DATA.skillInfo(st.id, s.gongfa[st.id] || 1); if (inf) st.per = DATA.studyPer(inf); st.spent = 0; st.ling = 1; }   // v246 旧存档：正在修炼的改成按灵气算
      // v247 每 10 秒结算一次（= 2 个 5 秒单位）；消耗仍按 5 秒单位计，最后不足 10 秒只扣剩下的单位，每层总消耗不变
      // 练功房：先把练功房 % 加进秘法/经脉减少%里一起除，进度 × mul，每单位灵气同比例多扣，总消耗不变
      let R = this.gfRoomNow(DATA.skillInfo(st.id, s.gongfa[st.id] || 1));
      const mul = R ? R.mul : 1, per = this.ssGfPer(st.per * mul);   // 神识功法《敛息归元诀》减灵气
      const rem = Math.ceil((st.total - st.done) / (STEP * mul));
      // 最后不足 10 秒的一段：倒计时到 0 立刻结算，不再等满 10 秒
      const fin = !st.stalled && this.now() >= st.at + rem * STEP && rem < 2;
      const steps = fin ? 1 : Math.floor((this.now() - st.at) / (2 * STEP));
      if (steps <= 0) break;
      st.at += fin ? rem * STEP : steps * 2 * STEP;
      // 灵气（秘法还要灵石）够几次就走几次；灵气不够且开了自动补充：用灵石补（秘法要的灵石先留够）；补到灵气上限为止，不超过 lingCap()（同 tick 里功法最先补，修为 / 肉身后补时按剩余容量算）
      const sp = (st.stone || 0) * mul, want = Math.min(2 * steps, rem);
      if (s.ling < want * per && s.array && s.array.autoRefill) { const keep = sp ? want * sp : 0, rate = this.lingPerStone(), cap = this.lingCap(), pay = Math.min(Math.ceil((want * per - s.ling) / rate), Math.floor(s.stone - keep), Math.max(0, Math.ceil((cap - s.ling) / rate)));
        if (pay > 0) { s.stone -= pay; s.ling = Math.min(cap, s.ling + pay * rate); } }
      // 灵石为负时 Math.floor(负数 / sp) 为负，can 为负会倒扣灵气 / 倒加进度：
      // 先钳到 0，灵石不够就暂停，不再推进。
      let can = Math.max(0, Math.min(want, per > 0 ? Math.floor(s.ling / per) : Infinity, sp ? Math.floor(s.stone / sp) : Infinity));   // per 可能被《敛息归元诀》减到 0：灵气 0 时 0/0 = NaN
      if (can < rem && can % 2) can--;   // 只按整 10 秒走（最后一次除外）
      s.ling -= can * per; st.spent += can * per; st.done = can >= rem ? st.total : Math.min(st.total, st.done + can * STEP * mul);
      if (sp) {   // 秘法灵石：按已走的 5 秒单位四舍五入累计，这层走完正好扣满 sc
        const C = st.sc || Math.round(st.stone * Math.ceil(st.total / STEP)); st.su = (st.su || 0) + can * mul;
        const tgt = st.done >= st.total ? C : Math.min(C, Math.round(st.stone * st.su)), pay = Math.max(0, tgt - (st.spentStone || 0));
        s.stone -= pay; st.spentStone = (st.spentStone || 0) + pay; }
      // 练功房贡献改为按分钟扣（modules/sect.js roomBill）
      st.stalled = can < want && st.done < st.total;   // 灵气 / 灵石不够，暂停
      if (st.done < st.total) { if (!st.stalled && can > 0) continue; break; }   // 还差最后一段且已到点：接着结算
      // 完成，升一层
      s.gongfa[st.id] = (s.gongfa[st.id] || 1) + 1;
      const info = DATA.skillInfo(st.id, s.gongfa[st.id]);
      if (this._off) this._off.gfUp[`《${info.name}》`] = info.lv;   // v173 离线账本
      this.log(`修炼有成，《${info.name}》提升至第 ${info.lv} 层！共消耗灵气 ${U.fmt(st.spent)}${st.spentStone ? `、灵石 ${U.fmt(st.spentStone)}` : ""}。`, "gold");
      s.gfStudy = null; this.dirty();
      this.nextStudy(st.at);
    }
  },

  api: {
    // 开始学习（已付过贡献 / 灵石）：进学习队列，轮到后等 LEARN_MIN 分钟习得第 1 层
    startGfLearn(id) {
      const g = DATA.skillInfo(id); if (!g) return;
      this.lqAdd("gf", { id, k: "gf", ms: DATA.gfLearnMin(g.star) * 60000 });
    },
    // 功法殿 / 坊市 / 功德司的学习按钮
    gfLearnBtn(g, on, poor) {
      if (this.hasGongfa(g.id)) return `<button class="sm" disabled>已学会</button>`;
      return this.lqBtn("gf", g.id, on, poor);
    },

    /* ---------- v173 学习队列 ----------
     * 三条队列各自独立：gf 功法 / 法术 / 秘法 / 背包秘诀，dan 丹方，forge 炼器图谱 / 背包图纸
     * 正在学的放在 s.gfLearn / s.danStudy / s.forgeStudy（{ id 或 key, end, ms, k }），后面排队的在 s.lq[队列]
     * 点学习就扣费，不能取消；排队最多 CFG.gongfa.LEARN_Q.MAX 个（不算正在学的）；前一个学完，下一个接着开始（离线也是） */
    lqSlot(ch) { return { gf: "gfLearn", dan: "danStudy", forge: "forgeStudy" }[ch]; },
    lqMax() { const Q = CFG.gongfa.LEARN_Q || {}; return Q.MAX === undefined ? 5 : Q.MAX; },
    lqList(ch) { const s = this.s; if (!s.lq) s.lq = {}; return s.lq[ch] || (s.lq[ch] = []); },
    lqKey(x) { return x.id !== undefined ? x.id : x.key; },
    // 0 = 没有，1 = 正在学，2 = 排队中
    lqHas(ch, key) { const c = this.s[this.lqSlot(ch)]; if (c && this.lqKey(c) === key) return 1; return this.lqList(ch).some(x => this.lqKey(x) === key) ? 2 : 0; },
    lqFull(ch) { return !DATA.isTest() && !!this.s[this.lqSlot(ch)] && this.lqList(ch).length >= this.lqMax(); },
    // 能不能再加一个（不能就提示）
    lqCan(ch, key) {
      if (this.lqHas(ch, key)) { this.log("已经在学习 / 排队中了。", "sys"); return false; }
      if (this.lqFull(ch)) { this.log(`学习队列已满（最多排队 ${this.lqMax()} 个）。`, "sys"); return false; }
      return true;
    },
    lqName(x) {
      const k = x.k;
      if (k === "xd") return this.xdName(x.xk, x.src, x.id, x.v);   // 心得（world.js）
      if (k === "dan" || k === "dfb" || (!k && x.key && x.key.includes("|"))) { const [t, g] = x.key.split("|"); return `丹方《${DATA.danName(t, +g)}》`; }
      if (k === "bp") return DATA.furnaceName(x.kind, x.g) + "图纸";
      if (k === "rbp") return DATA.ringBpName(x.g, x.r);
      if (k === "bmbp") return this.bmCfg().MIFA;
      if (k === "zfbp") return this.zfBpName(x.kind, x.g);
      if (x.key !== undefined) return this.forgeKeyName(x.key);
      const g = DATA.skillInfo(x.id, 1); return g ? `《${g.name}》` : "功法";
    },
    // 学习总时间（毫秒）：加入队列时记在 x.ms
    lqMs(ch, x) { return x.ms; },
    // 加入（调用前已扣费）：空着就马上开始，否则排队
    lqAdd(ch, x) {
      const s = this.s, sl = this.lqSlot(ch);
      if (DATA.isTest()) x = Object.assign({}, x, { ms: 0 });   // 测试模式学习瞬间完成
      else if (ch === "gf" && this.oriSum && this.oriSum("gfStudyPct")) x = Object.assign({}, x, { ms: Math.round(x.ms * Math.max(0, 1 - this.oriSum("gfStudyPct") / 100)) });   // 出身「书香门第」
      if (!s[sl]) { s[sl] = Object.assign({}, x, { end: this.now() + x.ms }); this.log(`开始学习${this.lqName(x)}，需 ${U.dur(x.ms / 1000)}。`, "good"); }
      else { this.lqList(ch).push(x); this.log(`${this.lqName(x)}已加入学习队列（排第 ${this.lqList(ch).length} 个）。`, "good"); }
      this.lqTick(ch); this.dirty();
    },
    // 到时间就学会，下一个从上一个学完的时刻开始（离线补算也对）
    lqTick(ch) {
      const s = this.s, sl = this.lqSlot(ch); let c, guard = 0;
      while ((c = s[sl]) && this.now() >= c.end && guard++ < 100) {
        s[sl] = null; this.lqDone(ch, c);
        const q = this.lqList(ch);
        if (q.length) { const n = q.shift(); s[sl] = Object.assign({}, n, { end: c.end + this.lqMs(ch, n) }); }
      }
    },
    // 背包里正在学 / 排队的那本（学完才从背包消失）
    lqBagIdx(c) { return this.s.bag.findIndex(it => it && it.lq && it.t === c.k && (c.k === "gfb" ? it.id === c.id : c.k === "bmbp" ? true : c.k === "dfb" ? it.type === c.type && it.g === c.g : it.kind === c.kind && it.g === c.g && it.r === c.r)); },
    lqDone(ch, c) {
      const s = this.s, name = this.lqName(c);
      if (c.k === "gfb" || c.k === "bp" || c.k === "rbp" || c.k === "dfb" || c.k === "bmbp" || c.k === "zfbp") { const i = this.lqBagIdx(c); if (i >= 0) { const it = s.bag[i]; this.removeAt(i, 1); if (s.bag[i] === it) delete it.lq; } }   // 叠在一起的只用掉一个
      if (c.k === "xd") { this.xdLearnDone(c); if (this._off) this._off.learn.push(name); this.dirty(); return; }
      if (ch === "gf") {
        s.gongfa[c.id] = Math.max(1, s.gongfa[c.id] || 0);
        const info = DATA.skillInfo(c.id, 1);
        if (info && info.kind === "sp") this.autoSlotSpell(c.id);   // 法术栏有空位就自动放入（见 bag.js）
        this.log(c.k === "mf" ? `习得${name}！之后在「功法 → 秘法」里修炼升层。` : `习得${name}第 1 层，可在功法栏修炼提升。`, "gold");
      } else if (ch === "dan") {
        if (!s.recipes.includes(c.key)) s.recipes.push(c.key);
        this.log(`学会${name}，可在洞府炼丹房炼制。`, "gold");
      } else if (c.k === "bmbp") {
        s.bmLearn = true;
        this.log(`学会${name}，可在「背包 → ${this.bmCfg().NAME}」炼制。`, "gold");
      } else if (c.k === "zfbp") {
        this.zfBpLearned(c);
        this.log(`学会${name}，可在「洞府 → 阵法室」布阵。`, "gold");
      } else if (c.k === "bp") {
        const bp = s.blueprints[c.kind]; if (!bp.includes(c.g)) bp.push(c.g);
        this.log(`学会${name}，可在洞府炼器室炼制。`, "gold");
      } else {
        if (!s.forgeKnown.includes(c.key)) s.forgeKnown.push(c.key);
        this.log(`学会${name}，可在洞府炼器室炼制。`, "gold");
      }
      if (this._off) this._off.learn.push(name);   // 离线账本
      this.dirty();
    },
    // 学习按钮：正在学 = 进度条，排队中，队列满，空着 = 学习，忙 = 排队
    lqBtn(ch, key, on, poor) {
      const h = this.lqHas(ch, key), c = this.s[this.lqSlot(ch)];
      if (h === 1) { const left = Math.max(0, c.end - this.now()); return `<button class="sm pg" disabled>${this.pgFill(left, this.lqMs(ch, c))}<span>学习中 ${U.cd(left / 1000)}</span></button>`; }
      if (h === 2) return `<button class="sm" disabled>排队中</button>`;
      if (this.lqFull(ch)) return `<button class="sm" disabled>队列已满</button>`;
      return `<button class="sm" onclick="${on}" ${poor ? "disabled" : ""}>${c ? "排队" : "学习"}</button>`;
    },
    // 学习队列卡片（没有就空）
    lqCard(ch) {
      const c = this.s[this.lqSlot(ch)], q = this.lqList(ch); if (!c) return "";
      const left = Math.max(0, c.end - this.now());
      return `<div class="card"><h3>学习队列<small>排队 ${q.length} / ${this.lqMax()}</small></h3>
        <div class="line"><div class="pg">${this.pgFill(left, this.lqMs(ch, c))}<span>${this.lqName(c)}<small>学习中 · 剩余 ${U.cd(left / 1000)}</small></span></div></div>` +
        q.map((x, i) => `<div class="line"><div>${i + 1}. ${this.lqName(x)}<small>排队中 · 需 ${U.dur(this.lqMs(ch, x) / 1000)}</small></div></div>`).join("") + `</div>`;
    },
    // 所有已学功法的加成合计（法术不算）
    gongfaBonus() {
      const b = { def: 0, atk: 0, hp: 0, cultivate: 0, speed: 0, hit: 0, dodge: 0, mana: 0, body: 0, res: {} };   // body：炼体秘诀加的肉身修炼速度 // res：真诀加的各系抗性
      for (const id in this.s.gongfa) {
        if (DATA.isSpell(id)) continue;
        const info = DATA.gongfaInfo(id, this.s.gongfa[id]);
        if (!info) continue;
        const lgOn = !(info.kind === "mf" || info.noEl || !info.el), lgK = (st) => lgOn ? this.lingenSpd(st, info.el.id) : 1;
        const v = info.value * lgK(info.type.stat);  // 灵根加成：修炼速度类走 GONGFA，其他功法走 OTHER（用户定 2026-11-14）
        if (info.type.stat === "res") b.res[info.el.id] = (b.res[info.el.id] || 0) + v;
        else b[info.type.stat] += v;
        if (info.type.stat2) b[info.type.stat2] += info.value2 * lgK(info.type.stat2);
      }
      if (this.sjSwBonus) { const w = this.sjSwBonus(); for (const k in w.gf) if (k in b) b[k] *= 1 + w.gf[k] / 100; for (const e in w.gfRes) if (b.res[e]) b.res[e] *= 1 + w.gfRes[e] / 100; }   // 主神纹：功法提供的属性 +%
      return b;
    },
    hasGongfa(id) { return !!this.s.gongfa[id]; },
    // 这一层的修炼时间（秒）= STUDY_MIN ÷ (1 + 减少%)，最少 STUDY_MIN_SEC（秘法和功法一样：悟道 + 经脉 + 聚灵阵）
    //   功法：悟道秘法 + 经脉光点冲满（jingmai.js jmGfCut）；法术：悟法秘法（经脉不减法术）；减少% 可以超过 100%
    studySec(g) {
      if (g.noEl) return Math.max(1, ((g.studyMin || [])[g.lv - 1] || 1) * 60);   // 开局功法书：config/start.js 的 STUDY_MIN
      const sw = this.sjSwBonus ? this.sjSwBonus() : {}, m = this.mifaBonus(), red = g.kind === "sp" ? m.spStudy + this.ssGfSum("sp") + (sw.spStudy || 0) : (sw.gfStudy || 0) + m.gfStudy + (this.jmGfCut ? this.jmGfCut() : 0) + (this.arrayGfCut ? this.arrayGfCut() : 0) + this.ssGfSum("gf");   // + 神识功法
      const base = DATA.studyMin[g.lv - 1] * 60;
      return Math.max(Math.min(CFG.wudao.STUDY_MIN_SEC || 10, base), base / (1 + Math.max(0, red) / 100));
    },
    // 是否学会了秘诀（修炼的前提）
    hasMijue() { return this.hasGfStat("cultivate"); },
    // 学会了加某属性的功法（按类型的 stat 判断，同类的第 2、3 本 mijue2 / tijue3 等也算）
    hasGfStat(stat) { return Object.keys(this.s.gongfa || {}).some(id => { if (DATA.isSpell(id) || id.split(":")[1] === "mf") return false; const g = DATA.gongfaInfo(id, 1); return !!(g && g.type && g.type.stat === stat); }); },

    // 本部功法计划达到的层数（当前层 + 正在修炼 + 队列中）
    plannedLv(id) {
      const s = this.s;
      return (s.gongfa[id] || 0) + (s.gfStudy && s.gfStudy.id === id ? 1 : 0) + s.gfQueue.filter(x => x === id).length;
    },
    // 加入修炼队列
    studyGongfa(id) {
      const s = this.s;
      if (!s.gongfa[id] || this.plannedLv(id) >= ((DATA.skillInfo(id) || {}).max || DATA.GONGFA_MAX)) return;
      if (s.gfQueue.length >= DATA.GF_QUEUE) return this.log(`修炼队列已满（最多 ${DATA.GF_QUEUE} 个）。`, "sys");
      s.gfQueue.push(id);
      if (!s.gfStudy) this.nextStudy();
      this.after();
    },
    // 从队列取下一个开始修炼
    nextStudy(at) {
      const s = this.s;
      while (!s.gfStudy && s.gfQueue.length) {
        const id = s.gfQueue.shift(), lv = s.gongfa[id];
        const info = DATA.skillInfo(id, lv);
        if (!lv || !info || lv >= (info.max || DATA.GONGFA_MAX)) continue;
        const total = this.studySec(info) * 1000;
        const sc = info.layerStone || 0;
        s.gfStudy = { id, total, done: 0, at: at || this.now(), per: DATA.studyPer(info), spent: 0, stone: sc ? sc / Math.ceil(total / 1000 / DATA.STUDY_STEP) : 0, sc, su: 0, ling: 1 };   // stone：秘法每 5 秒灵石（这层 sc 平均分）   // per：每 5 秒消耗灵气（v246）；stone：秘法每 5 秒灵石
      }
    },
    removeQueue(i) { this.s.gfQueue.splice(i, 1); this.after(); },
    // 「功法加成」：所有正在生效、减少功法 / 法术修炼时间的来源（v261 替代原来的「中断」）
    gfBonusView() {
      const m = this.mifaBonus(), ori = this.oriSum ? this.oriSum("gfStudyPct") : 0, K = id => (DATA.mifaKinds.find(k => k.id === id) || {}).name || id;
      const pill = this.studyPillPct ? this.studyPillPct() : 0, R = this.gfRoomNow ? this.gfRoomNow() : null;
      const room = R && !R.pillOnly ? [`${R.name}${R.free ? "（免费）" : ""}`, R.pct] : null;
      const gf = [[K("gfStudy"), (m.gfStudy || 0) - ori], ["出身「书香门第」", ori], ["经脉", this.jmGfCut ? this.jmGfCut() : 0], [`聚灵阵（${(this.s.array || {}).lv || 0} 级）`, this.arrayGfCut ? this.arrayGfCut() : 0], ["《识海演道诀》", this.ssGfSum("gf")]];
      const sp = [[K("spStudy"), m.spStudy || 0], ["《万法通明录》", this.ssGfSum("sp")]];
      const shared = [room, pill > 0 ? [`悟真丹（剩 ${U.dur(this.studyPillLeft() / 1000)}）`, pill] : null].filter(Boolean);
      const sec = (t, a) => { const r = a.filter(x => x && x[1] > 0), tot = r.reduce((s, x) => s + x[1], 0);
        return `<h3>${t}<small>合计 -${U.num(tot)}%</small></h3>${r.length ? r.map(x => `<div class="line"><div>${x[0]}</div><b>-${U.num(x[1])}%</b></div>`).join("") : `<p class="desc">暂无</p>`}`; };
      this.modal(`<h2>功法加成</h2><p class="desc">修炼时间 = 基础时间 ÷ (1 + 减少% 合计)，秘法和功法相同。</p>
        ${sec("功法", gf.concat(shared))}${sec("法术", sp.concat(shared))}${sec("秘法", gf.concat(shared))}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setGfFilter(t) { this.gfFilter = t; this.render(); const g = typeof document !== "undefined" && document.getElementById("gf-scroll"); if (g) g.scrollTop = 0; },   // 换分类时列表回到顶部
    // 排序 / 隐藏满级：「按等级」「按星级」一直开着，点击切换方向（v42）
    //   默认 等级 低层 → 高层（lvUp = true）、星级 高星 → 低星（starUp = false）
    //   三个设置存在浏览器本地（localStorage），刷新网页不变
    gfPref() {
      if (!this._gfPref) { let p = {}; try { p = JSON.parse(localStorage.getItem("xiu_gf_pref2") || "{}") || {}; } catch (e) {}
        let hide = p.hide; if (hide === undefined) { try { hide = !!(JSON.parse(localStorage.getItem("xiu_gf_pref") || "{}") || {}).hide; } catch (e) { hide = false; } }
        this._gfPref = { lvUp: p.lvUp !== false, starUp: p.starUp === true, hide: !!hide }; }
      return this._gfPref;
    },
    toggleGfPref(k) { const p = this.gfPref(); p[k] = !p[k]; try { localStorage.setItem("xiu_gf_pref2", JSON.stringify(p)); } catch (e) {} this.render(); },
    setGfSort(k) { this.toggleGfPref(k === "lv" ? "lvUp" : "starUp"); },
    toggleGfHideMax() { this.toggleGfPref("hide"); },

    // 数值显示：身法是闪避（两位小数），其余取整
    // 正在修炼的这一层什么时候结算完（毫秒）；暂停中返回 null（服务器据此准点结算）
    gfStudyEnd() {
      const st = this.s.gfStudy; if (!st || st.stalled) return null;
      const R = this.gfRoomNow(DATA.skillInfo(st.id, this.s.gongfa[st.id] || 1)), mul = R ? R.mul : 1, STEP = DATA.STUDY_STEP * 1000;
      return st.at + Math.ceil((st.total - st.done) / (STEP * mul)) * STEP;
    },
    gfValue(info, v) { return U.num(v); },
    // 倒计时文字：时分秒（countdownTxt 供 bars() 实时直写共用）
    countdownTxt(ms) {
      const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
      return (h ? h + "小时" : "") + (h || m ? m + "分" : "") + s + "秒";
    },
    countdown(ms) { return `<span class="cd">${this.countdownTxt(ms)}</span>`; },
    // 第3层 → 第4层（目标层红框）
    gfLvTo(lv) { return `<span class="tag gf-lv">第${lv}层</span> → <span class="tag gf-to">第${lv + 1}层</span>`; },
    // 「修炼队列」页：正在修炼（倒计时、进度、消耗）+ 排队中的
    // 当前修炼进度：{ done, left, mul }（无修炼返回 null），倒计时卡片与队列累计共用
    gfStudyProg() {
      const s = this.s, st = s.gfStudy; if (!st) return null;
      const R = this.gfRoomNow(), mul = R ? R.mul : 1;
      const done = st.stalled ? st.done : Math.min(st.total, st.done + Math.max(0, API.now() - st.at) * mul);
      const left = st.stalled ? (st.total - done) / mul : Math.max(0, st.at + Math.ceil((st.total - st.done) / (DATA.STUDY_STEP * 1000 * mul)) * DATA.STUDY_STEP * 1000 - API.now());
      return { done, left, mul };
    },
    // 修炼中卡片：只在「修炼队列」页显示（用户定），放在滚动区之外固定不滑，倒计时常驻可见（无修炼返回空）
    // 倒计时与进度条不在 HTML 里写死数值（每秒变会让整页每秒重建、列表滑动被打断），只留空位由 bars() 实时直写
    gfStudyCard() {
      const s = this.s, st = s.gfStudy; if (!st) return "";
      const info = DATA.skillInfo(st.id, s.gongfa[st.id]), p = this.gfStudyProg(), mul = p.mul;
      // “共 X 灵气”按当前练功房倍率估算：每 5 秒单位灵气 ×mul，总单位数 ÷mul（mul=1 时与旧式一致）
      return `<div class="card"><h3>修炼中 ·《${info ? info.name : st.id}》${info ? this.gfLvTo(info.lv) : ""}</h3>
        <div class="bar tick"><div id="gf-cd-bar"></div></div>
        <div class="row small"><span>${st.stalled ? `<b class='q5'>${st.stone ? "灵气或灵石" : "灵气"}不足，暂停中</b>` : `倒计时 <b><span class="cd" id="gf-cd"></span></b>`}</span></div>
        <div class="row small gf-cost"><span>每 10 秒消耗 <b>${U.fmt(this.ssGfPer(st.per * mul) * 2)}</b> 灵气${st.stone ? ` + ${U.fmt(Math.round(st.stone * mul * 2))} 灵石` : ""} · 已消耗 <b>${U.fix(U.fmt(st.spent))}</b> / ${U.fmt(this.ssGfPer(st.per * mul) * st.total / (DATA.STUDY_STEP * 1000 * mul))}</span><button class="sm" onclick="G.gfBonusView()">功法加成</button></div></div>`;
    },
    // 排队中每部的耗时与累计完成时间（毫秒），供列表渲染与倒计时实时刷新共用
    gfQueueTimes() {
      const s = this.s, R = this.gfRoomNow(), mul = R ? R.mul : 1;
      const p = this.gfStudyProg();
      let acc = p ? p.left : 0;   // acc：排到这一部为止还要多久（毫秒，按当前练功房加成估算）
      const lvPlan = {};
      if (s.gfStudy) lvPlan[s.gfStudy.id] = (s.gongfa[s.gfStudy.id] || 1) + 1;
      const rows = s.gfQueue.map(id => {
        const lv = lvPlan[id] || s.gongfa[id] || 1, info = DATA.skillInfo(id, lv); lvPlan[id] = lv + 1;
        // 排队中的每一部按自己的种类算练功房倍率（秘法/经脉减少%不同，倍率也不同），不再共用当前那部的 mul
        const mq = info ? (this.gfRoomNow(info) || {}).mul || 1 : mul;
        // 四舍五入到秒：各行累计 = 正在修炼的剩余 + 整秒，所有倒计时在同一刻跳秒，不会一个快一个慢（向上取整会让“全部完成约”每部多估最多 1 秒）
        const ms = info && lv < (info.max || DATA.GONGFA_MAX) ? Math.round(this.studySec(info) / mq) * 1000 : 0; acc += ms;
        return { ms, acc, lv };
      });
      return { rows, total: acc };
    },
    gfQueueView() {
      const s = this.s;
      let html = "";
      if (!s.gfStudy) html += `<div class="card"><p class="desc">当前没有在修炼的功法。在各分类里点「修炼」加入队列。</p></div>`;
      const { rows, total } = this.gfQueueTimes();
      html += `<div class="card"><h3>排队中<small>${s.gfQueue.length} / ${DATA.GF_QUEUE}${s.gfQueue.length ? ` · 全部完成约 <span class="cd" id="gf-q-total"></span>` : ""}</small></h3>` +
        (s.gfQueue.length ? s.gfQueue.map((id, i) => {
          const q = DATA.skillInfo(id); if (!q) return "";
          return `<div class="line"><div>${i + 1}. 《${q.name}》${q.noEl ? "" : `<span class="tag">${q.star}星</span>`}${this.gfLvTo(rows[i].lv)}<small>需 <span class="cd" id="gf-q-${i}-ms"></span> · 约 <span class="cd" id="gf-q-${i}-acc"></span> 后完成</small></div><button class="sm" onclick="G.removeQueue(${i})">移除</button></div>`; }).join("")
          : `<p class="desc">队列为空。</p>`) + `</div>`;
      return html;
    },
    // 法术伤害文字：先显示法术攻击（同法宝，已按星级封顶），再写 伤害 = 攻击 × 伤害%
    spellDmgTxt(g, noAtk) {   // noAtk：攻击另外显示（法术详情窗口放在层数后面）
      return `${noAtk ? "" : `攻击 ${U.fmt(g.atk)} · `}伤害 = 攻击×<b class="gf-base">${U.dec(g.pct + (g.fuPct || 0))}%</b>${g.jyDmg ? ` + 属性伤害 ${U.fmt(g.jyDmg)}` : ""}`;
    },
    // 一行：功法或法术，带修炼按钮
    skillLine(g) {
      const MX = g.max || DATA.GONGFA_MAX, s = this.s, max = g.lv >= MX, plan = this.plannedLv(g.id), full = plan >= MX;
      // 灵根只对修炼速度类功法生效：秘诀（cultivate）、炼体秘诀（body）；其他功法不显示灵根、不吃加成
      const spd = g.type && (g.type.stat === "cultivate" || g.type.stat === "body" || g.type.stat2 === "cultivate" || g.type.stat2 === "body");
      const lg = g.kind === "mf" || g.noEl || g.kind === "sp" ? 0 : this.s.lingen[g.el.id] || 0, lgP = lg ? (spd ? this.lingenPct(lg) : this.lingenOtPct(lg)) : 0, lgTxt = lgP ? `（${g.el.name}灵根 +${U.dec(lgP)}%）` : "";
      // 属性数值颜色：没有灵根加成 = 白色，有加成 = 绿色（数值已含加成）
      const lgK = lg ? (spd ? this.lingenGongfa(g.el.id) : this.lingenOt(g.el.id)) : 1;
      const cv = v => `<b class="${lg ? "gf-up" : "gf-base"}">${v}</b>`;
      const mfv = v => `${g.mk.sign}${U.num2(v)}${g.mk.unit}`;
      const xp = g.kind === "mf" ? DATA.mifaFullPct(g.mk.id, g.star) : 0;   // 聚元 / 炼体 / 斗血 / 斗灵 圆满额外 %
      const desc = g.kind === "mf" && xp
        ? `${g.label} ${mfv(g.value)}${max ? "" : `，下一层 ${mfv(g.next)}`}，圆满${max ? "" : "后"}${DATA.mifaFullTxt(g.mk.id, xp)}`
        : g.kind === "mf"
        ? (g.mk.id === "explore" || g.mk.full ? `${g.label} ${max ? mfv(g.value) : `圆满后 ${mfv(g.perLv)}`}` : `${g.label} ${mfv(g.value)}${max ? "" : `，下一层 ${mfv(g.next)}`}`)
        : g.kind === "sp"
        ? `${this.spellDmgTxt(g)}，耗法力 ${U.fmt(g.mana)}，每场战斗 ${g.uses} 次${max ? "" : `，下一层 攻击×${U.dec(g.next)}%`}`
        : `${g.label} ${cv("+" + this.gfValue(g, g.value * lgK))}${lgTxt}${max ? "" : `，下一层 ${cv("+" + this.gfValue(g, g.next * lgK))}`}` +
          (g.label2 ? `；${g.label2} ${cv("+" + this.gfValue(g, g.value2 * lgK))}${max ? "" : `，下一层 ${cv("+" + this.gfValue(g, g.next2 * lgK))}`}` : "");
      const sec = max ? 0 : this.studySec(g), n = Math.ceil(sec / DATA.STUDY_STEP), per = max ? 0 : this.ssGfPer(DATA.studyPer(g), !(this.s.gfStudy && this.s.gfStudy.id === g.id)), sp = max ? 0 : g.layerStone || 0;
      return `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》${g.noEl ? "" : `<span class="tag">${g.star}星</span>`}${g.kind === "mf" || g.noEl ? "" : `<span class="tag">${g.el.name}</span>`}<span class="tag gf-lv">第${g.lv}层</span>
        <small>${desc}${max ? "" : `<br>下一层：${U.dur(sec)} · 每10秒 ${U.fmt(per * 2)} 灵气${sp ? ` + ${U.fmt(Math.round(sp * 2 / n))} 灵石` : ""}（共 ${U.fmt(per * n)}${sp ? ` 灵气、${U.fmt(sp)} 灵石` : " 灵气"}）`}${plan > g.lv ? `<br><span class="c-green">已排至第 ${plan} 层</span>` : ""}</small></div>
        ${max ? `<button class="sm" disabled>圆满</button>` :
          `<button class="sm" onclick="G.studyGongfa('${g.id}')" ${full || s.gfQueue.length >= DATA.GF_QUEUE ? "disabled" : ""}>${full ? "已排满" : "修炼"}</button>`}</div>`;
    },
  },

  view() {
    const s = this.s, ids = Object.keys(s.gongfa), filter = this.gfFilter || "all";
    if (!ids.length) return `<div class="card"><h3>功法</h3><p class="desc">你尚未习得任何功法。拜入门派后在功法殿用贡献学习，或在世界 · 坊市用灵石购买。<br>注意：至少学会一部秘诀才能修炼。</p></div>`;

    // 分类按钮 + 「修炼队列」按钮（修炼中卡片固定在顶部常驻可见，排队情况在「修炼队列」里看）
    const qn = (s.gfStudy ? 1 : 0) + s.gfQueue.length;
    const cats = [["all", "全部"], ...DATA.gongfaTypes.filter(t => !t.base).map(t => [t.id, t.name]), ["spell", "法术"], ["mifa", "秘法"], ["queue", `修炼队列${qn ? `(${qn})` : ""}`]];
    cats.splice(cats.length - 1, 0, ["forget", "遗忘"]);   // 遗忘按钮放在修炼队列左边（shenshi.js）
    const tabs = `<div class="room-grid">${cats.map(([k, n]) => `<button class="${filter === k ? "active" : ""}" ${k === "queue" ? `style="grid-column:span 3"` : ""} onclick="G.setGfFilter('${k}')">${n}</button>`).join("")}</div>`;

    if (filter === "queue") return tabs + this.gfStudyCard() + `<div class="gf-scroll" id="gf-scroll">${this.gfQueueView()}</div>`;
    if (filter === "forget") return tabs + `<div class="gf-scroll" id="gf-scroll">${this.forgetView()}</div>`;

    // 排序 / 隐藏满级
    const P = this.gfPref(), hide = P.hide;
    const tools = `<div class="row small" style="gap:6px;justify-content:flex-start;margin:6px 0">
      <button class="sm active" onclick="G.setGfSort('lv')">按等级 ${P.lvUp ? "低→高" : "高→低"}</button>
      <button class="sm active" onclick="G.setGfSort('star')">按星级 ${P.starUp ? "低→高" : "高→低"}</button>
      <button class="sm ${hide ? "active" : ""}" onclick="G.toggleGfHideMax()">${hide ? "显示满级" : "隐藏满级"}</button></div>`;

    const full = ids.map(id => DATA.skillInfo(id, s.gongfa[id])).filter(Boolean), all = full.filter(g => !hide || g.lv < (g.max || DATA.GONGFA_MAX));
    // 右上角数量统计全部已学的（隐藏满级的也算）
    const mk = (key, title, sub, f) => ({ key, title, sub, items: all.filter(f), total: full.filter(f).length });
    const groups = [...DATA.gongfaTypes.filter(t => !t.base).map(t => mk(t.id, t.name, t.catLabel || t.label, g => g.kind === "gf" && (g.type.base || g.type.id) === t.id)),
                    mk("spell", "法术", "放入背包法术栏后战斗中施放", g => g.kind === "sp"),
                    mk("mifa", "秘法", "宗门秘法殿学习 · 修炼消耗灵气和灵石", g => g.kind === "mf")];
    // 先按等级，同等级再按星级；同星级 天 → 黄
    const sortFn = (a, b) => (P.lvUp ? a.lv - b.lv : b.lv - a.lv) || (P.starUp ? a.star - b.star : b.star - a.star);
    // v195「全部」：不分类型，一张卡片按排序显示（元婴出窍秘法放最前）
    const body = filter === "all" ? (all.length ? `<div class="card"><h3>全部功法<small>${full.length} 部</small></h3>${all.sort(sortFn).map(g => this.skillLine(g)).join("")}</div>` : "") :
      groups.filter(gr => gr.key === filter).map(gr => {
      if (!gr.items.length) return filter === "all" ? "" : `<div class="card"><p class="desc">${hide && gr.total ? `${gr.title}共 ${gr.total} 部，都已满级（已隐藏）` : `尚未学会任何${gr.title}`}。</p></div>`;
      gr.items.sort(sortFn);
      return `<div class="card"><h3>${gr.title}<small>${gr.total} 部</small></h3>${gr.items.map(g => this.skillLine(g)).join("")}</div>`;
    }).join("");
    return tabs + tools + `<div class="gf-scroll" id="gf-scroll">${body || `<div class="card"><p class="desc">没有可显示的功法。</p></div>`}</div>`;
  },
});
