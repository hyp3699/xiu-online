/* =====================================================================
 * 数据：装备 & 法宝
 * ---------------------------------------------------------------------
 * 炼制装备 / 戒指 / 法宝见 data/forge.js。
 * 装备栏：头盔 护甲 武器 腿甲 靴 吊坠 + 6 个戒指
 * 法宝栏、法术栏：开局 SLOT_START 格，每 SLOT_EVERY 个大境界多开 1 格，最多 SLOT_MAX 格（config/equip.js）
 * ===================================================================== */
// 物品部位（slot）：装备 + 法宝
DATA.slots = { helmet: "头盔", armor: "护甲", weapon: "武器", legs: "腿甲", boots: "靴", pendant: "吊坠", ring: "戒指", fabao: "法宝" };
for (const k in DATA.slots) DATA.slots[k] = DATA.nmPick(CFG.names.slot, k, DATA.slots[k]);   // 名字在 config/names.js 的 slot
// 装备栏位（ring0~ring5 都放戒指）
DATA.equipSlots = ["helmet", "armor", "weapon", "legs", "boots", "pendant", "ring0", "ring1", "ring2", "ring3", "ring4", "ring5"];
DATA.slotOf = key => key.startsWith("ring") ? "ring" : key; // 栏位 → 部位
DATA.SLOT_MAX = CFG.equip.SLOT_MAX;   // 法宝栏、法术栏最多格数（config/equip.js）
DATA.SLOT_EVERY = CFG.equip.SLOT_EVERY || 1;   // 每隔几个大境界开 1 格
DATA.SLOT_START = CFG.equip.SLOT_START || 1;   // 初始开几格
DATA.slotRealm = i => Math.max(0, i - DATA.SLOT_START + 1) * DATA.SLOT_EVERY;     // 第 i 格（0 起）开启的大境界

// 背包
DATA.BAG_START = CFG.bag.START; // 储物格初始数量（config/items.js 的 bag.START）
