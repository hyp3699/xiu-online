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
    bm: null,                                                 // 本命法宝 { e: 法宝, t: 炼成时间 }（config/benming.js）
    bmJob: null,                                              // 正在炼成本命的法宝 { e, end }
    bmLearn: false,                                           // 是否学会本命法宝炼制图纸（仙界第 1 图功德司买图纸，背包里学习）
    mailbox: [],                                              // 传音：背包放不下的物品 [{ id, it: 背包物品, at: 暂存时间 }]，10 天未领自动清除
  }),

  api: {
    // 法宝名字跟着 config/names.js 的 fabaoName
    // 旧存档补齐持久化 uid：没有 uid 的法宝在服务端绑定存档时就地补上，
    // 下一次存档后渡劫格子才能按 uid 找到它，而不是只在客户端弹窗里临时生成。
    fabaoNames() {
      const s = this.s, f = e => { if (e && e.slot === "fabao" && e.attrs) { e.name = DATA.fabaoName(e.ft, e.g); if (!e.uid) e.uid = DATA.newUid(); } };
      s.bag.forEach(it => it && it.t === "eq" && f(it.e)); (s.fabao || []).forEach(f); [s.bm && s.bm.e, s.bmJob && s.bmJob.e].forEach(e => { if (e) { const nm = e.name; f(e); e.name = nm; } });
    },
    // 法宝栏、法术栏当前开启格数：每个大境界 1 格
    // 背包是固定格子：用掉一件后该格留空（null），后面的物品不往前挪；
    // 只有手动整理时才把非空物品按原规则排序并紧缩到前面，空位留在最后。
    // 背包排序：先按类型（修炼丹 → 属性丹 → 药材 → 矿石 → 装备），同类型再按品阶从低到高
    // 秘境材料（t = "sm"，灵元 / 灵晶 / 耀石等）以前排序键全是 0 / ""，分不出种类和属性，只能保持获得顺序，
    // 所以点整理后还是三种混在一起；现在先按种类（灵元 → 灵晶 → 耀石 → 其他秘境材料），同种再按属性（金木水火土雷）排
    sortBag() {
      const order = it => it.t === "pill" ? 0 : it.t === "dan" || it.t === "ql" || it.t === "ysd" ? 1 : it.t === "mat" ? (it.kind === "herb" ? 2 : 3) : it.t === "seed" ? 2.5 : it.t === "lg" ? 2.6 : it.t === "fu" ? 4 : it.t === "bp" || it.t === "ss" || it.t === "rbp" || it.t === "bmbp" || it.t === "dfb" || it.t === "hx" || it.t === "sm" ? 5 : it.t === "eq" ? (it.e.slot === "fabao" ? 7 : 6) : it.t === "cu" ? 8 : 9;
      const smKind = it => { if (it.t !== "sm") return -1; const main = ["ly", "lj", "ys"]; const i = main.indexOf(it.k); if (i >= 0) return i; const keys = Object.keys(CFG.mijing.items || {}); const j = keys.indexOf(it.k); return 3 + (j >= 0 ? j : 99); };   // 非秘境材料先排（-1），秘境材料整块在后，不被图纸/空间石等隔开
      const grade = it => it.t === "eq" ? it.e.g * 10 + it.e.q : it.g || 0;
      const sub = it => it.t === "pill" || it.t === "dan" ? it.type : it.t === "eq" ? it.e.slot : it.kind || "";
      const smFt = it => it.t === "sm" ? (it.ft === undefined ? 99 : it.ft) : 0;   // 属性序号：-1（任意）排最前，0~5 按金木水火土雷
      const items = this.s.bag.filter(Boolean);
      items.sort((a, b) => order(a) - order(b) || smKind(a) - smKind(b) || grade(a) - grade(b) || (sub(a) < sub(b) ? -1 : sub(a) > sub(b) ? 1 : 0) || smFt(a) - smFt(b));
      this.s.bag.splice(0, this.s.bag.length, ...items);
    },
    // 手动整理：只有点背包里的「整理」按钮才排序并紧缩；打开背包不再自动整理，
    // 物品保持获得 / 上次整理后的顺序，不会每次进背包都换位置。
    sortBagNow() { this.sortBag(); this.after(); },
    // 物品加锁：点物品打开详情，弹窗右上角的锁点一下锁上 / 解开（格子上不显示）；锁上的不出现在出售页、也不能出售。
    //   装备、法宝、戒指锁在物品本身（e.lk），穿上、卸下都跟着走；其他物品锁在这一格（it.lk）。
    //   k：背包 "b序号"、法宝栏 "fb序号"、装备栏格子名（helmet、ring0……）
    isLocked(it) { return !!it && !!(it.t === "eq" ? it.e && it.e.lk : it.lk); },
    lockObj(k) {
      const s = this.s; k = String(k);
      if (/^b\d+$/.test(k)) { const it = s.bag[+k.slice(1)]; return it ? (it.t === "eq" ? it.e : it) : null; }
      if (/^fb\d+$/.test(k)) return (s.fabao || [])[+k.slice(2)] || null;
      return DATA.equipSlots.includes(k) ? s.equip[k] || null : null;
    },
    itemLock(k) { const o = this.lockObj(k); if (!o) return; if (o.lk) delete o.lk; else o.lk = 1; this.after(); },
    lockIco(k, on) {
      const path = on ? "M7 10V7a5 5 0 0 1 10 0v3" : "M7 10V7a5 5 0 0 1 9.6-2";
      return `<span class="ilk${on ? " on" : ""}" title="${on ? "已锁定，点击解锁" : "点击锁定"}" onclick="event.stopPropagation();G.itemLock('${k}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="${path}"/><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="currentColor"/></svg></span>`;
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
          const f = e.bm && this.bmEq() === e ? this.bmInfo() : DATA.fabaoInfo(e);   // 本命：含通玄加的使用次数
          head = `${DATA.elById[e.el].name}属性${e.name} · 每次祭出消耗法力 ${U.fmt(f.mana)}<br>`;
          // 合计（攻击 / 护盾 / 鼎）单独一块，和下面的属性条隔开
          let sum = f.shield ? `护盾值 ${U.int(f.shield.hp)} · 防御 ${U.int(f.shield.def)}` : `攻击 ${U.int(f.atk || 0)}`;
          sum += `<br>每场战斗最多祭出 ${f.uses} 次`;
          if (f.ding) sum += `<br>击中后对方速度 -${U.num(f.ding.speed)}%、命中 -${U.num(f.ding.hit)}%、闪避 -${U.num(f.ding.dodge)}%，持续 ${f.ding.rounds} 回合`;
          head += `<span class="fb-sum">${sum}</span>`;
          if (e.bm && e.bmRf) head += `<span class="fb-sum">精炼${e.bmRf}次　伤害 +${U.fmt(e.bmRf * ((this.bmCfg().RF_PCT) ?? 0.5))}%</span>`;
          if (e.enh) head += `<span class="fb-sum">强化${e.enh}次　${f.shield ? "护盾值" : "附加伤害"} +${U.fmt(DATA.fbEnh(e))}</span>`;
        }
        if (e.slot !== "fabao" && e.enh) head += `<span class="fb-sum">强化${e.enh}次　${this.enhText(e, e.enh).replace(/、/g, "　")}</span>`;
        return head + e.attrs.map(a => `<span class="${e.bm ? "" : "ac" + a.c}">${DATA.attrText(a, e)}</span>`).join("<br>");
      }
      return "";
    },

    /* ---------- 存取物品 ---------- */
    // 固定格子：已用格数按非空物品算，不是数组长度（用掉后留空，长度不变但格子是空的）。
    bagUsed() { return this.s.bag.reduce((n, it) => n + (it ? 1 : 0), 0); },
    bagFull() { return this.bagUsed() >= this.s.bagCap; },
    // 新物品先填第一个空格，空格不够且数组还没到上限才往后追加；满了返回 false。
    bagPut(it) {
      if (this.bagFull()) return false;
      const hole = this.s.bag.findIndex(x => !x);
      if (hole >= 0) { this.s.bag[hole] = it; return true; }
      if (this.s.bag.length < this.s.bagCap) { this.s.bag.push(it); return true; }
      return false;
    },
    // 一格最多叠几个（config/bag.js）
    stackMax(it) { const S = CFG.stack; return S.ONE.includes(it.t) || (it.t === "sm" && S.ONE_SM.includes(it.k)) ? 1 : it.t === "sm" && (S.BIG_SM || []).includes(it.k) ? 1e12 : S.MAX; },
    // ---------- 传音：背包放不下的物品先放这里，10 天未领自动清除 ----------
    MAILBOX_DAYS: 10,
    MAILBOX_MAX: 300,   // 传音最多几件
    mailboxDue(it) { return (it && it.at || 0) + this.MAILBOX_DAYS * 86400000; },
    mailboxList() { return Array.isArray(this.s.mailbox) ? this.s.mailbox : (this.s.mailbox = []); },
    // 清掉已过期（暂存满 10 天）的条目，返回清掉数；只在确实有过期项时才遍历
    mailboxPrune(now) {
      const list = this.mailboxList(); if (!list.length) return 0;
      now = now || this.now(); let n = 0;
      for (let i = list.length - 1; i >= 0; i--) if (now >= this.mailboxDue(list[i])) { list.splice(i, 1); n++; }
      if (list.length > this.MAILBOX_MAX) { n += list.length - this.MAILBOX_MAX; list.splice(0, list.length - this.MAILBOX_MAX); }   // 旧存档超上限的也削掉
      if (n && !this.silent) this.log(`传音里 ${n} 件物品超过 10 天未领，已自动清除。`, "sys");
      return n;
    },
    mailboxAdd(it, quiet, src) {   // src：来源说明（如「练气期奖励」），传音里显示
      const list = this.mailboxList(); this.mailboxPrune();
      const e = { id: DATA.newUid(), it, at: this.now() }; if (src) e.src = String(src); list.push(e);
      // 上限 MAILBOX_MAX 件，超出丢最早的：原来只增不减，存档超过 4MB 后服务器拒绝保存，账号进不去
      const MAX = this.MAILBOX_MAX; if (list.length > MAX) { const k = list.length - MAX; list.splice(0, k); if (!this.silent) this.log(`传音已满（最多 ${MAX} 件），最早的 ${k} 件已清除。`, "bad"); }
      if (!quiet && !this.silent) this.log("背包已满，已暂存到传音，10 天内领取。", "bad");
      return true;
    },
    // 单件物品：能进背包就进背包，否则进传音；返回 "bag" / "mail"
    bagPutOrMail(it) { return this.bagPut(it) ? "bag" : (this.mailboxAdd(it), "mail"); },
    // 放进背包：先补满同种的格子，剩下的每 stackMax 个开一格；make(k) 造一格 k 个。背包放不下的剩余部分进传音，不再静默丢失、也不再部分成功却按失败算账（原来先补堆叠、装不下返回 false，调用方按失败处理就白嫖了已补的部分）。
    // 新开的格子先填第一个空格，不往后追加（固定格子）。
    bagAdd(match, make, n, lost, noMail) {
      n = Math.floor(+n); if (!(n >= 1)) return true;   // 小数向下取整，负数/0 不加（防控制台直接调 add 系函数刷物品）
      const S = this.s.bag, max = this.stackMax(make(1));
      if (noMail) {   // 领取时必须原子：装不下就一分不动，否则已补的部分 + 传音里原条目 = 复制
        let free = (this.s.bagCap - this.bagUsed()) * max;
        if (max > 1) for (const it of S) if (it && match(it)) free += Math.max(0, max - (it.n || 1));
        if (free < n) return false;
      }
      if (max > 1) for (const it of S) { if (n <= 0) break; if (it && match(it) && (it.n || 1) < max) { const k = Math.min(n, max - (it.n || 1)); it.n = (it.n || 1) + k; n -= k; } }
      while (n > 0) {
        if (this.bagFull()) break;
        const k = Math.min(n, max); if (!this.bagPut(make(k))) break; n -= k;
      }
      if (n > 0) {
        if (noMail) {   // 领取时专用：前面已做原子预检，理论上走不到这里；走到这里也一分不动，不算成功
          return false;
        }
        while (n > 0) { const k = Math.min(n, max); this.mailboxAdd(make(k), true); n -= k; } if (!this.silent) this.log("背包已满，剩余物品已暂存到传音，10 天内领取。", "bad");
      }
      return true;
    },
    bagNum(match) { return this.s.bag.reduce((t, it) => t + (it && match(it) ? it.n || 1 : 0), 0); },
    // 从背包扣 n 个（可跨多格，从后往前扣）；不够返回 false 且不扣
    bagTake(match, n) {
      n = Math.floor(+n); if (!(n >= 1)) return false;   // 小数/负数直接失败，不进 removeAt
      if (this.bagNum(match) < n) return false;
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) { const it = this.s.bag[i]; if (!it || !match(it)) continue; const k = Math.min(n, it.n || 1); this.removeAt(i, k); n -= k; }
      return true;
    },
    addPill(type, g, n = 1) {
      return this.bagAdd(x => x.t === "pill" && x.type === type && x.g === g, k => ({ t: "pill", type, g, n: k }), n, "背包已满，物品遗失了。");
    },
    addMat(kind, name, g, n = 1) {
      if (kind === "sm") return this.addSm(g, n);   // 秘境专用材料（退回养神露等）
      if (kind === "cu") return this.addCustom(name, n);   // 自定义物品（瑶池玉蕊、蟠桃灵果，退回炼丹材料用）
      return this.bagAdd(x => x.t === "mat" && x.name === name && x.g === g, k => ({ t: "mat", kind, name, g, n: k }), n, "背包已满，材料遗失了。");
    },
    addEquipToBag(e) {
      if (e && e.attrs && !e.uid) e.uid = DATA.newUid();
      return this.bagPut({ t: "eq", e });
    },
    addEquip(e) {
      if (!this.addEquipToBag(e)) return this.mailboxAdd({ t: "eq", e });
      return true;
    },
    // 返还 / 出炉用：同一件（同一引用或同一 uid）已在背包里时不再新塞一件，
    // 防止精炼、炼制取消等返还路径把同一件装备复制成两件。
    addEquipOnce(e) {
      if (!e || !e.attrs) return this.addEquip(e);
      const dup = this.s.bag.find(x => x && x.t === "eq" && x.e && (x.e === e || (e.uid && x.e.uid === e.uid)));
      if (dup) return true;
      if (e.uid && this.rfLive && this.rfLive(e.uid)) return true;   // 身上、法宝栏已有同一件也不再放
      return this.addEquip(e);
    },
    // ---------- 传音领取 ----------
    mailboxCount() { const now = this.now(); return this.mailboxList().filter(x => x && now < this.mailboxDue(x)).length; },
    mailboxClaimItem(it) {
      if (!it) return false;
      if (it.t === "eq") return this.addEquipToBag(it.e);
      const n = it.n || 1;
      if (it.t === "cur") { const k = it.k === "merit" ? "merit" : it.k === "stone" ? "stone" : ""; if (!k || !(n > 0)) return false; this.s[k] = (+this.s[k] || 0) + Math.floor(n); return true; }   // 灵石、功德：直接到账，不占格
      if (it.t === "pill") return this.bagAdd(x => x.t === "pill" && x.type === it.type && x.g === it.g, k => ({ t: "pill", type: it.type, g: it.g, n: k }), n, null, true);
      if (it.t === "dan") return this.bagAdd(x => x.t === "dan" && x.type === it.type && x.g === it.g && !x.sg === !it.sg, k => it.sg ? { t: "dan", type: it.type, g: it.g, n: k, sg: 1 } : { t: "dan", type: it.type, g: it.g, n: k }, n, null, true);
      if (it.t === "mat") return this.bagAdd(x => x.t === "mat" && x.name === it.name && x.g === it.g, k => ({ t: "mat", kind: it.kind, name: it.name, g: it.g, n: k }), n, null, true);
      if (it.t === "cu") return this.bagAdd(x => x.t === "cu" && x.name === it.name, k => ({ t: "cu", name: it.name, n: k }), n, null, true);
      if (it.t === "sm") return this.bagAdd(this.smIs(it.k, it.ft), k => { const o = { t: "sm", k: it.k, n: k }; if (DATA.SM_GRADED.includes(it.k)) o.ft = it.ft || 0; return o; }, n, null, true);
      if (it.t === "hx") return this.bagAdd(x => x.t === "hx", k => ({ t: "hx", n: k }), n, null, true);
      if (it.t === "seed") return this.bagAdd(x => x.t === "seed" && x.g === it.g, k => ({ t: "seed", g: it.g, n: k }), n, null, true);
      if (it.t === "lg") return this.bagAdd(x => x.t === "lg" && x.k === it.k, k => ({ t: "lg", k: it.k, n: k }), n, null, true);
      if (it.t === "fu") return this.bagAdd(x => x.t === "fu" && x.kind === it.kind && x.g === it.g, k => ({ t: "fu", kind: it.kind, g: it.g, n: k }), n, null, true);
      if (it.t === "ss") return this.bagAdd(x => x.t === "ss" && x.g === it.g, k => ({ t: "ss", g: it.g, n: k }), n, null, true);
      if (it.t === "ql") return this.bagAdd(x => x.t === "ql" && x.sect === it.sect, k => ({ t: "ql", sect: it.sect, n: k }), n, null, true);
      if (it.t === "ysd") return this.bagAdd(x => x.t === "ysd" && x.ys === it.ys && x.k === it.k, k => ({ t: "ysd", ys: it.ys, k: it.k, n: k }), n, null, true);
      if (it.t === "stp") return this.bagAdd(x => x.t === "stp" && x.id === it.id, k => ({ t: "stp", id: it.id, n: k }), n, null, true);
      if (it.t === "cxp") return this.bagAdd(x => x.t === "cxp" && x.k === it.k, k => ({ t: "cxp", k: it.k, n: k }), n, null, true);
      if (it.t === "ylb") return this.bagAdd(x => x.t === "ylb" && x.k === it.k && x.g === it.g, k => ({ t: "ylb", k: it.k, g: it.g, n: k }), n, null, true);
      return this.bagPut(JSON.parse(JSON.stringify(it)));
    },
    mailboxClaim(id) {
      this.mailboxPrune();
      const list = this.mailboxList(), i = list.findIndex(x => x && x.id === id);
      if (i < 0) return this.log("这件物品已过期或已被领取。", "sys");
      const entry = list[i];
      if (!this.mailboxClaimItem(entry.it)) return this.log("背包空间不足，先整理或腾出格子再领取。", "sys");
      list.splice(i, 1);
      this.log(`已从传音领取${this.itemName(entry.it)}${entry.it.n > 1 ? ` ×${entry.it.n}` : ""}。`, "good");
      this.after(); this.openMailbox();
    },
    mailboxClaimAll() {
      this.mailboxPrune();
      const list = this.mailboxList(); let got = 0;
      for (let i = list.length - 1; i >= 0; i--) if (this.mailboxClaimItem(list[i].it)) { list.splice(i, 1); got++; }
      this.log(got ? `已从传音领取 ${got} 件物品。` : "背包空间不足，先整理或腾出格子再领取。", got ? "good" : "sys");
      this.after(); this.openMailbox();
    },
    openMailbox() {
      // 在线时服务端是权威：本地只过滤显示已过期项，不直接改本地存档（服务端在领取和每 10 秒结算时清掉）；单机时直接清掉
      const online = typeof API !== "undefined" && API._socket;
      if (!online) this.mailboxPrune();
      const list = this.mailboxList().filter(x => x && this.now() < this.mailboxDue(x)), now = this.now();
      const rows = list.map(x => {
        const left = Math.max(0, this.mailboxDue(x) - now), days = Math.floor(left / 86400000), hours = Math.floor(left % 86400000 / 3600000);
        return `<div class="line"><div>${DATA.li(this.itemIcon(x.it))}${this.itemName(x.it)}${x.it.n > 1 ? ` ×${U.fmt(x.it.n)}` : ""}<small>　${x.src ? x.src + " · " : ""}剩余 ${days} 天 ${hours} 小时</small></div><button class="sm primary" onclick="G.mailboxClaim('${x.id}')">领取</button></div>`;
      }).join("");
      this.modal(`<h2>传音</h2>
        ${rows}
        <div class="btns">${list.length ? `<button class="primary" onclick="G.mailboxClaimAll()">全部领取</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    removeAt(i, n = 1) {
      const it = this.s.bag[i]; if (!it) return;
      // 中央关口：小数向下取整，负数/0 直接不扣（原来负数会让 it.n -= 负数 = 反向加物品），
      // 超过格子数量时只扣整格，不按请求数算账（算账在调用方先 clamp，见 sellItem）。
      // 固定格子：整格扣完后该格留空（null），不 splice，后面的物品不往前挪。
      n = Math.floor(+n); if (!(n >= 1)) return;
      if (it.n !== undefined && it.n > n) it.n -= n; else this.s.bag[i] = null;
    },
    itemName(it) {
      if (it.t === "cur") return it.k === "merit" ? "功德" : "灵石";   // 传音里的灵石、功德
      if (it.t === "pill") return `${DATA.realms[it.g]}·${DATA.pills[it.type].name}`;
      if (it.t === "dan") return DATA.danName(it.type, it.g, it.sg);
      if (it.t === "ql") return DATA.qlName(it.sect);   // v213 宗主清灵丹
      if (it.t === "ylb") return DATA.ybName(it.k, it.g);   // 游历宝物（data/youli.js）
      if (it.t === "ysd") return this.ysDanName(it.ys, it.k);   // 隐世宗门炼丹房丹药
      if (it.t === "stp") return this.ysFragName(it.id);
      if (it.t === "cxp") return DATA.cxpName(it.k);
      if (it.t === "xd") { const x = this.xdItem(it); return this.xdName(x.k, x.src, x.id, x.v); }   // 隐世宗门心得   // 炼丹 / 炼器经验（宗门秘境）   // 神通碎片（隐世宗门秘境）
      if (it.t === "mat") return DATA.matFull(it.kind, it.g);
      if (it.t === "fu") return DATA.furnaceName(it.kind, it.g);
      if (it.t === "bp") return DATA.furnaceName(it.kind, it.g) + "图纸";
      if (it.t === "zfbp") return this.zfBpName(it.kind, it.g);
      if (it.t === "cu") return it.name;
      if (it.t === "book") return CFG.start.book.name;
      if (it.t === "gfb") { const g = DATA.skillInfo(it.id, 1); return g ? `《${g.name}》` : "秘诀"; }   // 试炼塔秘诀
      if (it.t === "ss") return DATA.stoneName(it.g);
      if (it.t === "hx") return DATA.HX;
      if (it.t === "seed") return DATA.seedName(it.g);
      if (it.t === "lg") return (DATA.lgDef(it.k) || {}).name || "灵果";
      if (it.t === "sm") return DATA.smName(it.k, it.ft, it.tier);
      if (it.t === "rbp") return DATA.ringBpName(it.g, it.r);
      if (it.t === "bmbp") return this.bmCfg().MIFA;
      if (it.t === "dfb") return DATA.danName(it.type, it.g) + "丹方";
      if (it.e.attrs && it.e.slot === "fabao" && it.e.bm) return `本命·${DATA.elById[it.e.el].name}·${DATA.fabaoName(it.e.ft, it.e.g, it.e.name)}`;   // 本命法宝没有星级
      if (it.e.attrs && it.e.slot === "fabao") return `${DATA.XING[it.e.g]}·${DATA.elById[it.e.el].name}·${DATA.fabaoName(it.e.ft, it.e.g, it.e.name)}${it.e.enh ? ` +${it.e.enh}` : ""}`;
      if (it.e.attrs) return `${DATA.XING[it.e.g]}·${it.e.name}${it.e.enh ? ` +${it.e.enh}` : ""}`;
      return `${DATA.realms[it.e.g]}·${it.e.name}`;
    },
    // 炼制物品出售价：洞府炼丹房、炼器室炼出的物品 = 所耗全部材料的出售价合计 × CRAFT_SELL（1.1），向下取整
    //   按物品现在的星级、精炼次数推算（掉落、礼包、旧存档同样算）；失败损耗、图谱 / 图纸、强化、洗练不算
    matUnit(m) {
      if (m.kind === "herb" || m.kind === "ore") return DATA.matPrice(m.kind, m.g) || 0;
      if (m.kind === "sm") { const v = (CFG.mijing.items[m.g] || {}).sell || 0; return Array.isArray(v) ? v[Math.max(0, m.ft || 0)] || 0 : v; }
      if (m.kind === "cu") { const d = this.cuDef(m.g); return d ? d.sell || 0 : 0; }
      return 0;
    },
    matsValue(list) { return (list || []).reduce((a, m) => a + this.matUnit(m) * (m.n || 0), 0); },
    smVal(k, n, ft) { return n > 0 ? this.matUnit({ kind: "sm", g: k, ft, n }) * n : 0; },
    craftValue(it) {
      const F = CFG.forge, Y = F.YAOSHI || {};
      if (it.t === "eq" && it.e.bm) return -1;   // 本命法宝不按这个算
      if (it.t === "eq") {
        const e = it.e, g = Math.max(0, e.g || 0), fb = e.slot === "fabao", ring = e.slot === "ring";
        let v = 0;
        for (let k = 0; k <= g; k++) {
          if (ring) {
            const sp = DATA.ringSp(e.r);
            if (k === 0 && !sp) continue;   // 破军 / 磐石 / 长生 一星不能炼制
            v += this.matsValue(DATA.ringMatsFor(e.r, k)) + this.smVal("ys", (Y.ring || [])[k] || 0);
            if (sp) v += this.smVal(sp.sm, DATA.ringSmNeed(k));
          } else v += this.matsValue(DATA.forgeEqMats(k)) + this.smVal("ys", (Y[fb ? "fabao" : "equip"] || [])[k] || 0, fb ? DATA.elIdx(e.el) : 0);
        }
        const rj = DATA.rjCount(e);
        for (let i = 0; i < rj; i++) {   // 第 1~10 次按 1 星材料，第 11~20 次按 2 星……
          const t = Math.min(g, Math.floor(i / 10));
          v += this.matsValue(ring ? DATA.ringMats(t) : DATA.forgeEqMats(t));
          if (fb) v += this.smVal("ys", (Y.fabao || [])[t] || 0, DATA.elIdx(e.el));
        }
        return v;
      }
      if (it.t === "ss") return this.matsValue(DATA.stoneMats(it.g)) + this.smVal("kj", (F.stone.special || [])[it.g] || 0);
      if (it.t === "fu") return this.matsValue(DATA.furnaceMats(it.kind, it.g));
      if (it.t === "dan") return DATA.recipes[it.type] ? this.matsValue(DATA.danRecipe(it.type, it.g)) : -1;
      if (it.t === "pill") { const g = it.g - DATA.pillGrade(it.type, 0); return DATA.isSpeedRecipe(it.type) && g >= 0 && (DATA.recipes[it.type].herbs || [])[g] ? this.matsValue(DATA.danRecipe(it.type, g)) : -1; }
      if (it.t === "sm") { for (const t in DATA.recipes) if (DATA.recipeItem(t) === it.k) return this.matsValue(DATA.danRecipe(t, 0)); }
      return -1;   // 不是炼制物品
    },
    sellPrice(it) {
      if (it.t === "seed") return DATA.seedSell(it.g);
      if (it.t === "lg") return DATA.LG().SELL ?? 100;   // 灵果（config/garden.js LINGGUO.SELL）   // 种子 = 药材出售价 × config/garden.js SEED_SELL_MUL
      if (it.t === "eq" && !it.e.attrs) return 0;
      const cv = this.craftValue(it);
      if (cv >= 0) return Math.floor(cv * (CFG.price.CRAFT_SELL || 1.1));
      if (it.t === "pill") return Math.floor(DATA.pillPrice(it.type, it.g) * CFG.price.PILL_SELL);
      if (it.t === "dan") return DATA.danPrice(it.type, it.g);
      if (it.t === "mat") return DATA.matPrice(it.kind, it.g);
      if (it.t === "cu") { const d = this.cuDef(it.name); return d ? d.sell || 0 : 0; }
      if (it.t === "ss" || it.t === "book" || it.t === "gfb" || it.t === "ql" || it.t === "dfb" || it.t === "ylb" || it.t === "stp" || it.t === "ysd" || it.t === "cxp" || it.t === "xd") return 0;
      if (it.t === "hx") return CFG.forge.reset.SELL || 0;
      if (it.t === "sm") { const v = (CFG.mijing.items[it.k] || {}).sell || 0; return Array.isArray(v) ? v[it.ft || 0] || 0 : v; }
      if (it.t === "rbp") return CFG.forge.ring.bpSell[it.g] || 0;
      if (it.t === "eq" && it.e.attrs) return (it.e.slot === "ring" ? CFG.forge.ring.sell : CFG.forge.equip.sell)[it.e.g] || 0;
      if (it.t === "fu" || it.t === "bp") return Math.floor(DATA.blueprintCost(it.kind, it.g) * (it.t === "fu" ? 2 : 1));
      return 0;
    },

    setBagTab(t) { this.bagTab = t; this.render(); },
    // 背包里人物两侧圆钮打开的单独页面：shentong 神通秘术 / benming 本命法宝
    setBagPage(k) { if (k === "benming" && !this.s.bmLearn) return this.log(`需要先学习${this.bmCfg().MIFA}。`, "sys"); this.bagPage = k || ""; this.render(); },
    bagPageView() {
      const T = { shentong: "神通秘术", benming: "本命法宝" }, k = this.bagPage, t = T[k] || "";
      if (k === "shentong") return `<div class="mpage bpage"><div class="pghead">${t}</div>${this.stPageView()}<div class="fback"><button onclick="G.setBagPage('')">返回</button></div></div>`;
      if (k === "benming" && this.s.bmLearn) return `<div class="mpage bpage">${this.bmPageView(t)}<div class="fback"><button onclick="G.setBagPage('')">返回</button></div></div>`;
      return `<div class="mpage bpage"><div class="pghead">${t}</div>
        <div class="card bp-hero"><img src="img/orb_${k}.webp?v=3" alt=""><b>${t}</b><p class="desc">${t}即将开放，敬请期待。</p></div>
        <div class="fback"><button onclick="G.setBagPage('')">返回</button></div></div>`;
    },
    /* ---------- 本命法宝（config/benming.js）----------
     * 仙界第 1 图功德司学「本命法宝炼制秘法」（s.bmLearn）后，在本命法宝页面选一件已有的法宝（背包或法宝栏）
     * + 仙界矿石（ORES 各 ORE_N 个），炼制 MIN 分钟（s.bmJob），必定成功；炼成后存在 s.bm = { e, t }，
     * 自动生效：不占法宝栏、不用装备，去掉星级和附加属性，换成本命专属流光图（img/icons/bm形状.webp），盾不能炼。只能有一件，炼成后不能更换。 */
    bmCfg() { return Object.assign({ NAME: "本命法宝", MIFA: "本命法宝炼制图纸", MERIT: 300, LEARN_MIN: 5, MIN: 1, WORLD: "xian", MAP: 0, ORES: ["天外陨铁", "玄晶石", "星辰金"], ORE_N: 3000, PCT: 105 }, CFG.forge.benming || {}); },
    bmEq() { const e = this.s.bm && this.s.bm.e; return e && e.attrs ? e : null; },
    // 战斗用的本命法宝信息（名字前加「本命·」）
    bmInfo() { const e = this.bmEq(); if (!e) return null; const f = DATA.fabaoInfo(e); f.name = "本命·" + f.name;
      const T = this.bmCfg().TONGXUAN || {}; if (this.bmFxLv("bmfx5")[0] >= this.bmFxMax()) f.uses = (f.uses || 1) + (T.USES || 0);   // 通玄①满级：额外使用次数
      return f; },
    /* ---------- 本命特效强化（FX_UP；s.bm.fx = { 特效图片名: [①等级, ②等级] }）：破禁 bmfx3、蚀抗 bmfx4、通玄 bmfx5 ---------- */
    bmFxMax() { return (this.bmCfg().FX_UP || {}).MAX || 100; },
    bmFxLv(k) { const b = this.s.bm || {}, F = b.fx || {}; if (Array.isArray(F[k])) return F[k]; if (k === "bmfx5" && Array.isArray(b.tx)) return b.tx; return [0, 0]; },
    bmLerp(L, R) { const M = this.bmFxMax(); return L <= 0 ? 0 : R[0] + (R[1] - R[0]) * (M > 1 ? (Math.min(L, M) - 1) / (M - 1) : 1); },   // 1 级 = R[0]，满级 = R[1]
    // 战斗用的特效数值（world.js battle）
    bmFxVal() { if (!this.bmEq()) return {}; const B = this.bmCfg(), P = B.POJIN || {}, S = B.SHIKANG || {}, T = B.TONGXUAN || {}, Y = B.YINXUE || {}, SY = B.SHIYUAN || {}, sy = this.bmFxLv("bmfx1"), yx = this.bmFxLv("bmfx2"), pj = this.bmFxLv("bmfx3"), sk = this.bmFxLv("bmfx4"), tx = this.bmFxLv("bmfx5");
      return { syOn: sy[0] > 0, syDrain: this.bmLerp(sy[0], Array.isArray(SY.DRAIN) ? SY.DRAIN : [0.15, 15]), syLow: SY.LOW || 15, syStun: this.bmLerp(sy[0], SY.STUN || [1, 100]), syR: SY.STUN_R || 1, yxHeal: this.bmLerp(yx[0], Y.HEAL || [1, 100]), pjDmg: this.bmLerp(pj[0], P.DMG || [1, 100]), pjStun: this.bmLerp(pj[1], P.STUN || [1, 100]), pjR: P.STUN_R || 1,
        skRes: this.bmLerp(sk[0], S.RES || [1, 30]), skR: sk[0] > 0 ? Math.max(1, Math.round(this.bmLerp(sk[1], S.ROUNDS || [1, 20]))) : 0,
        txPct: tx[1] * (T.PCT || 0) }; },
    bmTxPct() { return this.bmFxVal().txPct || 0; },
    bmFxCost(L) { const U2 = this.bmCfg().FX_UP || {}, C = U2.COST || [300, 600], M = this.bmFxMax(); return Math.round(C[0] + (C[1] - C[0]) * (M > 1 ? (L - 1) / (M - 1) : 0)); },   // 升到第 L 级每种精炼石几个
    bmFxUpOK(k) { return ["bmfx1", "bmfx2", "bmfx3", "bmfx4", "bmfx5"].includes(k); },
    bmFxUp(k, m) {
      m = Math.floor(+m); if (!this.bmFxUpOK(k) || !(m >= 0 && m < this.bmFxModes(k).length) || !this.bmEq()) return;
      const s = this.s, lv = this.bmFxLv(k).slice(), M = this.bmFxMax(); if (lv[m] >= M) return this.log("已强化到满级。", "sys");
      const R = this.bmCfg().REF_STONES || [], n = this.bmFxCost(lv[m] + 1);
      if (!this.craftFree()) { const lack = R.filter(x => this.herbCount(x.name) < n); if (lack.length) return this.log(`${lack.map(x => x.name).join("、")}不足，需要各 ${U.fmt(n)} 个。`, "sys");
        R.forEach(x => this.herbTake(x.name, n)); }
      lv[m]++; (s.bm.fx || (s.bm.fx = {}))[k] = lv; if (k === "bmfx5") delete s.bm.tx;
      const f = this.bmFx().find(x => x[0] === k) || [k, ""], mn = this.bmFxModes(k)[m];
      this.log(`${f[1]}（${mn ? mn[0] : ""}）强化到 ${lv[m]} 级。`, "gold");
      this.dirty(); this.after();
    },
    bmTxUp(m) { return this.bmFxUp("bmfx5", m); },
    // 每种特效两种强化：[名字, 说明]
    bmFxModes(k) { const B = this.bmCfg(), M = this.bmFxMax(), V = this.bmFxVal(), lv = this.bmFxLv(k), P = B.POJIN || {}, S = B.SHIKANG || {}, T = B.TONGXUAN || {}, r = R => `${U.fmt(R[0])}% ~ ${U.fmt(R[1])}%`, cur = (L, t) => L > 0 ? `，当前 ${t}` : "";
      if (k === "bmfx1") { const SY = B.SHIYUAN || {}; return [["噬元", `本命法宝命中时，减少对手法力上限的 ${(D => `${+(+D[0]).toFixed(2)}% ~ ${+(+D[1]).toFixed(2)}%`)(Array.isArray(SY.DRAIN) ? SY.DRAIN : [0.15, 15])}${cur(lv[0], +(V.syDrain || 0).toFixed(2) + "%")}；对手法力不足上限 ${SY.LOW || 15}% 时有 ${r(SY.STUN || [1, 100])} 几率禁锢对手 ${SY.STUN_R || 1} 回合，可与破禁的禁锢叠加${cur(lv[0], U.fmt(Math.round(V.syStun * 10) / 10) + "%")}。没强化过不生效。`]]; }
      if (k === "bmfx2") return [["回血", `本命法宝造成伤害后，恢复伤害 ${r((B.YINXUE || {}).HEAL || [1, 100])} 的生命${cur(lv[0], U.fmt(Math.round(V.yxHeal * 10) / 10) + "%")}。`]];
      if (k === "bmfx3") return [["护盾增伤", `对手有护盾时，本命法宝伤害额外增加 ${r(P.DMG || [1, 100])}${cur(lv[0], U.fmt(Math.round(V.pjDmg * 10) / 10) + "%")}。`],
        ["禁锢", `对手没有护盾时，本命法宝命中有 ${r(P.STUN || [1, 100])} 几率禁锢对手 ${P.STUN_R || 1} 回合${cur(lv[1], U.fmt(Math.round(V.pjStun * 10) / 10) + "%")}。`]];
      if (k === "bmfx4") return [["减抗", `本命法宝命中时，对手 6 种抗性减少 ${r(S.RES || [1, 30])}${cur(lv[0], U.fmt(Math.round(V.skRes * 10) / 10) + "%")}。没强化过不生效。`],
        ["持续", `减抗持续 ${U.fmt((S.ROUNDS || [1, 20])[0])} ~ ${U.fmt((S.ROUNDS || [1, 20])[1])} 回合${lv[0] > 0 ? `，当前 ${V.skR} 回合` : ""}。`]];
      if (k === "bmfx5") return [["使用次数", `强化到 ${M} 级，本命法宝每场战斗额外增加 ${T.USES || 1} 次使用次数${lv[0] >= M ? "（已生效）" : ""}。`],
        ["不占回合", `每级 +${T.PCT || 1}% 几率使用本命法宝时不占用回合，当前 ${U.fmt(V.txPct || 0)}%。`]];
      return []; },
    openBmTx() { return this.openBmFxUp("bmfx5"); },
    openBmFxUp(k) {
      const lv = this.bmFxLv(k), M = this.bmFxMax(), R = this.bmCfg().REF_STONES || [], f = this.bmFx().find(x => x[0] === k) || [k, ""];
      const row = (m, [t, d]) => { const L = lv[m], full = L >= M, n = full ? 0 : this.bmFxCost(L + 1), ok = this.craftFree() || R.every(x => this.herbCount(x.name) >= n);
        return `<div class="card"><h3>${t}<small>${L} / ${M} 级</small></h3><p class="desc">${d}</p><div class="line"><div>${full ? "已满级" : `下一级：每种 ${U.fmt(n)} 个`}</div><button onclick="G.bmFxUp('${k}',${m})" ${!full && ok ? "" : "disabled"}>强化</button></div></div>`; };
      this.modal(`<div class="bm-tip"><img src="img/icons/${f[0]}.png?v=${DATA.IMG_V}" alt=""><h2>${f[1]}</h2></div>
        ${this.bmFxModes(k).map((x, m) => row(m, x)).join("")}
        ${R.map(x => `<div class="line bm-fs"><div><img src="${this.bmStoneDef(x.name).img}" alt=""><span class="q${x.q || 0}">${x.name}</span></div><span>拥有 ${U.fmt(this.herbCount(x.name))}</span></div>`).join("")}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    bmMapOK(a) { const B = this.bmCfg(); return (DATA.worldMapIdx[B.WORLD] || [])[B.MAP] === +a; },
    // 已有图纸：学会了 / 背包里有（含学习中）
    bmBpHave() { return this.s.bmLearn ? 1 : this.s.bag.some(it => it && it.t === "bmbp") ? 2 : 0; },
    // 功德司买图纸，进背包；在背包里学习 LEARN_MIN 分钟（炼器学习队列）后才能打开本命法宝页面
    buyBmBp(a) {
      const s = this.s, B = this.bmCfg();
      if (!this.bmMapOK(a)) return;
      const h = this.bmBpHave(); if (h) return this.log(h === 1 ? "已经学会了。" : `背包里已有${B.MIFA}。`, "sys");
      if ((s.merit || 0) < B.MERIT) return this.log("功德不足。", "sys");
      s.merit -= B.MERIT; const where = this.bagPutOrMail({ t: "bmbp" });
      this.log(`购买了${B.MIFA}，已放入${where === "mail" ? "传音" : "背包"}，学习后可打开${B.NAME}页面。`, "gold"); this.after();
    },
    learnBmBp(i) {
      const s = this.s, B = this.bmCfg(), it = s.bag[i]; if (!it || it.t !== "bmbp" || it.lq) return;
      if (s.bmLearn) return this.log("已经学会了。", "sys");
      if (!this.lqCan("forge", "bmbp")) return;
      it.lq = 1; this.lqAdd("forge", { key: "bmbp", k: "bmbp", ms: (B.LEARN_MIN || 0) * 60000 }); this.closeModal(); this.after();
    },
    bmMifaCard(a) {
      if (!this.bmMapOK(a)) return "";
      const s = this.s, B = this.bmCfg(), h = this.bmBpHave();
      const r = this.bmMifaRow(a);
      return r[0] ? "" : `<div class="card"><h3>图纸</h3>${r[1]}</div>`;   // 已学会的放页面最后「已学会」卡（jieGfView）
    },
    bmMifaRow(a) {   // [已学会?, 一行 html]
      if (!this.bmMapOK(a)) return [0, ""];
      const s = this.s, B = this.bmCfg(), h = this.bmBpHave();
      return [h === 1, `<div class="line"><div>${DATA.li(DATA.iconImg("bp"))}${B.MIFA}<small>${U.fmt(B.MERIT)} 功德</small></div>
        ${h ? `<button class="sm" disabled>${h === 1 ? "已学会" : "已购买"}</button>` : `<button class="sm" onclick="G.buyBmBp(${a})" ${(s.merit || 0) < B.MERIT ? "disabled" : ""}>购买</button>`}</div>`];
    },
    // 可选的法宝：src = "bag"（背包序号）/ "fb"（法宝栏序号）
    bmPick(src, i) { const s = this.s; i = Math.floor(+i);
      if (src === "bag") { const it = s.bag[i]; return it && it.t === "eq" && it.e && it.e.slot === "fabao" && !it.lq && !this.bmShield(it.e) && this.bmReqOK(it.e) ? it.e : null; }
      if (src === "fb") { const e = (s.fabao || [])[i]; return e && e.slot === "fabao" && !this.bmShield(e) && this.bmReqOK(e) ? e : null; }
      return null; },
    // 炼本命的法宝要求：REQ_STAR 星及以上、精炼 REQ_RJ 次及以上
    bmReqOK(e) { const B = this.bmCfg(); return (e.g || 0) + 1 >= (B.REQ_STAR || 0) && DATA.rjCount(e) >= (B.REQ_RJ || 0); },
    bmReqTxt() { const B = this.bmCfg(); return `${DATA.XING[(B.REQ_STAR || 1) - 1] || ""}及以上、精炼 ${B.REQ_RJ || 0} 次及以上`; },
    bmMats() { const B = this.bmCfg(); return (B.ORES || []).map(n => DATA.matByName[n]).filter(Boolean).map(m => ({ kind: m.kind, g: m.g, n: B.ORE_N || 0 })); },
    bmStart(src, i) {
      const s = this.s, B = this.bmCfg();
      if (!s.bmLearn) return this.log(`需要先学习${B.MIFA}。`, "sys");
      if (this.bmEq() || s.bmJob) return this.log(`已经有${B.NAME}了。`, "sys");
      const e = this.bmPick(src, i); if (!e) return this.log(`法宝需要${this.bmReqTxt()}。`, "sys");
      const mats = this.bmMats(); if (!this.hasMats(mats)) return this.log("矿石不足。", "sys");
      if (src === "bag") s.bag[Math.floor(+i)] = null; else s.fabao[Math.floor(+i)] = null;
      const paid = this.craftFree() ? [] : mats; paid.forEach(m => this.takeMat(m.kind, m.g, m.n));   // 测试模式不扣矿石
      s.bmJob = { e, mats: paid, end: this.now() + B.MIN * 60000 };   // mats：取消时按实际扣的退
      this.log(`开始把${this.itemName({ t: "eq", e })}炼成${B.NAME}，${B.MIN} 分钟后炼成。`, "good"); this.dirty(); this.after();
    },
    // 取消炼制：法宝和矿石原样退回
    bmCancel() {
      const s = this.s, j = s.bmJob; if (!j) return;
      // 背包满时法宝和矿石进传音，不再以“至少 1 格”校验后丢掉后面的矿石；日志说退回即包含传音
      this.addEquip(j.e); this.giveBack(j.mats || this.bmMats()); s.bmJob = null;
      this.log(`取消炼制${this.bmCfg().NAME}，法宝和矿石已退回${this.bagFull() ? "（背包满的部分在传音）" : ""}。`, "sys"); this.dirty(); this.after();
    },
    // 本命法宝没有附加属性和专属属性（config/benming.js）
    //   只留一条主属性「伤害」（数值固定 PCT%，见 data/forge.js 的 DATA.attrVal），去掉附加和专属属性；c 保留只用来算法力消耗
    bmFix(e) { if (!e || !e.bm || !e.attrs) return; const m = e.attrs.find(a => a.k === "pct") || e.attrs.find(a => a.m === 1) || { c: 0 };
      if (e.attrs.length !== 1 || e.attrs[0].k !== "pct" || e.attrs[0].m !== 1) e.attrs = [{ k: "pct", m: 1, c: m.c || 0 }]; },
    // 本命法宝炼成后人物额外属性（config/benming.js 的 BONUS）
    //   炼成时每项在 BONUS_MIN~BONUS_MAX 随机一次，存在 s.bm.b（res 是 { 属性id: 值 }）
    bmBonus() { return this.bmEq() && this.s.bm.b || {}; },
    bmRoll() {
      const B = this.bmCfg(), lo = B.BONUS_MIN || 0, hi = Math.max(lo, B.BONUS_MAX || 0), r = () => lo + Math.floor(Math.random() * (hi - lo + 1)), b = {};
      for (const k of (Array.isArray(B.BONUS) ? B.BONUS : [])) b[k] = k === "res" ? Object.fromEntries(DATA.elements.map(e => [e.id, r()])) : r();
      return b;
    },
    bmFxTip(i) { const f = this.bmFx()[i]; if (!f) return; if (this.bmFxUpOK(f[0])) return this.openBmFxUp(f[0]);
      this.modal(`<div class="bm-tip"><img src="img/icons/${f[0]}.png?v=${DATA.IMG_V}" alt=""><h2>${f[1]}</h2><p>${f[2]}</p></div><div class="btns"><button disabled>强化</button><button onclick="G.closeModal()">关闭</button></div>`); },
    /* ---------- 本命熔炼石（config/benming.js 的 STONES）：叠放在背包，按自定义物品存 { t: "cu", name, n } ---------- */
    bmStones() { return this.bmCfg().STONES || []; },
    bmStoneDef(name) { const B = this.bmCfg(), S = this.bmStones(), i = S.findIndex(x => x.name === name);
      if (i >= 0) { const x = S[i]; return { type: "misc", q: x.q || 0, ore: 1, sell: x.sell || 0, img: `img/icons/bms${i}.png?v=${DATA.IMG_V}`,
        desc: `本命法宝熔炼材料。熔炼一颗随机 ${B.FUSE_PER || 2} 种属性，四界秘境首领掉落。` }; }
      const R = B.REF_STONES || [], j = R.findIndex(x => x.name === name); if (j < 0) return null; const y = R[j];
      return { type: "misc", q: y.q || 0, ore: 1, sell: y.sell || 0, img: `img/icons/bmr${j}.png?v=${DATA.IMG_V}`, desc: "精炼本命法宝、升级本命特效的材料。四界秘境首领掉落。" }; },
    // 灵地首领掉落：熔炼石（STONES / DROP_LD / DROP_N / WEIGHT）+ 精炼石（REF_ 开头），每组合计 N 个按权重随机；[] = 12 处全掉；不吃地图收益倍率
    bmStoneDrop(loot, i) {
      const B = this.bmCfg(), L = (CFG.lingdi || {}).list || [], out = []; if (!L[i]) return "";
      for (const [S, D, nn, WT] of [[this.bmStones(), B.DROP_LD, B.DROP_N, B.WEIGHT], [B.REF_STONES || [], B.REF_DROP_LD, B.REF_DROP_N, B.REF_WEIGHT]]) {
        if (!S.length || !nn || ((D || []).length && !D.includes(i))) continue;
        const n = U.rand(nn[0], nn[1]), W = S.map((x, j) => Math.max(0, (WT || [])[j] ?? 1)), tot = W.reduce((a, b) => a + b, 0), cnt = {};
        if (tot <= 0) continue;
        for (let k = 0; k < n; k++) { let r = Math.random() * tot, j = 0; while (j < W.length - 1 && (r -= W[j]) >= 0) j++; cnt[S[j].name] = (cnt[S[j].name] || 0) + 1; }
        loot.cu = loot.cu || {}; for (const nm in cnt) { loot.cu[nm] = (loot.cu[nm] || 0) + cnt[nm]; out.push(`${nm}×${cnt[nm]}`); }
      }
      return out.join("、");
    },
    // 熔炼属性池：BONUS 里的项，res 拆成 6 种抗性
    bmFusePool() { const B = this.bmCfg(); return (Array.isArray(B.BONUS) ? B.BONUS : []).flatMap(k => k === "res" ? DATA.elements.map(e => "res." + e.id) : [k]); },
    bmAttrName(k) { if (k.startsWith("res.")) { const e = DATA.elById[k.slice(4)]; return (e ? e.name : "") + "抗性"; } return { hp: "生命", atk: "攻击", def: "防御", hit: "命中", speed: "速度", dodge: "闪避" }[k] || k; },
    // 熔炼：消耗 n 颗第 j 种石头，每颗随机 FUSE_PER 种不同属性加到 s.bm.b
    bmFuse(j, n) {
      const x = this.bmStones()[Math.floor(+j)]; n = Math.max(1, Math.floor(+n) || 1);
      if (!this.bmEq() || !x) return;
      const have = this.herbCount(x.name); if (have <= 0) return this.log(`没有${x.name}。`, "sys");
      return this.bmFuseRun([[x, Math.min(n, have)]]);
    },
    // 一键熔炼：背包里所有熔炼石全部熔炼
    bmFuseAll() {
      if (!this.bmEq()) return;
      const L = this.bmStones().map(x => [x, this.herbCount(x.name)]).filter(([, n]) => n > 0);
      if (!L.length) return this.log("没有熔炼石。", "sys");
      return this.bmFuseRun(L);
    },
    // 熔炼 [[石头, 数量]]：每颗随机 FUSE_PER 种不同属性加到 s.bm.b；返回 { n, sum } 给前端弹窗
    bmFuseRun(L) {
      const s = this.s, B = this.bmCfg(), b = s.bm.b || (s.bm.b = {}), pool = this.bmFusePool(), per = Math.min(pool.length, B.FUSE_PER || 2), sum = {};
      let tot = 0;
      for (const [x, n] of L) {
        for (let k = 0; k < n; k++) {
          const p = pool.slice();
          for (let m = 0; m < per; m++) { const key = p.splice(Math.floor(Math.random() * p.length), 1)[0], v = U.rand(x.min, x.max);
            if (key.startsWith("res.")) { const id = key.slice(4); b.res = b.res || {}; b.res[id] = (b.res[id] || 0) + v; } else b[key] = (b[key] || 0) + v;
            sum[key] = (sum[key] || 0) + v; }
        }
        this.herbTake(x.name, n); tot += n;
      }
      s.bm.fn = (s.bm.fn || 0) + tot;
      const keys = pool.filter(k => sum[k]);
      this.log(`熔炼${L.map(([x, n]) => `${x.name}×${n}`).join("、")}：${keys.map(k => `${this.bmAttrName(k)} +${U.fmt(sum[k])}`).join("、")}。`, "gold");
      this.dirty(); this.after();
      return { n: tot, sum: keys.map(k => [k, sum[k]]) };
    },
    // 熔炼后弹窗：列出增加的属性，确定后回到熔炼窗口
    bmFuseDone(r) {
      if (!r || !Array.isArray(r.sum)) return;
      this.modal(`<h2>熔炼完成</h2><p class="desc">共熔炼 ${U.fmt(r.n)} 颗，增加属性：</p><div class="bm-attr">${r.sum.map(([k, v]) => `<div><span>${this.bmAttrName(k)}</span><b>+${U.fmt(v)}</b></div>`).join("")}</div><div class="btns"><button onclick="G.openBmFuse()">确定</button></div>`);
    },
    openBmFuse() {
      const S = this.bmStones(); let all = 0;
      const rows = S.map(x => { const n = this.herbCount(x.name); all += n;
        return `<div class="line bm-fs"><div><img src="${this.bmStoneDef(x.name).img}" alt=""><span class="q${x.q || 0}">${x.name}</span></div><span>拥有 ${U.fmt(n)}</span></div>`; }).join("");
      this.modal(`<h2>熔炼</h2><p class="desc">每颗熔炼石随机增加 ${this.bmCfg().FUSE_PER || 2} 种属性，熔炼没有上限，已熔炼 ${U.fmt((this.s.bm || {}).fn || 0)} 颗。</p>${rows}<div class="btns"><button onclick="G.bmFuseAll()" ${all ? "" : "disabled"}>熔炼</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 本命精炼（RF_*）：每次 +RF_PCT% 攻击（e.bmRf），最多 RF_MAX 次，消耗 3 种精炼石，必定成功、立即生效
    bmRfCost(L) { const B = this.bmCfg(), C = B.RF_COST || [300, 600], M = B.RF_MAX || 300; return Math.round(C[0] + (C[1] - C[0]) * (M > 1 ? (L - 1) / (M - 1) : 0)); },
    bmRefine() {
      const e = this.bmEq(); if (!e) return; const B = this.bmCfg(), M = B.RF_MAX || 300, n0 = e.bmRf || 0;
      if (n0 >= M) return this.log("已精炼到满级。", "sys");
      const R = B.REF_STONES || [], n = this.bmRfCost(n0 + 1);
      if (!this.craftFree()) { const lack = R.filter(x => this.herbCount(x.name) < n); if (lack.length) return this.log(`${lack.map(x => x.name).join("、")}不足，需要各 ${U.fmt(n)} 个。`, "sys");
        R.forEach(x => this.herbTake(x.name, n)); }
      e.bmRf = n0 + 1; this.log(`本命法宝精炼到 ${e.bmRf} 次：伤害 攻击×${U.fmt(DATA.bmPct(e))}%。`, "gold"); this.dirty(); this.after();
    },
    openBmRefine() {
      const e = this.bmEq(); if (!e) return; const B = this.bmCfg(), R = B.REF_STONES || [], M = B.RF_MAX || 300, n0 = e.bmRf || 0, full = n0 >= M, n = full ? 0 : this.bmRfCost(n0 + 1),
        ok = !full && (this.craftFree() || R.every(x => this.herbCount(x.name) >= n));
      const rows = R.map(x => `<div class="line bm-fs"><div><img src="${this.bmStoneDef(x.name).img}" alt=""><span class="q${x.q || 0}">${x.name}</span></div><span>拥有 ${U.fmt(this.herbCount(x.name))}</span></div>`).join("");
      this.modal(`<h2>精炼</h2><p class="desc">已精炼 ${n0} / ${M} 次，伤害 攻击×${U.fmt(DATA.bmPct(e))}%${full ? "" : ` → ${U.fmt(DATA.bmPct(Object.assign({}, e, { bmRf: n0 + 1 })))}%`}。${full ? "" : `下一次每种 ${U.fmt(n)} 个。`}</p>${rows}<div class="btns"><button onclick="G.bmRefine()" ${ok ? "" : "disabled"}>${full ? "已满级" : "精炼"}</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    bmShield(e) { return !!(DATA.fabaoTypes[e.ft] || {}).shield; },   // 盾不能炼成本命法宝
    // 本命法宝的 5 种特效（img/icons/bmfx1~5.png）；数值、解锁方式待定，先只显示
    bmFx() { return this.bmCfg().FX || []; },
    bmTick() {
      const s = this.s, j = s.bmJob; if (s.bm && s.bm.e) { this.bmFix(s.bm.e); if (!s.bm.b || typeof s.bm.b.res === "number") s.bm.b = this.bmRoll(); }   // 老存档补随机属性
      if (!j || this.now() < j.end) return;
      j.e.bm = true; s.bm = { e: j.e, t: j.end, b: this.bmRoll() }; s.bmJob = null;
      this.bmFix(s.bm.e);
      this.log(`${this.bmCfg().NAME}炼成：${this.itemName({ t: "eq", e: s.bm.e })}，已自动生效。`, "gold"); this.dirty();
    },
    bmPageView(ttl = "") {   // 有法宝时标题放在框框左上角（不占一行，下面的返回按钮就不挡属性）
      const s = this.s, B = this.bmCfg(), e = this.bmEq();
      const art = x => { const src = DATA.eqIcon(x), abs = typeof location !== "undefined" ? new URL(src, location.href).href : src; return `<div class="bm-art" style="--m:url('${abs}')"><img src="${src}" alt=""></div>`; };
      const hero = (x, t, d) => `<div class="card bp-hero bm-hero">${ttl ? `<span class="bm-ttl">${ttl}</span>` : ""}${art(x)}<b class="${x.bm ? "" : "q" + x.q}${DATA.fbElCls(x)}">${t}</b>${d}</div>`;   // 已炼成的本命不带原法宝颜色（在炼的 j.e 还没变本命，照旧显示原颜色）
      if (e) { const b = this.bmBonus(), L = [["hp", "生命"], ["atk", "攻击"], ["def", "防御"], ["hit", "命中"], ["speed", "速度"], ["dodge", "闪避"]].filter(([k]) => b[k]);
        return hero(e, this.itemName({ t: "eq", e }), `<p>${this.equipDesc(e)}</p>
          <div class="bm-btns"><button class="bm-btn" onclick="G.openBmFuse()"><i>熔</i>熔炼</button><button class="bm-btn" onclick="G.openBmRefine()"><i>精</i>精炼</button><button class="bm-btn" onclick="G.openEnhance('bm')"><i>强</i>强化</button></div>`) +
          `<div class="card"><div class="bm-fx">${this.bmFx().map(([k, n], i) => `<button class="bm-fx-i" onclick="G.bmFxTip(${i})"><img src="img/icons/${k}.png?v=${DATA.IMG_V}" alt="${n}"><span>${n}</span></button>`).join("")}</div>
          <div class="bm-attr">${L.map(([k, n]) => `<div><span>${n}</span><b>+${U.fmt(b[k])}</b></div>`).join("")}${b.res ? DATA.elements.map(x => `<div><span>${x.name}抗性</span><b>+${U.fmt(b.res[x.id] || 0)}</b></div>`).join("") : ""}</div></div>`; }
      if (s.bmJob) { const j = s.bmJob, left = Math.max(0, j.end - this.now());
        return hero(j.e, this.itemName({ t: "eq", e: j.e }), `<p class="desc">正在炼成${B.NAME}，还需 ${U.dur(left / 1000)}。</p><div class="btns"><button onclick="G.bmCancel()">取消炼制</button></div>`); }
      return (ttl ? `<div class="pghead">${ttl}</div>` : "") + this.bmPickView();
    },
    bmPickView() {
      const s = this.s, B = this.bmCfg();
      const list = [];
      (s.fabao || []).forEach((x, i) => { if (x && x.slot === "fabao" && !this.bmShield(x)) list.push(["fb", i, x, "法宝栏"]); });
      s.bag.forEach((it, i) => { if (it && it.t === "eq" && it.e && it.e.slot === "fabao" && !it.lq && !this.bmShield(it.e)) list.push(["bag", i, it.e, "背包"]); });
      const ok = this.hasMats(this.bmMats());
      const rows = list.map(([src, i, x, w]) => { const rq = this.bmReqOK(x);
        return `<div class="line"><div>${DATA.eqTierIco(DATA.eqIcon(x), x.g)}<span class="q${x.q}">${this.itemName({ t: "eq", e: x })}</span><span class="tag">${w}</span><small>${DATA.rjName(x)}</small></div>
          <button class="sm" onclick="G.bmStart('${src}',${i})" ${ok && rq ? "" : "disabled"}>${rq ? "炼制" : "未达要求"}</button></div>`; }).join("");
      return `<div class="card"><h3>炼制${B.NAME}</h3>
        <p class="desc">选一件${this.bmReqTxt()}的法宝，加上 ${this.matsText(this.bmMats())}。</p>
        ${rows || `<p class="desc">没有可以炼成本命的法宝（盾除外），先去炼器室炼一件。</p>`}</div>`;
    },
    // 物品图片（没有就返回 ""）
    itemIcon(it) {
      switch (it.t) {
        case "eq": return DATA.eqIcon(it.e);
        case "mat": return DATA.matImg(it.kind, it.g);
        case "seed": return DATA.seedImg(it.g);
        case "lg": return DATA.lgImg(it.k);
        case "pill": return DATA.pillIcon(it.type);
        case "dan": return DATA.danIcon(it.type);
        case "ql": return DATA.iconImg("dan_ql");
        case "ylb": return DATA.ybIcon(it.k);
        case "stp": return DATA.iconImg("st_frag");
        case "cxp": return DATA.cxpIcon(it.k);
        case "xd": return DATA.iconImg("xd_" + (it.k === "qi" || it.k === "jl" ? it.k : "dan"));
        case "ysd": return `img/ysdan/${it.k}.webp`;
        case "fu": return DATA.furnaceIcon(it.kind);
        case "ss": return DATA.iconImg("ss");
        case "hx": return DATA.iconImg("hx");
        case "sm": return DATA.smIcon(it.k, it.ft);
        case "book": case "gfb": return DATA.iconImg("mifa");
        case "bp": case "rbp": case "bmbp": case "zfbp": return DATA.iconImg("bp");
        case "dfb": return DATA.danIcon(it.type);
        case "cu": return DATA.cuIcon(this.cuDef(it.name));
        case "cur": return DATA.iconImg(it.k === "merit" ? "merit" : "stone");
      }
      return "";
    },
    setBagFilter(k) { this.bagFilter = k; this.bagSell = false; this.render(); },
    // 出售页点「出售」：弹窗选数量（1 / 100 / 1000 / 全部）
    openSellPick(i) {
      const it = this.s.bag[i]; if (!it || it.lq || this.isLocked(it)) return;
      const p = this.sellPrice(it), n = it.n || 1;
      const b = (k, t) => `<button onclick="G.sellItem(${i},${k})" ${n >= k ? "" : "disabled"}>${t}<br><small>${U.fmt(p * k)} 灵石</small></button>`;
      this.modal(`<h2>出售 ${this.itemName(it)}</h2><p>持有 ${U.fmt(n)} 个，单价 ${U.fmt(p)} 灵石。</p>
        <div class="btns">${b(1, "出售1个")}${b(100, "出售100个")}${b(1000, "出售1000个")}<button class="primary" onclick="G.sellItem(${i},${n})">全部出售<br><small>${U.fmt(p * n)} 灵石</small></button></div>
        <div class="btns"><button onclick="G.closeModal()">取消</button></div>`);
    },
    openSellPage() { this.bagSell = true; this.render(); },
    closeSellPage() { this.bagSell = false; this.render(); },
    // v26：出售页（按上面的分类筛选），只有这里能卖东西
    sellPageView(match) {
      const s = this.s, flt = this.bagFilter || "all";
      const rows = s.bag.map((it, i) => [it, i]).filter(([it]) => it && match(it) && !it.lq && !this.isLocked(it)).map(([it, i]) => {
        const p = this.sellPrice(it), n = it.n || 1, q = it.t === "eq" ? it.e.q : it.t === "cu" ? ((this.cuDef(it.name) || {}).q || 0) : 0;
        const src = this.itemIcon(it), img = src ? `<img src="${src}" alt="" style="width:28px;height:28px;vertical-align:middle;margin-right:4px">` : "";
        return `<div class="line"><div>${img}<span class="q${q}">${this.itemName(it)}</span>${n > 1 ? ` ×${U.fmt(n)}` : ""}<small>单价 ${U.fmt(p)} 灵石</small></div>
          <div><button class="sm" onclick="G.openSellPick(${i})" ${p > 0 ? "" : "disabled"}>出售</button></div></div>`;
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
      return `<button class="primary" onclick="${on}">${this.s[this.lqSlot(ch)] ? "排队学习" : "学习"}（${U.dur(ms / 1000)}）</button>`;   // 先关框会把学习失败（队列满 / 灵识不够 / 已学会）也关掉；成功时各 learn 函数自己关框
    },
    /* ---------- 弹窗：点储物格 ---------- */
    openItem(i) {
      const it = this.s.bag[i]; if (!it) return;
      const sell = "";   // v26：背包里不能直接出售，去「出售」页
      const _sell = it.n > 1
        ? `<button onclick="G.sellItem(${i},1)">出售1个（${U.fmt(this.sellPrice(it))}）</button><button onclick="G.sellItem(${i},${it.n})">全部出售</button>`
        : `<button onclick="G.sellItem(${i},1)">出售（${U.fmt(this.sellPrice(it))}）</button>`;
      const cq = it.t === "cu" ? ((this.cuDef(it.name) || {}).q || 0) : it.t === "ysd" ? 5 : it.t === "xd" ? (x => this.xdQ(x.src, x.id, x.v))(this.xdItem(it)) : it.t === "ylb" ? DATA.ybQ(it.g) : 0;
      const big = it.t === "mat" ? "" : this.itemIcon(it);
      let h = this.lockIco("b" + i, this.isLocked(it)) + (big ? (it.t === "dan" || it.t === "ql" ? DATA.danImg(big, it.t === "dan" ? DATA.danCls(it.type, it.g) : DATA.qlCls(it.sect), "big") : (it.t === "eq" ? DATA.fbArt(it.e, big, "item-img" + DATA.eqCls(it.e)) : `<img class="item-img" src="${big}" alt="">`)) : "") + `<h2 class="q${it.t === "eq" ? it.e.q : cq}${it.t === "eq" ? DATA.fbElCls(it.e) : ""}">${this.itemName(it)}${it.n ? " ×" + it.n : ""}${it.t === "eq" && it.e.attrs ? `<br><small>${DATA.rjName(it.e)}</small>` : ""}</h2>`;
      if (it.t === "pill") {
        const ok = this.canUsePill(it.g);
        h += `<p>修炼速度 +${Math.round(DATA.pillPct(it.type, it.g))}%，持续 ${DATA.pills[it.type].dur} 次修炼。<br>只有${DATA.realmLabel(it.g)}可服用。
          ${ok ? "" : "<br><span class='q5'>与你当前境界不符，无法服用。</span>"}</p>
          <div class="btns"><button class="primary" onclick="G.usePill(${i});G.closeModal()" ${ok ? "" : "disabled"}>服用</button>${sell}</div>`;
      } else if (it.t === "dan") {
        if (it.type === "wuzhen") {
          const left = this.studyPillLeft(), on = left > 0;
          h += `<p>功法/法术/秘法修炼时间 -${(CFG.alchemy.recipes.wuzhen || {}).studyPct || 120}%，持续 ${(CFG.alchemy.recipes.wuzhen || {}).studyMin || 360} 分钟。${on ? `<br><span class='q5'>已生效，剩余 ${U.dur(left / 1000)}，再次服用效果增加${(CFG.alchemy.recipes.wuzhen || {}).studyMin || 360}分钟。</span>` : ""}</p>
          <div class="btns"><button class="primary" onclick="G.eatWuzhen(${i})">服用</button>${sell}</div>`;
        } else {
        const left = this.danLeft(it.type, it.g), d = DATA.dans[it.type];
        h += `<p>服用后永久 ${d.label} +${U.num(DATA.danVal(it.type, it.g))}。<br>此阶已服 ${DATA.danLimit(it.type, it.g) - left} / ${DATA.danLimit(it.type, it.g)} 枚。</p>
          <div class="btns"><button class="primary" onclick="G.eatDan(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatDan(${i},${it.n})" ${left > 0 && it.n >= 1 ? "" : "disabled"}>全部服用</button>${sell}</div>`;
        }
      } else if (it.t === "ql") {
        const o = DATA.sectById[it.sect], lim = DATA.qlLimit(it.sect), used = (this.s.qlEaten || {})[it.sect] || 0, left = Math.max(0, lim - used);
        h += `<p>${o ? o.name : ""}宗主专属丹药，服用后永久 ${DATA.qlTxt(it.sect)}。<br>已服 ${used} / ${lim} 颗。</p>
          <div class="btns"><button class="primary" onclick="G.eatQl(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatQl(${i},${it.n})" ${left > 0 && it.n >= 1 ? "" : "disabled"}>全部服用</button>${sell}</div>`;
      } else if (it.t === "ysd") {
        const D = this.ysDanCfg(), used = this.ysDanEatN(it.ys, it.k), left = Math.max(0, D.MAX - used);
        h += `<p>隐世宗门丹药，服用后永久 ${this.ysDanLab(it.k)} +${U.fmt(D.VAL)}。<br>本宗此丹已服 ${used} / ${D.MAX} 颗。</p>
          <div class="btns"><button class="primary" onclick="G.eatYsDan(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatYsDan(${i},${it.n})" ${left > 0 && it.n >= 1 ? "" : "disabled"}>全部服用</button></div>`;
      } else if (it.t === "xd") {
        const x = this.xdItem(it), ch = this.xdCh(x.k), key = this.xdKey(x), sp = (CFG.xinde || {}).SPD ?? 1;
        h += `<p>${x.src === "js" ? "四界坊市" : "隐世宗门"}心得，学习 ${(CFG.xinde || {}).MIN ?? 30} 分钟，${x.k === "jl" ? `学完每 10 秒聚灵永久 +${U.fmt(this.xdJl().GATHER)}` : `学完获得 ${U.fmt(this.xdExp(x.k, x.src, x.id, x.v))} 点${CFG.craftsman[x.k].name}经验，${this.xdLab(x.k)}速度永久 +${sp}%`}。</p>
          ${this.lqCard(ch)}<div class="btns">${this.lqBtn(ch, key, `G.learnXd(${i})`, false)}</div>`;
      } else if (it.t === "cxp") {
        const v = (CFG.yinshi.MJ || {}).CXP_VAL || 10, ck = it.k === "qi" || it.k === "ling" ? it.k : "dan", max = this.craftLv(ck) >= this.craftMax(ck);
        h += `<img class="item-img" src="${DATA.cxpIcon(ck)}" alt=""><p>使用后获得 ${v} 点${CFG.craftsman[ck].name}经验。${max ? "<br>已满阶，无法再获得经验。" : ""}</p>
          <div class="btns"><button class="primary" onclick="G.useCxp(${i},1)" ${max ? "disabled" : ""}>使用</button>
          <button onclick="G.useCxp(${i},${it.n})" ${!max && it.n > 1 ? "" : "disabled"}>全部使用</button></div>`;
      } else if (it.t === "stp") {
        h += `<img class="item-img" src="${DATA.iconImg("st_frag")}" alt=""><p>神通碎片用于修炼精研神通</p>`;
      } else if (it.t === "ylb") {
        const left = this.ybLeft(it.k, it.g);
        h += `<p>游历宝物，服用后永久 ${DATA.ybLabel(it.k)} +${U.num(DATA.ybVal(it.k, it.g))}。<br>此阶已服 ${this.ybUsed(it.k, it.g)} / ${DATA.YB_MAX} 个。</p>
          <div class="btns"><button class="primary" onclick="G.eatYb(${i},1)" ${left > 0 ? "" : "disabled"}>服用</button>
          <button onclick="G.eatYb(${i},${it.n})" ${left > 0 && it.n >= 1 ? "" : "disabled"}>全部服用</button></div>`;
      } else if (it.t === "fu") {
        const own = this.s.furnaces[it.kind].includes(it.g);
        h += `<p>${this.furnaceDesc(it.kind, it.g)}。<br>使用后装进洞府${DATA.isDanFu(it.kind) ? "炼丹房" : "炼器室"}，可随时更换。${own ? "<br><span class='q5'>洞府里已有同阶炉子。</span>" : ""}</p>
          <div class="btns"><button class="primary" onclick="G.installFurnace(${i})" ${own ? "disabled" : ""}>使用</button>${sell}</div>`;
      } else if (it.t === "zfbp") {
        const has = it.g ? this.zfTOpen(it.kind, it.g) : this.zfAOpen(it.kind);
        h += `<p>学习后可在阵法室里布阵：${this.zfBpName(it.kind, it.g).replace("图纸", "")}。${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "forge", `zfbp|${it.kind}|${it.g}`, `G.learnZfBp(${i})`, has, this.zfBpMs(it.g))}</div>`;
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
      } else if (it.t === "lg") {
        const d = DATA.lgDef(it.k) || { k: "", v: 0 }, eat = this.lgEatN(it.k);
        h += `<p>服用后永久 ${DATA.lgLab(d.k)} +${U.fmt(d.v)}，没有上限。已服用 ${U.fmt(eat)} 颗，累计 +${U.fmt(d.v * eat)}。</p>
          <div class="btns"><button class="primary" onclick="G.eatLg(${i},1)">服用</button><button onclick="G.eatLg(${i},${it.n})" ${it.n >= 1 ? "" : "disabled"}>全部服用</button>${sell}</div>`;
      } else if (it.t === "seed") {
        h += `<p>${DATA.cropName(it.g)}的种子。洞府灵药园每种一季（含自动续种）消耗 ${this.plantSeedN ? this.plantSeedN() : 1} 颗。</p><div class="btns">${sell}</div>`;
      } else if (it.t === "sm") {
        h += `<p>${(CFG.mijing.items[it.k] || {}).desc || ""}</p><div class="btns">${sell}</div>`;
      } else if (it.t === "book") {
        const B = CFG.start.book, has = this.hasGongfa(DATA.START_GF);
        h += `<p>秘诀 · 修炼速度每层 +${U.num(B.SPEED)} · 共 ${B.MAX} 层${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns"><button class="primary" onclick="G.learnBook(${i})" ${has ? "disabled" : ""}>学习</button></div>`;
      } else if (it.t === "gfb") {
        const g = DATA.skillInfo(it.id, 1), has = this.hasGongfa(it.id), need = this.ssCost(it.id), left = Math.max(0, this.lsLeft());
        const yl = g && (g.src === "yl" || g.src === "ys");   // 游历功法、隐世宗门功法（隐世的功诀/心法/秘诀/炼体秘诀占灵识点，按 need 显示）
        h += `<p>${yl ? `${g.src === "ys" ? "隐世宗门功法 · " : ""}${g.star}星` : "试炼塔秘诀"}${g && g.label ? ` · ${g.label}每层 +${this.gfValue(g, g.perLv)}` : ""}${need > 0 ? `<br>学习占用灵识点 ${need}（剩余 ${left}）` : ""}${has ? "<br><span class='q5'>已学会。</span>" : need > 0 && left < need ? "<br><span class='q5'>灵识点不足，可在「修炼 → 神识」增加或遗忘功法。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "gf", it.id, `G.learnGfBook(${i})`, has, g ? DATA.gfLearnMin(g.star) * 60000 : 0)}</div>`;
      } else if (it.t === "dfb") {
        const key = it.type + "|" + it.g, has = this.s.recipes.includes(key);
        h += `<p>四界丹方 · ${DATA.recipeEffect(it.type, it.g)}<br>学习后可在洞府炼丹房炼制。${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "dan", key, `G.learnDanScroll(${i})`, has, DATA.danGdLearnMs(it.g, this.s.ssPow))}</div>`;
      } else if (it.t === "rbp") {
        const has = it.r === undefined ? this.s.forgeKnown.includes(this.forgeKey("ring", it.g)) : this.ringKnown(it.r, it.g);
        const sp = DATA.ringSp(it.r), smn = sp ? `、${DATA.smName(sp.sm)} ×${DATA.ringSmNeed(it.g)}` : "";
        h += `<p>${it.g < 1 && sp ? `学习后可在洞府炼器室炼制${DATA.ringName(it.r, 0)}（一种矿石、耀石${smn}）` : `学习后可在洞府炼器室把${DATA.XING[it.g - 1]}${DATA.ringNames[it.r] || "戒指"}升为${DATA.XING[it.g]}（上一星同种戒指 + ${sp ? "一种" : "三种"}矿石、耀石${smn}）`}${DATA.ringBonus(it.r) ? `，主属性额外 +${DATA.ringBonus(it.r)}%` : ""}。${has ? "<br><span class='q5'>已学会。</span>" : ""}</p>
          <div class="btns">${this.bagLearnBtn(it, "forge", this.forgeKey("ring", it.g, it.r), `G.learnRingBp(${i})`, has, this.bagLearnMs("RBP_MIN", it.g))}${sell}</div>`;
      } else if (it.t === "bmbp") {
        const B = this.bmCfg();
        h += `<p>学习后可打开${B.NAME}页面，把一件法宝炼成${B.NAME}。不能出售。</p>
          <div class="btns">${this.bagLearnBtn(it, "forge", "bmbp", `G.learnBmBp(${i})`, this.s.bmLearn, (B.LEARN_MIN || 0) * 60000)}</div>`;
      } else if (it.t === "cu") {
        h += this.customItemHtml(i, it, sell);   // 自定义物品，见 custom.js
      } else if (it.t === "mat") {
        h += `<img class="item-img" src="${DATA.matImg(it.kind, it.g)}" alt=""><p>${{ herb: "药材，可用于炼丹。", ore: "矿石，可用于炼器。" }[it.kind] || ""}</p><div class="btns">${sell}</div>`;
      } else {
        h += `<p>${DATA.slots[it.e.slot]} · ${this.equipDesc(it.e)}</p>
          <div class="btns"><button class="primary" onclick="G.equipItem(${i})">${it.e.slot === "fabao" ? "放入法宝栏" : "装备"}</button>${it.e.attrs ? `<button onclick="G.openReset('b${i}')">洗练</button>` : ""}${this.canEnhance(it.e) ? `<button onclick="G.openEnhance('b${i}')">强化</button>` : ""}${sell}</div>`;
      }
      this.modal(h + `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 点装备栏 / 法宝栏
    openEquip(key) {
      const e = key.startsWith("fb") ? this.s.fabao[+key.slice(2)] : this.s.equip[key]; if (!e) return;
      const src = DATA.eqIcon(e);
      this.modal(`${this.lockIco(key, !!e.lk)}${src ? DATA.fbArt(e, src, "item-img" + DATA.eqCls(e)) : ""}<h2 class="q${e.q}${DATA.fbElCls(e)}">${this.itemName({ t: "eq", e })}${e.attrs ? `<br><small>${DATA.rjName(e)}</small>` : ""}</h2><p>${DATA.slots[e.slot]} · ${this.equipDesc(e)}</p>
        <div class="btns"><button onclick="G.unequip('${key}')">卸下</button>${key.startsWith("fb") ? `<button onclick="G.openFabaoSwap(${+key.slice(2)})">更换</button>` : ""}${e.attrs ? `<button onclick="G.openReset('${key}')">洗练</button>` : ""}${this.canEnhance(e) ? `<button onclick="G.openEnhance('${key}')">强化</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },

    /* ---------- 强化（config/forge.js 的 forge.enhance）：每条属性分别强化 ---------- */
    canEnhance(e) { return !!(e && e.attrs); },
    // v152/v153 强化：整件一个等级，没有上限；只要火髓 + 耀石（法宝同属性，装备 / 戒指任意一种）
    // 装备 / 法宝 / 戒指共用 config/forge.js 的 enhance.COST：每强化 UP.N 级，之后每次 灵石 / 火髓 / 耀石 + 固定值
    enhCost(e, ys) { const E = CFG.forge.enhance.COST || {}, P = E.UP || {}, n = e.enh || 0, k = P.N > 0 ? Math.floor(n / P.N) : 0;
      return { stone: (E.STONE || 0) + k * (P.STONE || 0), fire: ((E.FIRE || [])[e.g] || 1) + k * (P.FIRE || 0), jj: ((E.SPECIAL || [])[e.g] || 0) + k * (P.SPECIAL || 0), sk: "ys", sf: e.slot !== "fabao" && this.ysArg(ys) >= 0 ? this.ysArg(ys) : this.ysFor(e) }; },   // 装备 / 戒指：ys = 玩家选的耀石，不选 = 自动
    enhHave(c) { return (this.s.stone || 0) >= (c.stone || 0) && this.fireCount() >= c.fire && this.smCount(c.sk, c.sf) >= c.jj; },
    enhRate(e) { if (e && e.bm) return 1;   // 本命法宝强化必定成功
      return Math.max(0, this.craftRate("qi", e.g) - (e.enh || 0) * (DATA.enhCfg(e).RATE_DROP || 0) / 100); },
    // 强化加成文字：n = 强化等级
    enhText(e, n) {
      if (e.slot === "fabao") return `${(DATA.fabaoTypes[e.ft] || {}).shield ? "护盾值" : "附加伤害"} +${U.fmt(n * DATA.fbEnhPer(e))}`;
      const A = DATA.eqEnhAdd(e); return Object.keys(A).filter(k => A[k] > 0).map(k => `${DATA.attrNames[k]} +${U.fmt(n * A[k])}`).join("、");
    },
    openEnhance(src) { const e = this.resetTarget(src); if (!this.canEnhance(e)) return; this._enhSource = src; this._enhObj = e; this.drawEnhance(); },
    drawEnhance() {
      const e = this._enhObj; if (!e) return;
      const fb = e.slot === "fabao", sel = fb ? -1 : this.ysSel("enh"), c = this.enhCost(e, sel), n = e.enh || 0, ys = c.sf;
      this.modal(`${DATA.fbArt(e, DATA.eqIcon(e), "item-img" + DATA.eqCls(e))}<h2 class="q${e.q}${DATA.fbElCls(e)}">强化 · ${this.itemName({ t: "eq", e })}</h2>${fb ? "" : this.ysRow("enh", c.jj)}
        <p class="desc">灵石 ${U.fmt(this.s.stone || 0)} · ${DATA.HX} ${U.fmt(this.fireCount())} · ${DATA.li(DATA.smIcon("ys", ys))}${DATA.smName("ys", ys)} ${U.fmt(this.smCount("ys", ys))}</p>
        <div class="line"><div>强化 +${n}<small>${this.enhText(e, n)} → ${this.enhText(e, n + 1)}<br>
          ${c.stone ? `<span class="${(this.s.stone || 0) >= c.stone ? "" : "q5"}">灵石 ${U.fmt(c.stone)}</span>、` : ""}<span class="${this.fireCount() >= c.fire ? "" : "q5"}">${DATA.HX} ${c.fire}</span>${c.jj ? `、<span class="${this.smCount(c.sk, c.sf) >= c.jj ? "" : "q5"}">${DATA.li(DATA.smIcon(c.sk, c.sf))}${DATA.smName(c.sk, c.sf)} ${c.jj}</span>` : ""} · 成功率 ${this.ratePct(this.enhRate(e))}</small></div>
          <button class="sm" onclick="G.doEnhance('${this._enhSource}',${sel})" ${this.enhHave(c) ? "" : "disabled"}>强化</button></div>
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    doEnhance(src, ys) {
      const e = this.resetTarget(src); if (!this.canEnhance(e)) return;
      this._enhSource = src; this._enhObj = e;
      const c = this.enhCost(e, ys);
      if (!this.enhHave(c)) return this.log("材料不足。", "sys");
      this.s.stone -= c.stone || 0; this.takeFire(c.fire); if (c.jj) this.takeSm(c.sk, c.jj, c.sf);
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
    smIs(k, ft) { return x => x && x.t === "sm" && x.k === k && (!DATA.SM_GRADED.includes(k) || (x.ft || 0) === (ft || 0)); },
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
          const fts = [...new Set(this.s.bag.filter(x => x && x.t === "sm" && x.k === "ys").map(x => x.ft || 0))].sort((a, b) => this.smCount("ys", b) - this.smCount("ys", a));
          const f = fts[0], m = Math.min(n, this.smCount("ys", f));
          this.bagTake(this.smIs("ys", f), m); n -= m; out.push({ k, ft: f, n: m });
        }
        return out;
      }
      if (!this.bagTake(this.smIs(k, ft), n)) return false; return [{ k, ft, n }];
    },
    // 找到要洗练 / 强化的那件：b序号 = 背包，fb序号 = 法宝栏，其它 = 装备栏
    resetTarget(src) {
      if (src === "bm") return this.bmEq();   // 本命法宝（本命页面的「强化」）
      if (src[0] === "b" && src[1] !== undefined && !isNaN(+src.slice(1))) { const it = this.s.bag[+src.slice(1)]; return it && it.t === "eq" ? it.e : null; }
      if (src.startsWith("fb")) return this.s.fabao[+src.slice(2)] || null;
      return this.s.equip[src] || null;
    },
    // 洗练弹窗：点属性切换锁定（记住装备对象本身，背包重新排序也不会找错）
    openReset(src) {
      const e = this.resetTarget(src); if (!e || !e.attrs) return;
      if (e.bm) return this.log("本命法宝不能洗练。", "sys");   // 本命没有附加属性，洗练会刷出临时附加属性和新颜色，必须禁掉（强化走 openEnhance，不受影响）
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
      if (e.bm) return this.log("本命法宝不能洗练。", "sys");
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
      const s = this.s, it = s.bag[i]; if (!it || !it.e) return;
      const e = it.e;
      if (e.slot === "fabao") {
        const hole = s.fabao.findIndex(x => !x);
        if (hole >= 0 && hole < this.slotCount()) { s.bag[i] = null; s.fabao[hole] = e; }   // 卸下留下的空格先填上
        else if (s.fabao.length < this.slotCount()) { s.bag[i] = null; s.fabao.push(e); }
        else return this.log("法宝栏已满。", "sys");
      } else {
        // 戒指放第一个空戒指位，都满了替换第一个
        const key = e.slot === "ring" ? (DATA.equipSlots.find(k => k.startsWith("ring") && !s.equip[k]) || "ring0") : e.slot;
        const old = s.equip[key];
        s.bag[i] = null; s.equip[key] = e;
        if (old) this.addEquip(old);   // 换下的旧装备先填第一个空格（固定格子）
      }
      this.log(`装备了${e.name}。`, "good"); this.closeModal(); this.after();
    },
    unequip(key) {
      if (key.startsWith("fb")) { const k = +key.slice(2); if (!this.s.fabao[k]) return; this.addEquip(this.s.fabao[k]); this.s.fabao[k] = null; }   // 法宝卸下不补位：该格留空，后面的法宝不往前挪
      else { if (!this.s.equip[key]) return; this.addEquip(this.s.equip[key]); this.s.equip[key] = null; }   // 装备（含戒指）本来就是按格位存，卸下只清该格，不补位；背包满时卸下的装备进传音，不再塞入 e:null 的幻影物品
      this.closeModal(); this.after();
    },
    // 宗门秘境掉的炼丹 / 炼器经验：每个 +MJ.CXP_VAL 点
    useCxp(i, n) {
      const it = this.s.bag[i]; if (!it || it.t !== "cxp") return;
      const ck = it.k === "qi" || it.k === "ling" ? it.k : "dan", v = (CFG.yinshi.MJ || {}).CXP_VAL || 10;
      if (this.craftLv(ck) >= this.craftMax(ck)) return this.log(`${CFG.craftsman[ck].name}已满阶。`, "sys");
      n = Math.min(Math.floor(+n) || 1, it.n || 1); if (n <= 0) return;
      this.removeAt(i, n); this.addCraftExp(ck, v * n);
      this.log(`使用${DATA.cxpName(ck)} ×${n}，${CFG.craftsman[ck].name}经验 +${U.fmt(v * n)}。`, "good"); this.closeModal(); this.after();
    },
    sellItem(i, n) {
      const it = this.s.bag[i]; if (!it || it.lq || it.t === "bmbp" || this.isLocked(it)) return;   // 加锁的不能卖；v173 学习中 / 排队中的不能卖；本命图纸不能卖
      // 先 clamp 再算钱：原来直接用请求数算钱，n=1e12 时只删 1 个却按 1e12 个结算；
      // n 为负数时算出负价、再经 removeAt 反向加物品。装备没有 n，按 1 个算。
      n = Math.floor(+n); if (!(n >= 1)) return;
      n = Math.min(n, it.n || 1);
      const p = this.sellPrice(it) * n;
      this.s.stone += p; this.removeAt(i, n);
      this.log(`售出${this.itemName(it)} ×${n}，灵石 +${U.fmt(p)}。`, "sys"); this.closeModal(); this.after();
    },

    /* ---------- 法术栏 ---------- */
    autoSlotSpell(id) { const sl = this.s.spellSlots; if (sl.includes(id)) return; const hole = sl.findIndex(x => !x); if (hole >= 0 && hole < this.slotCount()) sl[hole] = id; else if (sl.length < this.slotCount()) sl.push(id); },
    // 更换列表排序：跟修炼功法列表一样，「按等级」「按星级」只选一个，再点切换方向；
    //   默认 等级 低层 → 高层、星级 高星 → 低星；存在浏览器本地，刷新网页不变（跟功法列表分开存）
    spPickPref() {
      if (!this._spPref) { let p = {}; try { p = JSON.parse(localStorage.getItem("xiu_sp_pref") || "{}") || {}; } catch (e) {}
        this._spPref = { lvUp: p.lvUp !== false, starUp: p.starUp === true, by: p.by === "star" ? "star" : "lv" }; }
      return this._spPref;
    },
    // 只能选一个：点没选中的改用它，点已选中的切换方向（用户定 2026-11-14）
    setSpPickSort(k) { const p = this.spPickPref(); k = k === "star" ? "star" : "lv"; if (p.by !== k) p.by = k; else if (k === "lv") p.lvUp = !p.lvUp; else p.starUp = !p.starUp; try { localStorage.setItem("xiu_sp_pref", JSON.stringify(p)); } catch (e) {} this.openSpellPick(this._spPickRep); },
    // rep：更换第几格（不写 = 放入空格）
    openSpellPick(rep) {
      const s = this.s, P = this.spPickPref(), r = rep === undefined ? "" : "," + rep;
      this._spPickRep = rep;
      const infos = Object.keys(s.gongfa).filter(id => DATA.isSpell(id) && !s.spellSlots.includes(id)).map(id => DATA.spellInfo(id, s.gongfa[id])).filter(Boolean);
      if (!infos.length) return this.log(rep === undefined ? "没有可放入的法术，请先去门派功法殿学习。" : "没有可更换的法术。", "sys");
      const byLv = (a, b) => P.lvUp ? a.lv - b.lv : b.lv - a.lv, bySt = (a, b) => P.starUp ? a.star - b.star : b.star - a.star;
      infos.sort(P.by === "star" ? (a, b) => bySt(a, b) || byLv(a, b) : (a, b) => byLv(a, b) || bySt(a, b));
      this.modal(`<h2>${rep === undefined ? "放入" : "更换"}法术</h2><div class="row small" style="gap:6px;justify-content:flex-start;margin:6px 0">
      <button class="sm ${P.by === "lv" ? "active" : ""}" onclick="G.setSpPickSort('lv')">按等级 ${P.lvUp ? "低→高" : "高→低"}</button>
      <button class="sm ${P.by === "star" ? "active" : ""}" onclick="G.setSpPickSort('star')">按星级 ${P.starUp ? "低→高" : "高→低"}</button></div>` + infos.map(g => {
        const fu = g.fuPct ? `<span class="c-green">融合 +${U.dec(g.fuPct)}%（${DATA.fuseTxt(g.fu)}）</span>` : "未融合";
        const jy = g.jy ? `<span class="c-green">精研 ${U.fmt(g.jy)} 次 · 属性伤害 +${U.fmt(g.jyDmg)}</span>` : "未精研";
        const nx = g.lv < this.spMax() ? ` · 下一层攻击×${U.dec(g.next)}%` : "";
        return `<div class="line"><div>《${g.name}》<span class="tag c-red">${g.star}星</span><small>${g.el.name}系 · <span class="c-green">${g.lv} 层</span> · 攻击 ${U.fmt(g.atk)} · 伤害×${U.dec(g.pct)}% · 耗法力 ${U.fmt(g.mana)} · 每场 ${g.uses} 次${nx}</small><small>${fu} · ${jy}</small></div>
          <button class="sm" onclick="G.slotSpell('${g.id}'${r})">${rep === undefined ? "放入" : "更换"}</button></div>`; }).join("") + `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    slotSpell(id, rep) {
      // 未学会的法术不能装备：DATA.spellInfo 对未学法术也会返回 1 层对象，
      // 只靠它校验等于没校验；服务端跑同一份代码，控制台越权调用也会被挡下。
      if (!DATA.isSpell(id) || !this.s.gongfa[id]) return;
      const sl = this.s.spellSlots;
      if (sl.includes(id) && (rep === undefined || sl[rep] !== id)) return;
      if (rep !== undefined) sl[rep] = id;
      else { const hole = sl.findIndex(x => !x); if (hole >= 0 && hole < this.slotCount()) sl[hole] = id; else if (sl.length < this.slotCount()) sl.push(id); }
      this.closeModal(); this.after();
    },
    // 更换法宝：k 法宝栏第几格；从背包里选一件法宝换上，原来的放回背包
    openFabaoSwap(k) {
      const s = this.s, list = s.bag.map((it, i) => i).filter(i => s.bag[i] && s.bag[i].t === "eq" && s.bag[i].e && s.bag[i].e.slot === "fabao");
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
    unslotSpell(i) { this.s.spellSlots[i] = null; this.closeModal(); this.after(); },   // 卸下不补位：该格留空，后面的法术不往前挪
    // 点法术栏：显示详细，可卸下
    openSpellSlot(i) {
      const id = this.s.spellSlots[i], g = id && DATA.spellInfo(id, this.s.gongfa[id]); if (!g) return;
      this.modal(`<h2 class="q1">《${g.name}》</h2><p><span class="c-red">${g.star}星</span> · ${g.el.name}系 · <span class="c-green">${g.lv} 层</span> · 攻击 ${U.fmt(g.atk)}<br>${this.spellDmgTxt(g, 1)}<br>耗法力 ${U.fmt(g.mana)} · 每场战斗最多 ${g.uses} 次<br>${g.fuPct ? `<span class="c-green">融合 +${U.dec(g.fuPct)}%（${DATA.fuseTxt(g.fu)}）</span>` : "未融合"} · ${g.jy ? `<span class="c-green">已精研 ${U.fmt(g.jy)} 次</span>` : "未精研"}</p>
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
      // 法术栏也是固定格子：卸下 / 换成新法术只改该格，留空不补位；原来 filter 会把全部空位闭合，后面的法术整体前移
      s.spellSlots = s.spellSlots.map(x => x === id ? to || null : x);
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
        ${e ? `${src ? DATA.fbArt(e, src, "si") : ""}<span class="nm">${e.name}</span>` : `<b>${label}</b>`}</div>`; }; // 只显示名字，点击看详细

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
    // 背包不再自动整理：打开背包不重排、不补位，只有手动点「整理」才按原规则排序。
    // v26：储物格分类（全部 丹药 药材 矿石）+ 出售页
    const flt = this.bagFilter || "all", match = it => flt === "all" || (flt === "dan" ? it.t === "pill" || it.t === "dan" || it.t === "ql" || it.t === "ylb" || it.t === "ysd" : flt === "herb" ? (it.t === "mat" && it.kind === "herb") || it.t === "seed" || it.t === "lg" || (it.t === "cu" && !!((this.cuDef(it.name) || {}).herb)) : (it.t === "mat" && it.kind === flt) || (flt === "ore" && it.t === "cu" && !!((this.cuDef(it.name) || {}).ore)));
    const ftabs = `<div class="bag-tabs">${[["all", "全部"], ["dan", "丹药"], ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore]].map(([k, t]) =>
      `<button class="${flt === k && !this.bagSell ? "active" : ""}" onclick="G.setBagFilter('${k}')">${t}</button>`).join("")}
      <button class="sell ${this.bagSell ? "active" : ""}" onclick="G.openSellPage()">出售</button>
      <button onclick="G.sortBagNow()">整理</button></div>`;
    if (this.bagSell) return top + `<div class="card"><h3>储物格<small>${this.bagUsed()} / ${s.bagCap}</small></h3>${ftabs}</div>` + this.sellPageView(match);
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
 else if (it.t === "xd") cells += `<div class="cell q${(x => this.xdQ(x.src, x.id, x.v))(this.xdItem(it))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("xd_" + (it.k === "qi" || it.k === "jl" ? it.k : "dan"))}" alt="">${this.itemName(it)}</div>`;
 else if (it.t === "cxp") cells += `<div class="cell q3" onclick="G.openItem(${i})"><img class="mi" src="${DATA.cxpIcon(it.k)}" alt="">${this.itemName(it)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "stp") cells += `<div class="cell q4" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("st_frag")}" alt="">${this.itemName(it)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "ylb") cells += `<div class="cell q${DATA.ybQ(it.g)}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.ybIcon(it.k)}" alt="">${(DATA.YB[it.k] || {}).name || "宝物"}<span class="n">${it.n}</span></div>`;
 else if (it.t === "book") cells += `<div class="cell q1" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("mifa")}" alt="">${CFG.start.book.name}</div>`;
 else if (it.t === "gfb") cells += `<div class="cell q3" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("mifa")}" alt="">${this.itemName(it)}</div>`;
 else if (it.t === "lg") cells += `<div class="cell q5" onclick="G.openItem(${i})"><img class="mi" src="${DATA.lgImg(it.k)}" alt="">${this.itemName(it)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "seed") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.seedImg(it.g)}" alt="">${DATA.seedName(it.g)}<span class="n">${U.fmt(it.n)}</span></div>`;
 else if (it.t === "hx") cells += `<div class="cell q4" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("hx")}" alt="">${DATA.HX}<span class="n">${U.fmt(it.n)}</span></div>`;
      else if (it.t === "dfb") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})">${DATA.danImg(DATA.danIcon(it.type), DATA.danCls(it.type, it.g), "mi")}${DATA.danName(it.type, it.g)}丹方</div>`;
      else if (it.t === "zfbp") cells += `<div class="cell q${Math.min(5, Math.floor(Math.max(0, it.g - 1) / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("bp")}" alt="">${this.zfBpName(it.kind, it.g).replace("图纸", "")}</div>`;
      else if (it.t === "rbp") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("bp")}" alt="">${DATA.ringNames[it.r] || "戒指"}图纸${it.n > 1 ? `<span class="n">${it.n}</span>` : ""}</div>`;
 else if (it.t === "ss") cells += `<div class="cell q${Math.min(5, Math.floor(it.g / 2))}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("ss")}" alt="">${DATA.stoneName(it.g)}<span class="n">${it.n}</span></div>`;
      else if (it.t === "bmbp") cells += `<div class="cell q4" onclick="G.openItem(${i})"><img class="mi" src="${DATA.iconImg("bp")}" alt="">${this.bmCfg().MIFA}</div>`;
      else if (it.t === "cu") { const d = this.cuDef(it.name); cells += `<div class="cell q${d ? d.q || 0 : 0}" onclick="G.openItem(${i})"><img class="mi" src="${DATA.cuIcon(d)}" alt="">${it.name}<span class="n">${U.fmt(it.n)}</span></div>`; }
      else { const src = DATA.eqIcon(it.e); cells += `<div class="cell q${it.e.q}${DATA.eqCls(it.e)}" onclick="G.openItem(${i})">${src ? DATA.fbArt(it.e, src, "mi") : ""}${it.e.name}${it.e.enh ? `<span class="n">+${it.e.enh}</span>` : ""}${src ? "" : `<span class="g">${DATA.slots[it.e.slot]}</span>`}</div>`; }
    }
    return top + `<div class="card bag-store"><h3>储物格<small>${this.bagUsed()} / ${s.bagCap}</small></h3>${ftabs}<div class="bag-scroll" id="bag-grid"><div class="grid">${cells || `<p class="desc">没有这类物品。</p>`}</div></div></div>`;
  },
});
