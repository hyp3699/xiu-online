/* =====================================================================
 * 模块：神器（数值在 config/shenqi.js）
 * 存档 s.sq = { lv, day, ts（今天时光用了几次）, hun（今天领过养魂的日期） }
 * 养魂加的灵识点记 s.sqLs（shenshi.js lsTotal 加上），神识强度直接加进 s.ssPow，另记 s.sqSs（养神丹需求扣掉）
 * ===================================================================== */
G.module({
  id: "shenqi",
  defaults: () => ({ sq: { lv: 1, day: "", ts: 0, hun: "" }, sqLs: 0, sqSs: 0 }),

  api: {
    // 神器升级：每个大境界能升一级
    sqUp() {
      const s = this.s, q = this.sqState(), C = CFG.shenqi, cap = this.sqCap();
      if (q.lv >= cap) { this.log(`境界不够，突破到下一个大境界才能再升级${C.NAME}。`); this.after(); return; }
      const c = +(C.UP_STONE || [])[q.lv - 1] || 0;
      if (s.stone < c) { this.log("灵石不足。"); this.after(); return; }
      s.stone -= c; q.lv++;
      this.log(`${C.NAME}升至 ${q.lv} 级${c ? `，消耗灵石 ${U.fmt(c)}` : ""}。`, "gold"); this.after();
    },
    // 时光：立即减少正在修炼的功法 / 法术 / 秘法剩余时间
    sqTime() {
      const s = this.s, q = this.sqState(), C = CFG.shenqi, st = s.gfStudy;
      if (q.ts >= (C.TS_N || 0)) { this.log("今天的时光次数已用完。"); this.after(); return; }
      if (!st) { this.log("没有正在修炼的功法。"); this.after(); return; }
      const cut = (C.TS_MIN || 0) * q.lv * 60000, left = Math.max(0, st.total - st.done), d = Math.min(left, cut);
      st.total -= d; q.ts++;
      const info = DATA.skillInfo(st.id, s.gongfa[st.id] || 1);
      this.log(`时光流转，《${info ? info.name : ""}》修炼时间减少 ${U.dur(d / 1000)}。`, "good");
      if (this.modules) { const m = this.modules.find(x => x.id === "gongfa"); if (m && m.tick) m.tick.call(this); }
      this.after();
    },
    // 养魂：每天领一次
    sqHun() {
      const s = this.s, q = this.sqState(), C = CFG.shenqi, ls = (C.LS || 0) * q.lv, ss = (C.SS || 0) * q.lv;
      if (q.hun === this.today()) { this.log("今天已经养魂过了。"); this.after(); return; }
      q.hun = this.today(); s.sqLs = (s.sqLs || 0) + ls; s.sqSs = (s.sqSs || 0) + ss; s.ssPow = (s.ssPow || 0) + ss;
      this.log(`${C.NAME}温养神魂：灵识点 +${ls}，神识强度 +${ss}。`, "good"); this.after();
    },
    // 当天状态（换日清零时光次数）
    sqState() {
      const s = this.s; s.sq = s.sq || { lv: 1, day: "", ts: 0, hun: "" };
      const q = s.sq, d = this.today(); if (q.day !== d) { q.day = d; q.ts = 0; }
      q.lv = Math.max(1, Math.floor(+q.lv || 1)); return q;
    },
    sqTsUsed() { const q = this.s.sq || {}; return q.day === this.today() ? q.ts || 0 : 0; },
    sqCap() { const s = this.s; return Math.min(DATA.realms.length, (s.mortal ? 0 : Math.floor((s.L || 0) / DATA.LAYERS)) + 1); },
    openShenqi() {
      const s = this.s, q = Object.assign({ lv: 1 }, s.sq || {}), C = CFG.shenqi, cap = this.sqCap(), today = this.today();
    const upC = +(C.UP_STONE || [])[q.lv - 1] || 0, canUp = q.lv < cap && s.stone >= upC;
    const tsLeft = Math.max(0, (C.TS_N || 0) - this.sqTsUsed()), cut = (C.TS_MIN || 0) * q.lv;
    const row = (t, d, btn) => `<div class="row small"><span><b>${t}</b><br>${d}</span>${btn}</div>`;
    this.modal(`<h2>${C.NAME}</h2>
      <div class="stats"><div><span>等级</span>${q.lv} / ${cap}</div><div><span>升级</span>${q.lv >= cap ? "突破大境界后可升" : upC ? `${U.fmt(upC)} 灵石` : "免费"}</div></div>
      ${row("时光", `立即减少正在修炼的功法时间 ${cut} 分钟，今天剩 ${tsLeft} 次`, `<button onclick="G.sqTime()" ${tsLeft && s.gfStudy ? "" : "disabled"}>使用</button>`)}
      ${row("养魂", `每天灵识点 +${(C.LS || 0) * q.lv}，神识强度 +${(C.SS || 0) * q.lv}`, `<button onclick="G.sqHun()" ${q.hun === today ? "disabled" : ""}>${q.hun === today ? "已领" : "领取"}</button>`)}
      <div class="btns"><button class="primary" onclick="G.sqUp()" ${canUp ? "" : "disabled"}>升级</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
  },
});
