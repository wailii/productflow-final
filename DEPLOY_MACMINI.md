# Mac mini Demo 部署指南（开源项目线上演示）

更新时间：2026-02-24

## 目标
- 用 `Mac mini` 作为常驻 Demo 服务器。
- 项目单机单实例运行，数据持久化到主机目录。
- 默认不直接暴露公网端口，公网访问走 Cloudflare Tunnel（可选）。

## 仓库内已准备的文件
- `/Users/wali/Downloads/productflow-final/docker-compose.macmini.yml`
- `/Users/wali/Downloads/productflow-final/.env.macmini.example`
- `/Users/wali/Downloads/productflow-final/productflow-showcase/.env.macmini.example`
- `/Users/wali/Downloads/productflow-final/scripts/macmini/`

## 一次性初始化
在仓库根目录执行：

```bash
chmod +x /Users/wali/Downloads/productflow-final/scripts/macmini/*.sh
/Users/wali/Downloads/productflow-final/scripts/macmini/prepare.sh
```

首次运行会自动生成：
- `/Users/wali/Downloads/productflow-final/.env.macmini`
- `/Users/wali/Downloads/productflow-final/productflow-showcase/.env.macmini`

然后编辑这两个文件。

## 必改配置

### 1) 根目录 `.env.macmini`
- `PRODUCTFLOW_DATA_DIR`：改成你的实际路径（例如 `/Users/wali/server-data/productflow`）
- `CF_TUNNEL_TOKEN`：如果要公网访问，填 Cloudflare Tunnel token；不需要公网可留空

### 2) 应用目录 `productflow-showcase/.env.macmini`
- `JWT_SECRET`：必须替换为随机长串
- 其他变量默认即可，`DATABASE_URL` 可留空（使用本地持久化）

生成随机密钥：

```bash
openssl rand -base64 48
```

## 部署与运维

### 本地/LAN 部署（不带公网隧道）
```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/deploy.sh
```

### 启用公网（Cloudflare Tunnel）
```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/deploy.sh --public
```

### 常用运维命令
```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/status.sh
/Users/wali/Downloads/productflow-final/scripts/macmini/health.sh
/Users/wali/Downloads/productflow-final/scripts/macmini/logs.sh app
/Users/wali/Downloads/productflow-final/scripts/macmini/down.sh
/Users/wali/Downloads/productflow-final/scripts/macmini/update.sh
```

## 备份与恢复

### 手动备份
```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/backup.sh
```

默认输出目录：
- `${HOME}/server-backups/productflow`

### 恢复
```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/restore.sh /path/to/productflow-data-YYYYMMDD-HHMMSS.tgz
```

## 开机自启（在 Mac mini 上执行）

```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/install-launchd.sh
```

如果你需要开机后自动带公网隧道：

```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/install-launchd.sh --public
```

卸载：

```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/uninstall-launchd.sh
```

## 电源策略（在 Mac mini 上执行）

开启“服务模式”（防止睡眠中断）：

```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/power-keepawake.sh
```

恢复系统默认：

```bash
/Users/wali/Downloads/productflow-final/scripts/macmini/power-defaults.sh
```

## 安全与限制
- 端口只绑定 `127.0.0.1`，不直接暴露到公网。
- 容器使用非 root 用户（Dockerfile 已设置）。
- `docker-compose` 默认单实例，当前本地 JSON 持久化不适合多实例并发写入。
- `.env.macmini` 和 `productflow-showcase/.env.macmini` 不应提交到仓库。

## 发布建议（开源 Demo）
1. 每次发版前先执行一次备份。
2. 发版命令只用 `update.sh`，保持流程统一。
3. 如果 Demo 数据需要定期重置，建议加一个定时任务执行清理脚本或恢复脚本。
