/* =====================================================================
 * 模块：洞府
 * ---------------------------------------------------------------------
 * 房间：聚灵阵、炼丹房、炼器室、灵根、灵药园、灵兽室、洞府阵法、道童居
 * （房间列表在 data/cave.js 的 DATA.caveRooms；炼丹房、炼器室见 craft.js，灵药园见 garden.js）
 *
 * 聚灵阵：
 * - 每 10 秒聚集一次灵气（有进度条），灵气是修炼的“燃料”
 * - 同时给修炼速度加倍率（见 data/cave.js 的 factor）
 * - 聚灵速度只由聚灵阵等级决定，境界提升不会增加
 * - 初始 0 级；开关在“修炼”页，开关只影响修炼加成，不影响聚灵
 * - 可以用灵石手动补充灵气，或开启“灵气不足时自动补充”
 * ===================================================================== */
G.module({
  id: "cave",
  tab: "cave",

  defaults: () => ({
    ling: CFG.start.ling,                                     // 当前灵气
    array: { lv: 0, on: true, autoRefill: false }, // 聚灵阵（初始 0 级）
    lzSlot: Array(CFG.lingzhu.SLOTS).fill(null),     // 聚灵阵灵珠格：{ ft 属性序号, v 聚灵 }，null = 空
  }),

  // 每 10 秒聚集灵气
  tick() {
    const cap = this.lingCap(); if (this.s.ling < cap) this.s.ling = Math.min(cap, this.s.ling + this.speed().gather);   // v207 上限只挡聚灵，上限变低时不删已有灵气
  },

  api: {
    // 其他房间的页面（炼丹房、炼器室、灵药园在各自模块里登记：G.caveViews.房间id = function）
    caveViews: {},
    arrayFactor() { return DATA.array.factor(this.s.array.lv); },
    // 每 10 秒聚灵量（只由等级决定，开关不影响）
    gatherAmount() { return DATA.array.gather(this.s.array.lv) + this.gatherLz() + this.gatherServant() + DATA.array.flat(this.s.array.lv) + (this.servantFlat ? this.servantFlat() : 0); },   // 固定聚灵最后加，不吃道童等加成
    gatherServant() { return (DATA.array.gather(this.s.array.lv) + this.gatherLz()) * (this.servantPct ? this.servantPct("zhen") : 0) / 100; },   // 道童阵法辅助：聚灵 +%
    gatherLz() { return (this.s.lzSlot || []).reduce((t, z) => t + (z ? z.v : 0), 0); },   // 灵珠格聚灵
    lingCap() { const sp = this.speed(); return Math.max(100, sp.gather * DATA.LING_CAP_GATHER + sp.total * DATA.LING_CAP_SPEED); },
    // v247 每 10 秒修炼消耗的灵气：修为修炼 + 肉身修炼 + 功法修炼（只算正在进行的）
    lingUse() {
      const s = this.s; let u = 0;
      if (s.auto && this.hasMijue() && !this.exBlocksCult()) u += Math.max(0, this.speed().total - this.wdRed("exp"));
      if (s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax()) u += Math.max(0, this.bodySpeed().total * Math.max(0.0001, CFG.body.LING_RATE || 1) - this.wdRed("body"));
      const st = s.gfStudy;
      if (st && st.done < st.total) { const R = this.gfRoomNow(); u += st.per * (R ? R.mul : 1) * 2; }
      return u;
    },
    lingPerStone() { return DATA.array.STONE_LING; }, // 固定数值

    // 用灵石补充灵气，stones 为 "fill" 时补满
    buyLing(stones) {
      const cap = this.lingCap(), rate = this.lingPerStone();
      const need = Math.ceil((cap - this.s.ling) / rate);
      if (stones === "fill") stones = need;
      else stones = Math.floor(+stones);
      stones = Math.min(stones, need, Math.floor(this.s.stone));
      if (stones <= 0) return this.log(this.s.ling >= cap ? "灵气已满。" : "灵石不足。", "sys");
      this.s.stone -= stones;
      this.s.ling = Math.min(cap, this.s.ling + stones * rate);
      this.log(`消耗 ${U.fmt(stones)} 灵石，补充灵气 ${U.fmt(stones * rate)}。`, "good");
      this.after();
    },
    // 灵气换灵石：每 LING_STONE 灵气换 1 灵石；want = 换几个灵石（不填 = 全部兑换）
    lingToStone(want) {
      const per = DATA.array.LING_STONE, n = Math.min(want === undefined || want === null ? Infinity : Math.floor(+want), Math.floor(this.s.ling / per));
      if (n <= 0) return this.log(`灵气不足 ${U.fmt(per)}。`, "sys");
      this.s.ling -= n * per; this.s.stone += n;
      this.log(`消耗灵气 ${U.fmt(n * per)}，换得 ${U.fmt(n)} 灵石。`, "good");
      this.after();
    },
    /* ---------- 兑换灵石 / 补充灵气：弹窗操作 ---------- */
    openLingStone() {
      this.modal(`<h2>兑换灵石<small> ${U.fmt(DATA.array.LING_STONE)} 灵气 = 1 灵石</small></h2>
        <div class="line"><div>灵气</div><b>${U.fmt(this.s.ling)}</b></div><div class="line"><div>灵石</div><b>${U.fmt(this.s.stone)}</b></div>
        <div class="btns"><button data-refresh="openLingStone" onclick="G.lingToStone(1)">换1灵石</button><button data-refresh="openLingStone" onclick="G.lingToStone(100)">换100灵石</button>
        <button data-refresh="openLingStone" onclick="G.lingToStone(10000)">换1万灵石</button><button class="primary" data-refresh="openLingStone" onclick="G.lingToStone()">全部兑换</button>
        <button onclick="G.closeModal()">关闭</button></div>`);
    },
    openBuyLing() {
      const a = this.s.array;
      this.modal(`<h2>补充灵气<small> 1 灵石 = ${U.fmt(this.lingPerStone())} 灵气</small></h2>
        <div class="line"><div>灵气</div><b>${U.fmt(this.s.ling)} / ${U.fmt(this.lingCap())}</b></div><div class="line"><div>灵石</div><b>${U.fmt(this.s.stone)}</b></div>
        <div class="btns"><button data-refresh="openBuyLing" onclick="G.buyLing(100)">用 100 灵石</button><button class="primary" data-refresh="openBuyLing" onclick="G.buyLing('fill')">补满</button>
        <button data-refresh="openBuyLing" class="${a.autoRefill ? "on" : ""}" style="flex-basis:100%" onclick="G.toggleRefill()">灵气不足时自动用灵石补充：${a.autoRefill ? "开" : "关"}</button>
        <button onclick="G.closeModal()">关闭</button></div>`);
    },
    /* ---------- 灵珠格：点空格放入背包里的灵珠，点灵珠强化 ---------- */
    lzOpen(i) {
      const C = CFG.lingzhu, z = this.s.lzSlot[i];
      if (z) {
        const have = this.smCount("lj", z.ft), per = C.ENH_JING;
        return this.modal(`<h2>${DATA.li(DATA.smIcon("lz", z.ft), "lz-glow")}${DATA.smName("lz", z.ft)}<small> 聚灵 +${U.fmt(z.v)}</small></h2>
          <p>强化一次：${DATA.smName("lj", z.ft)} ×${per}，聚灵 +${U.fmt(C.ENH)}（拥有 ${U.fmt(have)}）</p>
          <div class="btns"><button class="primary" onclick="G.lzEnh(${i},1)" ${have >= per ? "" : "disabled"}>强化</button>
          <button onclick="G.lzEnh(${i},10)" ${have >= per * 10 ? "" : "disabled"}>强化10次</button>
          <button onclick="G.lzEnh(${i},0)" ${have >= per ? "" : "disabled"}>全部强化</button><button onclick="G.closeModal()">关闭</button></div>`);
      }
      const own = C.NAMES.map((_, ft) => [ft, this.smCount("lz", ft)]).filter(x => x[1] > 0);
      this.modal(`<h2>灵珠格</h2>${own.length ? own.map(([ft, n]) => `<div class="line"><div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<small>拥有 ${n} · 聚灵 +${U.fmt(C.BASE)}</small></div>
        <button class="sm primary" onclick="G.lzPut(${i},${ft})">放入</button></div>`).join("") : "<p>背包里没有灵珠。</p>"}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    lzPut(i, ft) {
      const s = this.s; if (s.lzSlot[i] || !this.takeSm("lz", 1, ft)) return;
      s.lzSlot[i] = { ft, v: CFG.lingzhu.BASE };
      this.log(`${DATA.smName("lz", ft)}放入聚灵阵，聚灵 +${U.fmt(CFG.lingzhu.BASE)}。`, "good"); this.after(); this.lzOpen(i);
    },
    lzEnh(i, times) {
      const C = CFG.lingzhu, z = this.s.lzSlot[i]; if (!z) return;
      // 按钮传 Infinity 时 JSON 序列化成 null，Math.min(null, ...) = 0 永远失败：
      // 0 / null / undefined 都表示「全部」，其它数按次数算。
      const max = Math.floor(this.smCount("lj", z.ft) / C.ENH_JING);
      const n = times ? Math.min(Math.floor(+times), max) : max;   // 0/null = 全部哨兵保留，负数/小数先取整，负数走下面 n<=0 退出
      if (n <= 0 || !this.takeSm("lj", n * C.ENH_JING, z.ft)) return this.log(`${DATA.smName("lj", z.ft)}不足。`, "sys");
      z.v += n * C.ENH;
      this.log(`${DATA.smName("lz", z.ft)}强化 ${n} 次，聚灵 +${U.fmt(n * C.ENH)}。`, "good"); this.after(); this.lzOpen(i);
    },
    toggleRefill() { this.s.array.autoRefill = !this.s.array.autoRefill; this.after(); },

    // 升级聚灵阵，times 为最多升几级
    upgradeArray(times) {
      times = Math.floor(+times);   // 小数向下取整，负数/0 走下面循环 0 次、只提示，不升级
      let n = 0;
      while (n < times && this.s.array.lv < DATA.array.MAX) {
        const c = DATA.array.cost(this.s.array.lv);
        if (this.s.stone < c) break;
        this.s.stone -= c; this.s.array.lv++; n++;
      }
      if (n) this.log(`聚灵阵升至 ${this.s.array.lv} 级。`, "gold");
      else this.log(this.s.array.lv >= DATA.array.MAX ? "聚灵阵已满级。" : "灵石不足。", "sys");
      this.after();
    },
    setCaveRoom(id) { this.caveRoom = id; this.render(); },
  },

  view() {
    const s = this.s, a = s.array, cur = this.caveRoom || "array";
    const rooms = `<div class="room-grid">${DATA.caveRooms.map(r =>
      `<button class="${cur === r.id ? "active" : ""}${r.open ? "" : " dim"}" onclick="G.setCaveRoom('${r.id}')">${r.name}</button>`).join("")}</div>`;

    const room = DATA.caveRooms.find(r => r.id === cur);
    if (this.caveViews[cur]) return rooms + this.caveViews[cur].call(this);
    if (!room.open) return rooms + `<div class="card"><h3>${room.name}</h3><p class="desc">${room.desc}</p><p class="desc">尚在营建，敬请期待。</p></div>`;

    // 聚灵阵
    const cap = this.lingCap(), max = a.lv >= DATA.array.MAX, f = this.arrayFactor();
    return rooms + `<div class="card"><h3>${DATA.caveName("array")} · ${a.lv} / ${DATA.array.MAX} 级</h3>
      <div class="row small"><span>聚灵中（每 10 秒 +${U.num(this.gatherAmount())} 灵气）${(u => u > 0 ? `　修炼消耗 <b class="c-red">-${U.num(u)}</b>` : "")(this.lingUse())}</span></div>
      <div class="bar tick"><div id="gather-bar"></div></div>
      <div class="row small"><span>灵气</span><span>${U.fmt(s.ling)} / ${U.fmt(cap)}</span></div>
      <div class="bar ling"><div style="width:${Math.min(100, s.ling / cap * 100)}%"></div></div>
      <div class="line"><div>每 10 秒聚灵</div><b>+${U.num(this.gatherAmount())}${this.gatherLz() > 0 ? `<small>灵珠 +${U.num(this.gatherLz())}</small>` : ""}</b></div>
      <div class="line"><div>修炼速度加成</div><b>+${U.num((f - 1) * 100)}%</b></div>
      <div class="line"><div>下一级<small>加成 +${U.num((DATA.array.factor(a.lv + 1) - 1) * 100)}%，聚灵 +${U.num(DATA.array.gather(a.lv + 1) + DATA.array.flat(a.lv + 1))}</small></div><b>${max ? "满级" : U.fmt(DATA.array.cost(a.lv)) + " 灵石"}</b></div>
      <div class="btns">
        <button class="primary" onclick="G.upgradeArray(1)" ${max ? "disabled" : ""}>升级</button>
        <button onclick="G.upgradeArray(10)" ${max ? "disabled" : ""}>连升10级</button>
      </div></div>
      <div class="card"><div class="btns"><button onclick="G.openLingStone()">兑换灵石</button><button onclick="G.openBuyLing()">补充灵气</button></div></div>
      <div class="card"><h3>灵珠<small>聚灵 +${U.fmt(this.gatherLz())}</small></h3><div class="lz-grid">${s.lzSlot.map((z, i) => `<button class="lz-cell${z ? " has" : ""}" onclick="G.lzOpen(${i})">${z
        ? `<img class="lz-glow" src="${DATA.smIcon("lz", z.ft)}" alt=""><small>${DATA.smName("lz", z.ft)}</small><small>+${U.fmt(z.v)}</small>` : "<small>空</small>"}</button>`).join("")}</div></div>`;
  },
});
