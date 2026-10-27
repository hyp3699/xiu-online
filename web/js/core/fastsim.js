/* =====================================================================
 * 离线 / 后台补算加速（结果和逐个 10 秒结算完全一样）
 * ---------------------------------------------------------------------
 * 补算时把时间分成两种：
 *   1. 有「事件」的那一次结算（功法学会、事务堂完成、灵药收获、炼丹出炉、北京时间 0 点、丹药药力耗尽、
 *      修炼室贡献不足……）：照常调用各模块的 tick，逐个精确处理。
 *   2. 两个事件之间的「纯数值」结算（生命法力恢复、聚灵、修为修炼、肉身修炼、功法修炼进度、修炼室扣贡献、
 *      自动补充灵气扣灵石）：不再调用各模块，直接用同样的公式、同样的先后顺序做数字计算，非常快。
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
      if (s.explore || s.cq || s.trib) return -Infinity;               // 探索 / 渡劫：逐个结算
      const cs = s.cultSet;                                       // 修炼设置：快要自动去探索时逐个结算
      if (cs && cs.on && cs.tgt && s.auto && s.stone < cs.low) return -Infinity;
      if (!s.gfStudy && s.gfQueue && s.gfQueue.length) return -Infinity;
      // 北京时间下一个 0 点（免费修炼室 / 练功房重置、道童俸禄）
      const last = tk - DATA.TICK * 1000;
      ev.push(Math.floor((last + B) / D) * D - B + D);
      // v230 自动执行任务：北京时间 0:05（今天还没执行就是今天的，执行过就是明天的）
      if (this.autoTaskAny()) { const m5 = Math.floor((last + B) / D) * D - B + 5 * 60000; ev.push(s.autoTask.day === this.bjDay() || last >= m5 ? m5 + D : m5); }
      if (s.gfLearn) ev.push(s.gfLearn.end);
      if (s.cqzjL) ev.push(s.cqzjL.end);   // 出窍真诀学完
      // 门派：练体池、事务堂、免费练功房到时
      if (s.pool && s.pool.end) ev.push(s.pool.end);
      if (s.jd && s.jd.cur) ev.push(s.jd.cur.end);   // 讲道室听完
      const a = s.affair;
      if (s.sect && a && a.task !== undefined && a.task >= 0) { const t = DATA.affairs[a.task]; if (!t) return -Infinity; ev.push(a.start + t.time * 60000); }
      if (s.freeGf && s.sect && last < s.freeGf.end) ev.push(s.freeGf.end);
      // 星君官位俸禄
      const H = (CFG.xingjun.HOUR || 3600) * 1000;
      for (const w in s.offices || {}) { const o = s.offices[w]; if (!o) continue; if (!o.T) return -Infinity; ev.push(o.T + H); }
      // 炼丹炼器
      if (s.danStudy) ev.push(s.danStudy.end);
      if (s.forgeStudy) ev.push(s.forgeStudy.end);
      const j = s.forgeJob;
      if (j) {
        const waits = last >= j.end && j.ok !== undefined && this.bagFull() && ((!j.ok && j.prev) || j.kind === "rf" || (j.ok && (j.kind === "eq" || j.kind === "ring")));   // 背包满等待出炉：每次结算都不变
        if (!waits) ev.push(j.end);
      }
      const al = s.alchJob;
      if (al) { if (al.done >= al.n) return -Infinity; ev.push(al.next); }
      // 灵药园（等灵气的在 fastTick 里按灵气判断）
      for (const f of s.fields || []) if (f.g >= 0 && !f.wait) ev.push(f.start + this.fieldTime(f.g));
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
      if (gs && gs.ling !== 1) return 0;   // v246 旧存档还没转成灵气：逐个结算
      const GR = gs ? this.gfRoomNow() : null, RU = this.gfRoomUnits();
      // 修为修炼
      const cultOn = this.isCultivating() && this.hasMijue() && !this.exBlocksCult();
      if (cultOn) for (const t in DATA.pills) { const b = s.buffs[t]; if (s.autoPill[t] && (!b || b.left <= 0) && this.bestPillIndex(t) >= 0) return 0; }
      const freeOn = cultOn && this.freeCultOn(), roomOn = cultOn && !freeOn && s.room >= 0 && !!s.sect, roomC = roomOn ? this.roomCost(s.room) : 0;
      const SP = sp.total, RED = this.wdRed("exp"), BRED = this.wdRed("body"), RATE = this.lingPerStone(), refill = !!s.array.autoRefill;
      const buffs = cultOn ? Object.values(s.buffs).filter(b => b.left > 0) : [];
      // 肉身修炼
      const bodyOn = !!s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax();
      const BSP = bodyOn ? this.bodySpeed().total : 0, BR = Math.max(0.0001, CFG.body.LING_RATE || 1);
      // 灵药园等灵气的田
      const CS = s.cultSet, CSL = CS && CS.on && CS.tgt && s.auto ? CS.low : -Infinity;
      const waitNeed = (s.fields || []).filter(f => f.g >= 0 && f.wait).map(f => DATA.herbGrow(f.g).ling);
      const waitMin = waitNeed.length ? Math.min(...waitNeed) : Infinity;
      // 道童自动发俸禄：灵石够了就是事件
      let payMin = Infinity;
      if (s.svAuto) for (const d of s.servants || []) { const c = this.svOwed(d) * this.svSalary(d); if (c > 0) payMin = Math.min(payMin, c); }

      // ---------- 逐次做数字计算（顺序和各模块 tick 一致） ----------
      let hp = s.hp, mana = s.mana, ling = s.ling, exp = s.exp, stone = s.stone, contrib = s.contrib, bodyExp = s.bodyExp, lack = s.lackWarned;
      let freeLeft = freeOn ? s.freeCult.left : 0;
      let bl = buffs.map(b => b.left);
      let at = gs ? gs.at : 0, done = gs ? gs.done : 0, spent = gs ? gs.spent : 0, spentStone = gs ? gs.spentStone : undefined, su = gs ? gs.su || 0 : 0, rU = gs ? gs.rU || 0 : 0, stalled = gs ? gs.stalled : undefined;
      let m = 0, stop = false;
      for (; m < n && !stop; m++) {
        const now = tk + m * T;
        // 用临时变量算这一次，遇到事件就整次作废，交给逐个结算
        let h = hp, mp = mana, L = ling, ex = exp, sn = stone, ct = contrib, be = bodyExp, lk = lack, fl = freeLeft;
        let a2 = at, d2 = done, s2 = spent, ss2 = spentStone, su2 = su, ru2 = rU, sl2 = stalled, bl2 = bl;
        // 1. player：生命、法力恢复
        if (h < HP) h = Math.min(HP, h + HP * R0.hp / 100);
        if (mp < MP) mp = Math.min(MP, mp + MP * R0.mana / 100);
        // 2. cave：聚灵
        if (L < CAP) L = Math.min(CAP, L + GATH);   // v207 上限变低不删已有灵气
        // 3. gongfa：功法修炼进度
        if (gs) {
          const steps = Math.floor((now - a2) / (2 * STEP));   // v247 每 10 秒结算（和 gongfa.js 一样）
          if (steps > 0) {
            a2 += steps * 2 * STEP;
            const mul = GR ? GR.mul : 1, per = gs.per * mul, sps = (gs.stone || 0) * mul;
            const rem = Math.ceil((gs.total - d2) / (STEP * mul)), want = Math.min(2 * steps, rem);
            if (GR && GR.cost > 0 && Math.floor((ru2 + want) / RU) * GR.cost > ct) break;   // 离开练功房：事件
            if (L < want * per && refill) { const pay = Math.min(Math.ceil((want * per - L) / RATE), Math.floor(sn - (sps ? want * sps : 0))); if (pay > 0) { sn -= pay; L += pay * RATE; } }
            // 同 gongfa.js：灵石为负时 can 不能为负，否则会倒加灵气 / 贡献。
            let can = Math.max(0, Math.min(want, Math.floor(L / per), sps ? Math.floor(sn / sps) : Infinity));
            if (can < rem && can % 2) can--;
            L -= can * per; s2 += can * per; d2 = can >= rem ? gs.total : Math.min(gs.total, d2 + can * STEP * mul);
            if (sps) {   // 同 gongfa.js：按单位四舍五入累计，这层走完扣满 sc
              const C = gs.sc || Math.round(gs.stone * Math.ceil(gs.total / STEP)); su2 += can * mul;
              const tgt = d2 >= gs.total ? C : Math.min(C, Math.round(gs.stone * su2)), pay = Math.max(0, tgt - (ss2 || 0));
              sn -= pay; ss2 = (ss2 || 0) + pay; }
            if (GR) { ct -= Math.floor((ru2 + can) / RU) * GR.cost; ru2 = (ru2 + can) % RU; }
            sl2 = can < want && d2 < gs.total;
            if (d2 >= gs.total) break;   // 修炼完成：事件
          }
        }
        // 4. sect：0 点重置、练体池、事务堂都是事件（已算进时间）
        // 5. cultivate：修为修炼
        let ended = false;
        if (cultOn) {
          if (freeOn) { if (--fl <= 0) break; }   // 免费修炼室次数用完：事件
          else if (roomOn) { if (ct >= roomC) ct -= roomC; else break; }   // 贡献不足离开修炼室：事件
          if (L < SP - RED && refill && sn >= 1) { const pay = Math.min(Math.ceil((SP - RED - L) / RATE), Math.floor(sn)); sn -= pay; L += pay * RATE; }
          const PER = Math.max(0, SP - RED) / Math.max(1e-9, SP), gain = PER > 0 ? Math.min(SP, Math.floor(L / PER)) : SP;
          if (gain <= 0) { if (!lk) lk = true; }
          else {
            L = Math.max(0, L - gain * PER); ex += gain;
            if (gain < SP * 0.999) { if (!lk) lk = true; } else lk = false;
            if (bl.length) { bl2 = bl.slice(); for (let k = 0; k < bl2.length; k++) if (bl2[k] > 0 && --bl2[k] === 0) ended = true; }   // 药力耗尽：算完这一次就停
          }
        }
        // 7. body：肉身修炼
        if (bodyOn) {
          if (L < BSP * BR - BRED && refill && sn >= 1) { const pay = Math.min(Math.ceil((BSP * BR - BRED - L) / RATE), Math.floor(sn)); sn -= pay; L += pay * RATE; }
          const BPER = Math.max(0, BSP * BR - BRED) / Math.max(1e-9, BSP), g = BPER > 0 ? Math.min(BSP, Math.floor(L / BPER)) : BSP;
          if (g > 0) { L = Math.max(0, L - g * BPER); be += g; }
        }
        // 修炼设置：灵石掉到下限以下 → 事件（可能要自动去探索）
        if (sn < CSL) break;
        // 11. garden：等灵气的田灵气够了 → 事件
        if (L >= waitMin) break;
        // 12. servant：灵石够发俸禄 → 事件
        if (sn >= payMin) break;
        // 这一次没有事件：提交
        hp = h; mana = mp; ling = L; exp = ex; stone = sn; contrib = ct; bodyExp = be; lack = lk; freeLeft = fl;
        at = a2; done = d2; spent = s2; spentStone = ss2; su = su2; rU = ru2; stalled = sl2; bl = bl2;
        if (ended) stop = true;
      }
      // 上面 break 时 m 是作废那一次的序号（= 已提交次数）；正常结束时 m = 已提交次数
      const done_n = m;
      if (!done_n) return 0;
      s.hp = hp; s.mana = mana; s.ling = ling; s.exp = exp; s.stone = stone; s.contrib = contrib; s.bodyExp = bodyExp; s.lackWarned = lack;
      if (freeOn) s.freeCult.left = freeLeft;
      buffs.forEach((b, k) => { b.left = bl[k]; });
      if (gs) { gs.at = at; gs.done = done; gs.spent = spent; if (spentStone !== undefined) gs.spentStone = spentStone; if (su) gs.su = su; if (rU) gs.rU = rU; else delete gs.rU; if (stalled !== undefined) gs.stalled = stalled; }
      if (stop) this.dirty();   // 丹药药力耗尽：修炼速度重新计算（和 cultivate.js 一样）
      return done_n;
    },
  });
})();
