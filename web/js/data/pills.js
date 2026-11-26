/* =====================================================================
 * 数据：修炼速度丹药（数值在 config/items.js 的 pills / price）
 * ---------------------------------------------------------------------
 * 丹药只增加修炼速度，不会直接给修为。
 * 每种丹药每个大境界都有一个品质（grade = 境界序号），只能服用与当前境界相同品质的。
 * ===================================================================== */
DATA.pills = CFG.pills;
DATA.PILL_PRICE_STEP = CFG.price.PILL_PRICE_STEP;

DATA.pillPct = type => DATA.pills[type].pct;   // 各阶固定
DATA.pillPrice = (type, grade) => Math.floor(DATA.pills[type].price * Math.pow(DATA.PILL_PRICE_STEP, grade));
