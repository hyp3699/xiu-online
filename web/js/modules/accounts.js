/* =====================================================================
 * 模块：账号管理（只有管理员看得到：世界 → 设置 → 账号管理）
 * ---------------------------------------------------------------------
 * 所有玩家：设置 → 账号 → 修改密码（改完其他设备上的登录会失效）。
 * 管理员：开启 / 关闭注册；查看所有注册的账号；删除账号（连同服务器上的存档，管理员账号不能删）。
 * 接口在 server/server.py：admin/users、admin/reg、admin/user/del
 * ===================================================================== */
G.module({
  id: "accounts",
  api: {
    openAccAdmin(on) { this.accPage = !!on; if (on) { this.loadAccs(); this.loadChars(); } this.render(); },
    async loadAccs() {
      try { const j = await API.userList(); this.accList = j.list || []; this.accRegOpen = !!j.reg_open; }
      catch (e) { this.accList = []; this.log("读取账号失败：" + e.message, "bad"); }
      this.render();
    },
    async accSetReg(open) {
      try { await API.setRegOpen(open); this.accRegOpen = open; this.log(open ? "已开启注册。" : "已关闭注册。", "sys"); }
      catch (e) { this.log("设置失败：" + e.message, "bad"); }
      this.render();
    },
    async accDel(id) {
      const u = (this.accList || []).find(x => x.id === id); if (!u) return;
      if (!(await this.ask(`删除账号「${u.username}」？存档会一起删除，无法恢复。`))) return;
      try { await API.userDelete(id); this.log(`已删除账号 ${u.username}。`, "sys"); this.loadAccs(); }
      catch (e) { this.log("删除失败：" + e.message, "bad"); }
    },
    // ---- 管理员多人物 ----
    async loadChars() {
      try { this.charData = await API.charList(); } catch (e) { this.charData = { list: [] }; this.log("读取人物失败：" + e.message, "bad"); }
      this.render();
    },
    async charNew(debug) {
      try { await API.charNew(debug); this.log(`已创建${debug ? "调试" : "新"}人物，切换过去后起名开始游戏。`, "sys"); this.loadChars(); }
      catch (e) { this.log("创建失败：" + e.message, "bad"); }
    },
    async charSwitch(id) {
      try { const j = await API.charSwitch(id); API.setLogin(j.username, j.token); location.reload(); }
      catch (e) { this.log("切换失败：" + e.message, "bad"); }
    },
    async charDel(id) {
      const c = ((this.charData || {}).list || []).find(x => x.id === id); if (!c) return;
      if (!(await this.ask(`删除人物「${c.name || "未创建"}」？存档会一起删除，无法恢复。`))) return;
      try { await API.charDel(id); this.log("已删除人物。", "sys"); this.loadChars(); }
      catch (e) { this.log("删除失败：" + e.message, "bad"); }
    },
    charView() {
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;"), D = this.charData, L = D ? D.list || [] : null;
      const rows = (L || []).map(c => `<div class="line"><div>${esc(c.name || "（未创建角色）")}${c.main ? `<span class="tag">主号</span>` : ""}${c.debug ? `<span class="tag">调试</span>` : ""}${c.id === D.cur ? `<span class="tag">当前</span>` : ""}
          <small>最后存档 ${this.accDate(c.updated)}</small></div>
        <span>${c.id === D.cur ? "" : `<button class="sm" onclick="G.charSwitch(${c.id})">切换</button>`}${c.main || c.id === D.cur ? "" : `<button class="sm" onclick="G.charDel(${c.id})">删除</button>`}</span></div>`).join("");
      return `<div class="card"><h3>我的人物<small>${L ? `${L.length} / ${D.max}` : "读取中…"}</small></h3><p class="desc">切换后其他人物照常修炼，回来时按离线结算。调试人物始终是测试模式，专门用来调试游戏。</p>${rows}
        <div class="btns"><button class="primary" onclick="G.charNew(false)" ${L && L.length < D.max ? "" : "disabled"}>创建人物</button><button onclick="G.charNew(true)" ${L && L.length < D.max ? "" : "disabled"}>创建调试人物</button></div></div>`;
    },
    accDate(t) { if (!t) return "—"; const d = new Date(t * 1000), z = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; },
    openPwForm(on) { this.pwOpen = !!on; this.pwF = {}; this.render(); },
    async changePw() {
      const F = this.pwF || {}, o = F.o || "", n = F.n || "", n2 = F.n2 || "";
      if (n.length < 6) return this.log("新密码至少 6 位。", "sys");
      if (n !== n2) return this.log("两次输入的新密码不一样。", "sys");
      try { await API.changePassword(o, n); this.pwOpen = false; this.pwF = {}; this.log("密码已修改。", "gold"); }
      catch (e) { this.log("修改失败：" + e.message, "bad"); }
      this.render();
    },
    pwFormView() {
      const q = k => String((this.pwF || {})[k] || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return this.pwOpen ? `<div class="row small"><span>原密码</span><input id="pw-old" type="password" value="${q("o")}" oninput="G.pwF.o=this.value" autocomplete="current-password" style="width:12em"></div>
        <div class="row small"><span>新密码</span><input id="pw-new" type="password" value="${q("n")}" oninput="G.pwF.n=this.value" autocomplete="new-password" style="width:12em"></div>
        <div class="row small"><span>确认新密码</span><input id="pw-new2" type="password" value="${q("n2")}" oninput="G.pwF.n2=this.value" autocomplete="new-password" style="width:12em"></div>
        <div class="btns"><button class="primary" onclick="G.changePw()">确认修改</button><button onclick="G.openPwForm(false)">取消</button></div>` : "";
    },
    accAdminView() {
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;"), L = this.accList;
      const rows = (L || []).map(u => `<div class="line"><div>${esc(u.username)}${u.admin ? `<span class="tag">管理员</span>` : ""}
          <small>注册 ${this.accDate(u.created)} · 最后存档 ${this.accDate(u.updated)}</small></div>
        ${u.admin ? "" : `<button class="sm" onclick="G.accDel(${u.id})">删除</button>`}</div>`).join("");
      return `<div class="row" style="margin:6px 0"><b>账号管理</b><button class="sm" onclick="G.openAccAdmin(false)">返回</button></div>
        ${this.charView()}
        <div class="card"><h3>注册<small>${this.accRegOpen ? "已开启" : "已关闭"}</small></h3>
          <div class="btns"><button class="${this.accRegOpen ? "" : "primary"}" onclick="G.accSetReg(${!this.accRegOpen})" ${L ? "" : "disabled"}>${this.accRegOpen ? "关闭注册" : "开启注册"}</button></div></div>
        <div class="card"><h3>所有账号<small>${L ? L.length + " 个" : "读取中…"}</small></h3>${rows}</div>`;
    },
  },
});
