
### 安装

Debian/Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
```

### 更新

```bash
sudo xiu-online-update
```


```bash
systemctl status xiu-online-test
curl http://127.0.0.1:18301/health
```

### 强制覆盖更新

`xiu-online-update` 每次都会强制覆盖服务器上的代码：丢弃 `/opt/xiu-online` 里的任何改动、删掉仓库里没有的文件（保留 `server/node_modules`），存档在 `/var/lib/xiu-online` 不受影响。

服务器第一次从 GitLab 切换到本仓库（GitHub）时，先执行一次：

```bash
sudo git -C /opt/xiu-online remote set-url origin https://github.com/hyp3699/xiu-online.git && sudo xiu-online-update
```

想手动强制覆盖（不跑更新脚本）：

```bash
cd /opt/xiu-online
sudo git fetch --depth 1 --force origin main
sudo git reset --hard FETCH_HEAD
sudo git clean -fdx -e server/node_modules
sudo systemctl restart xiu-online-test
```

### 更换代码仓库

以后要换成别的仓库地址，改这 3 处后推送，再在服务器上按上面的「第一次切换」命令把地址换成新仓库：

| 文件 | 要改的地方 |
| --- | --- |
| `deploy/xiu-update` | `REPO="${XIU_REPO:-https://github.com/hyp3699/xiu-online.git}"` |
| `deploy/install.sh` | `REPO="${XIU_REPO:-https://github.com/hyp3699/xiu-online.git}"` |
| `README.md` | 「安装」里的 `install.sh` 下载地址 |

也可以不改文件，临时指定：`sudo XIU_REPO=新仓库地址 xiu-online-update`。

### 卸载

```bash
sudo xiu-online-uninstall
```


## 绑定域名（HTTPS）

SSH 里输入 x

**APK 服务器地址是仓库根目录 `server-url.txt`。** 打包 APK 前，将它改成目标服务器地址，例如：

```text
http://你的服务器公网IP/xiuxian-test/
```

