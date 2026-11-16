/* =====================================================================
 * 模块：账号（登录 / 注册 / 开局创建角色）
 * ---------------------------------------------------------------------
 * 流程：
 *   1. 打开网页 → 有登录令牌就直接向服务器取存档
 *   2. 没有令牌或令牌失效 → 弹出登录框
 *   3. 服务器没有存档 → 进入“踏入仙途”创建角色
 *   4. 读到存档 → 补算离线收益 → 开始游戏
 * ===================================================================== */
G.module({
  id: "account",

  api: {
    loginForm(msg) {
      this._lockModal = true; document.body.classList.add("nologin");   // 未登录：只显示登录框
      this.modal(`<h2>问道长生</h2><p>${msg || "登录后存档保存在服务器，随时随地继续修仙。"}</p>
        <p><input id="lg-user" maxlength="20" placeholder="账号（字母、数字或中文）" value="${API.user || ""}"></p>
        <p><input id="lg-pass" type="password" maxlength="64" placeholder="密码（至少 6 位）"></p>
        <p id="lg-err" class="q5"></p>
        <div class="btns"><button class="primary" onclick="G.doLogin(false)">登录</button><button onclick="G.doLogin(true)">注册新账号</button></div>`);
    },
    async doLogin(isReg) {
      const u = $("#lg-user").value.trim(), p = $("#lg-pass").value;
      const err = t => { $("#lg-err").textContent = t; };
      if (!u || p.length < 6) return err("请填写账号，密码至少 6 位。");
      try {
        if (isReg) await API.register(u, p); else await API.login(u, p);
        if (this.s) return location.reload(); // 游戏中途掉线重登，刷新即可
        this.enterGame();
      } catch (e) { err(e.message); }
    },
    async showLogin() {
      if (!API.token) return this.loginForm();
      this.enterGame();
    },
    async enterGame() {
      // 服务器重启/更新时刷新正好撞上空档会失败一次：以前直接锁死在登录框，
      // 服务器恢复后也不会自动再试，只能重启 App。现在先自动重试几次，
      // 只有登录过期才立即回登录框，其它网络失败重试完才提示。
      let data, lastErr = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        try { data = await API.loadSave(); lastErr = null; break; }
        catch (e) {
          if (/登录/.test(e.message)) { API.logout(); return this.loginForm("登录已过期，请重新登录。"); }
          lastErr = e;
          if (attempt < 9) {
            try { API.setSync(`服务器重启中，正在重连（${attempt + 1}/10）…`); } catch {}
            await new Promise(r => setTimeout(r, Math.min(3000 * (attempt + 1), 10000)));
          }
        }
      }
      if (lastErr) return this.loginForm("连接服务器失败：" + lastErr.message);
      this._lockModal = false; this.closeModal();
      if (!data) return this.intro();
      this.s = data;
      this.dirty();
      this._lastTick = data.last || Date.now();
      document.body.classList.remove("nologin");
      this.start();
    },
    relogin() { API.logout(); this.loginForm("登录已过期，请重新登录（游戏进度保存在服务器）。"); },
    logout() {
      API.logout();
      setTimeout(() => location.reload(), 100);
    },
    async restart() {
      if (!(await this.ask("确定删除这个账号的存档，从头开始？"))) return;
      this._stopped = true;
      API.resetCharacter().then(() => location.reload()).catch(e => { this._stopped = false; this.modal(`<h2>重置失败</h2><p>${e.message}</p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); });
    },

    // 创建角色（不再随机灵根；灵根在「灵根」页用灵石提升）
    // 出身页占满屏幕（用户定 2026-11-16）。右上角「管理员」（管理员全部功能，页内显示）；「增加出身点」输入礼包码多选出身
    // keep = 弹窗被别的弹窗（确认框、数据修改、创建失败）盖掉后重开：保留已选出身、道号、打开的面板
    intro(keep) {
      this._lockModal = true; this._introOn = true;
      if (!keep) { this._oriSel = []; this._introName = ""; this._introPn = ""; }
      if (this._oriExtra === undefined) { this._oriExtra = 0; API.req("ori/extra").then(j => { this._oriExtra = Math.max(0, +j.n || 0); this.oriPaint(); }).catch(() => {}); }
      const esc = x => String(x || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      this.modal(`<div class="ori-head"><h2>踏入仙途</h2>${API.isAdmin ? `<button class="ori-rs-btn" onclick="G.introPn('adm')">管理员</button>` : ""}</div>
        <p>凡人寿不过百，你于山野间偶得一卷残破古经，自此心生问道之念。</p>
        <p>道号<input id="name-input" maxlength="8" placeholder="例如：青云子" value="${esc(this._introName)}" oninput="G._introName=this.value"></p>
        <div id="ori-box" class="ori-box"></div>
        <div class="btns"><button class="primary" id="start-btn">开始修仙</button></div>
        <div id="ori-pn-gift" class="ori-pn"><div class="ori-head"><h2>增加出身点</h2><button class="ori-rs-btn" onclick="G.introPn('')">返回</button></div>
          <p class="desc">输入礼包码，兑换后可以多选出身。当前可选 <b id="ori-pk-n"></b> 个。</p>
          <div class="row small"><input id="ori-code" maxlength="64" placeholder="礼包码" style="flex:1"><button class="sm primary" onclick="G.introRedeem()">兑换</button></div>
          <p class="desc" id="ori-code-msg"></p></div>
        ${API.isAdmin ? `<div id="ori-pn-adm" class="ori-pn"></div>` : ""}`, "ori-fs");
      this.oriPaint(); this.introPn(this._introPn || "");
      $("#start-btn").onclick = async () => {
        const name = ($("#name-input").value || "").trim() || "无名散修";
        if ((this._oriSel || []).length < Math.min(this.oriPick(), this.oriBase())) return;   // 出身点可以不用完
        try {
          this.s = await API.createCharacter(name, this._oriSel);
          this._introOn = false; this._lockModal = false; this.closeModal(); document.body.classList.remove("nologin");
          this.dirty(); this.start();
        } catch (e) { this.modal(`<h2>创建失败</h2><p>${e.message}</p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); }
      };
    },
    // 出身页里的面板：gift 增加出身点 / adm 管理员 / "" 关闭
    introPn(k) {
      this._introPn = k; const b = $("#modal-box"); if (!b) return;
      b.classList.toggle("pn-on", !!k);
      document.querySelectorAll("#modal-box .ori-pn").forEach(x => x.classList.toggle("on", x.id === "ori-pn-" + k));
      if (k === "gift") { const n = $("#ori-pk-n"); if (n) n.textContent = this.oriPick(); }
      if (k === "adm") { if (!this._admSub) this._admSub = ""; API.adminInfo().then(j => { this.adminInfo = j; this.introAdmPaint(); }).catch(() => {}); this.introAdmPaint(); }
    },
    async introRedeem() {
      const el = $("#ori-code"), code = ((el && el.value) || "").trim(), msg = $("#ori-code-msg"); if (!code) return;
      try {
        const j = await API.req("gift", { code });
        if (j.oriExtra !== undefined) this._oriExtra = Math.max(0, +j.oriExtra || 0);
        if (msg) msg.textContent = `兑换成功：${(j.got || []).join("、") || "无"}${j.lost && j.lost.length ? "（还没创建角色，其他物品无法领取）" : ""}`;
        if (el) el.value = ""; this.oriPaint(); const n = $("#ori-pk-n"); if (n) n.textContent = this.oriPick();
      } catch (e) { if (msg) msg.textContent = "兑换失败：" + e.message; }
    },
    // 出身页的管理员面板：菜单 + 各子页（礼包码、账号管理、服务器信息用原来的页面；render() 没有存档时转到这里重画）
    introAdmPaint() {
      const box = $("#ori-pn-adm"); if (!box) return;
      const A = this.adminInfo || {}, back = `<div class="ori-head"><h2>管理员</h2><button class="ori-rs-btn" onclick="G.introPn('')">返回</button></div>`;
      let h;
      if (this.giftPage) h = this.giftAdminView();
      else if (this.accPage) h = this.accAdminView();
      else if (this.srvPage) h = this.srvInfoView();
      else if (this._admSub === "rs") h = `<div class="row" style="margin:6px 0"><b>从 GitHub 恢复存档</b><button class="sm" onclick="G._admSub='';G.introAdmPaint()">返回</button></div>
        <div class="card"><p class="desc">服务器存档损坏或换了服务器时，从备份私有仓库下载最新备份，替换服务器上的全部账号和存档。</p>
        <p><input id="rs-repo" placeholder="仓库：用户名/仓库名" autocomplete="off"></p>
        <p><input id="rs-token" type="password" placeholder="GitHub 令牌" autocomplete="new-password"></p>
        <div class="btns"><button class="primary" onclick="G.ghRestoreRun($('#rs-repo').value, $('#rs-token').value)">下载并恢复</button></div></div>`;
      else h = back + `<div class="card"><h3>游戏更新</h3><p class="desc">当前版本：${String(A.version || "未知").replace(/</g, "&lt;")}</p>
        <div class="btns"><button class="primary" onclick="G.webUpdate()" ${this.updating ? "disabled" : ""}>${this.updating ? "更新中…" : "从 GitHub 更新"}</button><button onclick="location.reload()">刷新页面</button></div>
        ${A.log ? `<div class="explore-log" style="white-space:pre-wrap;font-size:11px">${String(A.log).replace(/</g, "&lt;")}</div>` : ""}</div>
        <div class="card"><h3>恢复存档</h3><div class="btns"><button class="primary" onclick="G._admSub='rs';G.introAdmPaint()">从 GitHub 恢复存档</button></div></div>
        <div class="card"><h3>服务器信息</h3><div class="btns"><button class="primary" onclick="G.openSrvInfo(true)">服务器信息</button></div></div>
        <div class="card"><h3>礼包码</h3><div class="btns"><button class="primary" onclick="G.openGiftAdmin(true)">生成礼包码</button></div></div>
        <div class="card"><h3>账号管理</h3><div class="btns"><button class="primary" onclick="G.openAccAdmin(true)">账号管理</button></div></div>
        <div class="card"><h3>数据修改</h3><div class="btns"><button class="primary" onclick="G.openCfgEdit()">数据修改</button></div></div>`;
      const sc = box.scrollTop; box.innerHTML = h; box.scrollTop = sc;
    },
  },
});
