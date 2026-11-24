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

  defaults: () => ({ gongfa: {}, gfStudy: null, gfQueue: [], gfLearn: null, lq: { gf: [], dan: [], forge: [] }, gfAuto: { on: false, rules: [] } }),   // gfLearn：正在学习（首次习得）{ id, end }

  // 每 10 秒结算修炼：按 5 秒一步扣灵气、累计进度
  tick() {
    const s = this.s, STEP = DATA.STUDY_STEP * 1000;
    this.lqTick("gf");   // v173 学习（首次习得）+ 学习队列
    this.gfAutoFill();   // 自动队列：排队不满 AUTO_Q 个按条件补
    if (!s.gfStudy) this.nextStudy();
    while (s.gfStudy) {
      const st = s.gfStudy;
      if (st.ling !== 1) { const inf = DATA.skillInfo(st.id, s.gongfa[st.id] || 1); if (inf) st.per = DATA.studyPer(inf); st.spent = 0; st.ling = 1; }   // v246 旧存档：正在修炼的改成按灵气算
      if ((st.u || 5) !== DATA.STUDY_STEP) { const u0 = st.u || 5, inf = DATA.skillInfo(st.id, s.gongfa[st.id] || 1); if (inf) st.per = DATA.studyPer(inf); if (st.stone) { st.stone = st.sc ? st.sc / Math.ceil(st.total / 1000 / DATA.STUDY_STEP) : st.stone * DATA.STUDY_STEP / u0; st.su = (st.su || 0) * u0 / DATA.STUDY_STEP; } st.u = DATA.STUDY_STEP; }   // 结算单位改了（5 秒 → 10 秒，用户定 2026-11-22）：正在修炼的按新单位重算
      // v247 每 10 秒结算一次（= 2 个 5 秒单位）；消耗仍按 5 秒单位计，最后不足 10 秒只扣剩下的单位，每层总消耗不变
      // 练功房：先把练功房 % 加进秘法/经脉减少%里一起除，进度 × mul，每单位灵气同比例多扣，总消耗不变
      let R = this.gfRoomNow(DATA.skillInfo(st.id, s.gongfa[st.id] || 1));
      const mul = R ? R.mul : 1, per = this.ssGfPer(st.per * mul);   // 神识功法《敛息归元诀》减灵气
      const rem = Math.ceil((st.total - st.done) / (STEP * mul));
      // 最后不足 10 秒的一段：倒计时到 0 立刻结算，不再等满 10 秒
      const SE = DATA.STUDY_SETTLE(), endMs = Math.ceil((st.total - st.done) / mul), fin = !st.stalled && rem <= SE && this.now() >= st.at + endMs;   // 最后一段按实际剩余时间到点就结算
      const steps = fin ? 1 : Math.floor((this.now() - st.at) / (SE * STEP));
      if (steps <= 0) break;
      st.at += fin ? endMs : steps * SE * STEP;
      // 灵气（秘法还要灵石）够几次就走几次；灵气不够且开了自动补充：用灵石补（秘法要的灵石先留够）；补到灵气上限为止，不超过 lingCap()（同 tick 里功法最先补，修为 / 肉身后补时按剩余容量算）
      const sp = (st.stone || 0) * mul, want = Math.min(SE * steps, rem);
      // 灵脉：这次要走的单位（秘法灵石够的部分）整份灵气先扣灵脉（不吃阵旗），够才用；不够整份走聚灵阵
      const lmN = Math.max(0, sp ? Math.min(want, Math.floor(s.stone / sp)) : want), lmPer = this.ssGfPer(st.per * mul, false, true);
      const lmOk = lmN > 0 && lmPer > 0 && this.lmPay ? this.lmPay(lmN * lmPer) : false;
      if (!lmOk && s.ling < want * per && s.array && s.array.autoRefill) { const keep = sp ? want * sp : 0, rate = this.lingPerStone(), cap = this.lingCap(), pay = Math.min(Math.ceil((want * per - s.ling) / rate), Math.floor(s.stone - keep - this.stoneKeep()), Math.max(0, Math.ceil((cap - s.ling) / rate)));
        if (pay > 0) { s.stone -= pay; s.ling = Math.min(cap, s.ling + pay * rate); } }
      // 灵石为负时 Math.floor(负数 / sp) 为负，can 为负会倒扣灵气 / 倒加进度：
      // 先钳到 0，灵石不够就暂停，不再推进。
      let can = lmOk ? lmN : Math.max(0, Math.min(want, per > 0 ? Math.floor(s.ling / per) : Infinity, sp ? Math.floor(s.stone / sp) : Infinity));   // per 可能被《敛息归元诀》减到 0：灵气 0 时 0/0 = NaN
      if (can < rem) can -= can % SE;   // 只按整 10 秒走（最后一次除外）
      if (lmOk) st.spent += can * lmPer; else { s.ling -= can * per; st.spent += can * per; } st.done = can >= rem ? st.total : Math.min(st.total, st.done + can * STEP * mul);
      if (sp) {   // 秘法灵石：按已走的 5 秒单位四舍五入累计，这层走完正好扣满 sc
        const C = st.sc || Math.round(st.stone * Math.ceil(st.total / STEP)); st.su = (st.su || 0) + can * mul;
        const tgt = st.done >= st.total ? C : Math.min(C, Math.round(st.stone * st.su)), pay = Math.max(0, tgt - (st.spentStone || 0));
        s.stone -= pay; st.spentStone = (st.spentStone || 0) + pay; }
      // 练功房贡献每 ROOM_BILL_SEC 秒扣（modules/sect.js roomBill）
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
    if (this.lsjSync) this.lsjSync();
  },

  api: {
    // 开始学习（已付过贡献 / 灵石）：进学习队列，轮到后等 LEARN_MIN 分钟习得第 1 层
    startGfLearn(id) {
      const g = DATA.skillInfo(id); if (!g) return;
      this.lqAdd("gf", { id, k: "gf", ms: DATA.gfLearnMin(g.star) * 60000 });
    },
    // 功法殿 / 坊市 / 功德司左边一列「功法类型」按钮（字竖排，用户定 2026-11-14）：this.gfSide = all / 类别 id（base）/ spell
    gfSideKey(g) { return g.kind === "sp" ? "spell" : g.type ? (g.type.base || g.type.id) : ""; },
    // 选了类型：只列这一类没学会的；「已学会」（最下面）：列全部已学会的（用户定 2026-11-14，去掉「全部」）
    gfSideOk(g) { const k = this.gfSide; return k === "done" ? this.hasGongfa(g.id) : (!k || this.gfSideKey(g) === k) && !this.hasGongfa(g.id); },   // k = "" 一个都不选 = 全部类型（没学会的）
    // gs = 这一页全部功法（决定显示哪些按钮），html = 右边内容（调用前先 gfSideFix）
    gfSideKeys(gs) { const have = new Set(gs.map(g => this.gfSideKey(g)));
      return [...DATA.gongfaTypes.filter(t => !t.base && have.has(t.id)).map(t => [t.id, t.id === "tijue" ? "炼体" : t.name]), ...(have.has("spell") ? [["spell", "法术"]] : []), ["done", "已学会"]]; },
    gfSideFix(gs) { const keys = this.gfSideKeys(gs); if (this.gfSide === undefined || (this.gfSide !== "" && !keys.some(([k]) => k === this.gfSide))) this.gfSide = "";  /* 默认不选 = 全部类型（用户定 2026-11-14） */ return gs; },
    gfSideWrap(gs, html) {
      const keys = this.gfSideKeys(gs), cur = this.gfSide, v = n => [...n].join("<br>");
      return `<div class="gf-side-wrap"><div class="gf-side">${keys.map(([k, n]) => `<button class="${cur === k ? "active" : ""}" onclick="G.setGfSide('${k}')">${v(n)}</button>`).join("")}</div><div class="gf-side-main">${html}</div></div>`;
    },
    setGfSide(k) { this.gfSide = this.gfSide === k ? "" : k; this.render(); },   // 再点一次已选的 = 不选 = 全部（用户定 2026-11-14）
    // 功法殿 / 坊市 / 功德司的学习按钮
    gfLearnBtn(g, on, poor) {
      if (this.hasGongfa(g.id)) return `<button class="sm" disabled>已学会</button>`;
      return this.lqBtn("gf", g.id, on, poor);
    },

    /* ---------- v173 学习队列 ----------
     * 一条队列（2026-11-15 起同时只学一个）：gf 功法 / 法术 / 秘法 / 背包秘诀，dan 丹方，forge 炼器图谱 / 背包图纸
     * 正在学的放在 s.gfLearn / s.danStudy / s.forgeStudy（{ id 或 key, end, ms, k }），后面排队的在 s.lq[队列]
     * 点学习就扣费，不能取消；排队最多 CFG.gongfa.LEARN_Q.MAX 个（不算正在学的）；前一个学完，下一个接着开始（离线也是） */
    lqSlot(ch) { return { gf: "gfLearn", dan: "danStudy", forge: "forgeStudy" }[ch]; },
    lqMax() { const Q = CFG.gongfa.LEARN_Q || {}; return Q.MAX === undefined ? 5 : Q.MAX; },
    lqList(ch) { const s = this.s; if (!s.lq) s.lq = {}; return s.lq[ch] || (s.lq[ch] = []); },
    lqKey(x) { return x.id !== undefined ? x.id : x.key; },
    // 0 = 没有，1 = 正在学，2 = 排队中
    lqHas(ch, key) { const c = this.s[this.lqSlot(ch)]; if (c && this.lqKey(c) === key) return 1; return this.lqList(ch).some(x => this.lqKey(x) === key) ? 2 : 0; },
    // 三条只是存放位置，实际是一条队列：同时只学一个，按加入顺序（x.sq）轮流学（用户定 2026-11-15）
    lqChs() { return ["gf", "dan", "forge"]; },
    // 学习队列最早学完的时刻（服务器据此准点结算，不等 10 秒周期；没有返回 null）
    lqEnd() { const s = this.s; let e = null; for (const c of this.lqChs()) { const x = s[this.lqSlot(c)]; if (x && +x.end > 0 && (e == null || x.end < e)) e = +x.end; } return e; },
    // 新学会功法 / 改了自动队列条件：马上按条件补队列并开练
    gfAutoKick() { this.gfAutoFill(); if (!this.s.gfStudy) this.nextStudy(); },
    lqCur() { const s = this.s; for (const c of this.lqChs()) if (s[this.lqSlot(c)]) return s[this.lqSlot(c)]; return null; },
    lqQueued() { const a = []; for (const c of this.lqChs()) this.lqList(c).forEach((x, i) => a.push({ ch: c, x, i })); return a.sort((p, q) => ((p.x.sq || 0) - (q.x.sq || 0)) || (p.i - q.i)); },
    lqFull(ch) { return !DATA.isTest() && !!this.lqCur() && this.lqQueued().length >= this.lqMax(); },
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
      s.lqSeq = (s.lqSeq || 0) + 1; x = Object.assign({}, x, { sq: s.lqSeq });
      if (!this.lqCur()) { s[sl] = Object.assign({}, x, { end: this.now() + x.ms }); this.log(`开始学习${this.lqName(x)}，需 ${U.dur(x.ms / 1000)}。`, "good"); }
      else { this.lqList(ch).push(x); this.log(`${this.lqName(x)}已加入学习队列（排第 ${this.lqQueued().length} 个）。`, "good"); }
      this.lqTick(ch); this.dirty();
    },
    // 到时间就学会，下一个从上一个学完的时刻开始（离线补算也对）
    lqTick() {
      const s = this.s, now = this.now(); let guard = 0;
      while (guard++ < 300) {
        let last = 0;
        for (const c of this.lqChs()) { const sl = this.lqSlot(c), x = s[sl]; if (x && now >= x.end) { s[sl] = null; this.lqDone(c, x); last = Math.max(last, x.end); } }
        if (this.lqCur()) return;   // 还有在学的（老存档可能同时学几个），等它学完
        const nx = this.lqQueued()[0]; if (!nx) return;
        this.lqList(nx.ch).splice(nx.i, 1);
        s[this.lqSlot(nx.ch)] = Object.assign({}, nx.x, { end: (last || now) + this.lqMs(nx.ch, nx.x) });
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
        if (this.lsjSync) this.lsjSync();
        const info = DATA.skillInfo(c.id, 1);
        if (info && info.kind === "sp") this.autoSlotSpell(c.id);   // 法术栏有空位就自动放入（见 bag.js）
        this.gfAutoKick();   // 自动队列马上识别新学会的
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
      return `<button class="sm" onclick="${on}" ${poor ? "disabled" : ""}>${this.lqCur() ? "排队" : "学习"}</button>`;
    },
    // 学习队列卡片（没有就空）；每本一行、时间跟在名字后面（.lq-card，用户定 2026-11-14）
    lqCard(ch, title) {
      const c = this.lqCur(), q = this.lqQueued(); if (!c) return "";
      const left = Math.max(0, c.end - this.now());
      return `<div class="card lq-card"><h3>${title || "学习队列"}<small>排队 ${q.length} / ${this.lqMax()}</small></h3>
        <div class="line"><div class="pg">${this.pgFill(left, c.ms)}<span>${this.lqName(c)}<small>学习中 · 剩余 ${U.cd(left / 1000)}</small></span></div></div>` +
        q.map((o, i) => `<div class="line"><div>${i + 1}. ${this.lqName(o.x)}<small>排队中 · 需 ${U.dur(this.lqMs(o.ch, o.x) / 1000)}</small></div></div>`).join("") + `</div>`;
    },
    // 「队列」按钮：点开弹窗看学习队列（坊市功法、功法殿用，用户定 2026-11-15）
    // 「队列」按钮：后面显示正在学 + 排队的总数；点开弹窗看全部学习队列（功法 / 丹方 / 图纸，含背包里学的）（用户定 2026-11-15）
    lqAll() { return this.lqChs().reduce((t, c) => t + (this.s[this.lqSlot(c)] ? 1 : 0) + this.lqList(c).length, 0); },
    lqQBtn(ch, cnt) { const n = this.lqAll(); return `<button onclick="G.openLqQ('${ch}')">${cnt ? "学习队列" : "队列"}${n ? ` ${n}` : ""}</button>`; },
    lqBar(ch) { return `<div class="room-grid lq-bar">${this.lqQBtn(ch, 1)}</div>`; },   // 没有按钮行的页面：单独一个「队列」按钮
    openLqQ(ch) {
      this.modal(`${this.lqCard(ch, "学习队列") || `<div class="card lq-card"><h3>学习队列</h3><p class="desc">没有正在学习的东西。</p></div>`}<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 所有已学功法的加成合计（法术不算）
    gongfaBonus() {
      const b = { def: 0, atk: 0, hp: 0, cultivate: 0, speed: 0, hit: 0, dodge: 0, mana: 0, body: 0, res: {} };   // body：炼体秘诀加的肉身修炼速度 // res：真诀加的各系抗性
      const raw = { res: {} };   // 不含灵根的功法原值：主神纹 % 按原值加（灵根 % 与神纹 % 相加，不相乘，用户定 2026-11-18）
      for (const id in this.s.gongfa) {
        if (DATA.isSpell(id)) continue;
        const info = DATA.gongfaInfo(id, this.s.gongfa[id]);
        if (!info || info.lsj) continue;   // 炼神诀不加战斗属性（神识、灵识点另算）
        const lgOn = !(info.kind === "mf" || info.noEl || !info.el), lgK = (st) => lgOn ? this.lingenSpd(st, info.el.id) : 1;
        const v = info.value * lgK(info.type.stat);  // 灵根加成：修炼速度类走 GONGFA，其他功法走 OTHER（用户定 2026-11-14）
        if (info.type.stat === "res") { b.res[info.el.id] = (b.res[info.el.id] || 0) + v; raw.res[info.el.id] = (raw.res[info.el.id] || 0) + info.value; }
        else { b[info.type.stat] += v; raw[info.type.stat] = (raw[info.type.stat] || 0) + info.value; }
        if (info.type.stat2) { b[info.type.stat2] += info.value2 * lgK(info.type.stat2); raw[info.type.stat2] = (raw[info.type.stat2] || 0) + info.value2; }
      }
      if (this.sjSwBonus) { const w = this.sjSwBonus(); for (const k in w.gf) if (k in b && k !== "res") b[k] += (raw[k] || 0) * w.gf[k] / 100; for (const e in w.gfRes) if (raw.res[e]) b.res[e] = (b.res[e] || 0) + raw.res[e] * w.gfRes[e] / 100; }   // 主神纹：功法原值 × %（与灵根 % 相加）
      return b;
    },
    hasGongfa(id) { return !!this.s.gongfa[id]; },
    // 这一层的修炼时间（秒）= STUDY_MIN ÷ (1 + 减少%)，最少 STUDY_MIN_SEC（秘法和功法一样：悟道 + 经脉 + 聚灵阵）
    //   功法：悟道秘法 + 经脉光点冲满（jingmai.js jmGfCut）；法术：悟法秘法（经脉不减法术）；减少% 可以超过 100%
    studySec(g) {
      if (g.noEl && !g.lsj) return Math.max(1, ((g.studyMin || [])[g.lv - 1] || 1) * 60);   // 开局功法书：config/start.js 的 STUDY_MIN
      const sw = this.sjSwBonus ? this.sjSwBonus() : {}, m = this.mifaBonus(), red = g.kind === "sp" ? m.spStudy + this.ssGfSum("sp") + (sw.spStudy || 0) : (sw.gfStudy || 0) + m.gfStudy + (this.jmGfCut ? this.jmGfCut() : 0) + (this.arrayGfCut ? this.arrayGfCut() : 0) + this.ssGfSum("gf");   // + 神识功法
      const base = DATA.studyMin[g.lv - 1] * 60 * (1 + (CFG.gongfa.STUDY_STAR_PCT ?? 10) * Math.max(0, (g.star || 1) - 1) / 100);   // 1 星 100%，每高一星 + STUDY_STAR_PCT%
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
    nextStudy(at, at2) {   // at2：内部重取次数
      const s = this.s;
      this.gfAutoFill();
      while (!s.gfStudy && s.gfQueue.length) {
        const id = s.gfQueue.shift(), lv = s.gongfa[id];
        const info = DATA.skillInfo(id, lv);
        if (!lv || !info || lv >= (info.max || DATA.GONGFA_MAX)) continue;
        const total = this.studySec(info) * 1000;
        const sc = info.layerStone || 0;
        s.gfStudy = { id, total, done: 0, at: at || this.now(), per: DATA.studyPer(info), u: DATA.STUDY_STEP, spent: 0, stone: sc ? sc / Math.ceil(total / 1000 / DATA.STUDY_STEP) : 0, sc, su: 0, ling: 1 };   // stone：秘法每 5 秒灵石（这层 sc 平均分）   // per：每 5 秒消耗灵气（v246）；stone：秘法每 5 秒灵石
      }
      this.gfAutoFill();   // 取走一个后再补满
      if (!s.gfStudy && s.gfQueue.length && !(+at2 > 2)) return this.nextStudy(at, (+at2 || 0) + 1);   // 队列里的都丢弃了（如已满层）、刚补的马上开练，不用等下一轮
    },
    // 立即减功法修炼时间（现实毫秒）：等于让修炼直接多走 ms 这么久——把开始时间往前挪 ms 再结算，
    // 灵气 / 灵石（秘法）按这段时间照常扣（灵气不够照常暂停）；修炼中的走完立即完成，剩下的接着走队列；队列空了剩余作废（用户定 2026-11-22）。
    // 返回实际用掉的毫秒（悟道室神魂之道用）
    gfCutTime(ms) {
      const s = this.s, M = (this.modules || []).find(x => x.id === "gongfa"), tick = () => { if (M && M.tick) M.tick.call(this); };
      let left = Math.max(0, +ms || 0), used = 0;
      tick();
      for (let g = 0; left > 0 && g < 500; g++) {   // 一层一层走：tick 一次跨过完成点时多出来的时间不会带到下一层，所以每层只挪到刚好完成
        if (!s.gfStudy) this.nextStudy();
        const st = s.gfStudy; if (!st) break;   // 队列空了：剩余作废
        if (st.stalled) { st.stalled = false; st.at = this.now(); }   // 暂停中的从现在算起
        const R = this.gfRoomNow(DATA.skillInfo(st.id, s.gongfa[st.id] || 1)), mul = R ? R.mul : 1;
        const rest = Math.max(0, Math.ceil((st.total - st.done) / mul) - Math.max(0, this.now() - st.at));   // 这一层还要多久（现实毫秒）
        const d = Math.min(left, rest);
        st.at -= d; tick(); left -= d; used += d;
        if (s.gfStudy === st) break;   // 没走完这一层（时间用完，或灵气 / 灵石不够暂停）
      }
      return used;
    },
    /* ---------- 自动队列（用户定 2026-11-24） ----------
     * s.gfAuto = { on, rules: [{ t, lv, star }] }，最多 CFG.gongfa.AUTO_RULES 条
     *   t：all 全部 / 功法类别 id（xinfa、gongjue…，含第 2、3 本）/ spell 法术 / mifa 秘法
     *   lv：低于第几层（计划层 = 当前 + 修炼中 + 排队中 < lv 才补；0 = 不限，补到满层）
     *   star：星级 ≥ 几（0 = 不限）
     * 排队不满 AUTO_Q 个就补：按条件先后，第一条没有可补的才看第二条；同一条里先补计划层最低的，再按星级高的。
     */
    gfAutoTypes() { const o = t => this.gfAutoOrd({ kind: "gf", type: t }); return [["all", "全部"], ...DATA.gongfaTypes.filter(t => !t.base).sort((a, b) => o(a) - o(b)).map(t => [t.id, t.name]), ["spell", "法术"], ["mifa", "秘法"]]; },
    // 「全部」的补充顺序（用户定 2026-11-24）：心法 攻诀 抗性（6 种） 生命 秘诀 法力 命中 闪避 速度，之后 炼体秘诀、法术、秘法
    gfAutoOrd(g) { if (g.kind === "sp") return 20; if (g.kind === "mf") return 21; const st = g.type && g.type.stat, L = ["def", "atk", "res", "hp", "cultivate", "mana", "hit", "dodge", "speed", "body"], i = L.indexOf(st); return i < 0 ? 19 : i; },
    gfAutoCfg() { const s = this.s; if (!s.gfAuto || typeof s.gfAuto !== "object") s.gfAuto = { on: false, rules: [] }; if (!Array.isArray(s.gfAuto.rules)) s.gfAuto.rules = []; return s.gfAuto; },
    gfAutoMatch(g, r) {
      if (r.t === "spell") { if (g.kind !== "sp") return false; }
      else if (r.t === "mifa") { if (g.kind !== "mf") return false; }
      else if (r.t !== "all") { if (g.kind !== "gf" || !g.type || (g.type.base || g.type.id) !== r.t) return false; }
      if (r.star > 0 && (g.noEl || (g.star || 0) < r.star)) return false;
      return true;
    },
    gfAutoFill() {
      const s = this.s, A = s.gfAuto; if (!A || !A.on || !Array.isArray(A.rules) || !A.rules.length || !s.gongfa) return;
      const NQ = Math.min(+CFG.gongfa.AUTO_Q || 2, DATA.GF_QUEUE); if (s.gfQueue.length >= NQ) return;
      // 性能：上次没东西可补、且功法 / 层数 / 队列 / 条件都没变，就不再算（离线结算每 10 秒都会调用）
      const ids = Object.keys(s.gongfa); let lvSum = 0; for (const id of ids) lvSum += s.gongfa[id] || 0;
      const sig = `${ids.length}|${lvSum}|${s.gfStudy ? s.gfStudy.id : ""}|${s.gfQueue.join(",")}|${JSON.stringify(A.rules)}`, M = this._gfaMiss || (this._gfaMiss = new WeakMap());   // 按存档分开记（服务器一个引擎轮流算多个玩家）
      if (M.get(s) === sig) return;
      // 每部只查一次 skillInfo，计划层数一次算好（之前每条条件 × 每补一个都重算）
      const plan = {}; for (const id of s.gfQueue) plan[id] = (plan[id] || 0) + 1;
      if (s.gfStudy) plan[s.gfStudy.id] = (plan[s.gfStudy.id] || 0) + 1;
      const all = [];
      const IC = DATA._gfaInfo || (DATA._gfaInfo = new Map());   // 只用到静态字段（类型、星级、上限），按 id|层 缓存，不随玩家变
      for (const id of ids) { const ck = id + "|" + (s.gongfa[id] || 0); let info = IC.get(ck);
        if (info === undefined) { const g = DATA.skillInfo(id, s.gongfa[id]); info = g ? { kind: g.kind, type: g.type, star: g.star, noEl: g.noEl, max: g.max } : null; if (IC.size > 50000) IC.clear(); IC.set(ck, info); }
        if (!info) continue; const p = (s.gongfa[id] || 0) + (plan[id] || 0), mx = info.max || DATA.GONGFA_MAX; if (p < mx) all.push({ id, info, plan: p, mx, ord: this.gfAutoOrd(info) }); }
      let added = 0;
      while (s.gfQueue.length < NQ) {
        let pick = null;
        for (const r of A.rules) {
          let best = null;
          for (const x of all) {
            if (x.plan >= x.mx || (r.lv > 0 && x.plan >= r.lv) || !this.gfAutoMatch(x.info, r)) continue;
            if (!best || (r.t === "all" && x.ord !== best.ord ? x.ord < best.ord : x.plan !== best.plan ? x.plan < best.plan : (x.info.star || 0) !== (best.info.star || 0) ? (x.info.star || 0) > (best.info.star || 0) : x.id < best.id)) best = x;   // 全部：先按类型顺序；再层数低、星级高
          }
          if (best) { pick = best; break; }
        }
        if (!pick) break;
        s.gfQueue.push(pick.id); pick.plan++; added++;
      }
      if (added) M.delete(s); else M.set(s, sig);
    },
    // 玩家操作（加进 server/action-whitelist.json）
    gfAutoOn() { const A = this.gfAutoCfg(); A.on = !A.on; this.log(`自动队列已${A.on ? "开启" : "关闭"}。`, "sys"); if (A.on) { this.gfAutoFill(); if (!this.s.gfStudy) this.nextStudy(); } this.after(); },
    gfAutoAdd(t) { const A = this.gfAutoCfg(), M = +CFG.gongfa.AUTO_RULES || 10; if (A.rules.length >= M) return this.log(`最多 ${M} 条条件。`, "sys");
      if (!this.gfAutoTypes().some(x => x[0] === t)) t = "all"; A.rules.push({ t, lv: 0, star: 0 }); this.gfAutoFill(); if (!this.s.gfStudy) this.nextStudy(); this.after(); },
    // 添加条件：先选功法类型（本地窗口），选好再加；关闭回到自动队列
    openGfAutoPick() { const T = this.gfAutoTypes();
      this.modal(`<h2>选择功法</h2><div class="sel-list">${T.map(([k, n]) => `<button onclick="G.gfAutoAdd('${k}');G.openGfAuto()">${n}</button>`).join("")}</div>
        <div class="btns"><button onclick="G.openGfAuto()">关闭</button></div>`); },
    gfAutoDel(i) { const A = this.gfAutoCfg(); i = Math.floor(+i); if (!(i >= 0 && i < A.rules.length)) return; A.rules.splice(i, 1); this.after(); },
    gfAutoMove(i, d) { const A = this.gfAutoCfg(); i = Math.floor(+i); if (+d !== 0 && +d !== 1) return; const j = i + (+d === 1 ? 1 : -1);   // d：0 上移、1 下移（服务器不收负数）
      if (!(i >= 0 && i < A.rules.length && j >= 0 && j < A.rules.length)) return; [A.rules[i], A.rules[j]] = [A.rules[j], A.rules[i]]; this.after(); },
    gfAutoSet(i, k, v) {
      const A = this.gfAutoCfg(), r = A.rules[Math.floor(+i)]; if (!r) return;
      if (k === "t") { if (!this.gfAutoTypes().some(x => x[0] === v)) return; r.t = v; }
      else if (k === "lv" || k === "star") { const n = Math.floor(+v); if (!Number.isFinite(n) || n < 0) return; r[k] = Math.min(n, k === "lv" ? DATA.GONGFA_MAX : 99); }
      else return;
      this.gfAutoFill(); if (!this.s.gfStudy) this.nextStudy(); this.after();
    },
    // 自动队列弹窗（只显示，不改存档）
    openGfAuto() {
      const A = this.gfAutoCfg(), T = this.gfAutoTypes(), M = +CFG.gongfa.AUTO_RULES || 10, NQ = +CFG.gongfa.AUTO_Q || 2, re = ";G.openGfAuto()";
      const rows = A.rules.map((r, i) => `<div class="gfa-row"><b>${i + 1}.</b>
        ${this.selBox("gfa" + i, T, r.t, v => { G.gfAutoSet(i, "t", v); G.openGfAuto(); }, () => G.openGfAuto())}
        <span>低于<input type="number" min="0" max="${DATA.GONGFA_MAX}" value="${r.lv || ""}" placeholder="满" onchange="G.gfAutoSet(${i},'lv',this.value||0)${re}">层</span>
        <span>≥<input type="number" min="0" max="99" value="${r.star || ""}" placeholder="任" onchange="G.gfAutoSet(${i},'star',this.value||0)${re}">星</span>
        <span class="gfa-ops"><button class="sm" ${i ? "" : "disabled"} onclick="G.gfAutoMove(${i},0)${re}">↑</button><button class="sm" ${i < A.rules.length - 1 ? "" : "disabled"} onclick="G.gfAutoMove(${i},1)${re}">↓</button><button class="sm" onclick="G.gfAutoDel(${i})${re}">删</button></span></div>`).join("");
      this.modal(`<h2>自动队列</h2><p class="desc">排队不满 ${NQ} 个时，按条件先后自动补：第 1 条没有可补的，才用第 2 条，依此类推。同一条里先补层数最低的，再按星级高的；选「全部」按 心法、功诀、真经（抗性）、真诀（生命）、秘诀、法诀（法力）、身法（命中）、遁术（闪避）、身法（速度）的顺序补。层数空着 = 补到满层，星级空着 = 不限。</p>
        <div class="gfa-list">${rows || `<p class="desc">还没有条件。</p>`}</div>
        <div class="btns"><button class="${A.on ? "primary" : ""}" onclick="G.gfAutoOn()${re}">${A.on ? "已开启（点击关闭）" : "已关闭（点击开启）"}</button>
        <button ${A.rules.length >= M ? "disabled" : ""} onclick="G.openGfAutoPick()">添加条件 ${A.rules.length}/${M}</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    gfAutoBtn() { const A = this.s.gfAuto; return `<button class="sm ${A && A.on ? "active" : ""}" onclick="G.openGfAuto()">自动队列${A && A.on ? "·开" : ""}</button>`; },
    removeQueue(i) { this.s.gfQueue.splice(i, 1); this.after(); },
    // 「功法加成」：所有正在生效、减少功法 / 法术修炼时间的来源（v261 替代原来的「中断」）
    gfBonusView() {
      const m = this.mifaBonus(), ori = this.oriSum ? this.oriSum("gfStudyPct") : 0, K = id => (DATA.mifaKinds.find(k => k.id === id) || {}).name || id;
      const pill = this.studyPillPct ? this.studyPillPct() : 0, R = this.gfRoomNow ? this.gfRoomNow() : null;
      const room = R && !R.pillOnly ? [`${R.name}${R.free ? "（免费）" : ""}`, R.pct] : null;
      const gf = [[K("gfStudy"), (m.gfStudy || 0) - ori], ["出身「书香门第」", ori], ["经脉", this.jmGfCut ? this.jmGfCut() : 0], [`聚灵阵（${(this.s.array || {}).lv || 0} 级）`, this.arrayGfCut ? this.arrayGfCut() : 0], ["《识海演道诀》", this.ssGfSum("gf")]];
      const osp = this.oriSum ? this.oriSum("spStudyPct") : 0;
      const sp = [[K("spStudy"), (m.spStudy || 0) - osp], ["出身「书香门第」", osp], ["《万法通明录》", this.ssGfSum("sp")]];
      const shared = [room, pill > 0 ? [`悟真丹（剩 ${U.dur(this.studyPillLeft() / 1000)}）`, pill] : null].filter(Boolean);
      const sec = (t, a) => { const r = a.filter(x => x && x[1] > 0), tot = r.reduce((s, x) => s + x[1], 0);
        return `<h3>${t}<small>合计 -${U.num(tot)}%</small></h3>${r.length ? r.map(x => `<div class="line"><div>${x[0]}</div><b>-${U.num(x[1])}%</b></div>`).join("") : `<p class="desc">暂无</p>`}`; };
      this.modal(`<h2>功法加成</h2><p class="desc">修炼时间 = 基础时间 ÷ (1 + 减少% 合计)，秘法和功法相同。</p>
        ${sec("功法", gf.concat(shared))}${sec("法术", sp.concat(shared))}${sec("秘法", gf.concat(shared))}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setGfFilter(t) { this.gfFilter = t; this.render(); const g = typeof document !== "undefined" && document.getElementById("gf-scroll"); if (g) g.scrollTop = 0; },   // 换分类时列表回到顶部
    // 排序 / 隐藏满级：「按等级」「按星级」只选一个（by），再点切换方向
    //   默认 等级 低层 → 高层（lvUp = true）、星级 高星 → 低星（starUp = false）
    //   三个设置存在浏览器本地（localStorage），刷新网页不变；按存档分开（用户 2026-11-17）
    gfPref() {
      if (!this._gfPref) { let p = {}; try { p = JSON.parse(this.saveLsGet("xiu_gf_pref2") || "{}") || {}; } catch (e) {}
        let hide = p.hide; if (hide === undefined) { try { hide = !!(JSON.parse(this.saveLsGet("xiu_gf_pref") || "{}") || {}).hide; } catch (e) { hide = false; } }
        this._gfPref = { lvUp: p.lvUp !== false, starUp: p.starUp === true, by: p.by === "star" ? "star" : "lv", hide: !!hide }; }
      return this._gfPref;
    },
    toggleGfPref(k) { const p = this.gfPref(); p[k] = !p[k]; this.saveLsSet("xiu_gf_pref2", JSON.stringify(p)); this.render(); },
    // 按等级 / 按星级只能选一个（用户定 2026-11-14）：点没选中的 → 改用它排序；点已选中的 → 切换方向
    setGfSort(k) { const p = this.gfPref(); k = k === "star" ? "star" : "lv";
      if (p.by !== k) { p.by = k; this.saveLsSet("xiu_gf_pref2", JSON.stringify(p)); return this.render(); }
      this.toggleGfPref(k === "lv" ? "lvUp" : "starUp"); },
    toggleGfHideMax() { this.toggleGfPref("hide"); },

    // 数值显示：身法是闪避（两位小数），其余取整
    // 正在修炼的这一层什么时候结算完（毫秒）；暂停中返回 null（服务器据此准点结算）
    gfStudyEnd() {
      const st = this.s.gfStudy; if (!st || st.stalled) return null;
      const R = this.gfRoomNow(DATA.skillInfo(st.id, this.s.gongfa[st.id] || 1)), mul = R ? R.mul : 1, STEP = DATA.STUDY_STEP * 1000;
      return st.at + Math.ceil((st.total - st.done) / mul);   // 按实际剩余时间（最后一段不满 10 秒也到点就完成）
    },
    gfValue(info, v) { return U.num(v); },
    // 倒计时文字：时分秒（countdownTxt 供 bars() 实时直写共用）
    countdownTxt(ms) {
      const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
      return (h ? h + "小时" : "") + (h || m ? m + "分" : "") + s + "秒";
    },
    // 第3层 → 第4层（目标层红框）
    gfYears(sec) { const y = sec / ((+CFG.player.YEAR_MIN || 15) * 60); return `${y >= 100 ? Math.round(y) : +y.toFixed(1)}年`; },   // 游戏时间：现实 15 分钟 = 1 年（用户定 2026-11-16）
    // 「修炼队列」页：正在修炼（倒计时、进度、消耗）+ 排队中的
    // 当前修炼进度：{ done, left, mul }（无修炼返回 null），倒计时卡片与队列累计共用
    gfStudyProg() {
      const s = this.s, st = s.gfStudy; if (!st) return null;
      const R = this.gfRoomNow(), mul = R ? R.mul : 1;
      const done = st.stalled ? st.done : Math.min(st.total, st.done + Math.max(0, API.now() - st.at) * mul);
      const left = st.stalled ? (st.total - done) / mul : Math.max(0, st.at + Math.ceil((st.total - st.done) / mul) - API.now());
      return { done, left, mul };
    },
    // 修炼中卡片：只在「修炼队列」页显示（用户定），放在滚动区之外固定不滑，倒计时常驻可见（无修炼返回空）
    // 倒计时与进度条不在 HTML 里写死数值（每秒变会让整页每秒重建、列表滑动被打断），只留空位由 bars() 实时直写
    gfStudyCard() {
      const s = this.s, st = s.gfStudy; if (!st) return "";
      const info = DATA.skillInfo(st.id, s.gongfa[st.id]), p = this.gfStudyProg(), mul = p.mul;
      // “共 X 灵气”按当前练功房倍率估算：每 5 秒单位灵气 ×mul，总单位数 ÷mul（mul=1 时与旧式一致）
      // 星级 + 修到第几层（只显示目标层），不换行（用户定 2026-11-16）
      return `<div class="card"><h3 class="gf-cur-h"><span class="gf-cur-l">修炼中 ·《${info ? info.name : st.id}》</span><span class="gf-tags">${info && !info.noEl ? `<span class="tag">${info.star}星</span>` : ""}${info ? `<span class="tag gf-to">第${info.lv + 1}层</span>` : ""}</span></h3>
        <div class="bar tick"><div id="gf-cd-bar"></div></div>
        <div class="gf-info"><div class="gf-info-l"><div class="row small"><span>${st.stalled ? `<b class='q5'>${st.stone ? "灵气或灵石" : "灵气"}不足，暂停中</b>` : `${info ? `<span class="c-green">${this.gfGainTxt(info)}</span> · ` : ""}倒计时 <b><span class="cd" id="gf-cd"></span></b>`}</span></div>
        <div class="row small gf-cost"><span>每 10 秒消耗 <b>${U.fmt(this.ssGfPer(st.per * mul) * DATA.STUDY_SETTLE())}</b> 灵气${st.stone ? ` + ${U.fmt(Math.round(st.stone * mul * DATA.STUDY_SETTLE()))} 灵石` : ""} · 已消耗 <b>${U.fix(U.fmt(st.spent))}</b> / ${U.fmt(this.ssGfPer(st.per * mul) * st.total / (DATA.STUDY_STEP * 1000 * mul))}</span></div></div><div class="gf-btns">${this.gfAutoBtn()}<button class="sm" onclick="G.gfBonusView()">功法加成</button></div></div></div>`;
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
    // 修炼队列一行：这一层修完加多少（如「防御 +156」），代替原来的「需 X · 约」（用户定 2026-11-14）
    gfGainTxt(g) {
      if (!g) return "";
      if (g.kind === "sp") return `伤害 +${U.dec(g.next - g.pct)}%`;
      if (g.kind === "mf") return `${g.label} ${g.mk.sign}${U.num2(g.next - g.value)}${g.mk.unit}`;
      const spd = g.type && (g.type.stat === "cultivate" || g.type.stat === "body" || g.type.stat2 === "cultivate" || g.type.stat2 === "body");
      const lg = g.noEl || !g.el ? 0 : this.s.lingen[g.el.id] || 0, k = lg ? (spd ? this.lingenGongfa(g.el.id) : this.lingenOt(g.el.id)) : 1;
      return `${g.label} +${this.gfValue(g, (g.next - g.value) * k)}${g.label2 ? ` · ${g.label2} +${this.gfValue(g, (g.next2 - g.value2) * k)}` : ""}`;
    },
    gfQueueView() {
      const s = this.s;
      let html = "";
      if (!s.gfStudy) html += `<div class="card"><div class="row small"><p class="desc">当前没有在修炼的功法。在各分类里点「修炼」加入队列，或设置自动队列。</p>${this.gfAutoBtn()}</div></div>`;
      const { rows, total } = this.gfQueueTimes();
      html += `<div class="card"><h3>排队中<small>${s.gfQueue.length} / ${DATA.GF_QUEUE}${s.gfQueue.length ? ` · 全部完成约 <span class="cd" id="gf-q-total"></span>` : ""}</small></h3>` +
        (s.gfQueue.length ? `<div class="gf-qlist">` + s.gfQueue.map((id, i) => {
          const q = DATA.skillInfo(id); if (!q) return "";
          // 一张网格排所有行：星级/层数一列对齐，下面对齐放剩余时间+后完成；按钮只留「移除」（用户定 2026-11-16）
          return `<div class="gf-qrow"><div class="gf-qn">${i + 1}. 《${q.name}》</div><div class="gf-tags gf-q-tg">${q.noEl ? "" : `<span class="tag">${q.star}星</span>`}<span class="tag gf-to">第${rows[i].lv + 1}层</span></div><div class="gf-qb"><button class="sm" onclick="G.removeQueue(${i})">移除</button></div><small class="gf-qs c-green">${this.gfGainTxt(DATA.skillInfo(id, rows[i].lv))}</small><small class="gf-qt"><span class="cd" id="gf-q-${i}-acc"></span>后完成</small></div>`; }).join(`<div class="gf-qsep"></div>`) + `</div>`
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
      const nxV = [], nx = { v: nxV, d: desc.replace(/，下一层 ([^，；]*)/g, (_, v) => { nxV.push(v); return ""; }) };   // 描述里的「下一层 X」移到下一层那行（用户定 2026-11-16）
      const sec = max ? 0 : this.studySec(g), n = Math.ceil(sec / DATA.STUDY_STEP), per = max ? 0 : this.ssGfPer(DATA.studyPer(g), !(this.s.gfStudy && this.s.gfStudy.id === g.id)), sp = max ? 0 : g.layerStone || 0;
      return `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》${g.noEl ? "" : `<span class="tag">${g.star}星</span>`}${g.kind === "mf" || g.noEl ? "" : `<span class="tag">${g.el.name}</span>`}<span class="tag gf-lv">第${g.lv}层</span><div class="c-red" style="white-space:nowrap;min-height:1.4em">${plan > g.lv ? `已排至第${plan}层` : ""}</div>
        <small>${nx.d}${max ? "" : `<br>下一层：${nx.v.length ? nx.v.join("；") + " · " : ""}${this.gfYears(sec)} · 每10秒 ${U.fmt(per * DATA.STUDY_SETTLE())} 灵气${sp ? ` + ${U.fmt(Math.round(sp * DATA.STUDY_SETTLE() / n))} 灵石` : ""}`}</small></div>
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
      <button class="sm ${P.by === "lv" ? "active" : ""}" onclick="G.setGfSort('lv')">按等级 ${P.lvUp ? "低→高" : "高→低"}</button>
      <button class="sm ${P.by === "star" ? "active" : ""}" onclick="G.setGfSort('star')">按星级 ${P.starUp ? "低→高" : "高→低"}</button>
      <button class="sm ${hide ? "active" : ""}" onclick="G.toggleGfHideMax()">${hide ? "显示满级" : "隐藏满级"}</button></div>`;

    const full = ids.map(id => DATA.skillInfo(id, s.gongfa[id])).filter(Boolean), all = full.filter(g => !hide || g.lv < (g.max || DATA.GONGFA_MAX));
    // 右上角数量统计全部已学的（隐藏满级的也算）
    const mk = (key, title, sub, f) => ({ key, title, sub, items: all.filter(f), total: full.filter(f).length });
    const groups = [...DATA.gongfaTypes.filter(t => !t.base).map(t => mk(t.id, t.name, t.catLabel || t.label, g => g.kind === "gf" && (g.type.base || g.type.id) === t.id)),
                    mk("spell", "法术", "放入背包法术栏后战斗中施放", g => g.kind === "sp"),
                    mk("mifa", "秘法", "宗门秘法殿学习 · 修炼消耗灵气和灵石", g => g.kind === "mf")];
    // 按选中的（等级或星级）排，相同再按另一个
    const byLv = (a, b) => P.lvUp ? a.lv - b.lv : b.lv - a.lv, bySt = (a, b) => P.starUp ? a.star - b.star : b.star - a.star;
    const sortFn = P.by === "star" ? (a, b) => bySt(a, b) || byLv(a, b) : (a, b) => byLv(a, b) || bySt(a, b);   // 选中的为主，相同再按另一个
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
