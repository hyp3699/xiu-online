/* =====================================================================
 * 参考人物属性
 * ---------------------------------------------------------------------
 * DATA.refStats(境界, 层, 功法层数, 星级, 来源) = 人物在该境界第几层（1~10）的属性（含升级成长）
 *   + 1 ~ 星级 的全部功法（来源 1 宗门 / 2 +凡界坊市 / 3 +仙魔冥神坊市 / 4 +功德司，所有类别）都练到「功法层数」
 *   不算丹药、肉身、灵根、装备；功法层数 0 = 不算功法
 * 用到的地方：js/data/mobs.js 算怪物（地图、秘境、灵地、天将星君界主、宗门考官等）和试炼塔守关者的基础属性（数值 config/mobs.js），
 *   现在都只算修为突破（功法层数 0）
 * ===================================================================== */
DATA.REF_KEYS = ["hp", "atk", "def", "speed", "hit", "dodge", "mana", "res"];   // res：每系抗性（RES_BASE + 修为突破 + 全部真诀）
DATA._ref = {};
DATA.refStar = realm => (CFG.sect.REQ_REALM || []).filter(x => x <= realm).length;   // 该境界能进的最高星级
// star = 算 1 ~ star 星的功法（不写 = 该境界能进的最高星）；src = 算哪些来源（1 宗门 2 +凡界坊市 3 +仙魔冥神坊市 4 +功德司，不写 = 1）
DATA.refSrcList = src => [DATA.sects, src >= 2 ? DATA.shopSources : [], src >= 3 ? ((DATA.jieGf || {}).jshop || []).filter(x => !x.old) : [], src >= 4 ? ((DATA.jieGf || {}).gd || []).filter(x => !x.old) : []].flat();
DATA.refStats = (realm, layer, gf, star, src) => {
  realm = Math.max(0, Math.min(DATA.realms.length - 1, realm)); layer = Math.max(1, Math.min(DATA.LAYERS, layer));
  const ms = star > 0 ? star : DATA.refStar(realm), sr = src > 0 ? src : 1;
  const key = realm + ":" + layer + ":" + gf + ":" + ms + ":" + sr;
  if (DATA._ref[key]) return DATA._ref[key];
  const L = realm * DATA.LAYERS + layer - 1, o = {};
  for (const k of DATA.REF_KEYS) o[k] = DATA.realmStat(L, k);   // 修为突破属性（config/realm.js 的 GAIN）
  o.manaBr = o.mana;   // 只算修为突破的法力（怪物法术 / 法宝耗法力用）
  if (gf > 0) {
    for (const sc of DATA.refSrcList(sr)) {
      if (sc.star > ms) continue;
      for (const t of DATA.gfTypesOf(sc.src, sc.star)) {
        if (sc.src === "shop" && t.sectOnly) continue;
        const g = DATA.gongfaInfo(DATA.gongfaId(sc.id, t.id), gf);
        if (g && o[t.stat] !== undefined) o[t.stat] += g.value;
        if (g && t.stat2 && o[t.stat2] !== undefined) o[t.stat2] += g.value2;
      }
    }
  }
  return DATA._ref[key] = o;
};
