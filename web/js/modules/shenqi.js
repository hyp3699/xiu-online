/* =====================================================================
 * 模块：神器莲台（数值在 config/shenqi.js）
 * 修炼页左上莲台图标 → 莲台页（cultView "shenqi"）：人物坐在莲台上，下面修炼、升级
 * 存档 s.sq = { lv, day, ts（今天修炼用了几次） }
 * ===================================================================== */
G.module({
  id: "shenqi",
  defaults: () => ({ sq: { lv: 1, day: "", ts: 0 } }),

  api: {
    // 升级：每个大境界能升一级
    sqUp() {
      const s = this.s, q = this.sqState(), C = CFG.shenqi, cap = this.sqCap();
      if (q.lv >= cap) { this.log(`境界不够，突破到下一个大境界才能再升级${C.NAME}。`); this.after(); return; }
      const c = +(C.UP_STONE || [])[q.lv - 1] || 0;
      if (s.stone < c) { this.log("灵石不足。"); this.after(); return; }
      s.stone -= c; q.lv++;
      this.log(`${C.NAME}升至 ${q.lv} 级${c ? `，消耗灵石 ${U.fmt(c)}` : ""}。`, "gold"); this.after();
    },
    // 修炼：立即减少正在修炼的功法 / 法术 / 秘法剩余时间
    sqTime() {
      const s = this.s, q = this.sqState(), C = CFG.shenqi, st = s.gfStudy;
      if (q.ts >= (C.TS_N || 0)) { this.log("今天的莲台修炼次数已用完。"); this.after(); return; }
      if (!st) { this.log("没有正在修炼的功法。"); this.after(); return; }
      const d = Math.min(Math.max(0, st.total - st.done), (C.TS_MIN || 0) * q.lv * 60000);
      st.total -= d; q.ts++;
      const info = DATA.skillInfo(st.id, s.gongfa[st.id] || 1);
      this.log(`莲台修炼，《${info ? info.name : ""}》修炼时间减少 ${U.dur(d / 1000)}。`, "good");
      const m = (this.modules || []).find(x => x.id === "gongfa"); if (m && m.tick) m.tick.call(this);
      this.after();
    },
    // 当天状态（换日清零次数）
    sqState() {
      const s = this.s; s.sq = s.sq || { lv: 1, day: "", ts: 0 };
      const q = s.sq, d = this.today(); if (q.day !== d) { q.day = d; q.ts = 0; }
      q.lv = Math.max(1, Math.floor(+q.lv || 1)); return q;
    },
    sqTsUsed() { const q = this.s.sq || {}; return q.day === this.today() ? q.ts || 0 : 0; },
    sqCap() { const s = this.s; return Math.min(DATA.realms.length, (s.mortal ? 0 : Math.floor((s.L || 0) / DATA.LAYERS)) + 1); },
    openShenqi(on = true) { this.cultView = on ? "shenqi" : ""; this.render(); },
  },
});

/* 修炼 · 莲台（cultivate.js 调用） */
G.shenqiView = function () {
  const s = this.s, q = Object.assign({ lv: 1 }, s.sq || {}), C = CFG.shenqi, cap = this.sqCap();
  const upC = +(C.UP_STONE || [])[q.lv - 1] || 0, canUp = q.lv < cap && s.stone >= upC;
  const left = Math.max(0, (C.TS_N || 0) - this.sqTsUsed()), cut = (C.TS_MIN || 0) * q.lv, st = s.gfStudy;
  const info = st ? DATA.skillInfo(st.id, s.gongfa[st.id] || 1) : null;
  return `<div class="cult-stage sq-stage">
      <div class="sq-seat"><img class="sq-lotus" src="img/sq_lotus.webp?v=${DATA.IMG_V}" alt=""><img class="sq-hero" src="${this.heroImg("ys")}?v=${DATA.IMG_V}" alt=""></div>
      <div class="sq-lv">${C.NAME} · ${q.lv} 级</div>
    </div>
    <div class="card sq-card">
      <div class="stats"><div><span>等级</span>${q.lv} / ${cap}</div><div><span>今天剩余</span>${left} 次</div></div>
      <p class="desc">每次立即减少正在修炼的功法时间 ${cut} 分钟${info ? `（正在修炼《${info.name}》）` : "（现在没有正在修炼的功法）"}。${q.lv >= cap ? "突破到下一个大境界后可升级。" : `升级${upC ? `需要 ${U.fmt(upC)} 灵石` : "免费"}。`}</p>
      <div class="btns"><button class="primary" onclick="G.sqTime()" ${left && st ? "" : "disabled"}>修炼</button><button onclick="G.sqUp()" ${canUp ? "" : "disabled"}>升级</button></div>
      <div class="btns"><button onclick="G.openShenqi(false)">返回修炼</button></div>
    </div>`;
};
