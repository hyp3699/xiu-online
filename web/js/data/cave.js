/* =====================================================================
 * 数据：洞府 · 聚灵阵
 * ---------------------------------------------------------------------
 * 聚灵阵的聚灵速度、修炼加成只由聚灵阵等级决定，与境界无关。
 * 每 STEP 级为一段，数值在 config/array.js：
 *   - 修炼速度加成% = 已升各级所在段的 SPEED 相加；factor = 1 + 加成% / 100
 *   - 每 10 秒聚集灵气 = GATHER_BASE + 已升各级的聚灵量相加
 *   - 1 灵石换灵气     = STONE_LING（固定）
 * cost(lv)：从 lv 升到 lv+1 需要的灵石（COST_BASE × 各级所在段 COST_RATE 连乘）
 * ===================================================================== */
// 数值在 js/config/ 下的数值文件 的 array 部分
const _A = CFG.array;
// 分段数值：第 lv 级（1 起）所在段的数值 C[key][段]（超出数组用最后一段）
DATA.segIdx = (C, lv) => Math.floor((Math.max(1, lv) - 1) / (C.STEP || 30));
DATA.segVal = (C, key, lv) => { const a = C[key] || [0]; return a[Math.min(DATA.segIdx(C, lv), a.length - 1)] || 0; };
// 升到 lv 级的灵石：升到 2 级 = COST_BASE，之后每级 × 所在段的 COST_RATE
DATA.segCost = (C, lv) => { let c = C.COST_BASE || 0; for (let l = 3; l <= lv; l++) c *= DATA.segVal(C, "COST_RATE", l); return Math.floor(c); };
// 聚灵量：第 lv 级 = GATHER_INIT × GATHER_RATE^(lv−1) × 所在段 GATHER_SEG
DATA.gatherLv = (C, lv) => { const g = C.GATHER_SEG || [1]; return (C.GATHER_INIT || 0) * Math.pow(C.GATHER_RATE || 1, lv - 1) * (g[Math.min(DATA.segIdx(C, lv), g.length - 1)] ?? 1); };
DATA.segSum = (C, key, lv) => { let t = 0; lv = Math.min(lv, C.MAX); for (let l = 1; l <= lv; l++) t += DATA.segVal(C, key, l); return t; };
DATA.array = {
  MAX: _A.MAX,
  GATHER_BASE: _A.GATHER_BASE,
  STONE_LING: _A.STONE_LING,
  LING_STONE: _A.LING_STONE,
  factor: lv => 1 + Math.round(DATA.segSum(_A, "SPEED", lv) * 1e6) / 1e8,
  flat: lv => DATA.segSum(_A, "GATHER_FLAT", lv),   // 固定聚灵（不吃任何加成）
  gather: lv => { let t = _A.GATHER_BASE; for (let l = 1; l <= Math.min(lv, _A.MAX); l++) t += DATA.gatherLv(_A, l); return t; },
  cost: lv => DATA.segCost(_A, lv + 1),
};
DATA.LING_CAP_GATHER = _A.CAP_GATHER;
DATA.LING_CAP_SPEED = _A.CAP_SPEED;

/* 洞府各房间（open: false 表示暂未开放，只显示入口） */
DATA.caveRooms = [
  { id: "array",   name: "聚灵阵",   open: true,  desc: "聚集天地灵气，供修炼使用。" },
  { id: "alchemy", name: "炼丹房",   open: true,  desc: "以灵药炼制丹药。" },
  { id: "forge",   name: "炼器室",   open: true,  desc: "锻造法器、法宝。" },
  { id: "lingen",  name: "灵根",     open: true,  desc: "只提升对应属性的修炼速度类功法效果。" },
  { id: "garden",  name: "灵药园",   open: true,  desc: "种植灵草灵药。" },
  { id: "wudao",   name: "悟道室",   open: true,  desc: "参悟大道，每天一次。" },
  { id: "formation",name:"洞府阵法", open: false, desc: "布置护府大阵。" },
  { id: "servant", name: "道童居",   open: true,  desc: "招募道童，代为打理洞府。" },
];
DATA.caveRooms.forEach(r => { r.name = DATA.nmPick(CFG.names.cave, r.id, r.name); });   // 名字在 config/names.js 的 cave
DATA.caveName = id => (DATA.caveRooms.find(r => r.id === id) || {}).name || id;
