/* =====================================================================
 * 模块：四界官位 —— 界主 / 星君（各界殿君）/ 天将（单人，数值在 config/xingjun.js）
 * ---------------------------------------------------------------------
 * 界主、星君之位由 NPC 镇守；挑战时满血满法力，结束后恢复自己原来的生命法力。
 *   挑战扣本图贡献（失败不退）。星君：单挑胜即就任；天将：扣贡献直接就任；
 *   界主：担任过天将和全部星君后才能挑战，一场连战依次打完该图所有星君再打界主，全胜就任。
 * 每界各能担任一个官位（s.offices[界]）。俸禄每 HOUR 秒结算：功德 s.merit（顶部显示的功德）、灵石、火髓。
 * ===================================================================== */
G.module({
  id: "xingjun",

  defaults: () => ({
    offices: {},                 // { xian: { t: "jz" 界主 / "xj" 星君 / "tj" 天将, map 地图序号, seat 星君位, T 上次结算时间 }, ming: …, mo: …, shen: … }
    xjGx: {},                    // 每张地图的贡献 { 地图序号: 点数 }（完成历练获得，挑战官位消耗）
    xjHeld: {},                  // 每张地图担任过的职位 { 地图序号: [职位…] }（1 天将，2~8 星君；挑战界主要全部担任过）
  }),

  tick() { this.xjSettle(); },

  api: {
    xjW(a) { return DATA.maps[a].w; },
    xjC(w) { return CFG.xingjun.worlds[w] || CFG.xingjun.worlds.xian; },
    xjTpl(t, a, seat) { const n = DATA.maps[a].name; return t.replace("{map}", n).replace("{short}", n.replace(/(天|地狱)$/, "") || n).replace("{seat}", seat || ""); },
    xjSeats(a) { const S = this.xjC(this.xjW(a)).SEATS || []; return (S.length === 1 ? S[0] : S[DATA.maps[a].wi || 0]) || []; },
    xjSeatName(a, i) { return this.xjTpl(this.xjC(this.xjW(a)).SEAT, a, this.xjSeats(a)[i]); },
    xjDadi(a) { const C = this.xjC(this.xjW(a)), L = C.JZS; return (L && L[DATA.maps[a].wi || 0]) || this.xjTpl(C.JZ, a); },
    xjTjName(a) { return this.xjC(this.xjW(a)).TJ || "天将"; },
    xjHallName(a, id) { const H = ((CFG.worldMaps || {})[this.xjW(a)] || {}).halls || {}; return this.xjTpl(H[id] || "", a); },
    // 挑战需要的境界（config/mobs.js 天将 / 星君 第 1 个数）
    xjReq(a, t) { return (DATA.maps[a].mob || {})[t === "tj" ? "天将需" : "星君需"] || 0; },
    // 职位：1 天将；星君名单第 i 位（0 起）= 职位 i + 2（名单从低到高）
    xjPos(a, t, seat) { return t === "tj" ? 1 : t === "jz" ? CFG.xingjun.JZ_POS : seat + 2; },
    // 每张地图的贡献
    xjGxOf(a) { return DATA.isTest() ? 1e15 : (this.s.xjGx || {})[a] || 0; },   // 测试模式本图贡献随便花
    xjGxAdd(a, n) { if (DATA.isTest()) return; const g = this.s.xjGx || (this.s.xjGx = {}); g[a] = (g[a] || 0) + n; },
    // 挑战需要的贡献 = 基础 × 职位 × 第几张地图
    xjCost(a, t, seat) { return Math.round(CFG.xingjun.CH_BASE * this.xjPos(a, t, seat) * ((DATA.maps[a].wi || 0) + 1)); },
    // 担任过的职位
    xjHeldOf(a) { return (this.s.xjHeld || {})[a] || []; },
    xjMarkHeld(a, p) { const h = this.s.xjHeld || (this.s.xjHeld = {}); const l = h[a] || (h[a] = []); if (!l.includes(p)) l.push(p); },
    // 挑战界主的前提：天将 + 全部星君都担任过
    xjJzReady(a) { const h = this.xjHeldOf(a), n = this.xjSeats(a).length; for (let p = 1; p <= n + 1; p++) if (!h.includes(p)) return false; return true; },
    // 扣贡献（不够返回 false）
    xjPay(a, t, seat) { const c = this.xjCost(a, t, seat); if (this.xjGxOf(a) < c) { this.log(`贡献不足，需要 ${U.fmt(c)} 点。`, "sys"); return false; } this.xjGxAdd(a, -c); return true; },
    xjOfficeOf(w) { return (this.s.offices || {})[w] || null; },
    xjOffice(o) {
      if (!o) return "无";
      const m = DATA.maps[o.map].name;
      if (o.t === "zz") return m + "尊者";
      return o.t === "jz" ? m + "大帝" : o.t === "xj" ? m + this.xjSeatName(o.map, o.seat) : m + this.xjTjName(o.map);
    },
    // 每次结算的俸禄范围 { merit, stone: [少, 多], hx: [少, 多] }（已乘本界 PAY_MULT）
    xjRate(o) {
      const X = CFG.xingjun, a = o.map, wi = DATA.maps[a].wi || 0, k = this.xjC(this.xjW(a)).PAY_MULT || 1;
      const pick = (arr, i) => arr[Math.min(i, arr.length - 1)] || 0, r = v => Math.round(v * k);
      if (this.xjW(a) === "shen") {   // 神界：俸禄改发愿力（功德数 × CFG.shenjie.XJ_YL）
        const SC = CFG.shenjie || {}, K = SC.XJ_YL || 1, z = { merit: 0, yl: 0, stone: [0, 0], hx: [0, 0] };
        const M = DATA.worldMapIdx.shen || [], f = M.length > 1 ? Math.max(0, M.indexOf(a)) / (M.length - 1) : 0, lerp = R => Math.round(R[0] + (R[1] - R[0]) * f);
                if (o.t === "jz") { const st = r(pick(X.JZ_STONE, wi)), hx = r(pick(X.JZ_HX, wi)); z.yl = SC.XJ_JZ_YL ? lerp(SC.XJ_JZ_YL) : r(pick(X.JZ_MERIT, wi)) * K; z.stone = [st, st]; z.hx = [hx, hx]; }
        else if (o.t === "tj" && SC.XJ_TJ_YL) z.yl = lerp(SC.XJ_TJ_YL);
        else z.yl = r(pick(pick(X.MERIT, wi) || [], this.xjPos(a, o.t, o.seat) - 1)) * K;
        return z;
      }
      if (o.t === "jz") { const st = r(pick(X.JZ_STONE, wi)), hx = r(pick(X.JZ_HX, wi)); return { merit: r(pick(X.JZ_MERIT, wi)), stone: [st, st], hx: [hx, hx] }; }
      const row = pick(X.MERIT, wi) || [];
      return { merit: r(pick(row, this.xjPos(a, o.t, o.seat) - 1)), stone: [0, 0], hx: [0, 0] };
    },
    // n 次结算的实际俸禄
    xjRoll(o, n) {
      const R = this.xjRate(o), sum = ([lo, hi]) => { if (hi <= 0) return 0; if (n > 1000) return Math.round(n * (lo + hi) / 2); let t = 0; for (let i = 0; i < n; i++) t += U.rand(lo, hi); return t; };
      return { merit: R.merit * n, yl: (R.yl || 0) * n, stone: sum(R.stone), hx: sum(R.hx) };
    },
    xjRangeText(r) { const f = ([lo, hi]) => lo === hi ? U.fmt(lo) : `${U.fmt(lo)}~${U.fmt(hi)}`; return [r.merit ? `功德 ${U.fmt(r.merit)}` : "", r.yl ? `愿力 ${U.fmt(r.yl)}` : "", r.stone[1] ? `灵石 ${f(r.stone)}` : "", r.hx[1] ? `${DATA.HX} ${f(r.hx)}` : ""].filter(x => x).join("、") || "无"; },
    xjRateText(r) { return [r.merit ? `功德 ${U.fmt(r.merit)}` : "", r.yl ? `愿力 ${U.fmt(r.yl)}` : "", r.stone ? `灵石 ${U.fmt(r.stone)}` : "", r.hx ? `${DATA.HX} ${U.fmt(r.hx)}` : ""].filter(x => x).join("、") || "无"; },
    xjValid(o) { if (o && o.t === "zz") return false;   // 神界尊者已去掉（2026-11-12），旧存档的尊者官位作废
      return o && DATA.maps[o.map] && (o.t !== "xj" || this.xjSeats(o.map)[o.seat] !== undefined); },
    // 结算俸禄（每 HOUR 秒一次）
    xjSettle() {
      const s = this.s, H = (CFG.xingjun.HOUR || 3600) * 1000;
      if (!s.offices) s.offices = {};
      for (const w in s.offices) {
        const o = s.offices[w]; if (!o) continue;
        if (!this.xjValid(o)) { delete s.offices[w]; continue; }
        if (!o.T) o.T = this.now();
        const n = Math.floor((this.now() - o.T) / H); if (n <= 0) continue;
        const r = this.xjRoll(o, n); o.T += n * H;
        s.merit = (s.merit || 0) + r.merit; s.stone += r.stone; if (r.yl) s.yuanli = (s.yuanli || 0) + r.yl;
        if (r.hx) this.addFire(r.hx);
        this.log(`${this.xjOffice(o)}俸禄：${this.xjRateText(r)}`, "gold");
        this.dirty();
      }
    },
    // 换官位（同一界）：先结算旧官位，再从现在重新计时
    xjSetOffice(w, o) {
      this.xjSettle();
      if (o) { o.T = this.now(); this.s.offices[w] = o; if (o.t !== "jz" && o.t !== "zz") this.xjMarkHeld(o.map, this.xjPos(o.map, o.t, o.seat)); }
      else delete this.s.offices[w];
    },
    // NPC：属性按 config/mobs.js 的一行怪物数据（tu）生成；ck = 暴击分类（天将 / 星君 / 界主）
    xjNpc(a, name, tu, ck, seat) {
      const elKey = ck === "天将" ? `tj:${a}` : ck === "界主" ? `jz:${a}` : seat !== undefined ? `xj:${a}:${seat}` : "", b = DATA.mobRoll(tu, DATA.mobCrit(ck)), v = (x, k) => x * DATA.mobRnd(k);   // v168 功法随机
      const m = this.addMagic({ name, a, mapA: a, img: this.npcImg(`${ck}${a}_${name}`, ck === "天将" ? "rn" : "rx"), glow: ck !== "天将", elKey, Lm: DATA.region(a, 3).L, kind: "boss", boss: true,
        hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.resEl || b.res, manaBr: b.manaBr, L: b.L, crit: b.crit, stl: b.stl }, ck);
      if (!m.mf) m.mf = this.rollMf(this.mobRandCfg(ck));   // 秘法：一般已按存档定死（mobElInit），没有键时按 config/battle.js MOB_RAND 随机
      return m;
    },
    // 依次挑战 list（[{name, k}]），满血满法力开打，中间不回复；结束恢复原来的生命法力
    xjFight(a, list, title, onWin) {
      const s = this.s, w = this.xjW(a);
      if (!this.mapOpen(a)) return;
      const hp0 = s.hp, mp0 = s.mana, st = this.stats();
      s.hp = st.hp; s.mana = st.mana;
      const ev = []; let win = true;
      for (const x of list) {
        const res = this.battle(this.xjNpc(a, x.name, x.tu, x.ck, x.seat), { foe: "xj" });
        const t = res.win ? `${res.rounds}回合获胜` : res.timeout ? `${res.rounds} 回合未能击败，落败` : `第 ${res.rounds} 回合落败`;
        ev.push({ n: ev.length + 1, t: `${x.name}：${t}`, c: res.win ? "gold" : "bad", b: res.detail });
        if (!res.win) { win = false; break; }
      }
      s.hp = hp0; s.mana = mp0;
      this.xjLast = { title: `${title} · ${win ? "胜" : "未胜"}`, bad: !win, ev, map: a };
      // 胜负提示等战斗画面播放完再出（播放最后一场）
      const logs = [];
      if (win) { const L0 = this.log; this.log = (m, c) => logs.push([m, c]); try { onWin(); } finally { this.log = L0; } }
      else logs.push([`${title}，${ev[ev.length - 1].t}。`, "bad"]);
      this.after();
      const last = ev[ev.length - 1];
      if (last && last.b) this.playBattle(last.b, title, logs.length ? logs[logs.length - 1][0] : last.t, win, logs);
      else logs.forEach(([m, c]) => this.log(m, c));
    },
    xjChallenge(a, i) {
      const w = this.xjW(a), o = this.xjOfficeOf(w); if (o && o.t === "xj" && o.map === a && o.seat === i) return;
      const name = this.xjSeatName(a, i), title = `挑战${DATA.maps[a].name}${name}`;
      if (!this.mapOpen(a) || !this.realmOK(this.xjReq(a, "xj", i))) return;
      if (!this.xjPay(a, "xj", i)) return this.after();   // 先扣贡献，失败不退
      this.xjFight(a, [{ name, tu: DATA.mobXj(a, i), ck: "星君", seat: i }], title, () => { this.xjSetOffice(w, { t: "xj", map: a, seat: i }); this.log(`${title}获胜，就任${this.xjOffice(this.xjOfficeOf(w))}！`, "gold"); });
    },
    // 界主：连战全部星君（从低到高），最后打界主
    xjChallengeJz(a) {
      const w = this.xjW(a), o = this.xjOfficeOf(w); if (o && o.t === "jz" && o.map === a) return;
      if (!this.xjJzReady(a)) return this.log(`需要先在${DATA.maps[a].name}担任过${this.xjTjName(a)}和全部星君，才能挑战大帝。`, "sys");
      if (!this.mapOpen(a) || !this.xjPay(a, "jz")) return this.after();   // 先扣贡献，失败不退
      const list = this.xjSeats(a).map((n, i) => ({ name: this.xjSeatName(a, i), tu: DATA.mobXj(a, i), ck: "星君", seat: i }));
      list.push({ name: this.xjDadi(a), tu: DATA.mobJz(a), ck: "界主" });
      const title = `挑战${this.xjHallName(a, "tg")}`;
      this.xjFight(a, list, title, () => { this.xjSetOffice(w, { t: "jz", map: a }); this.log(`${title}全胜，就任${this.xjOffice(this.xjOfficeOf(w))}！`, "gold"); });
    },
    // 天将：挑战天将，胜即就任
    xjTianjiang(a) {
      const w = this.xjW(a), o = this.xjOfficeOf(w);
      if (!this.mapOpen(a) || !this.realmOK(this.xjReq(a, "tj")) || (o && o.t === "tj" && o.map === a)) return;
      if (!this.xjPay(a, "tj")) return this.after();   // 先扣贡献，失败不退
      const name = this.xjTjName(a), title = `挑战${DATA.maps[a].name}${name}`;
      this.xjFight(a, [{ name, tu: DATA.mobTj(a), ck: "天将" }], title, () => { this.xjSetOffice(w, { t: "tj", map: a }); this.log(`${title}获胜，就任${this.xjOffice(this.xjOfficeOf(w))}！`, "gold"); });
    },
    xjResign(w) { if (!this.xjOfficeOf(w)) return; const n = this.xjOffice(this.xjOfficeOf(w)); this.xjSetOffice(w, null); this.log(`已辞去${n}。`, "sys"); this.after(); },
    xjShowLast(i) {
      const L = this.xjLast; if (!L || !L.ev[i] || !L.ev[i].b) return;
      const keep = this.s.lastRun; this.s.lastRun = L; this.showBattle("last", i); this.s.lastRun = keep;
    },

    // 本界官位 + 俸禄 + 上次挑战结果（天宫、星君殿共用）
    xjHead(a) {
      const s = this.s, w = this.xjW(a), o = this.xjOfficeOf(w), H = CFG.xingjun.HOUR || 3600, L = this.xjLast && this.xjW(this.xjLast.map) === w ? this.xjLast : null;
      const next = o ? Math.max(0, Math.ceil((o.T + H * 1000 - this.now()) / 1000)) : 0;
      return `<div class="row small"><span>官位 ${this.xjOffice(o)}</span><span>功德 ${U.fmt(s.merit || 0)} · 本图贡献 ${U.fmt(this.xjGxOf(a))}</span></div>
        ${o ? `<div class="line"><div>俸禄<small>${this.xjRangeText(this.xjRate(o))} / ${U.dur(H)} · ${U.cd(next)}后结算</small></div><button class="sm" onclick="G.xjResign('${w}')">辞官</button></div>` : ""}
        ${L ? `<p class="desc ${L.bad ? "q5" : ""}">${L.title}</p>${L.ev.map((e, i) => `<div class="row small"><span class="${e.c === "bad" ? "q5" : ""}">${e.t}</span>${e.b ? `<button class="sm" onclick="G.xjShowLast(${i})">详情</button>` : ""}</div>`).join("")}` : ""}`;
    },
    // 天宫（界主）
    tgView(a) {
      const w = this.xjW(a), o = this.xjOfficeOf(w), mine = o && o.t === "jz" && o.map === a, ready = this.xjJzReady(a), cost = this.xjCost(a, "jz");
      const n = this.xjSeats(a).length, held = this.xjHeldOf(a).filter(p => p <= n + 1).length;
      return `<div class="card"><h3>${this.xjHallName(a, "tg")}</h3>${this.xjHead(a)}
        <div class="line"><div>大帝<small>${mine ? "在任" : `${this.xjDadi(a)} · 需 ${U.fmt(cost)} 贡献 · ${ready ? "可挑战（连战全部星君后挑战大帝）" : `担任过 ${held} / ${n + 1} 个职位`}`}</small></div>
          ${mine ? `<button class="sm on" disabled>在任</button>` : `<button class="sm" onclick="G.xjChallengeJz(${a})" ${!this.mapOpen(a) || !ready || this.xjGxOf(a) < cost ? "disabled" : ""}>挑战</button>`}</div></div>`;
    },
    // 星君殿（星君 + 天将）
    xjView(a) {
      const w = this.xjW(a), C = this.xjC(w), o = this.xjOfficeOf(w), lockMap = !this.mapOpen(a), gx = this.xjGxOf(a), held = this.xjHeldOf(a);
      const seats = this.xjSeats(a).map((n, i) => i).reverse().map(i => {   // 从高到低显示

        const mine = o && o.t === "xj" && o.map === a && o.seat === i, c = this.xjCost(a, "xj", i), p = this.xjPos(a, "xj", i);
        const rq = this.xjReq(a, "xj", i), rok = this.realmOK(rq);
        return `<div class="line"><div>${this.xjSeatName(a, i)}<small>${mine ? "在任" : `${rok ? "" : `需${DATA.realmLabel(rq)} · `}需 ${U.fmt(c)} 贡献${held.includes(p) ? " · 担任过" : ""}`}</small></div>
          ${mine ? `<button class="sm on" disabled>在任</button>` : `<button class="sm" onclick="G.xjChallenge(${a},${i})" ${lockMap || !rok || gx < c ? "disabled" : ""}>挑战</button>`}</div>`;
      }).join("");
      const tjOn = o && o.t === "tj" && o.map === a, T = this.xjReq(a, "tj"), tc = this.xjCost(a, "tj");
      return `<div class="card"><h3>${this.xjHallName(a, "xj")}</h3>${this.xjHead(a)}
        ${seats}
        <div class="line"><div>${this.xjTjName(a)}<small>${tjOn ? "在任" : `${this.realmOK(T) ? "" : `需${DATA.realmLabel(T)} · `}需 ${U.fmt(tc)} 贡献${held.includes(1) ? " · 担任过" : ""}`}</small></div>
          ${tjOn ? `<button class="sm on" disabled>在任</button>` : `<button class="sm" onclick="G.xjTianjiang(${a})" ${lockMap || !this.realmOK(T) || gx < tc ? "disabled" : ""}>挑战</button>`}</div></div>`;
    },
  },
});
