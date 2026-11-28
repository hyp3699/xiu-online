/* =====================================================================
 * 离线 / 后台补算加速（结果和逐个 10 秒结算完全一样）
 * ---------------------------------------------------------------------
 * 补算时把时间分成两种：
 *   1. 有「事件」的那一次结算（功法学会、事务堂完成、灵药收获、炼丹出炉、北京时间 0 点、丹药药力耗尽、
 *      修炼室贡献不足……）：照常调用各模块的 tick，逐个精确处理。
 *   2. 两个事件之间的「纯数值」结算（生命法力恢复、聚灵、修为修炼、肉身修炼、功法修炼进度、修炼室扣贡献、
 *      自动补充灵气扣灵石）：不调用各模块，直接用同样的公式、同样的先后顺序做数字计算，非常快。
 * 只要有一点点拿不准（正在探索、渡劫、出窍秘法修炼、新加了带 tick 的模块……）就退回逐个结算，保证数据准确。
 * 新增带 tick 的模块后，要在 FAST_MODULES 里登记并在 fastTick 里写好它的纯数值部分，否则会自动退回逐个结算。
 * ===================================================================== */
(function () {
  // 这些模块的 tick 已在下面处理（按 index.html 的加载顺序结算）
  const FAST_MODULES = ["player", "cave", "gongfa", "sect", "cultivate", "body", "world", "xingjun", "craft", "garden", "servant"];
  const D = 86400000, B = 8 * 3600000;

  Object.assign(G, {
    // 从时间 t0 起补算 n 次结算（第 i 次的时间 = t0 + i × 10 秒）
    runTicks(t0, n) {
      const T = DATA.TICK * 1000;
      // 补算期间秘法加成按属性缓存版本记住（功法 / 秘法升层都会 dirty()，版本一变就重算）
      const orig = this.mifaBonus; let ver = -1, mb = null;
      this.mifaBonus = function () { if (ver !== this._ver) { mb = orig.call(this); ver = this._ver; } return mb; };
      try {
        let i = 0;
        while (i < n) {
          i++; this._simNow = t0 + i * T; this.tickAll(true);
          if (i < n) i += this.fastTicks(t0 + (i + 1) * T, n - i);
        }
      } finally { this._simNow = 0; this.mifaBonus = orig; }
    },

    // 下一个事件的时间（毫秒时间戳）；返回 -Infinity = 现在就不能加速
    fastNextEvent(tk) {
      const s = this.s, ev = [];
      // 只在这些模块有 tick 时加速
      const ids = this.modules.filter(m => m.tick).map(m => m.id);
      if (ids.length !== FAST_MODULES.length || ids.some((id, k) => id !== FAST_MODULES[k])) return -Infinity;
      // 离线自动胜利补算的普通自动探索：中间不用逐个结算，快进到这一次走完那一刻（world.js exAutoFast / exAvgLoot，用户定）
      // 出窍：走满次数那一刻是事件（回来）；秘境 / 灵地：每处走完那一刻是事件（接着下一处 / 结束）
      const xOk = x => !x || (this.exAutoFast && this.exAutoFast(x) && x.ms), xf = (s.explore || s.cq) && xOk(s.explore) && xOk(s.cq);
      if (xf) for (const x of [s.explore, s.cq]) { if (!x) continue; const run = this.exCfg(x).TIME * x.ms + (CFG.explore.END_WAIT || 0) * 1000;
        if (x.mj !== undefined) ev.push(x.start + run); else if (x.cq) ev.push(x.start + Math.max(1, x.cq - x.count) * run); }
      else if (s.explore || s.cq) return -Infinity;
      if (s.trib && !s.trib.result) return -Infinity;   // 探索 / 渡劫中：逐个结算；渡劫已出结果（只剩领奖）可以加速
      if (this.yearRwNextAt) ev.push(this.yearRwNextAt());   // 修炼年数奖励到点
      if (this.lkNextAt) { const t = this.lkNextAt(); if (t) ev.push(t); }   // 灵矿每 STEP_MIN 分钟进一次灵石（world.js lkSettle）：结算那一刻逐个结算
      if (s.zf && s.zf.job) ev.push(s.zf.job.end);   // 属性阵修炼到时结算：快进到 job 结束那一刻再逐个结算（灵气修炼开始时已扣完，修炼中无逐秒消耗；主动阵按次收费不影响加速）
      // 自动悟道读条到时：快进到读满那一刻再逐个结算（wdAutoSettle 发奖；手动记录不等，客户端读条自己发 wudaoDone）
      { const _wd = s._wdStart; if (_wd && typeof _wd === "object" && !Array.isArray(_wd)) for (const dao of Object.keys(_wd)) { const r = _wd[dao]; if (r && r.auto === 1 && r.at) ev.push(r.at + (((CFG.wudaoRoom || {}).TIME || 0)) * 1000); } }
      const cs = s.cultSet;                                       // 修炼设置：快要自动去探索时逐个结算
      if (cs && cs.on && cs.tgt && s.stone < cs.low) return -Infinity;
      // 灵气不足时修炼设置挡住不修炼：灵气不足也加速会把“不修炼”加速成“修炼”
      // （条件与 cultivate.js 的 cultSetCheck 同口径）
      if (cs && cs.on) { const R = this.csRate(); if (R.act ? s.ling < Math.max(1, R.need) : this.cultLack()) return -Infinity; }
      if (!s.gfStudy && s.gfQueue && s.gfQueue.length) return -Infinity;
      // 北京时间下一个 0 点（免费修炼室 / 练功房重置、道童俸禄）
      const last = tk - DATA.TICK * 1000;
      ev.push(Math.floor((last + B) / D) * D - B + D);
      // 自动执行任务：北京时间 0:05（今天还没执行就是今天的，执行过就是明天的）
      if (this.autoTaskAny()) { const m5 = Math.floor((last + B) / D) * D - B + 5 * 60000; ev.push(s.autoTask.day === this.bjDay() || last >= m5 ? m5 + D : m5); }
      if (s.gfLearn) ev.push(s.gfLearn.end);
      if (s.studyBuff && s.studyBuff.end && this.studyPillFix) this.studyPillFix(s.studyBuff);
      if (s.studyBuff && s.studyBuff.end) ev.push(s.studyBuff.end);   // 悟真丹到期：重新算练功房倍率
      if (s.cqzjL) ev.push(s.cqzjL.end);   // 出窍真诀学完
      if (s.ngL) ev.push(s.ngL.end);   // 太上内观经学完
      // 门派：炼体池、事务堂、免费练功房到时
      if (s.pool && s.pool.end) ev.push(s.pool.end);
      if (s.jd && s.jd.cur) ev.push(s.jd.cur.end);   // 讲道室听完
      const a = s.affair;
      if (s.sect && a && a.task !== undefined && a.task >= 0) { const t = DATA.affairs[a.task]; if (!t) return -Infinity; ev.push(a.start + t.time * 60000); }
      if (s.freeGf && s.sect && last < s.freeGf.end) ev.push(s.freeGf.end);
      // 修炼室 / 练功房每 ROOM_BILL_SEC 秒扣贡献：fastRun 里按同样的规则逐次扣，贡献不够那一刻才算事件（用户定）；
      // 旧存档还没起算（没有 roomAt / gfRoomAt）的先逐个结算一次
      for (const k of ["room", "gfRoom"]) if (s.sect && s[k] >= 0) { if (!s[k + "At"]) return -Infinity; if (!(k === "room" ? DATA.rooms : DATA.gfRooms)[s[k]]) return -Infinity; }
      // 星君官位俸禄
      const H = (CFG.xingjun.HOUR || 3600) * 1000;
      for (const w in s.offices || {}) { const o = s.offices[w]; if (!o) continue; if (!o.T) return -Infinity; ev.push(o.T + H); }
      // 炼丹炼器
      if (s.danStudy) ev.push(s.danStudy.end);
      if (s.forgeStudy) ev.push(s.forgeStudy.end);
      if (s.bmJob && s.bmJob.end) ev.push(s.bmJob.end);   // 本命法宝炼成：到时加成才生效，不能跨过它做纯数值结算
      if (Array.isArray(s.mailbox) && G.MAILBOX_DAYS > 0) for (const x of s.mailbox) if (x && x.at) ev.push(x.at + G.MAILBOX_DAYS * 86400000);   // 传音到期：到时清掉过期项（MAILBOX_DAYS 0 = 无期限，没有到期事件）
      const j = s.forgeJob;
      if (j) ev.push(j.end);   // 炼器到期是事件（背包满时出炉物品进传音，不暂停）
      const al = s.alchJob;
      if (al) { if (al.done >= al.n) return -Infinity; ev.push(al.next); }
      // 灵药园（等灵气的在 fastTick 里按灵气判断）
      for (const f of s.fields || []) if (f.g >= 0 && !f.wait) ev.push(f.start + this.fieldTime(f.g, f));
      // 道童选拔
      if (s.svPick && s.svPick.end) ev.push(s.svPick.end);
      return Math.min(...ev);
    },

    // 从时间 tk 开始最多加速 maxN 次结算，返回实际加速了几次（0 = 这一次要逐个结算）
    fastTicks(tk, maxN) {
      // 秘法加成在两个事件之间不变：这里只算一次（mifaBonus 本身没有缓存）
      const mb = this.mifaBonus(), orig = this.mifaBonus;
      this.mifaBonus = () => mb;
      try { return this.fastRun(tk, maxN); } finally { this.mifaBonus = orig; }
    },
    fastRun(tk, maxN) {
      const s = this.s, T = DATA.TICK * 1000;
      const tEv = this.fastNextEvent(tk);
      if (!(tEv > tk)) return 0;
      const n = Math.min(maxN, Math.ceil((tEv - tk) / T));
      if (n < 2) return 0;

      // ---------- 两个事件之间不变的数值 ----------
      const st = this.stats(), R0 = this.regen(false), sp = this.speed();
      const HP = st.hp, MP = st.mana, CAP = this.lingCap(), GATH = sp.gather;
      // 功法修炼
      const gs = s.gfStudy, STEP = DATA.STUDY_STEP * 1000;
      if (gs && (gs.ling !== 1 || (gs.u || 5) !== DATA.STUDY_STEP)) return 0;   // 旧存档 / 结算单位改过：先逐个结算转换
      const SE = DATA.STUDY_SETTLE();
      if (this.lmActive && this.lmActive()) return 0;   // 租借了灵脉：灵气先扣灵脉，逐个结算
      const GR = gs ? this.gfRoomNow(DATA.skillInfo(gs.id, s.gongfa[gs.id] || 1)) : null, RU = this.gfRoomUnits();
      // 修为修炼
      const cultOn = this.isCultivating() && this.hasMijue() && !this.exBlocksCult();
      if (cultOn) for (const t in DATA.pills) { const b = s.buffs[t]; if (s.autoPill[t] && (!b || b.left <= 0) && this.bestPillIndex(t) >= 0) return 0; }
      const bodyOn = !!s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax(), anyOn = cultOn || bodyOn;   // 只开肉身时修炼室由肉身扣
      const freeOn = anyOn && this.freeCultOn();   // 免费修炼室；付费修炼室 / 练功房扣贡献见下面 RB
      const SP = sp.total, RED = this.wdRed("exp"), BRED = this.wdRed("body"), RATE = this.lingPerStone(), refill = !!s.array.autoRefill, KEEP = Math.max(0, +s.array.keepStone || 0);   // 保留灵石（用户定）
      const ZFKEEP = this.zfKeep ? this.zfKeep() : 0;   // 主动阵运转消耗（每 10 秒；开着的阵、等级在加速区间内不变，只算一次）
      const buffs = cultOn ? Object.values(s.buffs).filter(b => b.left > 0) : [];
      // 肉身修炼
      const BSP = bodyOn ? this.bodySpeed().total : 0, BR = Math.max(0.0001, CFG.body.LING_RATE || 1);
      // 灵药园等灵气的田
      const CS = s.cultSet, CSL = CS && CS.on && CS.tgt ? CS.low : -Infinity;
      const waitNeed = (s.fields || []).filter(f => f.g >= 0 && f.wait === true).map(f => (DATA.herbGrow(f.g) || {}).ling ?? 0);
      const waitMin = waitNeed.length ? Math.min(...waitNeed) : Infinity;
      // 道童自动发俸禄：灵石够了就是事件
      let payMin = Infinity;
      if (s.svAuto) for (const d of s.servants || []) { const c = this.svOwed(d) * this.svSalary(d); if (c > 0) payMin = Math.min(payMin, c); }

      // 付费修炼室 / 练功房扣贡献（同 sect.js roomBill）：免费房使用中只把下次扣费时间往后推；贡献不够要离开房间 = 事件
      const RB = [], RT = this.roomBillMs();
      for (const k of ["room", "gfRoom"]) if (s.sect && s[k] >= 0) RB.push({ k, c: k === "room" ? this.roomCost(s[k]) : this.gfRoomCost(s[k]), free: k === "gfRoom" ? !!(this.freeGfOn && this.freeGfOn()) : null });
      const FREE0 = !!this.freeCultOn();   // 免费修炼室开着（没在修炼时次数不减，一直开着）
      let contrib = s.contrib, rAt = RB.map(r => s[r.k + "At"]), billed = false;
      // ---------- 逐次做数字计算（顺序和各模块 tick 一致） ----------
      let hp = s.hp, mana = s.mana, ling = s.ling, exp = s.exp, stone = s.stone, bodyExp = s.bodyExp, lack = s.lackWarned;   // 贡献：付费房扣费在上面 RB 里算
      let freeLeft = freeOn ? s.freeCult.left : 0;
      let bl = buffs.map(b => b.left);
      let at = gs ? gs.at : 0, done = gs ? gs.done : 0, spent = gs ? gs.spent : 0, spentStone = gs ? gs.spentStone : undefined, su = gs ? gs.su || 0 : 0, rU = gs ? gs.rU || 0 : 0, stalled = gs ? gs.stalled : undefined;
      let m = 0, stop = false;
      // 逐次结算一次（now 时刻）：遇到事件返回 false，这一次整次作废
      const one = now => {
        // 用临时变量算这一次，遇到事件就整次作废，交给逐个结算
        let h = hp, mp = mana, L = ling, ex = exp, sn = stone, be = bodyExp, lk = lack, fl = freeLeft;
        let a2 = at, d2 = done, s2 = spent, ss2 = spentStone, su2 = su, ru2 = rU, sl2 = stalled, bl2 = bl;
        let cb = contrib, rA2 = rAt, bd = false;
        // 1. player：生命、法力恢复
        if (h < HP) h = Math.min(HP, h + HP * R0.hp / 100);
        if (mp < MP) mp = Math.min(MP, mp + MP * R0.mana / 100);
        // 2. cave：聚灵
        if (L < CAP) L = Math.min(CAP, L + GATH);   // 上限变低不删已有灵气
        if (ZFKEEP > 0) L = Math.max(0, L - ZFKEEP);   // 主动阵运转消耗：聚灵先封顶、再扣 KEEP，下限 0（同 cave.tick）
        // 3. gongfa：功法修炼进度
        if (gs) {
          { const mul0 = GR ? GR.mul : 1, rem0 = Math.ceil((gs.total - d2) / (STEP * mul0));   // 同 gongfa.js 的 fin：最后不足 10 秒的一段到点就结算 → 这层修完是事件，交给逐个结算
            if (!sl2 && rem0 <= SE && now >= a2 + Math.ceil((gs.total - d2) / mul0)) return false; }
          const steps = Math.floor((now - a2) / (SE * STEP));   // 每 10 秒结算（和 gongfa.js 一样）
          if (steps > 0) {
            a2 += steps * SE * STEP;
            const mul = GR ? GR.mul : 1, per = this.ssGfPer(gs.per * mul), sps = (gs.stone || 0) * mul;
            const rem = Math.ceil((gs.total - d2) / (STEP * mul)), want = Math.min(SE * steps, rem);
            if (L < want * per && refill) { const pay = Math.min(Math.ceil((want * per - L) / RATE), Math.floor(sn - KEEP - (sps ? want * sps : 0)), Math.max(0, Math.ceil((CAP - L) / RATE))); if (pay > 0) { sn -= pay; L = Math.min(CAP, L + pay * RATE); } }   // 自动补灵气封顶到 lingCap（同 gongfa.tick）
            // 同 gongfa.js：灵石为负时 can 不能为负，否则会倒加灵气 / 贡献。
            let can = Math.max(0, Math.min(want, per > 0 ? Math.floor(L / per) : Infinity, sps ? Math.floor(sn / sps) : Infinity));
            if (can < rem) can -= can % SE;
            L -= can * per; s2 += can * per; d2 = can >= rem ? gs.total : Math.min(gs.total, d2 + can * STEP * mul);
            if (sps) {   // 同 gongfa.js：按单位四舍五入累计，这层走完扣满 sc
              const C = gs.sc || Math.round(gs.stone * Math.ceil(gs.total / STEP)); su2 += can * mul;
              const tgt = d2 >= gs.total ? C : Math.min(C, Math.round(gs.stone * su2)), pay = Math.max(0, tgt - (ss2 || 0));
              sn -= pay; ss2 = (ss2 || 0) + pay; }
            sl2 = can < want && d2 < gs.total;
            if (d2 >= gs.total) return false;   // 修炼完成：事件
          }
        }
        // 4. sect：0 点重置、炼体池、事务堂都是事件（已算进时间）；付费房扣贡献
        if (RB.length) {
          rA2 = rAt.slice(); let quit = false;
          for (let r = 0; r < RB.length; r++) {
            const R = RB[r];
            if (R.k === "room" ? FREE0 && (!freeOn || fl > 0) : R.free) { rA2[r] = now + RT; continue; }   // 免费房使用中：付费房不扣（fl 为这次扣次数前的免费次数，免费房开着才 >0）
            if (now < rA2[r]) continue;
            const nn = Math.floor((now - rA2[r]) / RT) + 1;
            if (R.c > 0 && Math.floor(cb / R.c) < nn) { quit = true; break; }   // 贡献不够：离开房间 = 事件，交给逐个结算
            cb -= nn * R.c; rA2[r] += nn * RT; bd = true;
          }
          if (quit) return false;
        }
        // 5. cultivate：修为修炼
        let ended = false;
        if (cultOn) {
          if (freeOn) { if (--fl <= 0) return false; }   // 免费修炼室次数用完：事件（付费修炼室扣贡献见上面第 4 步）
          if (L < SP - RED && refill && sn >= 1) { const pay = Math.min(Math.ceil((SP - RED - L) / RATE), Math.floor(sn - KEEP), Math.max(0, Math.ceil((CAP - L) / RATE))); if (pay > 0) { sn -= pay; L = Math.min(CAP, L + pay * RATE); } }   // 自动补灵气封顶到 lingCap（同 cultivate.tick）
          const PER = Math.max(0, SP - RED) / Math.max(1e-9, SP), gain = PER > 0 ? Math.min(SP, Math.floor(L / PER)) : SP;
          if (gain <= 0) { if (!lk) lk = true; fl++; }   // 与 cultivate.tick 一致：灵气耗尽的 tick 不扣免费修炼室次数
          else {
            L = Math.max(0, L - gain * PER); ex += gain;
            if (gain < SP * 0.999) { if (!lk) lk = true; } else lk = false;
            if (bl.length) { bl2 = bl.slice(); for (let k = 0; k < bl2.length; k++) if (bl2[k] > 0 && --bl2[k] === 0) ended = true; }   // 药力耗尽：算完这一次就停
          }
        }
        // 7. body：肉身修炼
        if (bodyOn) {
          if (!cultOn) {
            if (freeOn) { if (--fl <= 0) return false; }   // 免费修炼室次数用完：事件
          }
          if (L < BSP * BR - BRED && refill && sn >= 1) { const pay = Math.min(Math.ceil((BSP * BR - BRED - L) / RATE), Math.floor(sn - KEEP), Math.max(0, Math.ceil((CAP - L) / RATE))); if (pay > 0) { sn -= pay; L = Math.min(CAP, L + pay * RATE); } }   // 自动补灵气封顶到 lingCap（同 body.tick）
          const BPER = Math.max(0, BSP * BR - BRED) / Math.max(1e-9, BSP), g = BPER > 0 ? Math.min(BSP, Math.floor(L / BPER)) : BSP;
          if (g > 0) { L = Math.max(0, L - g * BPER); be += g; }
          else if (!cultOn && freeOn) fl++;   // 与 body.tick 一致：只开肉身且灵气耗尽的 tick 不扣免费修炼室次数
        }
        // 修炼设置：灵石掉到下限以下 → 事件（可能要自动去探索）
        if (sn < CSL) return false;
        // 11. garden：等灵气的田灵气够了 → 事件
        if (L >= waitMin) return false;
        // 12. servant：灵石够发俸禄 → 事件
        if (sn >= payMin) return false;
        // 这一次没有事件：提交
        hp = h; mana = mp; ling = L; exp = ex; stone = sn; bodyExp = be; lack = lk; freeLeft = fl; contrib = cb; rAt = rA2; if (bd) billed = true;
        at = a2; done = d2; spent = s2; spentStone = ss2; su = su2; rU = ru2; stalled = sl2; bl = bl2;
        if (ended) stop = true;
        return true;
      };
      // 稳态合并（用户定）：最近两个周期（1/2/3/6 次）每次的变化完全一样，就按线性直接跳到区间末尾；
      // 只真算最后一个周期，结果对上才采用（各种判断都是线性量和常数比，起点和终点一样，中间也一样），对不上就减半再试
      const snap = () => [hp, mana, ling, exp, stone, bodyExp, freeLeft, contrib, at, done, spent, spentStone === undefined ? 0 : spentStone, su, rU, lack ? 1 : 0, stalled === undefined ? -1 : stalled ? 1 : 0, ...rAt, ...bl];
      const load = v => { [hp, mana, ling, exp, stone, bodyExp, freeLeft, contrib, at, done, spent] = v; spentStone = spentStone === undefined && !v[11] ? undefined : v[11]; su = v[12]; rU = v[13]; lack = !!v[14]; stalled = v[15] < 0 ? undefined : !!v[15];
        rAt = v.slice(16, 16 + rAt.length); bl = v.slice(16 + rAt.length); };
      const near = (x, y) => x === y || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
      const PS = [1, 2, 3, 6], HN = 13, H = [snap()];
      let nextTry = 0;
      const jump = () => {
        for (const P of PS) {
          if (H.length < 2 * P + 1) break;
          const a = H[H.length - 1], b = H[H.length - 1 - P], c = H[H.length - 1 - 2 * P], D = a.map((x, i) => x - b[i]);
          // 灵石自动补灵气：每次补的是整块灵石，补的时机不规则 → 把灵气和灵石合成一个量（灵气 + 灵石×每块灵气）看是否线性（用户定：聚灵总量减消耗一次算）
          const E = b.map((x, i) => x - c[i]), Q = (d, k) => k === 2 ? d[2] + d[4] * RATE : d[k];
          let qm = false;
          if (!D.every((d, i) => near(d, E[i]))) {
            if (!(RATE > 0) || !(D[4] < 0 || E[4] < 0) || !D.every((d, i) => i === 4 || near(Q(D, i), Q(E, i)))) continue;
            qm = true;
          }
          if (D[14] || D[15]) continue;
          if (qm) { D[2] = Q(D, 2); D[4] = 0; }
          const rb = rAt, bb = bl, bd0 = billed;
          for (let k = Math.floor((n - m) / P); k >= 2; k = Math.floor(k / 2)) {
            const v = a.map((x, i) => x + (k - 1) * D[i]), m0 = m + (k - 1) * P;
            if (qm) {   // 按整块灵石补回到可能的最低位置（最近几次灵气最大值 − 一块灵石的灵气）；最后一个周期真算时补灵气的逻辑会补齐，结果和逐次算一样
              const ref = Math.max(0, Math.max(...H.map(h => h[2])) - RATE), pay = Math.max(0, Math.ceil((ref - v[2]) / RATE - 1e-9));
              if (a[4] - pay < KEEP) continue;
              v[2] += pay * RATE; v[4] = a[4] - pay; if (v[2] > CAP) continue; }
            load(v); let ok = true;
            for (let q = 0; q < P && ok; q++) ok = one(tk + (m0 + q) * T) && !stop;
            if (ok) { const w = snap(), dw = w.map((x, i) => x - v[i]); ok = qm ? dw[4] <= 0 && dw.every((d, i) => i === 4 || near(i === 2 ? d + dw[4] * RATE : d, D[i])) : dw.every((d, i) => near(d, D[i])); if (ok) { m = m0 + P; H.length = 0; H.push(w); return true; } }
            load(a); rAt = rb; bl = bb; billed = bd0; stop = false;
          }
        }
        return false;
      };
      while (m < n && !stop) {
        if (m >= nextTry && H.length >= 3 && !jump()) nextTry = m + 32;
        if (m >= n || stop) break;
        if (!one(tk + m * T)) break;
        m++; H.push(snap()); if (H.length > HN) H.shift();
      }
      // 上面 break 时 m 是作废那一次的序号（= 已提交次数）；正常结束时 m = 已提交次数
      const done_n = m;
      if (!done_n) return 0;
      s.hp = hp; s.mana = mana; s.ling = ling; s.exp = exp; s.stone = stone; s.bodyExp = bodyExp; s.lackWarned = lack;
      if (freeOn) s.freeCult.left = freeLeft;
      if (RB.length) { s.contrib = contrib; RB.forEach((R, r) => { s[R.k + "At"] = rAt[r]; }); if (billed) this.dirty(); }
      buffs.forEach((b, k) => { b.left = bl[k]; });
      if (gs) { gs.at = at; gs.done = done; gs.spent = spent; if (spentStone !== undefined) gs.spentStone = spentStone; if (su) gs.su = su; if (rU) gs.rU = rU; else delete gs.rU; if (stalled !== undefined) gs.stalled = stalled; }
      if (stop) this.dirty();   // 丹药药力耗尽：修炼速度重新计算（和 cultivate.js 一样）
      return done_n;
    },
  });
})();
