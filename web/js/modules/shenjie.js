/* =====================================================================
 * 模块：神界（九重天）—— 每重天一张图：东西南北四域 + 大殿 / 天尊殿 / 愿力祠 / 神市 / 道场（数值 config/shenjie.js）
 * ---------------------------------------------------------------------
 * 存档：s.yuanli 愿力；s.sj = { day 北京日期, dcDay 上次感悟日期, gwN 感悟总次数, dcN { "a_0": 本重天感悟次数 },
 *        attr { 属性: 值 } 感悟累计固定属性, zy [{ k 种类, lv 级数 0~36, a 哪重天 }], v 3, sxDay 神像愿力发放日 }
 * 2026-11-12 道场改感悟（愿力 + 灵石，随机 3 种属性），真意 36 级、加突破属性百分比（v 3，旧真意级数截到 36）。
 * 2026-11-12 去掉格子探索、尊者、神将殿、神纹（旧存档里的 p / jd / n / sw 不再使用）。
 * ===================================================================== */
G.module({
  id: "shenjie",

  defaults: () => ({ yuanli: 0, sj: {} }),

  api: {
    sjC() { return CFG.shenjie || {}; },
    sjS() {
      const s = this.s; if (!s.sj || typeof s.sj !== "object") s.sj = {};
      const J = s.sj, d = this.bjDay();
      if (J.day !== d) J.day = d;
      for (const k of ["dcN", "attr"]) if (!J[k] || typeof J[k] !== "object" || Array.isArray(J[k])) J[k] = {};
      if (J.v !== 2 && J.v !== 3) { J.zy = []; J.dcN = {}; delete J.buy; }   // 旧真意（含买的防御真意、闪避暴击真意）作废
      if (J.v !== 3) { J.v = 3; for (const z of Array.isArray(J.zy) ? J.zy : []) z.lv = Math.min(this.sjC().ZY_MAX || 36, Math.max(0, Math.floor(+z.lv) || 0)); }   // 2026-11-12 真意改 36 级百分比
      if (!Array.isArray(J.zy)) J.zy = [];
      if (typeof s.yuanli !== "number" || !isFinite(s.yuanli)) s.yuanli = 0;
      if (J.sxDay !== d) {   // 神像：每座每天 SX_YL 愿力，按过去的天数补
        const n = this.sjSxCount(), C = this.sjC();
        if (J.sxDay && n > 0) { const days = Math.max(1, Math.min(C.SX_MAX_DAY || 30, Math.round((Date.parse(d) - Date.parse(J.sxDay)) / 86400000) || 1)), y = this.sjSxDayYl() * days;
          const got = {};   // 每座神像按所在界产一种物品
          for (const x of this.sjSxItems()) got[x.k] = (got[x.k] || 0) + x.n * days;
          const it = Object.keys(got).filter(k => got[k] > 0); it.forEach(k => this.addSm(k, got[k]));
          if (y > 0) s.yuanli += y;
          if (y > 0 || it.length) this.log(`${n} 座神像${days > 1 ? ` ${days} 天` : "今日"}共提供${[y > 0 ? `愿力 ${U.fmt(y)}` : ""].concat(it.map(k => `${DATA.smName(k)} ${U.fmt(got[k])}`)).filter(Boolean).join("、")}。`, "gold"); }
        J.sxDay = d;
      }
      return J;
    },
    isShen(a) { return !!DATA.maps[a] && DATA.maps[a].w === "shen"; },
    sjWi(a) { return (DATA.maps[a] || {}).wi || 0; },
    sjAt(arr, a) { arr = arr || []; return arr[Math.min(this.sjWi(a), arr.length - 1)] || 0; },
    sjJieName(a) { return (DATA.maps[a] || {}).name || ""; },
    sjJk() { return 1; },
    // 每域 2 界：格子游历用 r = 4 + 域 × 2 + j（4 ~ 11），和四域 0 ~ 3 的格子分开存
    sjJieOf(a, r, j) { const N = (this.sjC().JIE_NAMES || [])[this.sjWi(a)] || []; return N[r * 2 + (j ? 1 : 0)] ? N[r * 2 + (j ? 1 : 0)] + "界" : ""; },
    // 界的征服：s.grids["a_g"].m = 怪物格子（第一次进入时随机 JIE_MOB 个，不含中间神像格），.k = 已打败，.sx = 神像等级（0 级没有效果）
    //   神像固定在界地图正中间那格（sjSxCell），一开始 0 级；全部怪物打败（已占领）后才能升级（用户定 2026-11-12）
    sjSxCell(g) { const N = this.gridN(g); return Math.floor(N * N / 2); },
    sjJieG(a, g) {
      const s = this.s, N = this.gridN(g), M = Math.min(N * N - 1, this.sjC().JIE_MOB || 33), C0 = this.sjSxCell(g);
      if (!s.grids || typeof s.grids !== "object") s.grids = {};
      const k = a + "_" + g, o = s.grids[k] && typeof s.grids[k] === "object" ? s.grids[k] : (s.grids[k] = { v: [] });
      if (Array.isArray(o.m) && o.m.length && o.m.length !== M) {   // 怪物数改了（33 → 36）：保留已打败的，少了补随机空格，多了去掉没打败的
        const km = new Set(o.k || []), cur = o.m.filter(i => i !== C0);
        if (cur.length < M) { const vs = new Set(o.v || []), free = [], seen = [];   // 补的怪优先放没走过的格子（放到走过的格子上玩家看不到）
          for (let i = 0; i < N * N; i++) if (i !== C0 && !cur.includes(i)) (vs.has(i) ? seen : free).push(i);
          while (cur.length < M && free.length) cur.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
          while (cur.length < M && seen.length) cur.push(seen.splice(Math.floor(Math.random() * seen.length), 1)[0]); }
        else while (cur.length > M) { const j = cur.findIndex(i => !km.has(i)); cur.splice(j >= 0 ? j : cur.length - 1, 1); }
        o.m = cur.sort((x, y) => x - y); o.k = (o.k || []).filter(i => o.m.includes(i));
      }
      if (!Array.isArray(o.m) || o.m.length !== M) { const all = Array.from({ length: N * N }, (_, i) => i).filter(i => i !== C0); for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; } o.m = all.slice(0, M).sort((x, y) => x - y); o.k = []; }
      if (!Array.isArray(o.k)) o.k = [];
      if (o.m.includes(C0)) {   // 老存档：中间格是怪物的，挪到别的空格（打败过的一起挪）
        const vs = new Set(o.v || []), free0 = [], seen0 = []; for (let i = 0; i < N * N; i++) if (i !== C0 && !o.m.includes(i)) (vs.has(i) ? seen0 : free0).push(i);
        const free = free0.length ? free0 : seen0, to = free.length ? free[Math.floor(Math.random() * free.length)] : -1;
        if (to >= 0) { o.m = o.m.map(i => i === C0 ? to : i).sort((x, y) => x - y); o.k = o.k.map(i => i === C0 ? to : i); }
      }
      return o;
    },
    sjJieDone(a, g) { const o = this.sjJieG(a, g); return o.k.length >= o.m.length; },
    sjSxList() { const G0 = this.s.grids || {}; return Object.keys(G0).filter(k => G0[k] && G0[k].sx > 0 && +k.split("_")[1] >= DATA.regionCount).map(k => Math.min(this.sjC().SX_MAX || 12, Math.floor(+G0[k].sx) || 0)); },
    sjSxItemK(g) { const L = this.sjC().SX_ITEM || []; return L[(g - DATA.regionCount) % Math.max(1, L.length)] || ""; },   // 第几界的神像产什么
    sjSxItemN(lv) { return lv * (this.sjC().SX_ITEM_N || 0); },
    sjSxItems() { const G0 = this.s.grids || {}, M = this.sjC().SX_MAX || 12; return Object.keys(G0).filter(k => G0[k] && G0[k].sx > 0 && +k.split("_")[1] >= DATA.regionCount).map(k => ({ k: this.sjSxItemK(+k.split("_")[1]), n: this.sjSxItemN(Math.min(M, Math.floor(+G0[k].sx) || 0)) })).filter(x => x.k && x.n > 0); },
    sjSxOutRows(g, lv, up) {   // 神像产出行（愿力 + 本界物品，带图片）
      const C = this.sjC(), k = this.sjSxItemK(g), yl = lv * (C.SX_YL || 0), n = this.sjSxItemN(lv), d = `<small>${lv ? "每天" : "0 级没有产出"}</small>`, v = x => lv ? (up ? "+" : "") + U.fmt(x) : "0";
      return `<div class="line"><div>${DATA.li(DATA.iconImg("yuanli"))}愿力${d}</div><b>${v(yl)}</b></div>` + (k ? `<div class="line"><div>${DATA.li(DATA.smIcon(k))}${DATA.smName(k)}${d}</div><b>${v(n)}</b></div>` : "");
    },
    sjSxCount() { return this.sjSxList().length; },
    sjSxDayYl() { return this.sjSxList().reduce((t, lv) => t + lv * (this.sjC().SX_YL || 0), 0); },
    // 征服度：每只 JIE_PCT%，全部打败 =「已占领」
    sjJiePct(a, g) { const o = this.sjJieG(a, g); return o.k.length >= o.m.length ? "已占领" : `征服度 ${Math.min(99, Math.floor(o.k.length * 100 / Math.max(1, o.m.length)))}%`; },
    // 神像用的 3 种神界矿石（按界轮换本图矿石）
    //   全部 80 个界（10 重天 × 8）按序号依次取 6 选 3 的 20 种组合（排成每段用量尽量平均），每种矿石正好用 40 次
    sjSxOres(a, g) {
      const O = DATA.mapPool(a).ore; if (O.length < 3) return O.slice();
      if (!this._sxCombo || this._sxCombo.n !== O.length) {
        const all = [], n = O.length; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) all.push([i, j, k]);
        const cnt = new Array(n).fill(0), out = [];
        while (all.length) { let bi = 0, bv = Infinity; all.forEach((c, i) => { const v = c.reduce((t, x) => t + cnt[x], 0); if (v < bv) { bv = v; bi = i; } }); const c = all.splice(bi, 1)[0]; c.forEach(x => cnt[x]++); out.push(c); }
        this._sxCombo = { n, list: out };
      }
      const L = this._sxCombo.list, idx = this.sjWi(a) * 8 + (g - DATA.regionCount);
      return L[((idx % L.length) + L.length) % L.length].map(i => O[i]);
    },
    sjSxNeed(a, g, lv) { return this.sjSxOres(a, g).map(n => ({ n, g: DATA.matByName[n].g, c: lv * (this.sjC().SX_ORE || 1000) })); },
    // 建立 / 升级神像（0 → 1 是建立）
    sjBuildSx(a, g) {
      a = +a; g = +g; if (!Number.isInteger(a) || !Number.isInteger(g) || g < DATA.regionCount || !this.gridOpen(a, g)) return;
      const o = this.sjJieG(a, g), C = this.sjC(), lv = Math.floor(+o.sx) || 0, to = lv + 1;
      if (!this.sjJieDone(a, g)) return this.log(`击败${this.sjGrName(a, g)}全部 ${this.sjJieG(a, g).m.length} 只怪物后才能升级神像。`, "sys");
      if (lv >= (C.SX_MAX || 12)) return this.log("神像已是最高级。", "sys");
      const need = this.sjSxNeed(a, g, to), lack = need.filter(x => this.countMat("ore", x.g) < x.c);
      if (!need.length || lack.length) return this.log(`矿石不足：${lack.map(x => `${x.n} ${U.fmt(this.countMat("ore", x.g))} / ${U.fmt(x.c)}`).join("、")}。`, "sys");
      this.sjS(); need.forEach(x => this.takeMat("ore", x.g, x.c)); o.sx = to;
      this.log(`${this.sjGrName(a, g)}神像升到 ${to} 级，每天提供愿力 ${U.fmt(to * (C.SX_YL || 0))}${this.sjSxItemK(g) ? `、${DATA.smName(this.sjSxItemK(g))} ${U.fmt(this.sjSxItemN(to))}` : ""}。`, "gold"); this.after();
    },
    // 神像弹窗：大图 + 当前产出；点「升级」再弹出升级需要的物品（都带图片）
    openSjSx(a, g) {
      a = +a; g = +g; const o = this.sjJieG(a, g), C = this.sjC(), lv = Math.floor(+o.sx) || 0, M = C.SX_MAX || 12, done = this.sjJieDone(a, g), yl = lv * (C.SX_YL || 0);
      this.modal(`<img class="sx-big" src="img/map/sjsx.webp?v=1" alt="">
        <div class="card"><h3>当前产出<small>神像 ${lv} 级</small></h3>${this.sjSxOutRows(g, lv, true)}</div>
        ${done || lv >= M ? "" : `<p class="desc bad">击败本界全部 ${o.m.length} 只怪物后才能升级（已击败 ${o.k.length} 只）</p>`}
        <div class="btns">${lv < M ? `<button onclick="G.openSjSxUp(${a},${g})" ${done ? "" : "disabled"}>升级</button>` : `<button disabled>已满级</button>`}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    openSjSxUp(a, g) {
      a = +a; g = +g; const o = this.sjJieG(a, g), C = this.sjC(), lv = Math.floor(+o.sx) || 0, M = C.SX_MAX || 12, to = lv + 1;
      if (lv >= M || !this.sjJieDone(a, g)) return this.openSjSx(a, g);
      const need = this.sjSxNeed(a, g, to), ok = need.length && need.every(x => this.countMat("ore", x.g) >= x.c);
      const rows = need.map(x => { const h = this.countMat("ore", x.g); return `<div class="line"><div>${DATA.li(DATA.matImg("ore", x.g))}${x.n}</div><b class="${h >= x.c ? "" : "c-red"}">${U.fmt(h)} / ${U.fmt(x.c)}</b></div>`; }).join("");
      this.modal(`<h2>升级神像<small> ${lv} → ${to} 级</small></h2>
        <div class="card"><h3>需要物品</h3>${rows}</div>
        <div class="card"><h3>升级后产出</h3>${this.sjSxOutRows(g, to, true)}</div>
        <div class="btns"><button class="primary" onclick="G.sjBuildSx(${a},${g})" ${ok ? "" : "disabled"}>升级</button><button onclick="G.openSjSx(${a},${g})">返回</button></div>`);
    },
    sjGr(r, j) { return 4 + r * 2 + (j ? 1 : 0); },
    sjGrName(a, g) { return DATA.regionName(a, (g - 4) >> 1) + "·" + this.sjJieOf(a, (g - 4) >> 1, (g - 4) & 1); },
    sjKey(a) { return a + "_0"; },
    sjMapOk(a) { return this.isShen(a) && this.worldOpen("shen") && this.realmOK(DATA.mapReq(a)); },   // 默认全开：达到境界就能进

    // 道场：从第一重天起，前一重天 10 种真意都得到了才去下一重天得真意（还要境界够）；全部得到后仍可每天感悟（在最高能进的那重天）
    sjZyKinds() { return this.sjC().ZY_KINDS || []; },
    sjZyOf(a) { return this.sjS().zy.filter(z => z.a === a); },
    sjDcDone(a) { return this.sjZyOf(a).length >= this.sjZyKinds().length; },
    sjDcAt() {
      const L = [...(DATA.worldMapIdx.shen || [])].sort((x, y) => this.sjWi(x) - this.sjWi(y));
      for (const a of L) { if (this.sjDcDone(a)) continue; return this.sjMapOk(a) ? { a, j: 0 } : null; }
      const ok = L.filter(a => this.sjMapOk(a)); return ok.length ? { a: ok[ok.length - 1], j: 0, all: true } : null;
    },
    sjGwN() { const J = this.sjS(); return Math.max(0, Math.floor(+J.gwN || 0)); },   // 已感悟总次数
    sjGwToday(a) { return !DATA.isTest() && (this.sjS().dcDayM || {})[this.sjKey(a)] === this.bjDay(); },   // 每重天每天一次
    // 每重天单独计次：本重天第 n 次 = n × GW_YL / GW_STONE × 重天倍率（第一重天 1 倍 → 最后一重天 GW_LAST 倍）
    sjGwCost(a) { const C = this.sjC(), n = (this.sjS().dcN[this.sjKey(a)] || 0) + 1, M = DATA.worldMapIdx.shen || [], f = M.length > 1 ? Math.max(0, M.indexOf(a)) / (M.length - 1) : 0, k = 1 + f * ((C.GW_LAST || 1) - 1);
      return { yl: Math.round(n * (C.GW_YL || 81) * k), stone: Math.round(n * (C.GW_STONE || 108) * k) }; },
    // 在第 a 重天道场感悟（每重天独立计数；本重天 10 种真意拿齐后还能无限感悟，只是不再得真意）
    sjWudao(a) {
      a = +a; const J = this.sjS(), C = this.sjC(), s = this.s;
      if (!this.sjMapOk(a)) return this.log("还不能在这里的道场感悟（境界不够）。", "sys");
      if (this.sjGwToday(a)) return this.log("本重天今天已经感悟过了。", "sys");
      const c = this.sjGwCost(a);
      if (s.yuanli < c.yl || s.stone < c.stone) return this.log(`感悟需要 ${U.fmt(c.yl)} 愿力、${U.fmt(c.stone)} 灵石。`, "sys");
      s.yuanli -= c.yl; s.stone -= c.stone; (J.dcDayM || (J.dcDayM = {}))[this.sjKey(a)] = this.bjDay(); J.gwN = this.sjGwN() + 1;
      const K = (C.GW_KINDS || []).slice(), V = C.GW_VAL || [49, 81], add = {};
      for (let i = 0; i < (C.GW_PICK || 3) && K.length; i++) { const k = K.splice(Math.floor(Math.random() * K.length), 1)[0]; add[k] = U.rand(V[0], V[1]); J.attr[k] = (J.attr[k] || 0) + add[k]; }
      const key = this.sjKey(a), got = [];
      {
        const n = J.dcN[key] = (J.dcN[key] || 0) + 1;
        if (C.DC_ZY && n % C.DC_ZY === 0) {   // 每满 DC_ZY 次：本重天还没得的真意里随机一种（0 级）
          const have = new Set(this.sjZyOf(a).map(z => z.k)), left = this.sjZyKinds().filter(k => !have.has(k));
          if (left.length) { const k = left[Math.floor(Math.random() * left.length)]; J.zy.push({ k, lv: 0, a }); got.push(this.sjZyName(k)); }   // 图 img/icons/zy_<k>.webp
        }
      }
      const txt = Object.keys(add).map(k => `${this.sjAttrName(k)} +${add[k]}`).join("、");
      this.log(`${this.sjJieName(a)}道场感悟：${txt}${got.length ? `，获得${this.sjJieName(a)}${got.join("、")}` : ""}。`, "gold");
      this.after();
    },
    sjAttrName(k) { if (String(k).startsWith("res_")) return ((DATA.elById || {})[k.slice(4)] || {}).name + "抗"; return { atk: "攻击", def: "防御", hp: "生命", mana: "法力", hit: "命中", dodge: "闪避", speed: "速度", crit: "暴击", res: "六系抗性", cult: "修炼速度", body: "炼体速度" }[k] || k; },
    sjZyName(k) { return `${(this.sjC().ZY_NAME || {})[k] || this.sjAttrName(k)}真意`; },
    // 重天倍率：第一重天 1 倍 → 最后一重天 ZY_LAST 倍
    sjZyK(z) { const n = Math.max(1, (DATA.worldMapIdx.shen || []).length - 1); return 1 + Math.min(1, this.sjWi(z.a) / n) * ((this.sjC().ZY_LAST || 3) - 1); },
    // 每级 %：按重天倍率分（第一重天 1 份、最后一重天 ZY_LAST 份），10 重天同一种全满合计 ZY_PCT_MAX%
    sjZyStep(z) { const C = this.sjC(), M = DATA.worldMapIdx.shen || [], sum = M.reduce((t, a) => t + this.sjZyK({ a }), 0) || 1; return (C.ZY_PCT_MAX || 52) * this.sjZyK(z) / (sum * (C.ZY_MAX || 36)); },
    sjZyVal(z, lv) { return Math.round(this.sjZyStep(z) * (lv == null ? z.lv : lv) * 1000) / 1000; },   // 这条真意加的 %
    // 每条真意（第几重天 × 哪种）固定用 2 种神像物品：全部 10 重天 × 10 种依次取 8 选 2 的组合，挑用得最少的，打乱顺序（固定种子），每种物品用的次数一样多
    sjZyItems(z) {
      const L = this.sjC().SX_ITEM || [], K = this.sjZyKinds(), nM = (DATA.worldMapIdx.shen || []).length || 10;
      if (L.length < 2) return L.slice();
      if (!this._zyItem || this._zyItem.key !== L.join() + "|" + K.length + "|" + nM) {
        let seed = 81; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const pairs = []; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) pairs.push([i, j]);
        for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
        const cnt = new Array(L.length).fill(0), used = new Map(), out = [];
        for (let n = 0; n < nM * K.length; n++) {
          let best = null, bv = Infinity;
          for (const p of pairs) { const v = (cnt[p[0]] + cnt[p[1]]) * 1000 + (used.get(p) || 0) * 10 + rnd(); if (v < bv) { bv = v; best = p; } }
          cnt[best[0]]++; cnt[best[1]]++; used.set(best, (used.get(best) || 0) + 1); out.push(best);
        }
        this._zyItem = { key: L.join() + "|" + K.length + "|" + nM, out };
      }
      const idx = this.sjWi(z.a) * K.length + Math.max(0, K.indexOf(z.k)), p = this._zyItem.out[idx % this._zyItem.out.length];
      return p.map(i => L[i]);
    },
    sjZyCost(z) { const C = this.sjC(), L = z.lv + 1, k = this.sjZyK(z); return { yl: Math.round((C.ZY_YL || 3600) * L * k), stone: Math.round((C.ZY_STONE || 36000) * L * k), items: this.sjZyItems(z).map(x => ({ k: x, n: (C.ZY_ITEM_N || 0) * L })) }; },
    sjZyOk(c) { return this.s.yuanli >= c.yl && this.s.stone >= c.stone && c.items.every(x => this.smCount(x.k) >= x.n); },
    sjZyUp(i) {
      const J = this.sjS(), C = this.sjC(), z = J.zy[+i]; if (!z) return;
      if (z.lv >= (C.ZY_MAX || 36)) return this.log("已满级。", "sys");
      const c = this.sjZyCost(z); if (!this.sjZyOk(c)) return this.log(`修炼需要 ${U.fmt(c.yl)} 愿力、${U.fmt(c.stone)} 灵石${c.items.map(x => `、${DATA.smName(x.k)} ${U.fmt(x.n)}`).join("")}。`, "sys");
      this.s.yuanli -= c.yl; this.s.stone -= c.stone; c.items.forEach(x => this.takeSm(x.k, x.n)); z.lv++; this.log(`${this.sjJieName(z.a)}${this.sjZyName(z.k)}修炼到 ${z.lv} 级。`, "good"); this.after();
    },

    // 感悟累计的固定属性（craft.js danBonus 里加；cult / body 在修炼、炼体速度里加）
    sjBonus() {
      const J = (this.s && this.s.sj) || {}, b = {};
      for (const k in J.attr || {}) b[k] = (b[k] || 0) + (+J.attr[k] || 0);
      return b;
    },
    // 真意百分比 { atk: %, res_jin: % … }：只乘修为突破、肉身突破给的属性（player.js computeStats）
    sjPct() {
      const J = (this.s && this.s.sj) || {}, b = {}; if (J.v !== 3 || !Array.isArray(J.zy)) return b;
      for (const z of J.zy) b[z.k] = (b[z.k] || 0) + this.sjZyVal(z);
      return b;
    },

    /* ---------- 界面 ---------- */
    // 每重天的图：四边东西南北四域，中间 大殿 / 天尊殿 / 愿力祠 / 神市 / 道场
    sjMapView(a) {
      const s = this.s, hn = id => id === "dc" ? "道场" : this.xjHallName(a, id);
      const H = [["tg", 50, 35, "tg.png", 28], ["xj", 30, 52, "xj.png", 20], ["gd", 70, 52, "gd.png", 20], ["shop", 30, 68, "shop.png", 20], ["dc", 70, 68, "dc.webp?v=2", 24]];   // 左右对称排开
      const hall = H.map(([id, x, y, img, w]) => `<button class="sjhall" style="left:${x}%;top:${y}%;width:${w}%" onclick="G.setHall('${id}')"><img src="img/hall_${img}" alt=""><span>${hn(id)}</span></button>`).join("");
      // 东西南北四域画在底图里（北雪山、南火山、西沙漠、东林海，img/map/sj_jie2.webp），点名字牌开该域的探索 / 出窍
      const P = { 3: [50, 14], 2: [62, 89], 1: [9, 62], 0: [91, 46] };
      const rg = [3, 1, 0, 2].map(r => { const [x, y] = P[r];
        const ex = s.explore && s.explore.map === a && (s.explore.reg || 0) === r, q = s.cq && s.cq.map === a && (s.cq.reg || 0) === r;
        return `<button class="sjmk sjmk-rg${r < 2 ? " sjmk-v" : ""}${ex || q ? " cur" : ""}" style="left:${x}%;top:${y}%" onclick="G.openSjRg(${a},${r})">${DATA.regionDirs[r]}域${ex ? "<small>探索中</small>" : q ? "<small>出窍中</small>" : ""}</button>`; }).join("");
      const gx = this.xjGxOf ? `<div class="sjgx">愿力 <b>${U.fmt(s.yuanli || 0)}</b> · 贡献 <b>${U.fmt(this.xjGxOf(a))}</b></div>` : "";
      return `<div class="sjmap sjhxm"><img src="img/map/sj_jie2.webp?v=1" alt="">${gx}${hall}${rg}</div>`;
    },
    // 点四域：一整张图分三块，上面本域（历练 / 探索），下面左右两个界（点进去开格子）
    openSjRg(a, r) {
      a = +a; r = +r; const s = this.s, RG = ["dong", "xi", "nan", "bei"], d = DATA.regionDirs[r] + "域";
      const ok = this.isTrained(a, r), open = this.regionOpen(a, r), go = this.gridOpen(a, r), x = s.explore && s.explore.map === a && (s.explore.reg || 0) === r ? s.explore : null, q = s.cq && s.cq.map === a && (s.cq.reg || 0) === r;
      const st = `onclick="event.stopPropagation()"`;
      const btns = !open ? `<button class="sm" disabled ${st}>未开启</button>` : `<button class="sm ${x && x.once ? "on" : ""}" onclick="event.stopPropagation();G.toggleExplore(${a},${r},true)">${x && x.once ? "停止" : "历练"}</button><button class="sm ${x && !x.once ? "on" : ""}" onclick="event.stopPropagation();G.toggleExplore(${a},${r})" ${ok ? "" : "disabled"}>${x && !x.once ? "停止" : "探索"}</button>`;
      const jie = [0, 1].map(j => { const g = this.sjGr(r, j), ok2 = this.gridOpen(a, g);
        const o = ok2 ? this.sjJieG(a, g) : null, done = o && o.k.length >= o.m.length;
        const info = !ok2 ? "未开启" : this.sjJiePct(a, g) + ` · 神像 ${Math.floor(+o.sx) || 0} 级`;
        const sx = ok2 && done && (Math.floor(+o.sx) || 0) < (this.sjC().SX_MAX || 12) ? `<button class="sm" onclick="event.stopPropagation();G.openSjSx(${a},${g})">升级神像</button>` : "";
        return `<div class="sjz sjz${j + 1}${ok2 ? "" : " off"}" ${ok2 ? `onclick="G.closeModal();G.openGrid(${a},${g})"` : ""}><div class="sjjie"><b>${this.sjJieOf(a, r, j)}</b><small>${info}</small>${sx}</div></div>`; }).join("");
      // 图分三块：上半本域（点图进本域格子，按钮历练 / 探索），下面左右两个界（点图进界，用小世界令牌开格子）
      this.modal(`<div class="sjrgw"><img src="img/map/sjrg_${RG[r]}.webp?v=1" alt=""><div class="sjz sjz0${go ? "" : " off"}" ${go ? `onclick="G.closeModal();G.openGrid(${a},${r})"` : ""}><div class="sjyu"><b>${this.sjJieName(a)} · ${d}</b><small>${ok ? "已通过历练" : "未历练"}${q ? " · 出窍中" : ""}</small><div class="btns">${btns}</div></div></div>${jie}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 愿力祠兑换：悟道果、小世界令牌（config/shenjie.js YL_SHOP）
    sjShopCard(a) {
      const P = this.sjC().YL_SHOP || {};
      return `<div class="card"><h3>愿力兑换<small>愿力 ${U.fmt(this.s.yuanli)}</small></h3>${Object.keys(P).map(k => `<div class="line"><div>${DATA.li(DATA.smIcon(k))}${DATA.smName(k)}<small>${U.fmt(P[k])} 愿力/个 · 已有 ${U.fmt(this.smCount(k))}</small></div><button class="sm" onclick="G.openSjBuy('${k}')" ${this.s.yuanli < P[k] ? "disabled" : ""}>兑换</button></div>`).join("")}</div>`;
    },
    openSjBuy(k) {
      const c = (this.sjC().YL_SHOP || {})[k]; if (!c) return;
      const max = Math.min(99999, Math.floor((this.s.yuanli || 0) / c)); if (max <= 0) return this.log("愿力不足。", "sys");
      this.qtyModal(`兑换${DATA.smName(k)}`, `<p class="desc">每个 ${U.fmt(c)} 愿力 · 现有愿力 ${U.fmt(this.s.yuanli || 0)}</p>`, max, n => this.sjBuyItem(k, n), { max: "最多可换", ok: "兑换" });
    },
    sjBuyItem(k, n) {
      const s = this.s, c = (this.sjC().YL_SHOP || {})[k]; if (!c) return;
      n = Math.min(Math.floor(+n), Math.floor((s.yuanli || 0) / c));
      if (!Number.isFinite(n) || n <= 0) return this.log("愿力不足。", "sys");
      if (!this.addSm(k, n)) return;
      s.yuanli -= c * n; this.log(`兑换${DATA.smName(k)} ×${n}。`, "good"); this.after();
    },
    // 神市：分类 功法 / 药材 / 矿石；药材矿石用本图贡献换本图神界药材矿石（MAT_GX 点一个）
    setSjShopTab(t) { this.sjShopTab = t; this.render(); },
    sjShopView(a) {
      const t = ["gf", "herb", "ore"].includes(this.sjShopTab) ? this.sjShopTab : "gf";
      const tabs = `<div class="sub-tabs">${[["gf", "功法"], ["herb", "药材"], ["ore", "矿石"]].map(([k, n]) => `<button class="${t === k ? "active" : ""}" onclick="G.setSjShopTab('${k}')">${n}</button>`).join("")}</div>`;
      if (t === "gf") return tabs + this.jieGfView("jshop", a);
      const c = this.sjC().MAT_GX || 6, gx = this.xjGxOf(a), L = DATA.mapPool(a)[t] || [];
      return tabs + `<div class="card"><h3>${t === "herb" ? "药材" : "矿石"}<small>本图贡献 ${U.fmt(gx)}</small></h3>${L.map((n, i) => { const m = DATA.matByName[n] || {};
        return `<div class="line"><div>${DATA.li(DATA.matImg(m.kind || t, m.g))}${n}<small>${U.fmt(c)} 贡献/个 · 已有 ${U.fmt(this.countMat(m.kind || t, m.g))}</small></div><button class="sm" onclick="G.openSjMat(${a},'${t}',${i})" ${gx < c ? "disabled" : ""}>兑换</button></div>`; }).join("")}</div>`;
    },
    openSjMat(a, t, i) {
      const n0 = (DATA.mapPool(+a)[t] || [])[+i], c = this.sjC().MAT_GX || 6; if (!n0) return;
      const max = Math.min(99999, Math.floor(this.xjGxOf(+a) / c)); if (max <= 0) return this.log("贡献不足。", "sys");
      this.qtyModal(`兑换${n0}`, `<p class="desc">每个 ${U.fmt(c)} 点本图贡献 · 现有贡献 ${U.fmt(this.xjGxOf(+a))}</p>`, max, n => this.sjBuyMat(a, t === "herb" ? 0 : 1, i, n), { max: "最多可换", ok: "兑换" });
    },
    sjBuyMat(a, k, i, n) {
      a = +a; const t = +k ? "ore" : "herb", name = (DATA.mapPool(a)[t] || [])[+i], c = this.sjC().MAT_GX || 6;
      if (!name || !DATA.maps[a] || DATA.maps[a].w !== "shen" || !this.mapOpen(a)) return;
      n = Math.min(Math.floor(+n), Math.floor(this.xjGxOf(a) / c));
      if (!Number.isFinite(n) || n <= 0) return this.log("贡献不足。", "sys");
      const m = DATA.matByName[name]; if (!m) return;
      this.addMat(m.kind, name, m.g, n); this.xjGxAdd(a, -c * n);
      this.log(`兑换${name} ×${n}。`, "good"); this.after();
    },
    sjHeadCard(a) {
      return `<div class="card"><div class="row small"><span>愿力 <b>${U.fmt(this.s.yuanli)}</b> · 本图贡献 <b>${U.fmt(this.xjGxOf(a))}</b></span></div></div>`;
    },
    // 道场：感悟 + 真意
    sjDcView(a) {
      const J = this.sjS(), C = this.sjC(), here = this.sjMapOk(a), today = this.sjGwToday(a);
      const n = J.dcN[this.sjKey(a)] || 0, got = this.sjZyOf(a).length, all = this.sjZyKinds().length, done = got >= all;
      const c = this.sjGwCost(a), poor = this.s.yuanli < c.yl || this.s.stone < c.stone;
      const btn = `<button class="primary" onclick="G.sjGwStart(${a})" ${here && !today && !poor && !this._gwAnim ? "" : "disabled"}>${this._gwAnim ? "感悟中…" : today ? "今日已感悟" : here ? `感悟一次（消耗${U.fmt(c.yl)} 愿力、${U.fmt(c.stone)} 灵石）` : "境界不够"}</button>`;
      const next = done ? " · 本重天真意已全部得到" : ` · 再感悟 ${C.DC_ZY - n % C.DC_ZY} 次得真意`;
      const an = this._gwAnim ? " on" : "";   // 感悟中：人物发光、灵光环、光点上升（3 秒，sjGwStart）
      const hero = `<div class="sjgw${an}"><div class="sjgw-ring"></div><div class="sjgw-ring r2"></div>${an ? Array.from({ length: 12 }, (_, i) => `<i style="left:${8 + i * 7}%;animation-delay:${(i * 0.23 % 1.6).toFixed(2)}s"></i>`).join("") : ""}<img src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt=""></div>`;
      return this.sjHeadCard(a) + `<div class="card"><h3>感悟<small>本重天感悟 ${n} 次 · 本重天真意 ${got} / ${all}${next}</small></h3>${hero}<div class="btns">${btn}</div></div>` + this.sjZyCard(a);
    },
    // 点感悟：先放 3 秒感悟动画，再结算（sjWudao）
    sjGwStart(a) {
      if (this._gwAnim) return; this._gwAnim = Date.now(); this.render();
      // 等服务器结算回来再恢复按钮，避免先闪一下旧消耗
      setTimeout(async () => { try { await this.sjWudao(a); } finally { this._gwAnim = 0; this.render(); } }, 3000);
    },
    /* ---------- 神功（大帝殿，每重天 9 本）：s.sj.sg = { "重天_本": { n 已学次数, d 最后学习日, lit [已点亮神纹格] } } ---------- */
    sjSgId(a, j) { return this.sjWi(a) + "_" + j; },
    sjSgName(a, j) { return ((this.sjC().SG_LIST || [])[this.sjWi(a)] || [])[j] || "神功"; },
    sjSgImg(a, j) { return `img/icons/sg_${this.sjWi(a)}_${j}.png?v=1`; },
    sjSgSt(a, j) { const J = this.sjS(); if (!J.sg || typeof J.sg !== "object" || Array.isArray(J.sg)) J.sg = {}; const id = this.sjSgId(a, j); const o = J.sg[id] && typeof J.sg[id] === "object" ? J.sg[id] : (J.sg[id] = { n: 0, d: "", lit: [] }); if (!Array.isArray(o.lit)) o.lit = []; o.n = Math.max(0, Math.floor(+o.n) || 0); return o; },
    sjSgDone(a, j) { return this.sjSgSt(a, j).n >= (this.sjC().SG_LEARN_N || 12); },
    // 每本固定 2 种神像物品：90 本依次取 8 选 2 组合里用得最少的（固定种子打乱），每种物品用的次数尽量一样
    sjSgItems(a, j) {
      const L = this.sjC().SX_ITEM || [], nM = (DATA.worldMapIdx.shen || []).length || 10;
      if (L.length < 2) return L.slice();
      if (!this._sgItem || this._sgItem.key !== L.join() + "|" + nM) {
        let seed = 30; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const pairs = []; for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) pairs.push([x, y]);
        for (let x = pairs.length - 1; x > 0; x--) { const y = Math.floor(rnd() * (x + 1)); [pairs[x], pairs[y]] = [pairs[y], pairs[x]]; }
        const cnt = new Array(L.length).fill(0), used = new Map(), out = [];
        for (let n = 0; n < nM * 9; n++) { let best = null, bv = Infinity;
          for (const p of pairs) { const v = (cnt[p[0]] + cnt[p[1]]) * 1000 + (used.get(p) || 0) * 10 + rnd(); if (v < bv) { bv = v; best = p; } }
          cnt[best[0]]++; cnt[best[1]]++; used.set(best, (used.get(best) || 0) + 1); out.push(best); }
        this._sgItem = { key: L.join() + "|" + nM, out };
      }
      return this._sgItem.out[(this.sjWi(a) * 9 + j) % this._sgItem.out.length].map(i => L[i]);
    },
    sjSgCost(a, j) { const C = this.sjC(); return { yl: C.SG_LEARN_YL || 2400, items: this.sjSgItems(a, j).map(k => ({ k, n: C.SG_LEARN_ITEM || 120 })) }; },
    sjSgLearn(a, j) {
      a = +a; j = +j; if (!this.isShen(a) || !(j >= 0 && j <= 8)) return;
      if (!this.mapOpen(a)) return this.log("还不能进入这重天。", "sys");
      const o = this.sjSgSt(a, j), C = this.sjC(), N = C.SG_LEARN_N || 12, d = this.bjDay(), nm = this.sjSgName(a, j);
      if (o.n >= N) return this.log(`《${nm}》已学会。`, "sys");
      if (o.d === d) return this.log(`《${nm}》今天已经学习过了，明天再来。`, "sys");
      const c = this.sjSgCost(a, j);
      if ((this.s.yuanli || 0) < c.yl || c.items.some(x => this.smCount(x.k) < x.n)) return this.log(`学习《${nm}》需要愿力 ${U.fmt(c.yl)}${c.items.map(x => `、${DATA.smName(x.k)} ${U.fmt(x.n)}`).join("")}。`, "sys");
      this.s.yuanli -= c.yl; c.items.forEach(x => this.takeSm(x.k, x.n)); o.n++; o.d = d;
      this.log(o.n >= N ? `《${nm}》学习圆满（${N} / ${N}），神纹点亮图已开启！` : `学习《${nm}》（${o.n} / ${N}）。`, o.n >= N ? "gold" : "good"); this.after();
    },
    sjSgCard(a) {
      const C = this.sjC(), N = C.SG_LEARN_N || 12, d = this.bjDay();
      const books = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(j => { const o = this.sjSgSt(a, j), done = o.n >= N;
        return `<button class="sg-book" style="animation-delay:${(j * 0.7).toFixed(1)}s" onclick="G.${done ? "openSjSw" : "openSjSg"}(${a},${j})"><img src="${this.sjSgImg(a, j)}" alt=""><b>${this.sjSgName(a, j)}</b>${done ? `<span class="tag">已学会</span>` : ""}${!done && o.d === d ? "<small>今日已学习</small>" : ""}</button>`; }).join("");
      return `<div class="card"><h3>神功<small>每本每天学习一次，学满 ${N} 次解锁神纹</small></h3><div class="sg-books">${books}</div></div>`;
    },
    openSjSg(a, j) {
      a = +a; j = +j; const o = this.sjSgSt(a, j), N = this.sjC().SG_LEARN_N || 12, nm = this.sjSgName(a, j);
      if (o.n >= N) return this.openSjSw(a, j);
      const c = this.sjSgCost(a, j), today = o.d === this.bjDay(), ln = (img, n, h, need) => `<div class="line"><div>${DATA.li(img)}${n}</div><b class="${h >= need ? "" : "c-red"}">${U.fmt(h)} / ${U.fmt(need)}</b></div>`;
      const ok = (this.s.yuanli || 0) >= c.yl && c.items.every(x => this.smCount(x.k) >= x.n);
      this.modal(`<img class="sg-big" src="${this.sjSgImg(a, j)}" alt=""><h2 style="text-align:center">${nm}<small> 学习 ${o.n} / ${N}</small></h2>
        <div class="card"><h3>学习一次需要</h3>${ln(DATA.iconImg("yuanli"), "愿力", this.s.yuanli || 0, c.yl)}${c.items.map(x => ln(DATA.smIcon(x.k), DATA.smName(x.k), this.smCount(x.k), x.n)).join("")}</div>
        <div class="btns"><button class="primary" onclick="G.sjSgLearn(${a},${j})" ${!today && ok ? "" : "disabled"}>${today ? "今日已学习" : "学习"}</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 神纹点亮图：N × N，四角主神纹，其余辅神纹；中间格学会就亮，只能点和已亮格相邻的（点亮消耗待定）
    sjSwType(i) { const C = this.sjC(), N = C.SG_W_N || 7, x = i % N, y = Math.floor(i / N), M = C.SG_W_MAIN || [], S = C.SG_W_SUB || ["攻击"];
      const ci = [0, N - 1, N * (N - 1), N * N - 1].indexOf(i); return ci >= 0 ? { main: 1, n: M[ci] || "主神纹" } : { main: 0, n: S[(x + y) % S.length] }; },
    sjSwLit(a, j) { const N = this.sjC().SG_W_N || 7, c = Math.floor(N * N / 2), o = this.sjSgSt(a, j); return new Set([c].concat(o.lit)); },
    openSjSw(a, j, sel) {
      a = +a; j = +j; if (!this.sjSgDone(a, j)) return this.openSjSg(a, j);
      const N = this.sjC().SG_W_N || 7, lit = this.sjSwLit(a, j), adj = i => { const x = i % N, y = Math.floor(i / N); return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([p, q]) => p >= 0 && q >= 0 && p < N && q < N && lit.has(q * N + p)); };
      const s0 = Number.isInteger(+sel) && sel !== undefined && sel !== null ? +sel : -1;
      const cells = Array.from({ length: N * N }, (_, i) => { const t = this.sjSwType(i), on = lit.has(i), can = !on && adj(i);
        return `<button class="sw${t.main ? " main" : ""}${on ? " on" : can ? " can" : ""}${i === s0 ? " sel" : ""}" onclick="G.openSjSw(${a},${j},${i})">${t.main ? "主" : t.n[0]}</button>`; }).join("");
      let info = `<p class="desc">共 ${N * N} 个神纹：四角是主神纹（百分比），其余是辅神纹（固定数值）。从中间开始，只能点亮和已亮神纹相邻的。</p>`;
      if (s0 >= 0) { const t = this.sjSwType(s0), on = lit.has(s0);
        info = `<div class="card"><h3>${t.main ? "主神纹" : "辅神纹"}<small>${on ? "已点亮" : adj(s0) ? "可点亮" : "需先点亮相邻的神纹"}</small></h3><div class="line"><div>${t.n}<small>数值待定</small></div>${on ? `<button class="sm" disabled>已点亮</button>` : `<button class="sm" disabled>点亮消耗待定</button>`}</div></div>`; }
      this.modal(`<h2>${this.sjSgName(a, j)}<small> 神纹 ${lit.size} / ${N * N}</small></h2><div class="swg" style="grid-template-columns:repeat(${N},1fr)">${cells}</div>${info}<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 修炼真意弹窗：需要的物品（带图片）+ 升级后效果
    openSjZy(i) {
      const J = this.sjS(), C = this.sjC(), M = C.ZY_MAX || 36, z = J.zy[+i]; if (!z) return;
      const nm = `境界${this.sjAttrName(z.k)}`, cur = `${nm} +${this.sjZyVal(z).toFixed(2)}%`;
      if (z.lv >= M) return this.modal(`<h2>${this.sjZyName(z.k)}<small> ${z.lv} / ${M} 级</small></h2><div class="card"><h3>当前效果</h3><div class="line"><div>${cur}</div></div></div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
      const c = this.sjZyCost(z), s = this.s, ln = (img, n, h, need) => `<div class="line"><div>${DATA.li(img)}${n}</div><b class="${h >= need ? "" : "c-red"}">${U.fmt(h)} / ${U.fmt(need)}</b></div>`;
      const rows = ln(DATA.iconImg("yuanli"), "愿力", s.yuanli, c.yl) + ln(DATA.iconImg("stone"), "灵石", s.stone, c.stone) + c.items.map(x => ln(DATA.smIcon(x.k), DATA.smName(x.k), this.smCount(x.k), x.n)).join("");
      this.modal(`<h2>${this.sjZyName(z.k)}<small> ${z.lv} → ${z.lv + 1} 级</small></h2>
        <div class="card"><h3>需要物品</h3>${rows}</div>
        <div class="card"><h3>升级后效果</h3><div class="line"><div>${nm}<small>当前 +${this.sjZyVal(z).toFixed(2)}%</small></div><b class="c-green">+${this.sjZyVal(z, z.lv + 1).toFixed(2)}%</b></div></div>
        <div class="btns"><button class="primary" onclick="G.sjZyUp(${+i})" ${this.sjZyOk(c) ? "" : "disabled"}>修炼</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    sjZyCard(a) {
      const J = this.sjS(), C = this.sjC(), M = C.ZY_MAX || 36, s = this.s;
      const rows = J.zy.map((z, i) => [z, i]).filter(([z]) => z.a === a).map(([z, i]) => { const c = this.sjZyCost(z);
        return `<div class="line"><div>${DATA.li(`img/icons/zy_${z.k}.webp?v=1`)}${this.sjZyName(z.k)}<span class="tag">${z.lv} / ${M} 级</span></div>${z.lv >= M ? `<button class="sm" disabled>满级</button>` : `<button class="sm" onclick="G.openSjZy(${i})">修炼</button>`}</div>`; }).join("");
      const at = Object.keys(J.attr).filter(k => J.attr[k]).map(k => `${this.sjAttrName(k)} +${U.fmt(J.attr[k])}`).join("、");
      return `<div class="card"><h3>${this.sjJieName(a)}真意</h3>${at ? `<p class="desc">感悟累计：${at}</p>` : ""}${rows || `<p class="desc">本重天还没有真意。</p>`}</div>`;
    },
  },
});
