/* =====================================================================
 * 数据：名字（把 config/names.js 里改过的名字用到游戏里）
 * ---------------------------------------------------------------------
 * 加载顺序：所有 config/*.js → content/items.js → 这个文件 → 其它 data/*.js
 * 1. 药材、矿石、特殊材料的名字在别的数值文件里被当作「编号」用（掉落表、丹方、炉子材料、宝库……），
 *    这里把 CFG / ITEMS 里所有「整串等于原名」的字符串和对象键换成新名（只换整串，不换句子里的字）。
 * 2. 写在数值文件里的显示名（丹药、炉子、技艺、职务、修炼室、四界地图、官位、秘境、灵地……）直接换成新名。
 * 3. 写在 data/*.js 里的名字（境界、凡界地图、门派、装备……）由各 data 文件用 DATA.nmArr / DATA.nmPick 取新名。
 * 4. DATA.nmMigrate(s)：读档时把存档里的旧名换成新名（存档里 s._nm 记着上次用的名字，没有就当原名）。
 * 原名（没改过的名字）都记在 DATA.NM_DEF，供读档对照。
 * ===================================================================== */
window.DATA = window.DATA || {};
CFG.names = CFG.names || {};
(() => {
  const N = CFG.names, D = DATA.NM_DEF = {};
  const ok = v => typeof v === "string" && v !== "";
  // tbl[k] 有写名字就用它，没写用原名 def
  DATA.nmPick = (tbl, k, def) => tbl && ok(tbl[k]) ? tbl[k] : def;
  // 数组：按序号取新名
  DATA.nmArr = (tbl, def) => def.map((d, i) => DATA.nmPick(tbl, i, d));
  const pick = DATA.nmPick, arr = DATA.nmArr;

  /* ---------- 1. 当作编号用的名字：原名 → 新名，整串替换 ---------- */
  const herbDef = [...Object.keys(CFG.mats.herb), ...Object.keys((CFG.matsOther || {}).herb || {})];
  const oreDef = [...Object.keys(CFG.mats.ore), ...Object.keys((CFG.matsOther || {}).ore || {})];
  D.herb = herbDef.slice(); D.ore = oreDef.slice();
  const MI = (CFG.mijing || {}).items || {}, I = N.item || {};
  const ftDef = ((CFG.forge || {}).fabao || {}).types ? CFG.forge.fabao.types.map(t => t.name) : [];
  D.fabao = ftDef.slice();
  const fabaoNew = arr(N.fabao, ftDef), slotFb = pick(N.slot, "fabao", "法宝");
  const ren = {};   // 原名 → 新名
  const add = (o, n) => { if (ok(o) && ok(n) && o !== n && !(o in ren)) ren[o] = n; };
  herbDef.forEach((o, i) => add(o, pick(N.herb, i, o)));
  oreDef.forEach((o, i) => add(o, pick(N.ore, i, o)));
  add("火髓", pick(I, "hx", "火髓"));
  for (const k of ["kj", "lu", "yd", "cmd", "wdg"]) if (MI[k]) add(MI[k].name, pick(I, k, MI[k].name));
  if (MI.ys) { add(MI.ys.name, pick(I, "ys", MI.ys.name)); const yN = arr(N.ys, MI.ys.names || []); (MI.ys.names || []).forEach((o, i) => add(o, yN[i])); }
  { const all = [...herbDef.map((o, i) => pick(N.herb, i, o)), ...oreDef.map((o, i) => pick(N.ore, i, o))], dup = all.filter((x, i) => all.indexOf(x) !== i);
    if (dup.length) console.error("config/names.js：药材、矿石名字重复了：" + dup.join("、")); }
  // 深度替换：字符串值、对象键（保持键的顺序）
  const seen = new Set();
  const walk = o => {
    if (!o || typeof o !== "object" || seen.has(o) || o === N) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach((v, i) => { if (typeof v === "string" && v in ren) o[i] = ren[v]; else walk(v); }); return; }
    const keys = Object.keys(o);
    if (keys.some(k => k in ren)) {
      const ent = keys.map(k => [k in ren ? ren[k] : k, o[k]]);
      keys.forEach(k => delete o[k]); ent.forEach(([k, v]) => { o[k] = v; });
    }
    for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === "string" && v in ren) o[k] = ren[v]; else walk(v); }
  };
  if (Object.keys(ren).length) { walk(CFG); walk(window.ITEMS); }

  /* ---------- 2. 数值文件里的显示名 ---------- */
  DATA.HX = pick(I, "hx", "火髓");                 // 火髓
  DATA.SS = pick(I, "ss", "空间石");               // 空间石
  for (const k of ["kj", "lu", "yd", "cmd", "wdg", "ys"]) if (MI[k]) MI[k].name = pick(I, k, MI[k].name);
  if (MI.ys && MI.ys.names) MI.ys.names = arr(N.ys, MI.ys.names);
  if (ftDef.length) CFG.forge.fabao.types.forEach((t, i) => { t.name = fabaoNew[i]; });
  if (CFG.forge && CFG.forge.attr) CFG.forge.attr.colors.forEach((c, i) => { c.name = pick(N.color, i, c.name); });
  // 丹药（丹方 + 修炼丹）
  const AL = CFG.alchemy || {};
  for (const t in AL.recipes || {}) AL.recipes[t].name = pick(N.dan, t, AL.recipes[t].name);
  for (const t in CFG.pills || {}) CFG.pills[t].name = pick(N.dan, t, CFG.pills[t].name);
  if (AL.CATS) AL.CATS = arr(N.danCat, AL.CATS);
  for (const k in CFG.furnace || {}) if (CFG.furnace[k] && CFG.furnace[k].name) CFG.furnace[k].name = pick(N.furnace, k, CFG.furnace[k].name);
  for (const k in CFG.craftsman || {}) if (CFG.craftsman[k] && CFG.craftsman[k].name) CFG.craftsman[k].name = pick(N.craftsman, k, CFG.craftsman[k].name);
  // 门派：职务、事务、修炼室、练功房
  const SC = CFG.sect || {}, setNames = (list, tbl) => (list || []).forEach((x, i) => { x.name = pick(tbl, i, x.name); });
  setNames(SC.ranks, N.rank); setNames((SC.affair || {}).tasks, N.affair); setNames(SC.rooms, N.room); setNames(SC.gfRooms, N.gfRoom);
  if (SC.freeRoom) SC.freeRoom.name = pick(N.freeRoom, "cult", SC.freeRoom.name);
  if (SC.freeGfRoom) SC.freeGfRoom.name = pick(N.freeRoom, "gf", SC.freeGfRoom.name);
  if (CFG.chuqiao) CFG.chuqiao.NAME = ok(N.chuqiao) ? N.chuqiao : CFG.chuqiao.NAME;
  if (CFG.body && CFG.body.names) CFG.body.names = arr(N.body, CFG.body.names);
  // 地图 / 秘境 / 灵地：{ name, boss, monsters }
  const setMap = (m, n, bossKey) => {
    if (!m || !n) return;
    m.name = pick(n, "name", m.name); m[bossKey] = pick(n, "boss", m[bossKey]);
    if (Array.isArray(m.monsters) && n.monsters) m.monsters = arr(n.monsters, m.monsters);
  };
  for (const w in CFG.worldMaps || {}) {
    const W = CFG.worldMaps[w], nm = (N.map || {})[w] || [];
    (W.maps || []).forEach((m, i) => setMap(m, nm[i], "boss"));
    if (W.halls) for (const k in W.halls) W.halls[k] = pick((N.hall || {})[w], k, W.halls[k]);
  }
  ((CFG.mijing || {}).list || []).forEach((d, i) => setMap(d, (N.mijing || [])[i], "bossName"));
  ((CFG.lingdi || {}).list || []).forEach((d, i) => setMap(d, (N.lingdi || [])[i], "bossName"));
  // 官位
  for (const w in ((CFG.xingjun || {}).worlds || {})) {
    const C = CFG.xingjun.worlds[w], n = (N.xingjun || {})[w]; if (!n) continue;
    for (const k of ["JZ", "TJ"]) C[k] = pick(n, k, C[k]);
    if (C.SEAT !== undefined || (ok(n.SEAT) && n.SEAT !== "{seat}")) C.SEAT = pick(n, "SEAT", C.SEAT);
    if (Array.isArray(n.JZS)) C.JZS = n.JZS.slice();
    if (Array.isArray(C.SEATS) && Array.isArray(n.SEATS)) C.SEATS = C.SEATS.map((g, i) => arr(n.SEATS[i], g));
  }

  /* ---------- 4. 读档：存档里的旧名 → 新名 ---------- */
  // 存档里记的名字快照：药材、矿石（背包、探索收获按名字记），装备名（e.name）
  DATA.nmSnap = () => ({ herb: DATA.herbs.slice(), ore: DATA.ores.slice(),
    forge: JSON.parse(JSON.stringify(DATA.forgeNames)), ring: DATA.ringNames.slice(), fabao: DATA.fabaoTypes.map(t => t.name) });
  DATA.nmMigrate = s => {
    if (!s) return s;
    const cur = DATA.nmSnap(), old = Object.assign({}, D, s._nm || {});
    // 名字没变（绝大多数读档）：不遍历整个存档（服务器每次结算都会读档，遍历很耗 CPU）
    if (s._nm && ["herb", "ore", "forge", "ring", "fabao"].every(k => JSON.stringify(old[k]) === JSON.stringify(cur[k]))) { s._nm = cur; return s; }
    const diff = (o, c) => { const m = {}; (o || []).forEach((x, i) => { if (ok(x) && ok(c[i]) && x !== c[i]) m[x] = c[i]; }); return m; };
    const mat = { herb: diff(old.herb, cur.herb), ore: diff(old.ore, cur.ore) };
    const anyMat = Object.keys(mat.herb).length || Object.keys(mat.ore).length;
    // 装备名：按种类找原名，等于原名才换
    const eqNew = e => {
      if (!e || typeof e.name !== "string") return null;
      const g = (o, c) => o !== undefined && c !== undefined && e.name === o && o !== c ? c : null;
      if (e.attrs) {
        if (e.slot === "ring") return g((old.ring || [])[e.r], cur.ring[e.r]);
        if (e.slot === "fabao") return g((old.fabao || [])[e.ft], cur.fabao[e.ft]);
        return g(((old.forge || {})[e.slot] || [])[e.g], (cur.forge[e.slot] || [])[e.g]);
      }
      return null;
    };
    const seen = new Set();
    const walk = o => {
      if (!o || typeof o !== "object" || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (anyMat && (o.kind === "herb" || o.kind === "ore") && typeof o.name === "string" && mat[o.kind][o.name]) o.name = mat[o.kind][o.name];
      if (o.slot && o.name) { const n = eqNew(o); if (n) o.name = n; }
      if (anyMat) {   // 探索收获的键 "herb|名字"
        const keys = Object.keys(o);
        if (keys.some(k => /^(herb|ore)\|/.test(k) && mat[k.split("|")[0]][k.slice(k.indexOf("|") + 1)])) {
          const ent = keys.map(k => { const p = k.indexOf("|"), kd = k.slice(0, p), nm = k.slice(p + 1);
            return [/^(herb|ore)\|/.test(k) && mat[kd][nm] ? kd + "|" + mat[kd][nm] : k, o[k]]; });
          keys.forEach(k => delete o[k]); ent.forEach(([k, v]) => { o[k] = v; });
        }
      }
      for (const k in o) if (k !== "_nm") walk(o[k]);
    };
    walk(s);
    s._nm = cur;
    return s;
  };
})();
