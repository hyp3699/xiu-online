/* =====================================================================
 * 模块：渡劫（突破时的劫云）
 * ---------------------------------------------------------------------
 * 数值全部在 js/config/trib.js。
 * 流程：修为满了点「突破」→ 直接开始渡劫 → 渡劫页（上方劫云，下方人物）；v259 去掉准备页、格子、护盾，渡劫时不能用任何法宝、丹药
 * 劫云只有攻击，每 HIT_SEC 秒劈一次（金木水火土雷六种属性轮流，属性伤害 = 攻击 − 防御 × RES_RATE − 该系抗性），人物不还手；撑过 TIME 秒没倒 = 突破成功。
 * 按 G.now() 计时：关掉页面、关掉游戏，劫云照样劈，回来时一次算完。
 * 开始后先倒计时 PRE_SEC 秒，再开始劈。
 *
 * 存档：
 *   s.trib       正在进行（或刚结束还没关）的渡劫：
 *                { v: 2, L 突破后层序, start 劫雷开始时间（= 点开始 + PRE_SEC 秒）, time 时长秒, sec 已过秒, atk, crit, taken 共承受, hits 被劈次数, log, result }
 * ===================================================================== */
G.module({
  id: "trib",

  defaults: () => ({}),

  api: {
    /* ---------- 数值 ---------- */
    // 渡劫进行中（还没出结果）：不能使用任何法宝、丹药
    tribBusy() { const x = this.s.trib; return !!(x && !x.result); },
    // 渡劫时长（秒）：按突破后的大境界查 TIME（键 = 境界原名或改名后的名字）
    tribTime(L) {
      const ri = Math.min(Math.floor(L / DATA.LAYERS) || 0, 23), o = CFG.trib.TIME;   // L ≥ 240（圣人以上）时 ri 钳到最高境界 23，不再查不到 TIME 返 NaN
      const t = o[DATA.realms[ri]] !== undefined ? o[DATA.realms[ri]] : o[DATA.NM_DEF.realm[ri]];
      return Math.max(1, Number.isFinite(t) ? t : 30);   // 兜底：TIME 里没写该境界也按 30 秒（现全部境界都是 30 秒）
    },
    // 劫云：L = 突破后的层序；按突破前那一层（L − 1）的境界、层查 CFG.trib.MOB，格式同怪物（[a, b] 开始渡劫时随机）
    //   属性 = 那一层配置的修为突破 + 肉身突破 + 三类功法（DATA.mobCalc）× (1 + (层 − 层起) × 每层增加)
    tribRow(L) {
      const T = CFG.trib, F = Math.max(0, L - 1), ri = Math.floor(F / DATA.LAYERS), lay = F % DATA.LAYERS + 1;
      const R = DATA.mobRange, r = T.MOB.find(r => r[0] === ri && lay >= R(r[1])[0] && lay <= R(r[1])[1]) || T.MOB.filter(r => r[0] <= ri).pop() || [ri, [1, 10], 0];
      const gs = r.slice(2, -1).filter(Array.isArray), cat = c => gs.find(y => y[0] === c) || [c, 0, 0, 1, 0, 0];   // 没写的类别 = 不学
      const k = 1 + Math.max(0, lay - R(r[1])[0]) * (+r[r.length - 1] || 0);
      return [ri, lay, cat(1), cat(2), cat(3), k];
    },
    makeTrib(L) {
      const T = CFG.trib, st = DATA.mobRoll(this.tribRow(L));   // 学%、功法层按配置随机
      const R = T.RAND, rnd = R[0] + Math.random() * (R[1] - R[0]);
      return { atk: st.atk * rnd * (+((CFG.rates || {}).TRIB ?? 1) || 0), crit: T.crit };   // config/rates.js 雷劫强度总倍率
    },
    // 劫云劈一次的伤害 [伤害, 是否暴击]
    // 属性伤害（同怪物法术）：减免 = 防御 × RES_RATE + 该系抗性 × RES_EL_RATE
    tribEl(n) { const E = DATA.elements; return E[((n || 0) % E.length + E.length) % E.length]; },   // 第 n 道雷（从 0 起）的属性：金木水火土雷轮流
    tribHit(x, el) {
      const BT = CFG.battle, st = this.stats(), def = st.def;
      const RR = BT.RES_RATE === undefined ? BT.DEF_RATE : BT.RES_RATE, ER = BT.RES_EL_RATE === undefined ? 1 : BT.RES_EL_RATE, res = ((st.res || {})[el] || 0) * ER;
      const mn = DATA.minDmg(this.s.mortal ? 0 : this.s.L), r = (BT.RAND_MIN + Math.random() * (BT.RAND_MAX - BT.RAND_MIN));
      const c = Math.random() * 100 < Math.min(DATA.CRIT_CAP || 100, x.crit), k = r * (c ? BT.CRIT_MULT : 1);
      if (DATA.ratioOn()) { const L = this.s.mortal ? 0 : this.s.L, rv = (st.res || {})[el] || 0;   // 按比例减免（config/battle.js FORMULA）
        return [Math.max(mn, DATA.cutEl(x.atk, def, rv, L)) * k, c]; }
      return [Math.max(mn, x.atk - def * RR - res) * k, c];
    },

    /* ---------- 进入 / 开始 / 结束 ---------- */
    // 「突破」按钮：有渡劫在进行就看渡劫页（没有准备页，突破时直接 startTrib）
    openTrib() { if (!this.s.trib) return this.startTrib(); this.tribOpen = true; this.tribRender(true); },
    closeTrib() {
      this.tribOpen = false;
      const el = typeof document !== "undefined" && document.getElementById("trib"); if (el) { el.classList.add("hidden"); el.innerHTML = ""; }   // 服务器上没有页面
      if (this.s.trib && this.s.trib.result) this.s.trib = null;   // 结束后离开才清除记录
      this.render();
    },
    startTrib() {
      const s = this.s; if (s.trib || !this.canBreak() || !this.needTrib()) return;
      if (this.advanceExplore) this.advanceExplore();   // 探索 / 出窍先结算到现在，渡劫期间暂停
      const L = s.L + 1, t = this.makeTrib(L), st = this.stats();
      s.hp = st.hp; s.mana = st.mana;   // 开始时生命法力回满
      s.trib = { L, t0: this.now(), start: this.now() + CFG.trib.PRE_SEC * 1000, time: this.tribTime(L), sec: 0, atk: t.atk, crit: t.crit, taken: 0, hits: 0, log: [], result: "" };
      this.log(`劫云压顶，${this.realmName(L)}天劫降临！`, "gold");
      this.tribOpen = true; this.save && this.save(); this.tribRender(true);
    },
    // 按时间推进：每 HIT_SEC 秒劈一次（离线回来一次算完）
    advanceTrib() {
      const s = this.s, x = s.trib; if (!x || x.result) return;
      const HS = CFG.trib.HIT_SEC;
      let hit = null;
      while (!x.result) {
        const nextHit = (Math.floor(x.sec / HS) + 1) * HS;
        if (nextHit > x.time) { if (this.now() >= x.start + x.time * 1000) { x.sec = x.time; this.endTrib(true); } break; }
        if (this.now() < x.start + nextHit * 1000) break;
        x.sec = nextHit;
        const el = this.tribEl(x.hits);
        let [d, c] = this.tribHit(x, el.id);
        if (el.id === "lei" && this.oriSum && this.oriSum("leiCut")) d *= Math.max(0, 1 - this.oriSum("leiCut") / 100);   // 出身「天降异象」
        if (this.jmElCut && this.jmElCut(el.id)) d *= Math.max(0, 1 - this.jmElCut(el.id) / 100);   // 经脉腿部：受到该系属性伤害 −%
        s.hp -= d; x.taken += d; x.hits++;
        hit = { n: x.hits, d, c, el: el.id };
        x.last = hit;   // 最近一击：联网时客户端按它画闪电、飘伤害
        x.log.unshift(`${el.name}属性劫雷劈中你 ${U.fmt(d)}${c ? "（暴击）" : ""}`);
        if (x.log.length > 60) x.log.length = 60;
        if (s.hp <= 0) this.endTrib(false);
        else if (x.sec >= x.time) this.endTrib(true);
      }
      if (hit) this._tribHit = hit;
    },
    endTrib(win) {
      const s = this.s, x = s.trib;
      if (win) {
        s.exp -= this.needExp(); for (let t = s.L + 1; t <= x.L; t++) this.brRoll("xw", t); s.L = x.L; this.dirty();
        const st = this.stats(); s.hp = st.hp; s.mana = st.mana;
        x.result = `渡劫成功！踏入【${this.realmName()}】。`;
        this.log(x.result, "gold");
      } else {
        s.hp = 1;
        const loss = this.oriSum && this.oriSum("noTribLoss") ? 0 : Math.floor(s.exp * CFG.trib.FAIL_LOSS); s.exp -= loss;   // 出身「寺庙寄养」不掉修为
        x.result = loss ? `渡劫失败：被劫雷劈倒，修为 -${U.fmt(loss)}。` : "渡劫失败：被劫雷劈倒，心性平和，修为未失。";
        this.log(x.result, "bad");
      }
      if (this.exResume) this.exResume();   // 暂停的探索 / 出窍从现在继续
      // 全部信息：记下这次天劫的全过程（服务器存最近 100 条）
      (s.histQ || (s.histQ = [])).push({ at: this.now(), k: "天劫", title: `渡劫 · ${this.realmName(x.L)}：${x.result}`, bad: !win, ev: x.log.slice().reverse().map(t => ({ t, c: "" })).concat([{ t: x.result, c: win ? "gold" : "bad" }]) });
      this.dirty(); if (!this.silent) { this.save(); this.render(); }
    },

    /* ---------- 画面 ---------- */
    // 每秒调用：full = 整页重画，否则只更新数字、血条、闪电
    // 渡劫画面用的时间：联网时 = 服务器最近一次报的时间 + 本地经过的时间（不做平滑）
    tribNow() {
      const A = typeof API !== "undefined" ? API : null;
      if (A && A.serverNow && typeof performance !== "undefined") return A.serverNow + Math.max(0, performance.now() - (A._clockPerf || 0));
      return this.now();
    },
    showTrib() { if (this.tribOpen) this.tribRender(false); },
    tribRender(full) {
      const el = $("#trib"); if (!this.tribOpen || !el) return;
      el.classList.remove("hidden");
      const x = this.s.trib;
      if (!x) { this.tribOpen = false; el.classList.add("hidden"); el.innerHTML = ""; return; }
      const mode = x.result ? "end" : "run";
      // 联网：劈雷在服务器结算，客户端发现 x.last 是新的一击就画出来
      const key = x.start + ":" + (x.last ? x.last.n : -1);
      if (this._tribSeen === undefined || !String(this._tribSeen).startsWith(x.start + ":")) this._tribSeen = key;   // 刚打开页面：不补画旧的
      else if (this._tribSeen !== key) { this._tribSeen = key; if (x.last) this._tribHit = x.last; }
      // 最后一击（劈死或撑到最后一秒）：先在渡劫画面把这道雷劈出来、扣血，约 1 秒后再显示结果
      if (!full && mode === "end" && el.dataset.mode === "run") {
        if (this._tribHit) { this._tribHold = Date.now() + 1000; setTimeout(() => this.tribRender(false), 1050); }
        if (this._tribHold && Date.now() < this._tribHold) { this.tribUpd(); return; }
      }
      this._tribHold = 0;
      if (full || el.dataset.mode !== mode) { el.dataset.mode = mode; el.innerHTML = this.tribRunHtml(); if (mode === "end") this._tribHit = null; else if (this._tribHit) this.tribUpd(); return; }
      this.tribUpd();
    },
    // 渡劫画面：只更新会变的数字、血条、日志，有新的一击就画闪电
    tribUpd() {
      const x = this.s.trib; if (!x) return;
      const s = this.s, st = this.stats(), dead = x.result && !/成功/.test(x.result);
      const hp = dead ? 0 : Math.max(0, s.hp), hpPct = hp / st.hp * 100;   // 被劈倒：结算后生命留 1，画面上先显示 0
      const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
      set("tj-left", x.time - x.sec); set("tj-hp", `${U.fmt(hp)} / ${U.fmt(st.hp)}`); set("tj-taken", U.fmt(x.taken));
      const bar = document.getElementById("tj-hpbar"); if (bar) bar.style.width = hpPct + "%";
      set("tj-mp", `${U.fmt(Math.max(0, s.mana || 0))} / ${U.fmt(st.mana || 0)}`);
      const mb = document.getElementById("tj-mpbar"); if (mb) mb.style.width = (st.mana ? Math.max(0, s.mana || 0) / st.mana * 100 : 0) + "%";
      const tb = document.getElementById("tj-timebar"); if (tb) tb.style.width = x.sec / x.time * 100 + "%";
      const lg = document.getElementById("tj-log"); if (lg) lg.innerHTML = x.log.slice(0, 8).map(l => `<p>${l}</p>`).join("");
      // 倒计时按服务器时钟算（不用平滑后的显示时钟，那个可能比服务器慢几秒，导致倒计时还没完劫雷已经劈下）；已经劈过就不再显示
      const pre = x.hits > 0 || x.sec > 0 ? 0 : Math.ceil((x.start - this.tribNow()) / 1000), cd = document.getElementById("tj-cd");
      if (cd) { cd.textContent = pre > 0 && !x.result ? pre : ""; cd.classList.toggle("on", pre > 0 && !x.result); }
      if (this._tribHit) { this.tribBolt(this._tribHit); this._tribHit = null; }
    },
    // 一道劫雷：分形折线（中点位移）从云眼劈到人物头顶，带多级分叉；外层紫色辉光 + 中层淡紫 + 白色雷芯，劈下后再闪一次
    tribBolt(h) {
      const st = document.getElementById("tj-stage"), hero = document.getElementById("tj-hero"); if (!st || !hero) return;
      const W = st.clientWidth || 360, H = st.clientHeight || 380, R = Math.random;
      // 中点位移：两点之间反复取中点并横向偏移，偏移量逐级减半，得到自然的锯齿雷线
      const frac = (a, b, dis, depth) => {
        if (depth <= 0) return [a, b];
        const mx = (a[0] + b[0]) / 2 + (R() - 0.5) * dis, my = (a[1] + b[1]) / 2 + (R() - 0.5) * dis * 0.3;
        const l = frac(a, [mx, my], dis / 2, depth - 1), r = frac([mx, my], b, dis / 2, depth - 1);
        return l.concat(r.slice(1));
      };
      const make = () => {
        const top = [W * (0.5 + (R() - 0.5) * 0.12), H * 0.16], end = [W * 0.5 + (R() - 0.5) * 8, H * 0.7];
        const main = frac(top, end, W * 0.22, 6), out = [{ p: main, lv: 0 }];
        const branch = (src, lv) => {
          const n = lv ? 1 : 2 + Math.floor(R() * 3);
          for (let i = 0; i < n; i++) {
            const s = src[Math.floor(src.length * (0.1 + R() * 0.6))], dir = R() < 0.5 ? -1 : 1, len = H * (lv ? 0.07 : 0.12 + R() * 0.12);
            const e = [s[0] + dir * len * (0.5 + R() * 0.7), s[1] + len * (0.6 + R() * 0.5)];
            const p = frac(s, e, len * 0.5, 4); out.push({ p, lv: lv + 1 });
            if (lv < 1 && R() < 0.6) branch(p, lv + 1);
          }
        };
        branch(main, 0); return out;
      };
      const pts = p => p.map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
      const draw = ls => ls.map(({ p, lv }) => {
        const k = lv === 0 ? (h.c ? 1.4 : 1) : lv === 1 ? 0.45 : 0.25, P = pts(p);
        return `<polyline class="g" points="${P}" style="stroke-width:${14 * k}"/><polyline class="m" points="${P}" style="stroke-width:${5 * k}"/><polyline class="c" pathLength="1" points="${P}" style="stroke-width:${Math.max(0.8, 2.2 * k)}"/>`;
      }).join("");
      const id = "tjb" + Date.now() % 100000;
      const svg = ls => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs><g filter="url(#${id})">${ls.map(({ p, lv }) => `<polyline class="g" points="${pts(p)}" style="stroke-width:${lv ? 6 : 18}"/>`).join("")}</g>${draw(ls)}</svg>`;
      const b = document.createElement("div"); b.className = "tj-bolt el-" + (h.el || "lei") + (h.c ? " crit" : "");
      const ls = make(); b.innerHTML = svg(ls) + `<div class="tj-hitglow"></div>`;
      st.appendChild(b);
      // 回闪：同一主干稍微抖动后再亮一次
      setTimeout(() => { if (b.isConnected) { const s2 = b.querySelector("svg"); if (s2) s2.outerHTML = svg(ls.map(o => ({ lv: o.lv, p: o.p.map(q => [q[0] + (R() - 0.5) * 3, q[1]]) }))); } }, 140);
      setTimeout(() => b.remove(), 650);
      st.classList.remove("tj-flash"); void st.offsetWidth; st.classList.add("tj-flash");
      hero.classList.remove("tj-shake"); void hero.offsetWidth; hero.classList.add("tj-shake");
      const n = document.createElement("div"); n.className = "tj-dmg el-" + (h.el || "lei") + (h.c ? " crit" : ""); n.textContent = (h.el && DATA.elById[h.el] ? DATA.elById[h.el].name + " " : "") + "-" + U.fmt(h.d) + (h.c ? " 暴击" : "");
      n.style.left = 52 + Math.random() * 20 + "%"; st.appendChild(n); setTimeout(() => n.remove(), 1200);
    },
    // 舞台：上方劫云（img/trib_cloud.webp），下方打坐人物（img/trib_hero.webp），中间放倒计时
    tribStageHtml(mid, cls) {
      const v = DATA.IMG_V || 1, cl = `url(img/trib_cloud.webp?v=${v})`;
      return `<div class="tj-stage ${cls || ""}" id="tj-stage">
        <div class="tj-sky" style="background-image:${cl}"></div>
        <div class="tj-fog" style="background-image:${cl}"></div>
        <div class="tj-vortex" style="background-image:${cl}"></div>
        <div class="tj-amb"></div>
        <div class="tj-mid">${mid || ""}</div>
        <div class="tj-cd" id="tj-cd"></div>
        <div class="tj-hero" id="tj-hero"><div class="tj-aura"></div><img src="${this.heroId && this.heroId() ? this.heroImg("ys") : "img/trib_hero.webp"}?v=${v}" alt=""></div>
      </div>`;
    },
    tribRunHtml() {
      const s = this.s, x = s.trib, st = this.stats(), end = !!x.result, win = end && /成功/.test(x.result);
      return `<div class="tj-wrap${end ? win ? " win" : " lose" : ""}">
        <div class="tj-head"><button class="sm" onclick="G.closeTrib()">${end ? "离开" : "返回（渡劫继续）"}</button><b>渡劫 · ${this.realmName(x.L)}</b><span></span></div>
        ${this.tribStageHtml("", end ? win ? "win" : "dead" : "")}
        <div class="bar tick"><div id="tj-timebar" style="width:${x.sec / x.time * 100}%"></div></div>
        <div class="row small"><span>生命 <b id="tj-hp">${U.fmt(Math.max(0, s.hp))} / ${U.fmt(st.hp)}</b></span><span>共承受 <b id="tj-taken">${U.fmt(x.taken)}</b></span></div>
        <div class="bar hp"><div id="tj-hpbar" style="width:${Math.max(0, s.hp) / st.hp * 100}%"></div></div>
        <div class="row small"><span>法力 <b id="tj-mp">${U.fmt(Math.max(0, s.mana || 0))} / ${U.fmt(st.mana || 0)}</b></span><span></span></div>
        <div class="bar mp"><div id="tj-mpbar" style="width:${st.mana ? Math.max(0, s.mana || 0) / st.mana * 100 : 0}%"></div></div>
        ${end ? `<p class="${win ? "q4" : "q5"}" style="text-align:center"><b>${x.result}</b></p>` : ""}
        <div class="trib-log" id="tj-log">${x.log.slice(0, 8).map(l => `<p>${l}</p>`).join("") || "<p>乌云压顶，雷光翻涌……</p>"}</div>
        ${end ? `<div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.closeTrib()">离开</button></div>` : ""}
      </div>`;
    },
  },
});
