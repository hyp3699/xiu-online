/* =====================================================================
 * 模块：礼包码
 * ---------------------------------------------------------------------
 * 管理员：设置 → 生成礼包码（选物品、兑换次数；可随时删除）。礼包码存在服务器（server/server.py 的 gifts 表）。
 * 所有玩家：设置 → 礼包码兑换。每个账号每个礼包码只能兑换一次；兑换次数用完就失效。
 * 礼包里的物品格式 { c: 类别, ... }：
 *   stone / contrib / merit {n}         灵石 / 贡献 / 功德
 *   gf {src, type}                      功法（来源 = 门派 / 坊市 / 试炼塔）
 *   sp {src}                            法术（门派本属性）
 *   mf {star, kind}                     秘法
 *   fabao {ft, el, g, n}                法宝（形状、属性、阶）
 *   eq {slot, g, n}                     装备（slot = 部位，戒指写 "ring:种类序号"）
 *   herb / ore {g, n}                   药材 / 矿石（不含特产）；ore 的 g ≥ 1000 = 耀石（g − 1000 = 属性序号）
 *   tc {name, n}                        四界特产
 *   dan {item: "p:类型" 修炼丹 | "d:丹方", g, n}
 *   bp {item: "f:炉子" | "r:戒指序号", g, n}   图纸
 *   lj / lz {ft, n}                     灵晶 / 灵珠（ft = 金木水火土 0~4）
 *   hx {n}                              火髓
 *   st {id}                             神通（直接学会 = 宗门大殿修满，进背包「神通秘术」）
 * ===================================================================== */
G.module({
  id: "gift",

  api: {
    giftCats() {
      return [["stone", "灵石"], ["contrib", "贡献"], ["merit", "功德"], ["gf", "功法"], ["sp", "法术"], ["mf", "秘法"], ["fabao", "法宝"], ["eq", "装备"],
        ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore], ["tc", "特产"], ["dan", "丹药"], ["bp", "图纸"],
        ["lj", DATA.smName("lj")], ["lz", DATA.smName("lz")], ["hx", DATA.HX], ["st", "神通"]];
    },
    giftSpecial() { return CFG.matsOther.SPECIAL; },
    giftJie() { return DATA.JIE.map((n, i) => [i, n]); },
    // 每个类别要选的项：{ k, label, opts:[[值, 显示]] } 或 { k, label, num:true }
    giftFields(c, a) {
      const N = { k: "n", label: "数量", num: true }, jie = this.giftJie();
      const srcName = o => `${o.star}星·${o.name}${o.book ? `·第${o.book}卷` : ""}`;
      if (c === "stone" || c === "contrib" || c === "merit" || c === "hx") return [N];
      if (c === "lj" || c === "lz") return [{ k: "ft", label: "名称", opts: CFG.mijing.items[c].names.map((n, i) => [i, n]) }, N];
      if (c === "gf") {
        const srcs = [...DATA.sects, ...DATA.shopSources, ...DATA.jieGf.jshop.filter(x => !x.old), ...DATA.jieGf.gd.filter(x => !x.old), ...DATA.towerBooks, ...DATA.twSources].sort((x, y) => x.star - y.star);
        const o = DATA.gfSrcById[a.src] || srcs[0];
        const types = o.src === "tower" ? DATA.gongfaTypes.filter(t => DATA.TOWER_TYPES.includes(t.id)) : o.src === "shop" || o.src === "tianwai" ? DATA.gfTypesOf(o.src, o.star).filter(t => !t.sectOnly) : DATA.gfTypesOf(o.src, o.star);
        return [{ k: "src", label: "来源", opts: srcs.map(x => [x.id, srcName(x)]) }, { k: "type", label: "种类", opts: types.map(t => [t.id, t.name]) }];
      }
      if (c === "st") return [{ k: "id", label: "神通", opts: ((CFG.yinshi.SHENTONG || {}).LIST || []).map(d => [d.id, `${d.name}（${d.type === "pas" ? "被动" : "主动"}）`]) }];
      if (c === "sp") return [{ k: "src", label: "门派", opts: [...DATA.sects, ...DATA.twSources].map(x => [x.id, srcName(x)]) }];
      if (c === "mf") return [{ k: "star", label: "星级", opts: Array.from({ length: DATA.SECT_STARS }, (_, i) => [i + 1, `${i + 1}星`]) },
        { k: "kind", label: "种类", opts: DATA.mifaKinds.map(k => [k.id, k.name]) }];
      if (c === "fabao") return [{ k: "ft", label: "形状", opts: DATA.fabaoTypes.map((t, i) => [i, t.name]) }, { k: "el", label: "属性", opts: DATA.elements.map(e => [e.id, e.name]) },
        { k: "g", label: "阶", opts: jie }, N];
      if (c === "eq") return [{ k: "slot", label: "部位", opts: [...DATA.eqSlots6.map(x => [x, DATA.slots[x]]), ...DATA.ringNames.map((n, r) => ["ring:" + r, n])] }, { k: "g", label: "阶", opts: jie }, N];
      if (c === "herb" || c === "ore") {
        const sp = this.giftSpecial(), list = (c === "herb" ? DATA.herbs : DATA.ores).map((n, g) => [g, n]).filter(([, n]) => !sp.includes(n));
        if (c === "ore") list.push(...CFG.mijing.items.ys.names.map((n, i) => [1000 + i, n]));   // v152 耀石放在矿石里：g = 1000 + 属性序号
        return [{ k: "g", label: "名称", opts: list }, N];
      }
      if (c === "tc") return [{ k: "name", label: "名称", opts: [...this.giftSpecial().filter(n => DATA.matByName[n]).map(n => [n, n]), [DATA.smName("wdg"), DATA.smName("wdg")]] }, N];   // 悟道果也放在特产里
      if (c === "dan") {
        const items = [...Object.keys(DATA.pills).map(t => ["p:" + t, DATA.pills[t].name]),
          ...Object.keys(DATA.dans).map(t => ["d:" + t, DATA.recipes[t].name])];
        const it = a.item || items[0][0], gs = it[0] === "p" ? DATA.realms.map((n, i) => [i, DATA.realmLabel(i)]) : (DATA.recipes[it.slice(2)].val || []).map((_, i) => [i, DATA.JIE[i]]);
        return [{ k: "item", label: "丹药", opts: items }, { k: "g", label: it[0] === "p" ? "品质" : "阶", opts: gs }, N];
      }
      if (c === "bp") {
        const items = [...DATA.FURNACE_KINDS.map(k => ["f:" + k, DATA.furnaceKinds[k] + "图纸"]), ...DATA.ringNames.map((n, r) => ["r:" + r, n + "图纸"])];
        const it = a.item || items[0][0], gs = it[0] === "f" ? ((DATA.furnaces[it.slice(2)] || {}).blueprint || DATA.JIE).map((_, i) => [i, DATA.JIE[i]]) : jie;
        return [{ k: "item", label: "图纸", opts: items }, { k: "g", label: "阶", opts: gs }, N];
      }
      return [];
    },
    // 补齐默认值（选项变了以后不合法的也重置）
    giftFix(c, a) {
      for (let pass = 0; pass < 2; pass++) for (const f of this.giftFields(c, a)) {
        if (f.num) { if (!(+a[f.k] > 0)) a[f.k] = 1; continue; }
        if (!f.opts.some(o => String(o[0]) === String(a[f.k]))) a[f.k] = f.opts.length ? f.opts[0][0] : undefined;
      }
      return a;
    },
    giftNorm(c, a) {   // 存进礼包的干净对象（数字字段转数字）
      const it = { c };
      for (const f of this.giftFields(c, a)) { const v = a[f.k]; it[f.k] = f.num || typeof f.opts[0][0] === "number" ? +v : v; }
      return it;
    },
    giftLabel(it) {
      const n = it.n > 1 ? ` ×${U.fmt(it.n)}` : "";
      try {
        switch (it.c) {
          case "stone": return `灵石 ${U.fmt(it.n)}`;
          case "contrib": return `贡献 ${U.fmt(it.n)}`;
          case "merit": return `功德 ${U.fmt(it.n)}`;
          case "gf": { const g = DATA.gongfaInfo(DATA.gongfaId(it.src, it.type)); return `功法《${g.name}》`; }
          case "sp": { const o = DATA.gfSrcById[it.src]; if (!o) return "未知物品"; return `法术《${DATA.spellInfo(DATA.spellId(it.src, o.el)).name}》`; }
          case "mf": return `秘法《${DATA.mifaInfo(DATA.mifaId(it.star, it.kind)).name}》`;
          case "fabao": return `${DATA.XING[it.g]}·${DATA.elById[it.el].name}·${DATA.fabaoName(it.ft, it.g)}${n}`;
          case "eq": { const [sl, r] = String(it.slot).split(":"); return (sl === "ring" ? DATA.ringName(+r, it.g) : DATA.forgeEqName(sl, it.g)) + n; }
          case "herb": case "ore": return (it.c === "ore" && it.g >= 1000 ? DATA.smName("ys", it.g - 1000) : DATA.matName(it.c, it.g)) + n;
          case "tc": return it.name + n;
          case "lj": case "lz": return DATA.smName(it.c, it.ft) + n;
          case "hx": return DATA.HX + n;
          case "st": return `神通「${this.stName(it.id)}」`;
          case "dan": { const [k, t] = it.item.split(":"); return (k === "p" ? `${DATA.realms[it.g]}·${DATA.pills[t].name}` : DATA.danName(t, it.g)) + n; }
          case "bp": { const [k, t] = it.item.split(":"); return (k === "f" ? DATA.furnaceName(t, it.g) + "图纸" : DATA.ringBpName(it.g, +t)) + n; }
        }
      } catch (e) {}
      return "未知物品";
    },
    // 发放一件，返回是否放进去了
    giftGive(it) {
      const s = this.s, n = Math.max(1, Math.floor(+it.n || 1)), rep = f => { let ok = 0; for (let i = 0; i < n; i++) if (f()) ok++; return ok > 0; };
      switch (it.c) {
        case "stone": s.stone += n; return true;
        case "contrib": s.contrib = (s.contrib || 0) + n; return true;
        case "merit": s.merit = (s.merit || 0) + n; return true;
        case "gf": case "sp": case "mf": {
          const id = it.c === "gf" ? DATA.gongfaId(it.src, it.type) : it.c === "sp" ? DATA.spellId(it.src, DATA.gfSrcById[it.src].el) : DATA.mifaId(it.star, it.kind);
          if (!DATA.skillInfo(id)) return false;
          if (!s.gongfa[id]) { s.gongfa[id] = 1; if (it.c === "sp") this.autoSlotSpell(id); }
          return true;
        }
        case "fabao": return rep(() => this.addEquip(DATA.rollForged("fabao", it.g, it.ft, it.el)));
        case "eq": { const [sl, r] = String(it.slot).split(":"); return rep(() => this.addEquip(DATA.rollForged(sl, it.g, sl === "ring" ? +r : undefined))); }
        case "herb": case "ore": if (it.c === "ore" && it.g >= 1000) return this.addSm("ys", n, it.g - 1000);
          return this.addMat(it.c, DATA.matName(it.c, it.g), it.g, n);
        case "lj": case "lz": return this.addSm(it.c, n, it.ft);
        case "hx": return this.addFire(n);
        case "st": {   // 神通：直接修满（领悟），出战位有空就自动出战
          if (!this.stDef(it.id)) return false;
          const S = this.ysStFix(), had = this.ysStLv(it.id) >= this.ysStMax(); S[it.id] = this.ysStMax();
          if (!had) { if (!this.stEqWhy(it.id)) this.stEqList().push(it.id); }
          return true;
        }
        case "tc": { if (it.name === DATA.smName("wdg")) return this.addSm("wdg", n); const m = DATA.matByName[it.name]; return !!m && this.addMat(m.kind, it.name, m.g, n); }
        case "dan": { const [k, t] = it.item.split(":"); return k === "p" ? this.addPill(t, it.g, n) : this.addDan(t, it.g, n); }
        case "bp": { const [k, t] = it.item.split(":");
          return k === "f" ? rep(() => this.addBlueprintItem(t, it.g)) : rep(() => { if (this.bagFull()) return false; s.bag.push({ t: "rbp", r: +t, g: it.g }); return true; }); }
      }
      return false;
    },

    /* ---------- 玩家兑换 ---------- */
    async redeemGift() {
      const code = (this.giftCode || "").trim();
      if (!code || this.giftBusy) return;
      this.giftBusy = true; this.render();
      try {
        const j = await API.giftRedeem(code);
        this.giftCode = "";
        const got = (j && j.got) || [], lost = (j && j.lost) || [];
        API.toastLogs([{ m: `兑换成功，获得 ${got.join("、") || "无"}${lost.length ? `（背包已满，遗失 ${lost.join("、")}）` : ""}`, c: "gold" }], true);
      } catch (e) { this.log("兑换失败：" + e.message, "bad"); }
      this.giftBusy = false; this.render();
    },

    /* ---------- 管理员：生成 / 删除 ---------- */
    openGiftAdmin(on) {
      this.giftPage = !!on;
      if (on) { if (!this.gd) this.gd = { c: "stone", a: {}, list: [], uses: 1 }; this.loadGifts(); }
      this.render();
    },
    async loadGifts() { try { this.giftList = (await API.giftList()).list || []; } catch (e) { this.giftList = []; this.log("读取礼包码失败：" + e.message, "bad"); } this.render(); },
    gdCat(c) { this.gd.c = c; this.gd.a = {}; this.render(); },
    gdSet(k, v) { this.gd.a[k] = v; this.render(); },
    gdNum(k, v) { this.gd.a[k] = Math.max(1, Math.floor(+v || 1)); },
    gdUses(v) { this.gd.uses = Math.max(1, Math.floor(+v || 1)); },
    gdAdd() { const d = this.gd; this.giftFix(d.c, d.a); d.list.push(this.giftNorm(d.c, d.a)); this.render(); },
    gdDel(i) { this.gd.list.splice(i, 1); this.render(); },
    async gdCreate() {
      const d = this.gd, code = (d.code || "").trim();
      if (!d.list.length) return this.log("礼包里还没有物品。", "sys");
      try {
        const j = await API.giftCreate({ code, items: d.list, uses: d.uses });
        this.log(`已生成礼包码 ${j.code}（可兑换 ${d.uses} 次）。`, "gold");
        d.list = []; d.code = "";
        this.loadGifts();
      } catch (e) { this.log("生成失败：" + e.message, "bad"); }
    },
    async delGift(code) {
      if (!(await this.ask(`删除礼包码 ${code}？`))) return;
      try { await API.giftDelete(code); this.log(`已删除礼包码 ${code}。`, "sys"); this.loadGifts(); } catch (e) { this.log("删除失败：" + e.message, "bad"); }
    },
    giftAdminView() {
      const d = this.gd, a = this.giftFix(d.c, d.a), esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const sel = (key, opts, cur, fn) => this.selBox(key, opts, cur, fn);
      const fields = this.giftFields(d.c, a).map(f => `<div class="row small"><span>${f.label}</span>${f.num
        ? `<input type="number" min="1" value="${a[f.k]}" oninput="G.gdNum('${f.k}',this.value)" style="width:8em">`
        : sel("gd:" + f.k, f.opts, a[f.k], v => this.gdSet(f.k, v))}</div>`).join("");
      const items = d.list.map((it, i) => `<div class="line"><div>${this.giftLabel(it)}</div><button class="sm" onclick="G.gdDel(${i})">移除</button></div>`).join("");
      const list = (this.giftList || []).map(g => `<div class="line"><div><b>${esc(g.code)}</b><small>已兑换 ${g.used} / ${g.uses} · ${(g.items || []).map(it => this.giftLabel(it)).join("、")}</small></div>
        <button class="sm" onclick="G.delGift('${esc(g.code).replace(/'/g, "\\'")}')">删除</button></div>`).join("");
      return `<div class="row" style="margin:6px 0"><b>生成礼包码</b><button class="sm" onclick="G.openGiftAdmin(false)">返回</button></div>
        <div class="card"><h3>添加物品</h3>
          <div class="row small"><span>类别</span>${sel("gd:cat", this.giftCats(), d.c, v => this.gdCat(v))}</div>${fields}
          <div class="btns"><button onclick="G.gdAdd()">加入礼包</button></div></div>
        <div class="card"><h3>礼包物品<small>${d.list.length} 件</small></h3>${items || ""}
          <div class="row small"><span>兑换次数</span><input type="number" min="1" value="${d.uses}" oninput="G.gdUses(this.value)" style="width:8em"></div>
          <div class="row small"><span>礼包码</span><input id="gift-new-code" placeholder="不填自动生成 16 位" maxlength="32" value="${esc(d.code || "")}" oninput="G.gd.code=this.value" style="width:12em"></div>
          <div class="btns"><button class="primary" onclick="G.gdCreate()" ${d.list.length ? "" : "disabled"}>生成礼包码</button></div></div>
        <div class="card"><h3>已有礼包码</h3>${list}</div>`;
    },
    giftRedeemCard() {
      return `<div class="card"><h3>礼包码兑换</h3>
        <div class="row small"><input id="gift-code" maxlength="32" value="${String(this.giftCode || "").replace(/"/g, "&quot;")}" oninput="G.giftCode=this.value" style="flex:1"><button class="sm primary" onclick="G.redeemGift()" ${this.giftBusy ? "disabled" : ""}>兑换</button></div></div>`;
    },
  },
});
