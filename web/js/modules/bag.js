/* =====================================================================
 * 模块：背包
 * ---------------------------------------------------------------------
 * 上方三个分页：
 *   装备：头盔 护甲 武器 腿甲 靴 吊坠 + 6 个戒指
 *   法宝：每个大境界开启 1 格，最多 12 格
 *   法术：每个大境界开启 1 格，最多 12 格（放入的法术在战斗中轮流施放）
 * 下方：储物格（扩充以后另做）。
 * 背包物品格式：
 *   丹药 { t: "pill", type: "juqi", g: 境界品质, n: 数量 }        同种同品质堆叠
 *   装备 { t: "eq", e: { slot, g, q, name } }                     每件占一格（法宝 slot = "fabao"）
 *   材料 { t: "mat", kind: "herb"|"ore", name, g, n }  药材、矿石，同名堆叠（g = 序号）
 *   属性丹 { t: "dan", type: "atk", g: 阶, n }                    见 craft.js
 *   炉子 { t: "fu", kind: "dan"|"qi", g: 阶, n }   点「使用」装进洞府
 *   图纸 { t: "bp", kind: "dan"|"qi", g: 阶 }      点「学习」后才能在炼器室炼制
 * ===================================================================== */
G.module({
  id: "bag",
  tab: "bag",

  defaults: () => ({
    stone: CFG.start.stone,                                   // 开局灵石（config/start.js）
    bag: [...CFG.start.pills.map(([type, g, n]) => ({ t: "pill", type, g, n })), ...(CFG.start.book ? [{ t: "book", n: 1 }] : [])], // 开局丹药、功法书（config/start.js）
    bagCap: DATA.BAG_START,
    equip: Object.fromEntries(DATA.equipSlots.map(k => [k, null])), // 装备栏
    fabao: [],                                                // 法宝栏
    spellSlots: [],                                           // 法术栏（法术 id）
  }),

  api: {
    // 法宝名字跟着 config/names.js 的 fabaoName
    // 旧存档补齐持久化 uid：没有 uid 的法宝在服务端绑定存档时就地补上，
    // 下一次存档后渡劫格子才能按 uid 找到它，而不是只在客户端弹窗里临时生成。
    fabaoNames() {
      const s = this.s, f = e => { if (e && e.slot === "fabao" && e.attrs) { e.name = DATA.fabaoName(e.ft, e.g); if (!e.uid) e.uid = DATA.newUid(); } };
      s.bag.forEach(it => it.t === "eq" && f(it.e)); (s.fabao || []).forEach(f);
    },
    // 法宝栏、法术栏当前开启格数：每个大境界 1 格
    // 背包排序：先按类型（修炼丹 → 属性丹 → 药材 → 矿石 → 装备），同类型再按品阶从低到高
    sortBag() {
      const order = it => it.t === "pill" ? 0 : it.t === "dan" || it.t === "ql" || it.t === "ysd" ? 1 : it.t === "mat" ? (it.kind === "herb" ? 2 : 3) : it.t === "fu" ? 4 : it.t === "bp" || it.t === "ss" || it.t === "rbp" || it.t === "dfb" || it.t === "hx" || it.t === "sm" ? 5 : it.t === "eq" ? (it.e.slot === "fabao" ? 7 : 6) : it.t === "cu" ? 8 : 9;
      const grade = it => it.t === "eq" ? it.e.g * 10 + it.e.q : it.g || 0;
      const sub = it => it.t === "pill" || it.t === "dan" ? it.type : it.t === "eq" ? it.e.slot : it.kind || "";
      this.s.bag.sort((a, b) => order(a) - order(b) || grade(a) - grade(b) || (sub(a) < sub(b) ? -1 : sub(a) > sub(b) ? 1 : 0));
    },
    slotCount() { return Math.min(DATA.SLOT_MAX, Math.floor(this.r() / DATA.SLOT_EVERY) + DATA.SLOT_START); },

    /* ---------- 装备属性 ---------- */
    equipStats(e) {
      // 炼制法宝：战斗中祭出；专属属性只在这件法宝攻击时生效（data/forge.js 的 fabaoInfo），不加到人物属性
      if (e.attrs && e.slot === "fabao") return {};
      if (e.attrs) { const out = {}; for (const a of e.attrs) out[a.k] = (out[a.k] || 0) + DATA.attrVal(a, e.g, e); const en = DATA.eqEnhStats(e); for (const k in en) out[k] = (out[k] || 0) + en[k]; return out; } // 炼制装备 / 戒指（data/forge.js）
      return {};
    },
    equipDesc(e) {
      if (e.attrs) {
        let head = "";
        if (e.slot === "fabao") {
          const f = DATA.fabaoInfo(e);
          head = `${DATA.elById[e.el].name}属性${e.name} · 每次祭出消耗法力 ${U.fmt(f.mana)}<br>${f.fuPct ? `<span class="q4">融合 ${DATA.fuseTxt(e.fu)} · 伤害 +${U.dec(f.fuPct)}%</span><br>` : ""}`;
          // 合计（攻击 / 护盾 / 鼎）单独一块，和下面的属性条隔开
          let sum = f.shield ? `护盾值 ${U.fmt(f.shield.hp)} · 防御 ${U.fmt(f.shield.def)}` : `攻击 ${U.fmt(f.atk)}`;
          sum += `<br>每场战斗最多祭出 ${f.uses} 次`;
          if (f.ding) sum += `<br>击中后对方速度 -${U.num(f.ding.speed)}%、命中 -${U.num(f.ding.hit)}%、闪避 -${U.num(f.ding.dodge)}%，持续 ${f.ding.rounds} 回合`;
          head += `<span class="fb-sum">${sum}</span>`;
          if (e.enh) head += `<span class="fb-sum">强化${e.enh}次　${f.shield ? "护盾值" : "附加伤害"} +${U.fmt(DATA.fbEnh(e))}</span>`;
        }
        if (e.slot !== "fabao" && e.enh) head += `<span class="fb-sum">强化${e.enh}次　${this.enhText(e, e.enh).replace(/、/g, "　")}</span>`;
        return head + e.attrs.map(a => `<span class="ac${a.c}">${DATA.attrText(a, e)}</span>`).join("<br>");
      }
      return "";
    },

    /* ---------- 存取物品 ---------- */
    bagFull() { return this.s.bag.length >= this.s.bagCap; },
    // 一格最多叠几个（config/bag.js）
    stackMax(it) { const S = CFG.stack; return S.ONE.includes(it.t) || (it.t === "sm" && S.ONE_SM.includes(it.k)) ? 1 : S.MAX; },
    // 放进背包：先补满同种的格子，剩下的每 stackMax 个开一格；make(k) 造一格 k 个。没空格时丢弃剩下的，返回 false
    bagAdd(match, make, n, lost) {
      n = Math.floor(+n); if (!(n >= 1)) return true;   // 小数向下取整，负数/0 不加（防控制台直接调 add 系函数刷物品）
      const S = this.s.bag, max = this.stackMax(make(1));
      if (max > 1) for (const it of S) { if (n <= 0) break; if (match(it) && (it.n || 1) < max) { const k = Math.min(n, max - (it.n || 1)); it.n = (it.n || 1) + k; n -= k; } }
      while (n > 0) {
        if (this.bagFull()) { if (lost && !this.silent) this.log(lost, "bad"); return false; }
        const k = Math.min(n, max); S.push(make(k)); n -= k;
      }
      return true;
    },
    bagNum(match) { return this.s.bag.reduce((t, it) => t + (match(it) ? it.n || 1 : 0), 0); },
    // 从背包扣 n 个（可跨多格，从后往前扣）；不够返回 false 且不扣
    bagTake(match, n) {
      n = Math.floor(+n); if (!(n >= 1)) return false;   // 小数/负数直接失败，不进 removeAt
      if (this.bagNum(match) < n) return false;
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) { const it = this.s.bag[i]; if (!match(it)) continue; const k = Math.min(n, it.n || 1); this.removeAt(i, k); n -= k; }
      return true;
    },
    addPill(type, g, n = 1) {
      return this.bagAdd(x => x.t === "pill" && x.type === type && x.g === g, k => ({ t: "pill", type, g, n: k }), n, "背包已满，物品遗失了。");
    },
    addMat(kind, name, g, n = 1) {
      if (kind === "sm") return this.addSm(g, n);   // 秘境专用材料（退回养神露等）
      return this.bagAdd(x => x.t === "mat" && x.name === name && x.g === g, k => ({ t: "mat", kind, name, g, n: k }), n, "背包已满，材料遗失了。");
    },
    addEquip(e) {
      if (this.bagFull()) { this.log("背包已满，装备遗失了。", "bad"); return false; }
      if (e && e.attrs && !e.uid) e.uid = DATA.newUid();
      this.s.bag.push({ t: "eq", e }); return true;
    },
    removeAt(i, n = 1) {
      const it = this.s.bag[i]; if (!it) return;
      // 中央关口：小数向下取整，负数/0 直接不扣（原来负数会让 it.n -= 负数 = 反向加物品），
      // 超过格子数量时只扣整格，不按请求数算账（算账在调用方先 clamp，见 sellItem）。
      n = Math.floor(+n); if (!(n >= 1)) return;
      if (it.n !== undefined && it.n > n) it.n -= n; else this.s.bag.splice(i, 1);
    },
    itemName(it) {
      if (it.t === "pill") return `${DATA.realms[it.g]}·${DATA.pills[it.type].name}`;
      if (it.t === "dan") return DATA.danName(it.type, it.g, it.sg);
      if (it.t === "ql") return DATA.qlName(it.sect);   // v213 宗主清灵丹
      if (it.t === "ylb") return DATA.ybName(it.k, it.g);   // 游历宝物（data/youli.js）
      if (it.t === "ysd") return this.ysDanName(it.ys, it.k);   // 隐世宗门炼丹房丹药
      if (it.t === "stp") return this.ysFragName(it.id);   // 神通碎片（隐世宗门秘境）
      if (it.t === "mat") return DATA.matFull(it.kind, it.g);
      if (it.t === "fu") return DATA.furnaceName(it.kind, it.g);
      if (it.t === "bp") return DATA.furnaceName(it.kind, it.g) + "图纸";
      if (it.t === "cu") return it.name;
      if (it.t === "book") return CFG.start.book.name;
      if (it.t === "gfb") { const g = DATA.skillInfo(it.id, 1); return g ? `《${g.name}》` : "秘诀"; }   // 试炼塔秘诀
      if (it.t === "ss") return DATA.stoneName(it.g);
      if (it.t === "hx") return DATA.HX;
      if (it.t === "sm") return DATA.smName(it.k, it.ft, it.tier);
      if (it.t === "rbp") return DATA.ringBpName(it.g, it.r);
      if (it.t === "dfb") return DATA.danName(it.type, it.g) + "丹方";
      if (it.e.attrs && it.e.slot === "fabao") return `${DATA.XING[it.e.g]}·${DATA.elById[it.e.el].name}·${DATA.fabaoName(it.e.ft, it.e.g, it.e.name)}${it.e.enh ? ` +${it.e.enh}` : ""}`;
      if (it.e.attrs) return `${DATA.XING[it.e.g]}·${it.e.name}${it.e.enh ? ` +${it.e.enh}` : ""}`;
      return `${DATA.realms[it.e.g]}·${it.e.name}`;
    },
    sellPrice(it) {
      if (it.t === "pill") return Math.floor(DATA.pillPrice(it.type, it.g) * CFG.price.PILL_SELL);
      if (it.t === "dan") return DATA.danPrice(it.type, it.g);
      if (it.t === "mat") return DATA.matPrice(it.kind, it.g);
      if (it.t === "cu") { const d = this.cuDef(it.name); return d ? d.sell || 0 : 0; }
      if (it.t === "ss" || it.t === "book" || it.t === "gfb" || it.t === "ql" || it.t === "dfb" || it.t === "ylb" || it.t === "stp" || it.t === "ysd") return 0;
      if (it.t === "hx") return CFG.forge.reset.SELL || 0;
      if (it.t === "sm") { const v = (CFG.mijing.items[it.k] || {}).sell || 0; return Array.isArray(v) ? v[it.ft || 0] || 0 : v; }
      if (it.t === "rbp") return CFG.forge.ring.bpSell[it.g] || 0;
      if (it.t === "eq" && it.e.attrs) return (it.e.slot === "ring" ? CFG.forge.ring.sell : CFG.forge.equip.sell)[it.e.g] || 0;
      if (it.t === "fu" || it.t === "bp") return Math.floor(DATA.blueprintCost(it.kind, it.g) * (it.t === "fu" ? 2 : 1));
      return 0;
    },

    setBagTab(t) { this.bagTab = t; this.render(); },
    // 背包里人物两侧圆钮打开的单独页面：shentong 神通秘术 / benming 本命法宝
    setBagPage(k) { this.bagPage = k || ""; this.render(); },
    bagPageView() {
      const T = { shentong: "神通秘术", benming: "本命法宝" }, k = this.bagPage, t = T[k] || "";
      if (k === "shentong") return `<div class="mpage bpage"><div class="pghead">${t}</div>${this.stPageView()}<div class="fback"><button onclick="G.setBagPage('')">返回</button></div></div>`;
      return `<div class="mpage bpage"><div class="pghead">${t}</div>
        <div class="card bp-hero"><img src="img/orb_${k}.webp?v=3" alt=""><b>${t}</b><p class="desc">${t}即将开放，敬请期待。</p></div>
        <div class="fback"><button onclick="G.setBagPage('')">返回</button></div></div>`;
    },
    // 物品图片（没有就返回 ""）
    itemIcon(it) {
      switch (it.t) {
        case "eq": return DATA.eqIcon(it.e);
        case "mat": return DATA.matImg(it.kind, it.g);
        case "pill": return DATA.pillIcon(it.type);
        case "dan": return DATA.danIcon(it.type);
        case "ql": return DATA.iconImg("dan_ql");
        case "ylb": return DATA.ybIcon(it.k);
        case "stp": return DATA.iconImg("st_frag");
        case "ysd": return `img/ysdan/${it.k}.webp`;
        case "fu": return DATA.furnaceIcon(it.kind);
        case "ss": return DATA.iconImg("ss");
        case "hx": return DATA.iconImg("hx");
        case "sm": return DATA.smIcon(it.k, it.ft);
        case "book": case "gfb": return DATA.iconImg("mifa");
        case "bp": case "rbp": return DATA.iconImg("bp");
        case "dfb": return DATA.danIcon(it.type);
        case "cu": return DATA.cuIcon(this.cuDef(it.name));
      }
      return "";
    },
    setBagFilter(k) { this.bagFilter = k; this.bagSell = false; this.render(); },
    openSellPage() { this.bagSell = true; this.render(); },
    closeSellPage() { this.bagSell = false; this.render(); },
    // v26：出售页（按上面的分类筛选），只有这里能卖东西
    sellPageView(match) {
      const s = this.s, flt = this.bagFilter || "all";
      const rows = s.bag.map((it, i) => [it, i]).filter(([it]) => match(it) && !it.lq).map(([it, i]) => {
        const p = this.sellPrice(it), n = it.n || 1, q = it.t === "eq" ? it.e.q : it.t === "cu" ? ((this.cuDef(it.name) || {}).q || 0) : 0;
        const src = this.itemIcon(it), img = src ? `<img src="${src}" alt="" style="width:28px;height:28px;vertical-align:middle;margin-right:4px">` : "";
        return `<div class="line"><div>${img}<span class="q${q}">${this.itemName(it)}</span>${n > 1 ? ` ×${U.fmt(n)}` : ""}<small>单价 ${U.fmt(p)} 灵石</small></div>
          <div><button class="sm" onclick="G.sellItem(${i},1)" ${p > 0 ? "" : "disabled"}>卖1个</button>${n > 1 ? ` <button class="sm" onclick="G.sellItem(${i},${n})" ${p > 0 ? "" : "disabled"}>全部</button>` : ""}</div></div>`;
      }).join("");
      return `<div class="card"><h3>出售<small>${{ all: "全部", dan: "丹药", herb: DATA.matKinds.herb, ore: DATA.matKinds.ore }[flt]} · 灵石 ${U.fmt(s.stone)}</small></h3>${rows || `<p class="desc">没有可出售的物品。</p>`}
        <div class="btns"><button onclick="G.closeSellPage()">返回储物格</button></div></div>`;
    },

    // 开局功法书：学会第 1 层，书用掉
    learnBook(i) {
      const it = this.s.bag[i]; if (!it || it.t !== "book" || this.hasGongfa(DATA.START_GF)) return;
      this.s.gongfa[DATA.START_GF] = 1; this.removeAt(i, 1);
      this.log(`习得《${CFG.start.book.name}》第 1 层。`, "gold"); this.closeModal(); this.after();
    },
    // 试炼塔秘诀：在背包里学习，学会第 1 层，占用神识，书用掉
    learnGfBook(i) {
      const it = this.s.bag[i]; if (!it || it.t !== "gfb") return;
      const g = DATA.skillInfo(it.id, 1); if (!g) return;
      if (this.hasGongfa(it.id)) return this.log("已经学会了。", "sys");
      if (it.lq || !this.lqCan("gf", it.id)) return;   // v173 学习队列：学完才从背包消失
      if (!this.lsCheck(it.id)) return;   // 神识（shenshi.js）
      it.lq = 1; this.lqAdd("gf", { id: it.id, k: "gfb", ms: DATA.gfLearnMin(g.star) * 60000 }); this.closeModal(); this.after();
    },
    // 四界功德司丹方：在背包里学习（时间受神识强度减少），学完才从背包消失
    learnDanScroll(i) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "dfb") return;
      const key = it.type + "|" + it.g;
      if (s.recipes.includes(key)) return this.log("已经学会了。", "sys");
      if (it.lq || !this.lqCan("dan", key)) return;
      it.lq = 1; this.lqAdd("dan", { key, k: "dfb", type: it.type, g: it.g, ms: DATA.danGdLearnMs(it.g, s.ssPow) }); this.closeModal(); this.after();
    },
    // v173 背包里功法 / 图纸的学习按钮：学习中显示进度，排队中，学完才从背包消失
    bagLearnBtn(it, ch, key, on, has, ms) {
      if (has) return `<button class="primary" disabled>已学会</button>`;
      const st = it.lq ? this.lqHas(ch, key) : 0;
      if (st === 1) { const c = this.s[this.lqSlot(ch)], left = Math.max(0, c.end - this.now()); return `<button class="primary" disabled>学习中 ${U.cd(left / 1000)}</button>`; }
      if (st === 2) return `<button class="primary" disabled>排队中</button>`;
      if (this.lqFull(ch)) return `<button class="primary" disabled>学习队列已满</button>`;
      return `<button class="primary" onclick="${on}">${this.s[this.lqSlot(ch)] ? "排队学习" : "学习"}（${U.dur(ms / 1000)}）</button>`;
    },
    /* ---------- 弹窗：点储物格 ---------- */
    openItem(i) {
      const it = this.s.bag[i]; if (!it) return;
      const sell = "";   // v26：背包里不能直接出售，去「出售」页
      const _sell = it.n > 1
        ? `<button onclick="G.sellItem(${i},1)">出售1个（${U.fmt(this.sellPrice(it))}）</button><button onclick="G.sellItem(${i},${it.n})">全部出售</button>`
        : `<button onclick="G.sellItem(${i},1)">出售（${U.fmt(this.sellPrice(it))}）</button>`;
      const cq = it.t === "cu" ? ((this.cuDef(it.name) || {}).q || 0) : it.t === "ysd" ? 5 : it.t === "ylb" ? DATA.ybQ(it.g) : 0;
      const big = it.t === "mat" ? "" : this.itemIcon(it);
      let h = (big ? (it.t === "dan" || it.t === "ql" ? DATA.danImg(big, it.t === "dan" ? DATA.danCls(it.type, it.g) : DATA.qlCls(it.sect), "big") : `<img class="item-img${it.t === "eq" ? DATA.eqCls(it.e) : ""}" src="${big}" alt="">`) : "") + `<h2 class="q${it.t === "eq" ? it.e.q : cq}${it.t === "eq" ? DATA.fbElCls(it.e) : ""}">${this.itemName(it)}${it.n ? " ×" + it.n : ""}${it.t === "eq" && it.e.attrs ? `<br><small>${DATA.rjName(it.e)}</small>` : ""}</h2>`;
      if (it.t === "pill") {
        const ok = this.canUsePill(it.g);
        h += `<p>修炼速度 +${Math.round(DATA.pillPct(it.type, it.g))}%，持续 ${DATA.pills[it.type].dur} 次修炼。<br>只有${DATA.realmLabel(it.g)}可服用。
          ${ok ? "" : "<br><span class='q5'>与你当前境界不符，无法服用。</span>"}</p>
          <div class="btns"><button class="primary" onclick="G.usePill(${i});G.closeModal()" ${ok ? "" : "disabled"}>服用</button>${sell}</div>`;
      } else if (it.t === "dan") {
        const left = this.danLeft(it.type, it.g), d = DATA.dans[it.type];
        h += `<p>服用后永久 ${d.label} +${U.num(DATA.danVal(it.type, it.g))}。<br>此阶已服 ${DATA.danLimit(it.type, it.g) - left} / ${DATA.danLimit(it.type, it.g)} 枚。</p>
          <div class="btns"><button class="primary" onclick="G.eatDan(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatDan(${i},${it.n})" ${left > 0 && it.n > 1 ? "" : "disabled"}>全部服用</button>${sell}</div>`;
      } else if (it.t === "ql") {
        const o = DATA.sectById[it.sect], lim = DATA.qlLimit(it.sect), used = (this.s.qlEaten || {})[it.sect] || 0, left = Math.max(0, lim - used);
        h += `<p>${o ? o.name : ""}宗主专属丹药，服用后永久 ${DATA.qlTxt(it.sect)}。<br>已服 ${used} / ${lim} 颗。</p>
          <div class="btns"><button class="primary" onclick="G.eatQl(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatQl(${i},${it.n})" ${left > 0 && it.n > 1 ? "" : "disabled"}>全部服用</button>${sell}</div>`;
      } else if (it.t === "ysd") {
        const D = this.ysDanCfg(), used = this.ysDanEatN(it.ys, it.k), left = Math.max(0, D.MAX - used);
        h += `<p>隐世宗门丹药，服用后永久 ${this.ysDanLab(it.k)} +${U.fmt(D.VAL)}。<br>本宗此丹已服 ${used} / ${D.MAX} 颗。</p>
          <div class="btns"><button class="primary" onclick="G.eatYsDan(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatYsDan(${i},${it.n})" ${left > 0 && it.n > 1 ? "" : "disabled"}>全部服用</button></div>`;
      } else if (it.t === "stp") {
        h += `<img class="item-img" src="${DATA.iconImg("st_frag")}" alt=""><p>神通碎片用于修炼精研神通</p>`;
      } else if (it.t === "ylb") {
        const left = this.ybLeft(it.k, it.g);
        h += `<p>游历宝物，服用后永久 ${DATA.ybLabel(it.k)} +${U.num(DATA.ybVal(it.k, it.g))}。<br>此阶已服 ${this.ybUsed(it.k, it.g)} / ${DATA.YB_MAX} 个。</p>
          <div class="btns"><button class="primary" onclick="G.eatYb(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatYb(${i},${it.n})" ${left > 0 && it.n > 1 ? "" : "disabled"}>全部服用</button></div>`;
      } else if (it.t === "fu") {
        const own = this.s.furnaces[it.kind].includes(it.g);
        h += `<p>${this.furnaceDesc(it.kind, it.g)}。<br>使用后装进洞府${DATA.isDanFu(it.kind) ? "炼丹房" : "炼器室"}，可随时更换。${own ? "<br><span class='q5'>洞府里已有同阶炉子。</span>" : ""}</p>
          <div class="btns"><button class="primary" onclick="G.installFurnace(${i})" ${own ? "disabled" : ""}>使用</button>${sell}</div>`;
      } else if (it.t === "bp") {
        const has = this.s.blueprints[it.kind].includes(it.g);
        h += `<p>学习后可在洞府炼器室炼制${DATA.furnaceName(it.kind, it.g)}。<br>材料：${this.matsText(DATA.furnaceMats(it.kind, it.g))}${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "forge", `bp|${it.kind}|${it.g}`, `G.learnBlueprint(${i})`, has, this.bagLearnMs("BP_MIN", it.g))}${sell}</div>`;
      } else if (it.t === "ss") {
        const left = this.stoneLeft(it.g);
        h += `<p>使用后储物格 +1。此阶已用 ${CFG.forge.stone.MAX_USE - left} / ${CFG.forge.stone.MAX_USE} 个。</p>
          <div class="btns"><button class="primary" onclick="G.useStone(${i},1)" ${left > 0 ? "" : "disabled"}>使用</button>
          <button onclick="G.useStone(${i},${it.n})" ${left > 0 && it.n > 1 ? "" : "disabled"}>全部使用</button></div>`;
      } else if (it.t === "hx") {
        h += `<div class="btns">${sell}</div>`;
      } else if (it.t === "sm") {
        h += `<p>${(CFG.mijing.items[it.k] || {}).desc || ""}</p><div class="btns">${sell}</div>`;
      } else if (it.t === "book") {
        const B = CFG.start.book, has = this.hasGongfa(DATA.START_GF);
        h += `<p>秘诀 · 修炼速度每层 +${U.num(B.SPEED)} · 共 ${B.MAX} 层${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns"><button class="primary" onclick="G.learnBook(${i})" ${has ? "disabled" : ""}>学习</button></div>`;
      } else if (it.t === "gfb") {
        const g = DATA.skillInfo(it.id, 1), has = this.hasGongfa(it.id), need = this.ssCost(it.id), left = Math.max(0, this.lsLeft());
        const yl = g && (g.src === "yl" || g.src === "ys");   // 游历功法、隐世宗门功法：不占灵识点
        h += `<p>${yl ? `${g.src === "ys" ? "隐世宗门功法" : "游历功法"} · ${g.star}星` : "试炼塔秘诀"}${g && g.label ? ` · ${g.label}每层 +${this.gfValue(g, g.perLv)}` : ""}<br>${yl ? "学习不占灵识点" : `学习占用灵识点 ${need}（剩余 ${left}）`}${has ? "<br><span class='q5'>已学会。</span>" : !yl && left < need ? "<br><span class='q5'>灵识点不足，可在「修炼 → 神识」增加或遗忘功法。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "gf", it.id, `G.learnGfBook(${i})`, has, g ? DATA.gfLearnMin(g.star) * 60000 : 0)}</div>`;
      } else if (it.t === "dfb") {
        const key = it.type + "|" + it.g, has = this.s.recipes.includes(key);
        h += `<p>四界丹方 · ${DATA.recipeEffect(it.type, it.g)}<br>学习后可在洞府炼丹房炼制。${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "dan", key, `G.learnDanScroll(${i})`, has, DATA.danGdLearnMs(it.g, this.s.ssPow))}</div>`;
      } else if (it.t === "rbp") {
        const has = it.r === undefined ? this.s.forgeKnown.includes(this.forgeKey("ring", it.g)) : this.ringKnown(it.r, it.g);
        h += `<p>学习后可在洞府炼器室把${DATA.XING[it.g - 1]}${DATA.ringNames[it.r] || "戒指（全部 9 种）"}升为${DATA.XING[it.g]}（上一星同种戒指 + 三种矿石）。${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "forge", this.forgeKey("ring", it.g, it.r), `G.learnRingBp(${i})`, has, this.bagLearnMs("RBP_MIN", it.g))}${sell}</div>`;
      } else if (it.t === "cu") {
        h += this.customItemHtml(i, it, sell);   // 自定义物品，见 custom.js
      } else if (it.t === "mat") {
        h += `<img class="item-img" src="${DATA.matImg(it.kind, it.g)}" alt=""><p>${{ herb: "药材，可用于炼丹。", ore: "矿石，可用于炼器。" }[it.kind] || ""}</p><div class="btns">${sell}</div>`;
      } else {
        h += `<p>${DATA.slots[it.e.slot]} · ${this.equipDesc(it.e)}</p>
          <div class="btns"><button class="primary" onclick="G.equipItem(${i})">${it.e.slot === "fabao" ? "放入法宝栏" : "装备"}</button>${it.e.attrs ? `<button onclick="G.openReset('b${i}')">洗练</button>` : ""}${this.canEnhance(it.e) ? `<button onclick="G.openEnhance('b${i}')">强化</button>` : ""}${this.fbFusable(it.e) ? `<button onclick="G.openFbFuse('b${i}')">融合</button>` : ""}${sell}</div>`;
      }
      this.modal(h + `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 点装备栏 / 法宝栏
    openEquip(key) {
      const e = key.startsWith("fb") ? this.s.fabao[+key.slice(2)] : this.s.equip[key]; if (!e) return;
      const src = DATA.eqIcon(e);
      this.modal(`${src ? `<img class="item-img${DATA.eqCls(e)}" src="${src}" alt="">` : ""}<h2 class="q${e.q}${DATA.fbElCls(e)}">${this.itemName({ t: "eq", e })}${e.attrs ? `<br><small>${DATA.rjName(e)}</small>` : ""}</h2><p>${DATA.slots[e.slot]} · ${this.equipDesc(e)}</p>
        <div class="btns"><button onclick="G.unequip('${key}')">卸下</button>${key.startsWith("fb") ? `<button onclick="G.openFabaoSwap(${+key.slice(2)})">更换</button>` : ""}${e.attrs ? `<button onclick="G.openReset('${key}')">洗练</button>` : ""}${this.canEnhance(e) ? `<button onclick="G.openEnhance('${key}')">强化</button>` : ""}${this.fbFusable(e) ? `<button onclick="G.openFbFuse('${key}')">融合</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },

    /* ---------- 强化（config/forge.js 的 forge.enhance）：每条属性分别强化 ---------- */
    canEnhance(e) { return !!(e && e.attrs); },
    // v152/v153 强化：整件一个等级，没有上限；只要火髓 + 耀石（法宝同属性，装备 / 戒指任意一种）
    enhCost(e) { const E = DATA.enhCfg(e), n = e.enh || 0;
      if (E.UP && E.UP.N > 0) { const k = Math.floor(n / E.UP.N);   // 法宝：每强化 N 级，消耗 + 固定值
        return { fire: ((E.FIRE || [])[e.g] || 1) + k * (E.UP.FIRE || 0), jj: ((E.SPECIAL || [])[e.g] || 0) + k * (E.UP.SPECIAL || 0), sk: "ys", sf: this.ysFor(e) }; }
      const k = 1 + n * (E.COST_STEP || 0);
      return { fire: Math.ceil(((E.FIRE || [])[e.g] || 1) * k), jj: Math.ceil(((E.SPECIAL || [])[e.g] || 0) * k), sk: "ys", sf: this.ysFor(e) }; },
    enhHave(c) { return this.fireCount() >= c.fire && this.smCount(c.sk, c.sf) >= c.jj; },
    enhRate(e) { return Math.max(0, this.craftRate("qi", e.g) - (e.enh || 0) * (DATA.enhCfg(e).RATE_DROP || 0) / 100); },
    // 强化加成文字：n = 强化等级
    enhText(e, n) {
      if (e.slot === "fabao") return `${(DATA.fabaoTypes[e.ft] || {}).shield ? "护盾值" : "附加伤害"} +${U.fmt(n * DATA.fbEnhPer(e))}`;
      return e.attrs.filter(a => a.m && DATA.eqEnhPer(e, a.k) > 0).map(a => `${DATA.attrNames[a.k]} +${U.fmt(n * DATA.eqEnhPer(e, a.k))}`).join("、");
    },
    openEnhance(src) { const e = this.resetTarget(src); if (!this.canEnhance(e)) return; this._enhSource = src; this._enhObj = e; this.drawEnhance(); },
    drawEnhance() {
      const e = this._enhObj; if (!e) return;
      const c = this.enhCost(e), n = e.enh || 0, ys = this.ysFor(e);
      this.modal(`<img class="item-img${DATA.eqCls(e)}" src="${DATA.eqIcon(e)}" alt=""><h2 class="q${e.q}${DATA.fbElCls(e)}">强化 · ${this.itemName({ t: "eq", e })}</h2>
        <p class="desc">${DATA.HX} ${U.fmt(this.fireCount())} · ${DATA.li(DATA.smIcon("ys", ys))}${DATA.smName("ys", ys)} ${U.fmt(this.smCount("ys", ys))} · 失败只扣材料，不掉强化等级。升星时强化等级 −20%（最少 −1）。${e.slot === "fabao" ? "" : "只加主属性，暴击不加。"}</p>
        <div class="line"><div>强化 +${n}<small>${this.enhText(e, n)} → ${this.enhText(e, n + 1)}<br>
          <span class="${this.fireCount() >= c.fire ? "" : "q5"}">${DATA.HX} ${c.fire}</span>${c.jj ? `、<span class="${this.smCount(c.sk, c.sf) >= c.jj ? "" : "q5"}">${DATA.li(DATA.smIcon(c.sk, c.sf))}${DATA.smName(c.sk, c.sf)} ${c.jj}</span>` : ""} · 成功率 ${this.ratePct(this.enhRate(e))}</small></div>
          <button class="sm" onclick="G.doEnhance('${this._enhSource}')" ${this.enhHave(c) ? "" : "disabled"}>强化</button></div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    doEnhance(src) {
      const e = this.resetTarget(src); if (!this.canEnhance(e)) return;
      this._enhSource = src; this._enhObj = e;
      const c = this.enhCost(e);
      if (!this.enhHave(c)) return this.log("材料不足。", "sys");
      this.takeFire(c.fire); if (c.jj) this.takeSm(c.sk, c.jj, c.sf);
      if (Math.random() < this.enhRate(e)) { e.enh = (e.enh || 0) + 1; this.dirty(); this.log(`强化成功！${this.itemName({ t: "eq", e })}：${this.enhText(e, e.enh)}`, "gold"); }
      else this.log(`强化失败，材料已耗尽，${e.name}完好无损。`, "bad");
      this.after(); this.drawEnhance();
    },

    /* ---------- v25 火髓 ---------- */
    fireCount() { return this.bagNum(x => x.t === "hx"); },
    addFire(n) { return this.bagAdd(x => x.t === "hx", k => ({ t: "hx", n: k }), n, `背包已满，${DATA.HX}遗失了。`); },
    takeFire(n) { return this.bagTake(x => x.t === "hx", n); },
    /* ---------- 秘境专用材料：空间晶核 kj、养神露 lu、耀石 ys（ft = 属性序号 0~5；-1 = 任意一种） ---------- */
    ysFor(e) { return e && e.slot === "fabao" ? DATA.elIdx(e.el) : -1; },   // 强化 / 炼制用哪种耀石
    smIs(k, ft) { return x => x.t === "sm" && x.k === k && (!DATA.SM_GRADED.includes(k) || (x.ft || 0) === (ft || 0)); },
    smFind(k, ft) { return this.s.bag.findIndex(this.smIs(k, ft)); },
    smCount(k, ft) {
      if (k === "ys" && ft < 0) return this.bagNum(x => x.t === "sm" && x.k === "ys");
      return this.bagNum(this.smIs(k, ft));
    },
    addSm(k, n, ft) {
      if (k === "ys" && ft < 0) ft = 0;
      return this.bagAdd(this.smIs(k, ft), c => { const it = { t: "sm", k, n: c }; if (DATA.SM_GRADED.includes(k)) it.ft = ft || 0; return it; }, n, `背包已满，${DATA.smName(k, ft)}遗失了。`);
    },
    // 扣专用材料；返回实际扣了哪些 [{ k, ft, n }]（任意耀石：先扣最多的那种），不够返回 false
    takeSm(k, n, ft) {
      if (k === "ys" && ft < 0) {
        if (this.smCount(k, ft) < n) return false;
        const out = [];
        while (n > 0) {   // 先扣总数最多的那种
          const fts = [...new Set(this.s.bag.filter(x => x.t === "sm" && x.k === "ys").map(x => x.ft || 0))].sort((a, b) => this.smCount("ys", b) - this.smCount("ys", a));
          const f = fts[0], m = Math.min(n, this.smCount("ys", f));
          this.bagTake(this.smIs("ys", f), m); n -= m; out.push({ k, ft: f, n: m });
        }
        return out;
      }
      if (!this.bagTake(this.smIs(k, ft), n)) return false; return [{ k, ft, n }];
    },
    // 找到要洗练 / 强化的那件：b序号 = 背包，fb序号 = 法宝栏，其它 = 装备栏
    resetTarget(src) {
      if (src[0] === "b" && src[1] !== undefined && !isNaN(+src.slice(1))) { const it = this.s.bag[+src.slice(1)]; return it && it.t === "eq" ? it.e : null; }
      if (src.startsWith("fb")) return this.s.fabao[+src.slice(2)] || null;
      return this.s.equip[src] || null;
    },
    // 洗练弹窗：点属性切换锁定（记住装备对象本身，背包重新排序也不会找错）
    openReset(src) {
      const e = this.resetTarget(src); if (!e || !e.attrs) return;
      if (this._resetSource !== src) this._locks = [];
      this._resetSource = src;
      this._resetObj = e; this.drawReset();
    },
    drawReset() {
      const e = this._resetObj; if (!e) return;
      const L = this._locks || (this._locks = []), cost = DATA.resetCost(e, L.length);
      const wash = e.slot === "fabao", nm = "洗练";
      this.modal(`<h2 class="q${e.q}${DATA.fbElCls(e)}">${DATA.HX}${nm} · ${this.itemName({ t: "eq", e })}</h2>
        <p class="desc">点属性锁定 / 解锁，锁定的属性不变。每锁定一条，${DATA.HX}消耗多一份。</p>` +
        e.attrs.map((a, i) => `<div class="line"><div><span class="ac${a.c}">${DATA.attrText(a, e)}</span></div>
          <button class="sm ${L.includes(i) ? "active" : ""}" onclick="G.toggleLock(${i})">${L.includes(i) ? "已锁定" : "锁定"}</button></div>`).join("") +
        `<p>消耗${DATA.HX} <b>${cost}</b>（拥有 ${this.fireCount()}）</p>
        ${wash ? `<p class="desc">炼制、购买得到的法宝属性最高绿色，紫色、金色只能洗练得到。</p>` : ""}
        <div class="btns"><button class="primary" onclick="G.doReset('${this._resetSource}',${JSON.stringify(L)})" ${this.fireCount() >= cost && this.canWash(e, L) ? "" : "disabled"}>${nm}</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // v164 全部锁定时，附加属性没满（< 附加属性上限）也能洗练：再洗出新的附加属性补到满
    canWash(e, L) { return L.length < e.attrs.length || DATA.washRange(e, L)[1] > 0; },
    toggleLock(i) { const L = this._locks || (this._locks = []), j = L.indexOf(i); j >= 0 ? L.splice(j, 1) : L.push(i); this.drawReset(); },
    doReset(src, locks = []) {
      const e = this.resetTarget(src); if (!e || !e.attrs) return;
      const L = Array.isArray(locks) ? [...new Set(locks.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < e.attrs.length))] : [];
      const cost = DATA.resetCost(e, L.length);
      if (!this.canWash(e, L)) return;
      if (!this.takeFire(cost)) return this.log(`${DATA.HX}不足。`, "sys");
      const keep = L.map(i => e.attrs[i]);
      DATA.rerollForged(e, L);
      this._locks = keep.map(a => e.attrs.indexOf(a)).filter(i => i >= 0);   // 条数变了，锁定的序号跟着属性走
      this.log(`消耗${DATA.HX} ${cost}，洗练了${this.itemName({ t: "eq", e })}的属性。`, "good");
      this.after(); this.drawReset();
      return { locks: this._locks };
    },
    equipItem(i) {
      const s = this.s, it = s.bag[i], e = it.e;
      if (e.slot === "fabao") {
        if (s.fabao.length >= this.slotCount()) return this.log("法宝栏已满。", "sys");
        s.bag.splice(i, 1); s.fabao.push(e);
      } else {
        // 戒指放第一个空戒指位，都满了替换第一个
        const key = e.slot === "ring" ? (DATA.equipSlots.find(k => k.startsWith("ring") && !s.equip[k]) || "ring0") : e.slot;
        const old = s.equip[key];
        s.bag.splice(i, 1); s.equip[key] = e;
        if (old) s.bag.push({ t: "eq", e: old });
      }
      this.log(`装备了${e.name}。`, "good"); this.closeModal(); this.after();
    },
    unequip(key) {
      if (this.bagFull()) return this.log("背包已满。", "sys");
      if (key.startsWith("fb")) this.s.bag.push({ t: "eq", e: this.s.fabao.splice(+key.slice(2), 1)[0] });
      else { this.s.bag.push({ t: "eq", e: this.s.equip[key] }); this.s.equip[key] = null; }
      this.closeModal(); this.after();
    },
    sellItem(i, n) {
      const it = this.s.bag[i]; if (!it || it.lq) return;   // v173 学习中 / 排队中的不能卖
      // 先 clamp 再算钱：原来直接用请求数算钱，n=1e12 时只删 1 个却按 1e12 个结算；
      // n 为负数时算出负价、再经 removeAt 反向加物品。装备没有 n，按 1 个算。
      n = Math.floor(+n); if (!(n >= 1)) return;
      n = Math.min(n, it.n || 1);
      const p = this.sellPrice(it) * n;
      this.s.stone += p; this.removeAt(i, n);
      this.log(`售出${this.itemName(it)} ×${n}，灵石 +${U.fmt(p)}。`, "sys"); this.closeModal(); this.after();
    },

    /* ---------- 法术栏 ---------- */
    autoSlotSpell(id) { if (this.s.spellSlots.length < this.slotCount() && !this.s.spellSlots.includes(id)) this.s.spellSlots.push(id); },
    // rep：更换第几格（不写 = 放入空格）
    openSpellPick(rep) {
      const s = this.s, list = Object.keys(s.gongfa).filter(id => DATA.isSpell(id) && !s.spellSlots.includes(id)), r = rep === undefined ? "" : "," + rep;
      if (!list.length) return this.log(rep === undefined ? "没有可放入的法术，请先去门派功法殿学习。" : "没有可更换的法术。", "sys");
      this.modal(`<h2>${rep === undefined ? "放入" : "更换"}法术</h2>` + list.map(id => { const g = DATA.spellInfo(id, s.gongfa[id]);
        return `<div class="line"><div>《${g.name}》<small>${this.spellDmgTxt(g)} · 耗法力 ${U.fmt(g.mana)}</small></div>
          <button class="sm" onclick="G.slotSpell('${id}'${r})">${rep === undefined ? "放入" : "更换"}</button></div>`; }).join("") + `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    slotSpell(id, rep) {
      // 未学会的法术不能装备：DATA.spellInfo 对未学法术也会返回 1 层对象，
      // 只靠它校验等于没校验；服务端跑同一份代码，控制台越权调用也会被挡下。
      if (!DATA.isSpell(id) || !this.s.gongfa[id]) return;
      const sl = this.s.spellSlots;
      if (sl.includes(id) && (rep === undefined || sl[rep] !== id)) return;
      if (rep !== undefined && sl[rep] !== undefined) sl[rep] = id; else if (sl.length < this.slotCount()) sl.push(id);
      this.closeModal(); this.after();
    },
    // 更换法宝：k 法宝栏第几格；从背包里选一件法宝换上，原来的放回背包
    openFabaoSwap(k) {
      const s = this.s, list = s.bag.map((it, i) => i).filter(i => s.bag[i].t === "eq" && s.bag[i].e.slot === "fabao");
      if (!list.length) return this.log("背包里没有可更换的法宝。", "sys");
      this.modal(`<h2>更换法宝</h2>` + list.map(i => { const e = s.bag[i].e;
        return `<div class="line"><div><span class="q${e.q}">${this.itemName(s.bag[i])}</span><small>${this.equipDesc(e)}</small></div>
          <button class="sm" onclick="G.swapFabao(${k},${i})">更换</button></div>`; }).join("") + `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    swapFabao(k, i) {
      const s = this.s, it = s.bag[i], old = s.fabao[k];
      if (!it || it.t !== "eq" || it.e.slot !== "fabao" || !old) return;
      s.fabao[k] = it.e; s.bag[i] = { t: "eq", e: old };
      this.log(`装备了${it.e.name}。`, "good"); this.closeModal(); this.after();
    },
    // v239 法术精研界面：用该系法术心得精研，每次 + 属性伤害（config/gongfa.js 的 JY_DMG / JY_COST）
    openSpellJy(id) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]); if (!g || !s.gongfa[id]) return;
      const have = (s.spXd || {})[g.el.id] || 0, add = DATA.jyStep(g.star, "JY_DMG"), c = DATA.jyCost(g.star, g.jy);
      const ok = have >= c.xd && s.stone >= c.stone;
      this.modal(`<h2 class="q1">《${g.name}》精研</h2><p>已精研 ${U.fmt(g.jy)} 次 · 属性伤害 +${U.fmt(g.jyDmg)}<br>${g.el.name}系法术心得 ${U.fmt(have)} 点 · 灵石 ${U.fmt(s.stone)}<br>每次精研：属性伤害 +${U.fmt(add)}，消耗${g.el.name}系法术心得 ${U.fmt(c.xd)} 点、灵石 ${U.fmt(c.stone)}</p>
        <div class="btns"><button onclick="G.spellJy('${id}')" ${ok ? "" : "disabled"}>精研</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    spellJy(id) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]); if (!g || !s.gongfa[id]) return;
      const c = DATA.jyCost(g.star, g.jy), X = s.spXd = s.spXd || {};
      if ((X[g.el.id] || 0) < c.xd) return this.log(`${g.el.name}系法术心得不足。`, "sys");
      if (s.stone < c.stone) return this.log("灵石不足。", "sys");
      X[g.el.id] -= c.xd; s.stone -= c.stone; (s.spJy = s.spJy || {})[id] = (s.spJy[id] || 0) + 1;
      this.log(`《${g.name}》精研成功，属性伤害 +${U.fmt(DATA.jyStep(g.star, "JY_DMG"))}。`, "good");
      this.dirty(); this.after(); this.openSpellJy(id);
    },
    unslotSpell(i) { this.s.spellSlots.splice(i, 1); this.closeModal(); this.after(); },
    // 点法术栏：显示详细，可卸下
    openSpellSlot(i) {
      const id = this.s.spellSlots[i], g = id && DATA.spellInfo(id, this.s.gongfa[id]); if (!g) return;
      this.modal(`<h2 class="q1">《${g.name}》</h2><p>${g.star}星 · ${g.el.name}系 · ${g.lv} 层<br>${this.spellDmgTxt(g)}<br>耗法力 ${U.fmt(g.mana)} · 每场战斗最多 ${g.uses} 次${g.fuPct ? `<br><span class="q4">融合 ${DATA.fuseTxt(g.fu)} · 伤害 +${U.dec(g.fuPct)}%</span>` : ""}</p>
        <div class="btns g3"><button onclick="G.openSpellJy('${id}')">精研</button><button onclick="G.openSpellFuse('${id}')">融合</button><button onclick="G.openSpellAdv('${id}')">进阶</button>
        <button onclick="G.unslotSpell(${i})">卸下</button><button onclick="G.openSpellPick(${i})">更换</button><button onclick="G.closeModal()">关闭</button></div>`);
    },

    /* ---------- 法术融合 / 进阶、法宝融合（config/gongfa.js FUSE）---------- */
    spMax() { return DATA.GONGFA_MAX || 10; },
    spOwned() { return Object.keys(this.s.gongfa).filter(id => DATA.isSpell(id) && DATA.spellInfo(id, this.s.gongfa[id])); },
    // 法术从各处拿掉（被融合 / 进阶用掉）；to = 换成哪本（进阶）
    spDrop(id, to) {
      const s = this.s;
      delete s.gongfa[id]; if (s.spJy) delete s.spJy[id]; if (s.spFuse) delete s.spFuse[id];
      s.spellSlots = s.spellSlots.map(x => x === id ? to || null : x).filter((x, i, a) => x && a.indexOf(x) === i);
      (s.tribSlots || []).forEach((x, i, a) => { if (x && x.k === "sp" && x.id === id) a[i] = to ? { k: "sp", id: to } : null; });
      // 战斗设置里也引用了法术键名（sp:id），不更新会一直指向已删除的法术。
      const b = s.bset;
      if (b) {
        const key = "sp:" + id, toKey = to ? "sp:" + to : null;
        if (Array.isArray(b.r)) b.r = b.r.map(x => x === key ? (toKey || "auto") : x);
        if (b.lowKey === key) b.lowKey = toKey || "";
        if (Array.isArray(b.off)) b.off = b.off.map(x => x === key ? toKey : x).filter(Boolean);
        if (Array.isArray(b.order)) b.order = b.order.map(x => x === key ? toKey : x).filter(Boolean);
      }
    },
    fuseRow(fu, maxStar) {
      const C = DATA.fuseCfg(), out = [];
      for (let k = 1; k < maxStar; k++) out.push(`${k}星 ${(fu || {})[k] || 0}/${C.PER_STAR}`);
      return out.join(" · ");
    },
    openSpellFuse(id) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]); if (!g || !s.gongfa[id]) return;
      const C = DATA.fuseCfg(), fu = g.fu || {}, M = this.spMax(), P = C.PCT || [];
      let h = `<p>融合星级更低、已修炼到 ${M} 层的法术，被融合的法术消失，百分百成功。每个星级最多融合 ${C.PER_STAR} 本。<br>当前伤害 +${U.dec(g.fuPct)}%<br><small>${g.star > 1 ? this.fuseRow(fu, g.star) : "1 星法术没有可融合的"}</small></p>`;
      if (g.lv < M) h += `<p class="desc q5">本法术修炼到 ${M} 层才能融合。</p>`;
      else {
        const L = this.spOwned().filter(x => x !== id).map(x => DATA.spellInfo(x, s.gongfa[x])).filter(x => x.star < g.star && x.lv >= M).sort((a, b) => b.star - a.star);
        h += L.length ? L.map(x => { const full = (fu[x.star] || 0) >= C.PER_STAR;
          return `<div class="line"><div>《${x.name}》<small>${x.star}星 · ${x.el.name}系 · 伤害 +${U.dec(P[Math.min(x.star - 1, P.length - 1)] || 0)}%</small></div><button class="sm" onclick="G.spellFuse('${id}','${x.id}')" ${full ? "disabled" : ""}>${full ? "已满" : "融合"}</button></div>`; }).join("")
          : `<p class="desc">没有可融合的法术（要比本法术星级低、修炼到 ${M} 层）。</p>`;
      }
      this.modal(`<h2 class="q1">《${g.name}》融合</h2>${h}<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    spellFuse(id, fid) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]), f = fid !== id && s.gongfa[fid] && DATA.spellInfo(fid, s.gongfa[fid]), C = DATA.fuseCfg(), M = this.spMax();
      if (!s.gongfa[id] || !g || !f || g.lv < M || f.lv < M || f.star >= g.star) return;
      const fu = (s.spFuse = s.spFuse || {})[id] = s.spFuse[id] || {};
      if ((fu[f.star] || 0) >= C.PER_STAR) return this.log(`${f.star}星法术已融合 ${C.PER_STAR} 本。`, "sys");
      this.spDrop(fid); fu[f.star] = (fu[f.star] || 0) + 1;
      this.log(`《${g.name}》融合了《${f.name}》，伤害 +${U.dec(DATA.fusePct(fu))}%。`, "good");
      this.dirty(); this.after(); this.openSpellFuse(id);
    },
    openSpellAdv(id) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]); if (!g || !s.gongfa[id]) return;
      const M = this.spMax();
      let h = `<p>修炼到 ${M} 层后，用一本高一星、同属性、也修炼到 ${M} 层的法术进阶：本法术升一星，精研、融合效果和层数保留，用掉的那本消失。</p>`;
      if (g.lv < M) h += `<p class="desc q5">本法术修炼到 ${M} 层才能进阶。</p>`;
      else {
        const L = this.spOwned().map(x => DATA.spellInfo(x, s.gongfa[x])).filter(x => x.id !== id && x.star === g.star + 1 && x.el.id === g.el.id && x.lv >= M);
        h += L.length ? L.map(x => `<div class="line"><div>《${x.name}》<small>${x.star}星 · ${x.el.name}系 · ${x.lv} 层</small></div><button class="sm" onclick="G.spellAdv('${id}','${x.id}')">进阶</button></div>`).join("")
          : `<p class="desc">没有可用的法术（要${g.star + 1}星、${g.el.name}系、修炼到 ${M} 层）。</p>`;
      }
      this.modal(`<h2 class="q1">《${g.name}》进阶</h2>${h}<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    spellAdv(id, tid) {
      const s = this.s, g = DATA.spellInfo(id, s.gongfa[id]), t = tid !== id && s.gongfa[tid] && DATA.spellInfo(tid, s.gongfa[tid]), M = this.spMax();
      if (!s.gongfa[id] || !g || !t || g.lv < M || t.lv < M || t.star !== g.star + 1 || t.el.id !== g.el.id) return;
      // 目标法术已学且已有精研 / 融合时不能直接覆盖：取两边较大的精研，
      // 融合按星取较大值（上限 PER_STAR），两边都不丢。
      const jy = Math.max((s.spJy || {})[id] || 0, (s.spJy || {})[tid] || 0), fu0 = (s.spFuse || {})[id] || {}, fuT = (s.spFuse || {})[tid] || {}, fu = {}, lv = Math.max(g.lv, t.lv);
      for (const k of new Set([...Object.keys(fu0), ...Object.keys(fuT)])) fu[k] = Math.min(DATA.fuseCfg().PER_STAR || 99, Math.max(fu0[k] || 0, fuT[k] || 0));
      this.spDrop(id, tid);
      s.gongfa[tid] = lv;
      s.spJy = s.spJy || {}; if (jy) s.spJy[tid] = jy; else delete s.spJy[tid];
      s.spFuse = s.spFuse || {}; if (Object.keys(fu).length) s.spFuse[tid] = fu; else delete s.spFuse[tid];
      this.log(`《${g.name}》进阶为${t.star}星《${t.name}》，精研、融合效果保留。`, "gold");
      this.closeModal(); this.dirty(); this.after();
    },
    // 法宝融合：src = "fbN"（法宝栏）或 "bN"（背包）；被融合的只从背包里选
    fbFusable(e) { return !!(e && e.attrs && e.slot === "fabao" && !(DATA.fabaoTypes[e.ft] || {}).shield); },
    openFbFuse(src) {
      const s = this.s, e = this.resetTarget(src); if (!this.fbFusable(e)) return;
      const C = DATA.fuseCfg(), fu = e.fu || {}, P = C.PCT || [], star = e.g + 1, rj = Math.max(1, C.FB_RJ || 5);
      let h = `<p>融合星级更低、精炼到${DATA.JIE[rj - 1]}以上的法宝（背包里的），被融合的法宝消失，百分百成功；升星后融合效果保留。每个星级最多融合 ${C.PER_STAR} 件。<br>当前伤害 +${U.dec(DATA.fusePct(fu))}%<br><small>${star > 1 ? this.fuseRow(fu, star) : "一星法宝没有可融合的"}</small></p>`;
      const L = s.bag.map((it, i) => ({ it, i })).filter(({ it }) => it.t === "eq" && it.e !== e && it.e.slot === "fabao" && it.e.attrs && it.e.g < e.g && DATA.rjOf(it.e) >= rj - 1).sort((a, b) => b.it.e.g - a.it.e.g);
      h += L.length ? L.map(({ it, i }) => { const x = it.e, full = (fu[x.g + 1] || 0) >= C.PER_STAR;
        return `<div class="line"><div class="q${x.q}">${this.itemName(it)}<small>${DATA.rjName(x)} · 伤害 +${U.dec(P[Math.min(x.g, P.length - 1)] || 0)}%</small></div><button class="sm" onclick="G.fbFuse('${src}',${i})" ${full ? "disabled" : ""}>${full ? "已满" : "融合"}</button></div>`; }).join("")
        : `<p class="desc">背包里没有可融合的法宝（要比它星级低、精炼到${DATA.JIE[rj - 1]}以上）。</p>`;
      this.modal(`<h2 class="q${e.q}">${this.itemName({ t: "eq", e })} · 融合</h2>${h}<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    fbFuse(src, i) {
      const s = this.s, e = this.resetTarget(src), it = s.bag[i], C = DATA.fuseCfg(), rj = Math.max(1, C.FB_RJ || 5);
      if (!this.fbFusable(e) || !it || it.t !== "eq" || it.e === e || it.e.slot !== "fabao" || !it.e.attrs || it.e.g >= e.g || DATA.rjOf(it.e) < rj - 1) return;
      const fu = e.fu = e.fu || {}, k = it.e.g + 1;
      if ((fu[k] || 0) >= C.PER_STAR) return this.log(`${DATA.XING[k - 1]}法宝已融合 ${C.PER_STAR} 件。`, "sys");
      const name = this.itemName(it);
      s.bag.splice(i, 1); fu[k] = (fu[k] || 0) + 1;
      (s.tribSlots || []).forEach((x, j, a) => { if (x && x.k === "fb" && x.uid === it.e.uid) a[j] = null; });
      if (src[0] === "b" && +src.slice(1) > i) src = "b" + (+src.slice(1) - 1);   // 背包里的法宝：前面少了一格
      this.log(`${e.name}融合了${name}，伤害 +${U.dec(DATA.fusePct(fu))}%。`, "good");
      this.dirty(); this.after(); this.openFbFuse(src);
    },
  },

  view() {
    if (this.bagPage) return this.bagPageView();
    const s = this.s, tab = ["eq", "fb", "sp"].includes(this.bagTab) ? this.bagTab : "eq", n = this.slotCount();
    // 顶部两条缎带页签 装备 / 法宝，格子下面一条缎带按钮 法术（仿立绘界面：选中金色、未选灰白，两端箭头）
    const rib = (k, t, cls) => `<button class="rib ${cls}${tab === k ? " on" : ""}" onclick="G.setBagTab('${k}')">${t}</button>`;
    const tabs = `<div class="rib-tabs">${rib("eq", "装备", "l")}${rib("fb", DATA.slots.fabao, "r")}</div>`;
    const spBtn = `<div class="rib-tabs">${rib("sp", "法术", "c")}</div>`;
    // 人物左右两个圆钮：神通秘术 / 本命法宝，点开进单独页面（bagPage）
    const orb = (k, t, c) => `<button class="bs-orb" style="grid-column:${c};grid-row:2/4" onclick="G.setBagPage('${k}')"><img src="img/orb_${k}.webp?v=3" alt=""><span>${t}</span></button>`;
    // 格子：有装备 = 图片 + 名字；空 = 只显示格子名称（头盔、法宝……）
    const cell = (key, label, e) => { const src = DATA.eqIcon(e); return `<div class="slot-eq ${e ? "q" + e.q : ""}${DATA.eqCls(e)}" onclick="G.openEquip('${key}')">
        ${e ? `${src ? `<img class="si" src="${src}" alt="">` : ""}<span class="nm">${e.name}</span>` : `<b>${label}</b>`}</div>`; }; // 只显示名字，点击看详细

    // v（仿立绘界面）：格子围着人物站立图，左右两列；装备 12 格 = 外侧 4 + 内侧上下各 1，法宝 / 法术 8 格 = 外侧左右各 4
    const sCells = [], at = (c, r, h) => sCells.push(h.replace('<div class="slot-eq', `<div style="grid-column:${c};grid-row:${r}" class="slot-eq`));
    if (tab === "eq") {
      const P = { pendant: [1, 1], helmet: [2, 1], armor: [1, 2], weapon: [1, 3], legs: [1, 4], boots: [2, 4], ring0: [4, 1], ring1: [5, 1], ring2: [5, 2], ring3: [5, 3], ring4: [5, 4], ring5: [4, 4] };
      DATA.equipSlots.forEach(k => { const p = P[k] || [1, 1]; at(p[0], p[1], cell(k, DATA.slots[DATA.slotOf(k)], s.equip[k])); });
    } else {
      // 12 格：左外 4、左内上下、右内上下、右外 4（同装备）
      const P = [[1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 4], [4, 1], [4, 4], [5, 1], [5, 2], [5, 3], [5, 4]], nm = tab === "fb" ? "法宝" : "法术";
      for (let i = 0; i < Math.min(DATA.SLOT_MAX, P.length); i++) {
        let h;
        if (i >= n && !(tab === "fb" ? s.fabao[i] : s.spellSlots[i])) h = `<div class="slot-eq lock"><b>${nm}</b><span class="nm">${DATA.realmLabel(DATA.slotRealm(i))}开启</span></div>`;
        else if (tab === "fb") h = cell("fb" + i, "法宝", s.fabao[i]);
        else { const id = s.spellSlots[i]; if (id) { const g = DATA.spellInfo(id, s.gongfa[id]); h = `<div class="slot-eq q1" onclick="G.openSpellSlot(${i})"><img class="si" src="${DATA.skillIcon(g)}" alt=""><span class="nm">${g.name}</span></div>`; } else h = `<div class="slot-eq" onclick="G.openSpellPick()"><b>法术</b></div>`; }
        at(P[i][0], P[i][1], h);
      }
    }
    const top = `<div class="card bagstage"><div class="bs-hero" style="grid-column:2/5;grid-row:1/5"><img src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt=""></div>
      <div class="bs-top" style="grid-column:3;grid-row:1">${tabs}</div><div class="bs-bot" style="grid-column:3;grid-row:4">${spBtn}</div>${orb("shentong", "神通秘术", 2)}${orb("benming", "本命法宝", 4)}${sCells.join("")}</div>`;
    this.sortBag();
    // v26：储物格分类（全部 丹药 药材 矿石）+ 出售页
    const flt = this.bagFilter || "all", match = it => flt === "all" || (flt === "dan" ? it.t === "pill" || it.t === "dan" || it.t === "ql" || it.t === "ylb" || it.t === "ysd" : it.t === "mat" && it.kind === flt);
    const ftabs = `<div class="bag-tabs">${[["all", "全部"], ["dan", "丹药"], ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore]].map(([k, t]) =>
      `<button class="${flt === k && !this.bagSell ? "active" : ""}" onclick="G.setBagFilter('${k}')">${t}</button>`).join("")}
      <button class="sell ${this.bagSell ? "active" : ""}" onclick="G.openSellPage()">出售</button></div>`;
    if (this.bagSell) return top + `<div class="card"><h3>储物格<small>${s.bag.length} / ${s.bagCap}</small></h3>${ftabs}</div>` + this.sellPageView(match);
    let cells = "", shown = 0;
    for (let i = 0; i < s.bagCap; i++) {
      const it = s.bag[i];
      if (it && !match(it)) continue;
      shown++;
      if (!it) { if (flt !== "all") continue; cells += `<div class="cell"></div>`; }
      // 格子里只显示名字和类型，点击才看品质、境界、效果
      else if (it.t === "pill") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 3))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.pillIcon(it.type)}" alt="">${DATA.pills[it.type].name}<span class="n">${it.n}</span></div>`;
      else if (it.t === "dan") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}${DATA.danCls(it.type, it.g)}" onclick="G.openItem(${i})">${DATA.danImg(DATA.danIcon(it.type), DATA.danCls(it.type, it.g), "mi")}${it.sg ? DATA.sgDanBase(it.type) : DATA.dans[it.type].name}<span class="n">${it.n}</span></div>`;
      else if (it.t === "ql") cells += `<div class="cell q4${DATA.qlCls(it.sect)}" onclick="G.openItem(${i})">${DATA.danImg(DATA.iconImg("dan_ql"), DATA.qlCls(it.sect), "mi")}${DATA.qlName(it.sect)}<span class="n">${it.n}</span></div>`;
      else if (it.t === "mat") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.matImg(it.kind, it.g)}" alt="">${it.name}<span class="n">${U.fmt(it.n)}</span></div>`;
      else if (it.t === "fu") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.furnaceIcon(it.kind)}" alt="">${DATA.furnaceName(it.kind, it.g)}${it.n > 1 ? `<span class="n">${it.n}</span>` : ""}</div>`;
      else if (it.t === "bp") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("bp")}" alt="">${DATA.furnaceName(it.kind, it.g)}</div>`;
 else if (it.t === "sm") cells += `<div class="cell q3" onclick="G.openItem(${i})"><img class="mi" src="${DATA.smIcon(it.k, it.ft)}" alt="">${DATA.smName(it.k, it.ft, it.tier)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "ysd") cells += `<div class="cell q5" onclick="G.openItem(${i})"><img class="mi" src="img/ysdan/${it.k}.webp" alt="">${this.itemName(it)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "stp") cells += `<div class="cell q4" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("st_frag")}" alt="">${this.itemName(it)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "ylb") cells += `<div class="cell q${DATA.ybQ(it.g)}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.ybIcon(it.k)}" alt="">${(DATA.YB[it.k] || {}).name || "宝物"}<span class="n">${it.n}</span></div>`;
 else if (it.t === "book") cells += `<div class="cell q1" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("mifa")}" alt="">${CFG.start.book.name}</div>`;
 else if (it.t === "gfb") cells += `<div class="cell q3" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("mifa")}" alt="">${this.itemName(it)}</div>`;
 else if (it.t === "hx") cells += `<div class="cell q4" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("hx")}" alt="">${DATA.HX}<span class="n">${U.fmt(it.n)}</span></div>`;
      else if (it.t === "dfb") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})">${DATA.danImg(DATA.danIcon(it.type), DATA.danCls(it.type, it.g), "mi")}${DATA.danName(it.type, it.g)}丹方</div>`;
      else if (it.t === "rbp") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("bp")}" alt="">${DATA.ringNames[it.r] || "戒指"}图纸${it.n > 1 ? `<span class="n">${it.n}</span>` : ""}</div>`;
 else if (it.t === "ss") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("ss")}" alt="">${DATA.stoneName(it.g)}<span class="n">${it.n}</span></div>`;
      else if (it.t === "cu") { const d = this.cuDef(it.name); cells += `<div class="cell q${d ? d.q || 0 : 0}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.cuIcon(d)}" alt="">${it.name}<span class="n">${U.fmt(it.n)}</span></div>`; }
      else { const src = DATA.eqIcon(it.e); cells += `<div class="cell q${it.e.q}${DATA.eqCls(it.e)}" onclick="G.openItem(${i})">${src ? `<img class="mi" src="${src}" alt="">` : ""}${it.e.name}${it.e.enh ? `<span class="n">+${it.e.enh}</span>` : ""}${src ? "" : `<span class="g">${DATA.slots[it.e.slot]}</span>`}</div>`; }
    }
    return top + `<div class="card"><h3>储物格<small>${s.bag.length} / ${s.bagCap}</small></h3>${ftabs}<div class="grid">${cells || `<p class="desc">没有这类物品。</p>`}</div></div>`;
  },
});
