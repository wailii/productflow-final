# ProductFlow CloudBase 部署清单（低成本可持久化）

更新时间：2026-02-18

## 目标
- 平台：腾讯云 CloudBase 云托管（CloudRun）
- 方案：不依赖外部 MySQL，使用本项目内置 `local-db.json` 持久化
- 成本策略：`0.25 核 / 0.5GB`，最小实例 `0`，最大实例 `1`

## 你只要准备
1. 一个 CloudBase 环境（`env-xxxx`）
2. 一个对象存储桶（建议名：`productflow-data`）
3. 在云托管服务里把这个存储桶挂载成目录

## 仓库已准备好的内容
- `/Users/wali/Downloads/productflow-final/productflow-showcase/Dockerfile`
- `/Users/wali/Downloads/productflow-final/productflow-showcase/.dockerignore`
- `/Users/wali/Downloads/productflow-final/productflow-showcase/.env.cloudbase.example`
- `/Users/wali/Downloads/productflow-final/productflow-showcase/scripts/deploy-cloudbase.sh`

## 控制台逐项填写（建议值）

### 1. 创建云托管服务
- 服务名：`productflow-showcase`
- 部署方式：源码构建（使用仓库）
- 代码目录：`productflow-showcase`
- 端口：`3000`
- CPU：`0.25`
- 内存：`0.5GB`
- 最小实例数：`0`
- 最大实例数：`1`（重要：本地 JSON 写入不适合多实例并发）

### 2. 挂载持久化存储
在服务设置里新增“存储挂载”：
- 存储桶：`productflow-data`
- 挂载目录：`pf-data`
- 挂载后目录路径：`/mnt/cloudrun/productflow-data/pf-data`

### 3. 环境变量
按 `/Users/wali/Downloads/productflow-final/productflow-showcase/.env.cloudbase.example` 填：

- `NODE_ENV=production`
- `PORT=3000`
- `ENABLE_LOCAL_AUTH=true`
- `LOCAL_STORAGE_ROOT=/mnt/cloudrun/productflow-data/pf-data`
- `JWT_SECRET=<随机长串>`
- `VITE_APP_ID=local-auth`
- `OAUTH_SERVER_URL=https://example.com`
- `VITE_OAUTH_PORTAL_URL=https://example.com`
- `BUILT_IN_FORGE_API_URL=https://api.moonshot.cn/v1`
- `BUILT_IN_FORGE_API_KEY=placeholder`
- `AGENT_MAX_ITERATIONS=3`
- `AGENT_PASS_SCORE=85`
- `DATABASE_URL=`（留空即可）

生成 `JWT_SECRET` 示例：

```bash
openssl rand -base64 48
```

## 一键部署命令（可选）
在项目目录执行：

```bash
cd /Users/wali/Downloads/productflow-final/productflow-showcase
./scripts/deploy-cloudbase.sh <ENV_ID> productflow-showcase .
```

例如：

```bash
./scripts/deploy-cloudbase.sh env-abc123 productflow-showcase .
```

## 上线后验收
1. 打开首页，确认不再空白。
2. 注册新用户，确认不再出现 `Register failed`。
3. 新建一个项目并刷新页面，确认数据仍在。
4. 再手动发布一个新版本，重复第 3 步，确认数据仍在（验证挂载成功）。

## 成本说明（为什么这套更省）
- CloudBase 个人版（限时）约 `19.9 元/月`，含 `40,000` 资源点。
- 云托管官方单价（中国内地）：CPU `0.055 元/核时`，内存 `0.032 元/GB时`。
- 以 `0.25 核 + 0.5GB` 满负载估算：约 `0.02975 元/小时`，即约 `21.42 元/月`（30 天连续运行）。
- 你配置最小实例为 `0`，低流量时成本会低于满负载估算值。

## 官方文档
- CloudBase 云托管部署说明：
  [https://docs.cloudbase.net/run/deploy/version-setting](https://docs.cloudbase.net/run/deploy/version-setting)
- 云托管服务设置（环境变量）：
  [https://docs.cloudbase.net/run/deploy/service-setting/env](https://docs.cloudbase.net/run/deploy/service-setting/env)
- 云托管服务设置（存储挂载）：
  [https://docs.cloudbase.net/run/deploy/service-setting/storage](https://docs.cloudbase.net/run/deploy/service-setting/storage)
- 对象存储挂载路径说明：
  [https://docs.cloudbase.net/run/storage/mount](https://docs.cloudbase.net/run/storage/mount)
- CloudBase 计费：
  [https://cloud.tencent.com/document/product/876/75213](https://cloud.tencent.com/document/product/876/75213)
- 资源点与计费换算：
  [https://cloud.tencent.com/document/product/876/127357](https://cloud.tencent.com/document/product/876/127357)
