#!/bin/bash
# xiu-online 独立测试服安装器（Debian/Ubuntu，需 root 或 sudo）。
# 只使用 /opt/xiu-online、/var/lib/xiu-online、xiu-online-test、18301 和 /xiuxian-test/；
# 不停止、不覆盖原版 xiu-server、/opt/xiu、/var/lib/xiu 或 /xiuxian/。
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo -E bash "$0" "$@"
REPO="${XIU_REPO:-https://gitlab.com/hepicpde-group/xiu.git}"
DIR=/opt/xiu-online
DATA_DIR=/var/lib/xiu-online
SERVICE=xiu-online-test
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx >/dev/null
PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org || true)"
if [[ ! "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "无法自动探测服务器公网 IPv4；请检查服务器的出网连接后重试。" >&2
  exit 1
fi
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
if [ -d "$DIR/.git" ]; then
  # 已装过：远程改指向 $REPO，强制覆盖为仓库最新代码
  git -C "$DIR" remote set-url origin "$REPO" 2>/dev/null || git -C "$DIR" remote add origin "$REPO"
  git -C "$DIR" fetch --depth 1 --force origin main
  git -C "$DIR" reset --hard FETCH_HEAD
  git -C "$DIR" clean -fdx -e server/node_modules
else
  if [ -e "$DIR" ]; then  # 不是 Git 仓库的旧目录：挪到备份再重新拉
    BAK="$DIR.bak.$(date +%Y%m%d%H%M%S)"; mv "$DIR" "$BAK"; echo ">>> 旧目录已备份到 $BAK"
  fi
  git clone --depth 1 --branch main "$REPO" "$DIR"
fi

id xiu-online >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin xiu-online
install -d -o xiu-online -g xiu-online -m 0750 "$DATA_DIR"
# 安卓图片热更新清单（同 xiu-update，格式见 .github/workflows/apk.yml）：
# 服务器上的 web/img_ver.txt 供 MainActivity 比对，缺了它安卓端只能用内置旧图。
git -C "$DIR" rev-parse HEAD:web/img | cut -c1-8 > "$DIR/web/img_ver.txt"
git -C "$DIR" ls-files -s web/img | awk -F'\t' '{split($1,a," "); print substr($2,9)" "substr(a[2],1,8)}' >> "$DIR/web/img_ver.txt"
(cd "$DIR/server" && npm ci --omit=dev --no-audit --no-fund)
install -m 0644 "$DIR/deploy/xiu-server.service" "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
install -m 0755 "$DIR/deploy/xiu-update" /usr/local/bin/xiu-online-update
install -m 0755 "$DIR/deploy/uninstall.sh" /usr/local/bin/xiu-online-uninstall
# 快捷命令 x：域名管理（选已有证书绑定域名）。/usr/local/bin/x 已被别的程序占用就不覆盖，用 xiu-online-domain
install -m 0755 "$DIR/deploy/xiu-domain.sh" /usr/local/bin/xiu-online-domain
if [ ! -e /usr/local/bin/x ] || grep -q XIU-ONLINE-DOMAIN-TOOL /usr/local/bin/x 2>/dev/null; then install -m 0755 "$DIR/deploy/xiu-domain.sh" /usr/local/bin/x
else echo ">>> /usr/local/bin/x 已被其它程序占用，域名管理请用：xiu-online-domain"; fi
# 网页「设置 → 管理员 → 从 GitHub 更新」：root 的 path 单元监听请求文件并运行本更新器
install -m 0644 "$DIR/deploy/xiu-web-update.service" /etc/systemd/system/xiu-online-web-update.service
install -m 0644 "$DIR/deploy/xiu-web-update.path" /etc/systemd/system/xiu-online-web-update.path
systemctl daemon-reload
systemctl enable --now xiu-online-web-update.path
NGX_DIR=$(find /etc/nginx/conf.d/central_vps_users -mindepth 1 -maxdepth 1 -type d -print -quit 2>/dev/null || true)
if [ -n "$NGX_DIR" ]; then
  install -m 0644 "$DIR/deploy/nginx-xiuxian.conf" "$NGX_DIR/xiu-online-test.conf"
else
  install -d /etc/nginx/snippets
  install -m 0644 "$DIR/deploy/nginx-xiuxian.conf" /etc/nginx/snippets/xiu-online-test.conf
  echo ">>> 请在 HTTPS 站点的 server{} 中加入：include snippets/xiu-online-test.conf;"
fi
# 独立的公网 IP HTTP server block；HTTP 80 已可达，IP 根路径会跳到 /xiuxian-test/。
IP_NGX_TMP=$(mktemp)
sed "s/__XIU_PUBLIC_IP__/${PUBLIC_IP}/g" "$DIR/deploy/nginx-xiuxian-ip.conf" > "$IP_NGX_TMP"
install -m 0644 "$IP_NGX_TMP" /etc/nginx/conf.d/xiu-online-ip-test.conf
rm -f "$IP_NGX_TMP"
nginx -t
systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:18301/health >/dev/null && break || sleep 1; done
curl -fsS http://127.0.0.1:18301/health >/dev/null
printf '\n安装完成：\n  测试入口（HTTP）：http://%s/\n  Cloudflare Tunnel origin（HTTP）：http://127.0.0.1:18302\n  Node API（仅本机）：127.0.0.1:18301\n  服务：systemctl status %s\n  手动更新：sudo xiu-online-update\n  绑定域名（HTTPS）：x\n  卸载：sudo xiu-online-uninstall\n' "$PUBLIC_IP" "$SERVICE"
echo '注意：IP 测试入口使用明文 HTTP，仅限临时测试；请用一次性测试账号和密码，不要输入常用密码。'
