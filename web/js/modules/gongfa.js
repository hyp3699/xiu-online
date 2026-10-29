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
      const steps = Math.floor((this.now() - st.at) / (2 * STEP));
      if (steps <= 0) break;
      st.at += steps * 2 * STEP;
      // 练功房（扣贡献）：减少修炼时间，进度 × mul，每单位灵气同比例多扣，总消耗不变
      let R = this.gfRoomNow();
      const remU = Math.ceil((st.total - st.done) / (STEP * (R ? R.mul : 1)));
      const RU = this.gfRoomUnits(), rU = st.rU || 0;   // 练功房每 RU 个 5 秒单位扣一次贡献；rU 已用还没扣的单位
      if (R && R.cost > 0 && Math.floor((rU + Math.min(2 * steps, remU)) / RU) * R.cost > s[R.cur]) { this.leaveGfRoom("门派贡献不足"); R = null; }
      const mul = R ? R.mul : 1, per = st.per * mul;
      // 灵气（秘法还要灵石）够几次就走几次；灵气不够且开了自动补充：用灵石补（秘法要的灵石先留够）
      const sp = (st.stone || 0) * mul, rem = Math.ceil((st.total - st.done) / (STEP * mul)), want = Math.min(2 * steps, rem);
      if (s.ling < want * per && s.array && s.array.autoRefill) { const keep = sp ? want * sp : 0, rate = this.lingPerStone(), pay = Math.min(Math.ceil((want * per - s.ling) / rate), Math.floor(s.stone - keep));
        if (pay > 0) { s.stone -= pay; s.ling += pay * rate; } }
      // 灵石为负时 Math.floor(负数 / sp) 为负，can 为负会倒扣灵气 / 倒加进度：
      // 先钳到 0，灵石不够就暂停，不再推进。
      let can = Math.max(0, Math.min(want, Math.floor(s.ling / per), sp ? Math.floor(s.stone / sp) : Infinity));
      if (can < rem && can % 2) can--;   // 只按整 10 秒走（最后一次除外）
      s.ling -= can * per; st.spent += can * per; st.done = can >= rem ? st.total : Math.min(st.total, st.done + can * STEP * mul);
      if (sp) {   // 秘法灵石：按已走的 5 秒单位四舍五入累计，这层走完正好扣满 sc
        const C = st.sc || Math.round(st.stone * Math.ceil(st.total / STEP)); st.su = (st.su || 0) + can * mul;
        const tgt = st.done >= st.total ? C : Math.min(C, Math.round(st.stone * st.su)), pay = Math.max(0, tgt - (st.spentStone || 0));
        s.stone -= pay; st.spentStone = (st.spentStone || 0) + pay; }
      if (R) { const n = rU + can; s[R.cur] -= Math.floor(n / RU) * R.cost; st.rU = n % RU; }
      st.stalled = can < want && st.done < st.total;   // 灵气 / 灵石不够，暂停
      if (st.done < st.total) break;
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
      if (k === "dan" || k === "dfb" || (!k && x.key && x.key.includes("|"))) { const [t, g] = x.key.split("|"); return `丹方《${DATA.danName(t, +g)}》`; }
      if (k === "bp") return DATA.furnaceName(x.kind, x.g) + "图纸";
      if (k === "rbp") return DATA.ringBpName(x.g, x.r);
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
    lqBagIdx(c) { return this.s.bag.findIndex(it => it.lq && it.t === c.k && (c.k === "gfb" ? it.id === c.id : c.k === "dfb" ? it.type === c.type && it.g === c.g : it.kind === c.kind && it.g === c.g && it.r === c.r)); },
    lqDone(ch, c) {
      const s = this.s, name = this.lqName(c);
      if (c.k === "gfb" || c.k === "bp" || c.k === "rbp" || c.k === "dfb") { const i = this.lqBagIdx(c); if (i >= 0) { const it = s.bag[i]; this.removeAt(i, 1); if (s.bag[i] === it) delete it.lq; } }   // 叠在一起的只用掉一个
      if (ch === "gf") {
        s.gongfa[c.id] = Math.max(1, s.gongfa[c.id] || 0);
        const info = DATA.skillInfo(c.id, 1);
        if (info && info.kind === "sp") this.autoSlotSpell(c.id);   // 法术栏有空位就自动放入（见 bag.js）
        this.log(c.k === "mf" ? `习得${name}！之后在「功法 → 秘法」里修炼升层。` : `习得${name}第 1 层，可在功法栏修炼提升。`, "gold");
      } else if (ch === "dan") {
        if (!s.recipes.includes(c.key)) s.recipes.push(c.key);
        this.log(`学会${name}，可在洞府炼丹房炼制。`, "gold");
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
        const v = info.value * this.lingenGongfa(info.el.id);  // 灵根加成
        if (info.type.stat === "res") b.res[info.el.id] = (b.res[info.el.id] || 0) + v;
        else b[info.type.stat] += v;
        if (info.type.stat2) b[info.type.stat2] += info.value2 * this.lingenGongfa(info.el.id);
      }
      return b;
    },
    hasGongfa(id) { return !!this.s.gongfa[id]; },
    // 这一层的修炼时间（秒）= STUDY_MIN ÷ (1 + 减少%)，最少 STUDY_MIN_SEC（修炼秘法本身不减少）
    //   功法：悟道秘法 + 经脉光点冲满（jingmai.js jmGfCut）；法术：悟法秘法（经脉不减法术）；减少% 可以超过 100%
    studySec(g) {
      if (g.noEl) return Math.max(1, ((g.studyMin || [])[g.lv - 1] || 1) * 60);   // 开局功法书：config/start.js 的 STUDY_MIN
      const m = this.mifaBonus(), red = g.kind === "mf" ? 0 : g.kind === "sp" ? m.spStudy : m.gfStudy + (this.jmGfCut ? this.jmGfCut() : 0);
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
    stopStudy() {
      if (!this.s.gfStudy || !confirm("中断修炼，已消耗的灵气不退还，确定？")) return;
      this.s.gfStudy = null; this.nextStudy(); this.after();
    },
    setGfFilter(t) { this.gfFilter = t; this.render(); },
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
    gfValue(info, v) { return U.num(v); },
    // 倒计时文字：时分秒
    countdown(ms) {
      const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
      return `<span class="cd">${(h ? h + "小时" : "") + (h || m ? m + "分" : "") + s + "秒"}</span>`;
    },
    // 第3层 → 第4层（目标层红框）
    gfLvTo(lv) { return `<span class="tag gf-lv">第${lv}层</span> → <span class="tag gf-to">第${lv + 1}层</span>`; },
    // 「修炼队列」页：正在修炼（倒计时、进度、消耗）+ 排队中的
    gfQueueView() {
      const s = this.s, R = this.gfRoomNow(), mul = R ? R.mul : 1;
      let html = "", acc = 0;   // acc：排到这一部为止还要多久（毫秒，按当前练功房加成估算）
      if (s.gfStudy) {
        const info = DATA.skillInfo(s.gfStudy.id, s.gongfa[s.gfStudy.id]);
        const st = s.gfStudy, done = st.stalled ? st.done : Math.min(st.total, st.done + Math.max(0, Date.now() - st.at) * mul), left = (st.total - done) / mul;
        acc = left;
        html += `<div class="card"><h3>修炼中 ·《${info ? info.name : st.id}》${info ? this.gfLvTo(info.lv) : ""}</h3>
        <div class="bar tick"><div style="width:${done / st.total * 100}%"></div></div>
        <div class="row small"><span>${st.stalled ? `<b class='q5'>${st.stone ? "灵气或灵石" : "灵气"}不足，暂停中</b>` : `倒计时 <b>${this.countdown(left)}</b>`}</span><button class="sm" onclick="G.stopStudy()">中断</button></div>
        <div class="row small"><span>每 10 秒消耗 <b>${U.fmt(st.per * 2)}</b> 灵气${st.stone ? ` + ${U.fmt(Math.round(st.stone * 2))} 灵石` : ""} · 已消耗 <b>${U.fix(U.fmt(st.spent))}</b> / ${U.fmt(st.per * st.total / (DATA.STUDY_STEP * 1000))}</span><span>${R ? `${R.name} -${U.num(R.pct)}%` : "未进练功房"}</span></div></div>`;
      } else html += `<div class="card"><p class="desc">当前没有在修炼的功法。在各分类里点「修炼」加入队列。</p></div>`;
      const lvPlan = {};
      if (s.gfStudy) lvPlan[s.gfStudy.id] = (s.gongfa[s.gfStudy.id] || 1) + 1;
      const rows = s.gfQueue.map(id => {
        const lv = lvPlan[id] || s.gongfa[id] || 1, info = DATA.skillInfo(id, lv); lvPlan[id] = lv + 1;
        const ms = info && lv < (info.max || DATA.GONGFA_MAX) ? this.studySec(info) * 1000 / mul : 0; acc += ms;
        return { ms, acc, lv };
      });
      html += `<div class="card"><h3>排队中<small>${s.gfQueue.length} / ${DATA.GF_QUEUE}${s.gfQueue.length ? ` · 全部完成约 ${this.countdown(acc)}` : ""}</small></h3>` +
        (s.gfQueue.length ? s.gfQueue.map((id, i) => {
          const q = DATA.skillInfo(id); if (!q) return "";
          return `<div class="line"><div>${i + 1}. 《${q.name}》${q.noEl ? "" : `<span class="tag">${q.star}星</span>`}${this.gfLvTo(rows[i].lv)}<small>需 ${this.countdown(rows[i].ms)} · 约 ${this.countdown(rows[i].acc)} 后完成</small></div><button class="sm" onclick="G.removeQueue(${i})">移除</button></div>`; }).join("")
          : `<p class="desc">队列为空。</p>`) + `</div>`;
      return html;
    },
    // 法术伤害文字：法术攻击 × 伤害%（有灵根加成时注明）
    spellDmgTxt(g) {
      const lg = (this.s.lingen || {})[g.el.id] || 0;
      return `伤害 = ${g.fuPct ? "(" : ""}攻击×<b class="gf-base">${U.dec(g.pct)}%</b>${g.jyDmg ? ` + 属性伤害 ${U.fmt(g.jyDmg)}` : ""}${g.fuPct ? `) × ${U.dec(100 + g.fuPct)}%（融合）` : ""}${lg ? `（${g.el.name}灵根伤害 +${U.dec(this.lingenPct(lg, "sp"))}%）` : ""}`;
    },
    // 一行：功法或法术，带修炼按钮
    skillLine(g) {
      const MX = g.max || DATA.GONGFA_MAX, s = this.s, max = g.lv >= MX, plan = this.plannedLv(g.id), full = plan >= MX;
      const lg = g.kind === "mf" || g.noEl ? 0 : this.s.lingen[g.el.id] || 0, lgTxt = lg ? `（${g.el.name}灵根 +${U.dec(this.lingenPct(lg, g.kind))}%）` : "";
      // 属性数值颜色：没有灵根加成 = 白色，有加成 = 绿色（数值已含加成）
      const cv = v => `<b class="${lg ? "gf-up" : "gf-base"}">${v}</b>`;
      const mfv = v => `${g.mk.sign}${U.num2(v)}${g.mk.unit}`;
      const xp = g.kind === "mf" ? DATA.mifaFullPct(g.mk.id, g.star) : 0;   // 聚元 / 炼体 / 斗血 / 斗灵 圆满额外 %
      const desc = g.kind === "mf" && xp
        ? `${g.label} ${mfv(g.value)}${max ? "" : `，下一层 ${mfv(g.next)}`}，圆满${max ? "" : "后"}${DATA.mifaFullTxt(g.mk.id, xp)}`
        : g.kind === "mf"
        ? (g.mk.id === "explore" || g.mk.full ? `${g.label} ${max ? mfv(g.value) : `圆满后 ${mfv(g.perLv)}`}` : `${g.label} ${mfv(g.value)}${max ? "" : `，下一层 ${mfv(g.next)}`}`)
        : g.kind === "sp"
        ? `${this.spellDmgTxt(g)}，耗法力 ${U.fmt(g.mana)}，每场战斗 ${g.uses} 次${max ? "" : `，下一层 攻击×${U.dec(g.next)}%`}`
        : `${g.label} ${cv("+" + this.gfValue(g, g.value * this.lingenGongfa(g.el.id)))}${lgTxt}${max ? "" : `，下一层 ${cv("+" + this.gfValue(g, g.next * this.lingenGongfa(g.el.id)))}`}` +
          (g.label2 ? `；${g.label2} ${cv("+" + this.gfValue(g, g.value2 * this.lingenGongfa(g.el.id)))}${max ? "" : `，下一层 ${cv("+" + this.gfValue(g, g.next2 * this.lingenGongfa(g.el.id)))}`}` : "");
      const sec = max ? 0 : this.studySec(g), n = Math.ceil(sec / DATA.STUDY_STEP), per = max ? 0 : DATA.studyPer(g), sp = max ? 0 : g.layerStone || 0;
      return `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》${g.noEl ? "" : `<span class="tag">${g.star}星</span>`}${g.kind === "mf" || g.noEl ? "" : `<span class="tag">${g.el.name}</span>`}<span class="tag gf-lv">第${g.lv}层</span>
        <small>${desc}${max ? "" : `<br>下一层：${U.dur(sec)} · 每10秒 ${U.fmt(per * 2)} 灵气${sp ? ` + ${U.fmt(Math.round(sp * 2 / n))} 灵石` : ""}（共 ${U.fmt(per * n)}${sp ? ` 灵气、${U.fmt(sp)} 灵石` : " 灵气"}）`}${plan > g.lv ? `<br><span class="c-green">已排至第 ${plan} 层</span>` : ""}</small></div>
        ${max ? `<button class="sm" disabled>圆满</button>` :
          `<button class="sm" onclick="G.studyGongfa('${g.id}')" ${full || s.gfQueue.length >= DATA.GF_QUEUE ? "disabled" : ""}>${full ? "已排满" : "修炼"}</button>`}</div>`;
    },
  },

  view() {
    const s = this.s, ids = Object.keys(s.gongfa), filter = this.gfFilter || "all";
    if (!ids.length) return `<div class="card"><h3>功法</h3><p class="desc">你尚未习得任何功法。拜入门派后在功法殿用贡献学习，或在世界 · 坊市用灵石购买。<br>注意：至少学会一部秘诀才能修炼。</p></div>`;

    // 分类按钮 + 「修炼队列」按钮（修炼中的功法、排队情况都在这里看）
    const qn = (s.gfStudy ? 1 : 0) + s.gfQueue.length;
    const cats = [["all", "全部"], ...DATA.gongfaTypes.filter(t => !t.base).map(t => [t.id, t.name]), ["spell", "法术"], ["mifa", "秘法"], ["queue", `修炼队列${qn ? `(${qn})` : ""}`]];
    cats.splice(cats.length - 1, 0, ["forget", "遗忘"]);   // 遗忘按钮放在修炼队列左边（shenshi.js）
    const tabs = `<div class="room-grid">${cats.map(([k, n]) => `<button class="${filter === k ? "active" : ""}" ${k === "queue" ? `style="grid-column:span 3"` : ""} onclick="G.setGfFilter('${k}')">${n}</button>`).join("")}</div>`;

    if (filter === "queue") return tabs + this.gfQueueView();
    if (filter === "forget") return tabs + this.forgetView();

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
    return tabs + tools + (body || `<div class="card"><p class="desc">没有可显示的功法。</p></div>`);
  },
});
