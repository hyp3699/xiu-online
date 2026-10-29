/* =====================================================================
 * 模块：数据修改（只有管理员看得到：世界 → 设置 → 管理员 → 数据修改）
 * ---------------------------------------------------------------------
 * 直接修改 js/config/ 里的参数文件。点保存后服务器先用新参数完整加载一遍，
 * 没有错误才保存并立即生效；在线玩家的网页会自动重新加载新参数。
 * 改过的文件存在服务器数据目录（不会被「从 GitHub 更新」覆盖），可以「恢复默认」。
 * 接口在 server/server.mjs：admin/config、admin/config/file、admin/config/save、admin/config/reset
 * ===================================================================== */
G.module({
  id: "cfgedit",
  api: {
    cfgEsc(x) { return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    // 打开文件列表
    async openCfgEdit() {
      this._cfgOpen = true; this._lockModal = true; this._cfgFile = null;
      this.modal(`<h2>数据修改</h2><p>读取中…</p>`);
      try { const j = await API.req("admin/config"); this._cfgList = j.list || []; }
      catch (e) { this._cfgList = []; this.cfgMsg = "读取失败：" + e.message; }
      this.cfgListView();
    },
    // 每个参数文件的中文名和主要内容
    CFG_INFO: {
      alchemy: ["丹方", "炼丹丹方、学习星级、炼制材料和成功率"],
      array: ["聚灵阵", "聚灵阵等级、修炼加成、升级灵石"],
      bag: ["背包", "物品堆叠上限、一格只放一个的物品"],
      battle: ["战斗", "保底伤害、防御、命中、暴击、回合数"],
      body: ["肉身", "肉身修炼速度、灵气消耗"],
      craftsman: ["炼丹师/炼器师/灵植夫", "技艺等级、经验、成功率加成"],
      drops: ["掉落", "各地图怪物灵石、药材矿石、物品掉落"],
      equip: ["装备栏", "法宝栏、法术栏开格数"],
      explore: ["历练探索", "探索步数、怪物数量、灵药矿脉、耗时"],
      forge: ["炼器", "装备、空间石、戒指、法宝、强化、洗练"],
      furnace: ["丹炉/器炉", "炼丹炉、炼器炉、仙炉的图纸和加成"],
      garden: ["灵药园", "灵田开垦、种植时间和产量"],
      gongfa: ["功法法术", "功法每层效果、法术、学习消耗"],
      items: ["物品价格", "储物格、药材矿石、修炼丹、坊市价格"],
      jingmai: ["经脉", "经脉光点、穴位层数、冲脉丹与灵液消耗、冲满加成"],
      lingdi: ["灵地", "灵地发现、探索次数、怪物、首领奖励"],
      lingen: ["灵根", "金木水火土雷升级、加成；升级灵石、灵元（首次 / 最后一次）"],
      mijing: ["秘境", "秘境发现、探索次数、怪物、首领奖励；灵元掉落 LINGYUAN、专用材料（含灵元）"],
      mobs: ["怪物", "各地图怪物境界、属性、倍率"],
      names: ["名字", "游戏里显示的各种名字"],
      player: ["人物属性", "基础属性、属性计算"],
      realm: ["境界", "修为/肉身突破所需和每层属性"],
      sect: ["宗门", "职务俸禄、事务堂（含物品 / 特殊任务）、修炼室、试炼塔（药材矿石 / 火髓分段奖励）、宝库（含材料二换一、四界换凡界）、晋升"],
      servant: ["道童", "道童选拔、资质、升级灵石和灵元、差事（阵法辅助固定聚灵）、俸禄"],
      shenshi: ["神识", "神识强度、养神丹、灵识点"],
      start: ["开局", "新角色初始物品"],
      trib: ["雷劫", "渡劫层数、时间、雷击伤害"],
      worldmaps: ["四界地图", "仙冥魔神地图、区域、境界要求"],
      wudao: ["宗门秘法", "秘法殿秘法效果和学习"],
      wudaoshi: ["悟道室", "悟道次数、悟道果、悟道奖励"],
      youli: ["地图游历", "地图格子游历：每日次数、掉落几率、灵石药材矿石火髓数量、宝物属性与服用上限、游历功法"],
      xingjun: ["四界官位", "界主、星君、天将职位和俸禄"],
      rates: ["总倍率", "地图收益、怪物属性、雷劫强度、突破需要、战斗图片名字（顶部快捷修改）"],
    },
    cfgListView() {
      const L = this._cfgList || [];
      this.modal(`<h2>数据修改</h2><p class="desc">选择要修改的参数文件（js/config/）。标「已修改」的是改过的版本，可恢复默认。</p>
        ${this.cfgMsg ? `<p class="${this._cfgMsgOk ? "c-green" : "c-red"}">${this.cfgEsc(this.cfgMsg)}</p>` : ""}
        ${this.cfgQuickView()}
        <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">
        ${L.map(f => { const k = String(f.name).replace(/\.js$/, ""), inf = this.CFG_INFO[k] || [k, ""];
          return `<button class="sm" style="text-align:left;padding:6px 10px" onclick="G.cfgOpenFile('${f.name}')"><b>${inf[0]}</b> <small style="opacity:.6">${f.name}</small>${f.overridden ? ` <b class="c-green">已修改</b>` : ""}${inf[1] ? `<br><small style="opacity:.75">${inf[1]}</small>` : ""}</button>`; }).join("")}</div>
        <div class="btns"><button onclick="G.cfgClose()">关闭</button></div>`);
      this.cfgMsg = ""; this._cfgMsgOk = false;
    },
    /* ---------- 顶部快捷修改：总倍率（config/rates.js；突破属性倍率在 config/realm.js） ---------- */
    CFG_QUICK: [
      ["地图收益", [["MAP_GAIN.fan", "凡界地图"], ["MAP_GAIN.mijing", "秘境"], ["MAP_GAIN.sijie", "四界地图"], ["MAP_GAIN.lingdi", "灵地"]]],
      ["怪物属性", [["MOB", "总倍率（所有怪物，雷劫除外）"]]],
      ["雷劫强度", [["TRIB", "总倍率"]]],
      ["突破需要", [["BREAK", "总倍率（修为突破的修为、肉身突破的气血）"]]],
      ["战斗图片名字", [["MOB_IMG_NAME", "1 显示怪物图片文件名，0 关闭"]]],
      ["突破属性", [["realm:GAIN_RATE", "修为突破属性总倍率（人物、怪物、雷劫都生效）"], ["realm:BODY_GAIN_RATE", "肉身突破属性总倍率（人物、怪物、雷劫都生效）"]]],
    ],
    cfgQuickGet(key) {
      if (key.startsWith("realm:")) { const v = CFG.realm[key.slice(6)]; return v === undefined ? 1 : v; }
      const p = key.split("."); let o = CFG.rates || {}; for (const k of p) o = o == null ? undefined : o[k]; return o === undefined ? 1 : o;
    },
    cfgQuickView() {
      const inp = (key, label) => `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:3px 0"><small>${label}</small><input data-q="${key}" type="number" step="0.01" min="0" value="${this.cfgQuickGet(key)}" style="width:90px"></label>`;
      return `<div class="card" style="margin:8px 0"><h3>快捷修改<small>默认都是 1</small></h3>
        ${this.CFG_QUICK.map(([t, L]) => `<div style="margin:6px 0"><b>${t}</b>${L.map(([k, l]) => inp(k, l)).join("")}</div>`).join("")}
        <div class="btns"><button class="primary sm" id="cfg-qsave" onclick="G.cfgQuickSave()">保存快捷修改</button></div></div>`;
    },
    async cfgQuickSave() {
      const vals = {}; let bad = "";
      document.querySelectorAll("#modal-box input[data-q]").forEach(el => { const v = Number(el.value); if (!(el.value !== "" && isFinite(v) && v >= 0)) bad = "倍率要填 0 或以上的数字"; vals[el.dataset.q] = v; });
      if (bad) { this.cfgMsg = bad; this._cfgMsgOk = false; return this.cfgListView(); }
      const btn = document.getElementById("cfg-qsave"); if (btn) btn.disabled = true;
      // 只改数字，文件里其它内容（注释、管理员改过的地方）保持不变
      const setNum = (text, re, v) => { if (!re.test(text) && /MOB_IMG_NAME/.test(re.source)) return text.replace(/(\n\s*BREAK\s*:\s*[-\d.eE]+,?[^\n]*)/, `$1\n  MOB_IMG_NAME: ${v},`); if (!re.test(text)) throw new Error("文件里找不到要改的项：" + re); return text.replace(re, (m0, a) => a + v); };
      try {
        const changed = k => Number(this.cfgQuickGet(k)) !== vals[k];
        if (Object.keys(vals).some(k => !k.startsWith("realm:") && changed(k))) {
          let t = (await API.req("admin/config/file?name=rates.js")).content;
          for (const k in vals) { if (k.startsWith("realm:")) continue;
            const p = k.split("."), name = p[p.length - 1];
            const re = p.length > 1 ? new RegExp(`(${p[0]}\\s*:\\s*\\{[\\s\\S]*?\\b${name}\\s*:\\s*)[-\\d.eE]+`) : new RegExp(`(\\n\\s*${name}\\s*:\\s*)[-\\d.eE]+`);
            t = setNum(t, re, vals[k]); }
          await API.req("admin/config/save", { name: "rates.js", content: t });
        }
        if (["realm:GAIN_RATE", "realm:BODY_GAIN_RATE"].some(changed)) {
          let t = (await API.req("admin/config/file?name=realm.js")).content;
          for (const k of ["GAIN_RATE", "BODY_GAIN_RATE"]) {
            const re = new RegExp(`(\\n\\s*${k}\\s*:\\s*)[-\\d.eE]+`);
            if (re.test(t)) t = setNum(t, re, vals["realm:" + k]);
            else t = t.replace(k === "GAIN_RATE" ? /(\n\s*GAIN\s*:\s*\[)/ : /(\n\s*BODY_GAIN\s*:\s*\[)/, `\n  ${k}: ${vals["realm:" + k]},$1`);
          }
          await API.req("admin/config/save", { name: "realm.js", content: t });
        }
        this._cfgReload = true; this.cfgMsg = "快捷修改已保存，服务器已使用新倍率。关闭窗口后页面会重新加载。"; this._cfgMsgOk = true;
        for (const k in vals) { if (k.startsWith("realm:")) CFG.realm[k.slice(6)] = vals[k]; else { const p = k.split("."); let o = CFG.rates = CFG.rates || {}; for (let i = 0; i < p.length - 1; i++) o = o[p[i]] = o[p[i]] || {}; o[p[p.length - 1]] = vals[k]; } }
        API.showActionFeedback("倍率已保存");
      } catch (e) { this.cfgMsg = "保存失败：" + e.message; this._cfgMsgOk = false; API.showActionFeedback("保存失败", "bad"); }
      this.cfgListView();
    },
    async cfgOpenFile(name) {
      this.modal(`<h2>${this.cfgEsc(name)}</h2><p>读取中…</p>`);
      try {
        const j = await API.req("admin/config/file?name=" + encodeURIComponent(name));
        this._cfgFile = { name: j.name, overridden: j.overridden };
        this.modal(`<h2>${(this.CFG_INFO[String(j.name).replace(/\.js$/, "")] || [""])[0]} ${this.cfgEsc(j.name)}${j.overridden ? ` <small class="c-green">已修改</small>` : ""}</h2>
          <p class="desc">改完点「保存」，服务器检查无误后立即使用新参数。</p>
          <textarea id="cfg-text" spellcheck="false" autocapitalize="off" autocomplete="off" style="width:100%;height:58vh;background:#14110f;color:#e8dcc4;border:1px solid #4a3d31;border-radius:4px;padding:8px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre;overflow:auto;tab-size:2">${this.cfgEsc(j.content)}</textarea>
          <p id="cfg-msg" class="desc" style="margin-top:6px"></p>
          <div class="btns"><button class="primary" id="cfg-save" onclick="G.cfgSave()">保存</button>
          ${j.overridden ? `<button onclick="G.cfgReset()">恢复默认</button>` : ""}
          <button onclick="G.cfgBack()">返回</button></div>`);
      } catch (e) { this.cfgMsg = "读取失败：" + e.message; this.cfgListView(); }
    },
    cfgSetMsg(text, bad) { const el = document.getElementById("cfg-msg"); if (el) { el.textContent = text; el.className = bad ? "c-red" : "c-green"; } },
    async cfgSave() {
      const f = this._cfgFile, ta = document.getElementById("cfg-text"); if (!f || !ta) return;
      const btn = document.getElementById("cfg-save"); if (btn) btn.disabled = true;
      this.cfgSetMsg("保存中…");
      try {
        await API.req("admin/config/save", { name: f.name, content: ta.value });
        f.overridden = true; this._cfgReload = true;
        this.cfgSetMsg("已保存，服务器已使用新参数。关闭窗口后页面会重新加载。");
        API.showActionFeedback("参数已保存");
      } catch (e) { this.cfgSetMsg(e.message, true); API.showActionFeedback("保存失败", "bad"); }
      if (btn) btn.disabled = false;
    },
    async cfgReset() {
      const f = this._cfgFile; if (!f || !(await this.ask(`把 ${f.name} 恢复成默认参数？改过的内容会丢失。`))) return;
      try { await API.req("admin/config/reset", { name: f.name }); this._cfgReload = true; API.showActionFeedback("已恢复默认"); this.cfgOpenFile(f.name); }
      catch (e) { this.cfgSetMsg(e.message, true); }
    },
    async cfgBack() { this._cfgFile = null; await this.openCfgEdit(); },
    cfgClose() {
      this._cfgOpen = false; this._lockModal = false; this._cfgFile = null; this.closeModal();
      if (this._cfgReload) { this._cfgReload = false; location.reload(); }
    },
  },
});
