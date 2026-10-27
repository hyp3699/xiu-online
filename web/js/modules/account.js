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
    intro() {
      this._lockModal = true;
      this.modal(`<h2>踏入仙途</h2><p>凡人寿不过百，你于山野间偶得一卷残破古经，自此心生问道之念。</p>
        <p>道号<input id="name-input" maxlength="8" placeholder="例如：青云子"></p>
        <div id="ori-box" class="ori-box"></div>
        <div class="btns"><button class="primary" id="start-btn">开始修仙</button></div>
        ${API.isAdmin ? `<h3 style="margin-top:16px">管理员：从 GitHub 恢复存档</h3>
        <p class="desc">服务器存档损坏或换了服务器时，从备份私有仓库下载最新备份，替换服务器上的全部账号和存档。</p>
        <p><input id="rs-repo" placeholder="仓库：用户名/仓库名" autocomplete="off"></p>
        <p><input id="rs-token" type="password" placeholder="GitHub 令牌" autocomplete="new-password"></p>
        <div class="btns"><button onclick="G.ghRestoreRun($('#rs-repo').value, $('#rs-token').value)">下载并恢复</button></div>` : ""}`);
      this._oriSel = []; this.oriPaint();
      $("#start-btn").onclick = async () => {
        const name = ($("#name-input").value || "").trim() || "无名散修";
        if ((this._oriSel || []).length < this.oriPick()) return;
        try {
          this.s = await API.createCharacter(name, this._oriSel);
          this._lockModal = false; this.closeModal(); document.body.classList.remove("nologin");
          this.dirty(); this.start();
        } catch (e) { this.modal(`<h2>创建失败</h2><p>${e.message}</p><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); }
      };
    },
  },
});
