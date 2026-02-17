# ProductFlow 本地部署指南

## 环境要求

- Node.js 22.x
- pnpm 10.x
- MySQL 8.0+ 或 TiDB（推荐使用 TiDB Cloud 免费版）

## 快速开始

### 1. 解压代码

```bash
tar -xzf productflow-showcase-code.tar.gz
cd productflow-showcase
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

在项目根目录创建 `.env` 文件，填入以下配置：

推荐先复制模板：

```bash
cp .env.example .env
```

```env
# 数据库连接（必需）
DATABASE_URL=mysql://user:password@host:port/database

# JWT 密钥（必需，用于会话管理）
JWT_SECRET=your-random-secret-key-here

# Manus OAuth 配置（如果需要用户认证）
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://auth.manus.im
OWNER_OPEN_ID=your-owner-open-id
OWNER_NAME=Your Name
# 内置邮箱注册/登录（推荐本地默认开启）
ENABLE_LOCAL_AUTH=true
# 仅本地调试：是否启用 /api/oauth/dev-login
ENABLE_DEV_LOGIN=false

# AI 服务配置（必需，用于 AI 工作流）
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=your-api-key
VITE_FRONTEND_FORGE_API_KEY=your-frontend-api-key
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im

# 工作流 LLM（推荐：Kimi）
LLM_API_URL=https://api.moonshot.cn/v1
LLM_API_KEY=your-kimi-api-key
LLM_MODEL=kimi-k2.5
```

**重要说明：**
- `DATABASE_URL`: 您的 MySQL/TiDB 连接字符串
- `JWT_SECRET`: 随机生成一个安全的密钥（可使用 `openssl rand -base64 32`）
- Manus OAuth 相关配置：如果您想使用 Manus 的用户认证系统，需要在 [Manus 开发者平台](https://manus.im) 创建应用获取
- 项目已内置邮箱注册/登录（`ENABLE_LOCAL_AUTH=true`），可不依赖外部 OAuth
- 登录入口统一走 `/api/oauth/start`，服务端会生成并校验 OAuth `state`
- 仅在本地且 `ENABLE_DEV_LOGIN=true` 时，才允许使用 `/api/oauth/dev-login`
- AI API 配置：工作流步骤默认读取 `LLM_API_*`（推荐配置为 Kimi）；如果未配置，会回退到 `BUILT_IN_FORGE_API_*`

### 4. 初始化数据库

```bash
pnpm db:push
```

这会自动创建所需的数据库表（`users`、`projects`、`workflow_steps`）。

### 5. 启动开发服务器

```bash
pnpm dev
```

应用将在 `http://localhost:3000` 启动。

### 6. 运行测试

```bash
pnpm test
```

## 生产部署

生产环境会在启动时强校验关键变量，缺失会直接启动失败（Fail Fast）：
- `DATABASE_URL`
- `JWT_SECRET`
- `LLM_API_KEY`（或 `BUILT_IN_FORGE_API_KEY`）
- `VITE_APP_ID` + `OAUTH_SERVER_URL` + `VITE_OAUTH_PORTAL_URL`

### 1. 构建生产版本

```bash
pnpm build
```

### 2. 启动生产服务器

```bash
pnpm start
```

## 项目结构

```
productflow-showcase/
├── client/                 # 前端代码
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   │   ├── Home.tsx           # 项目列表页
│   │   │   └── ProjectDetail.tsx  # 项目详情页
│   │   ├── components/    # UI 组件
│   │   ├── lib/          # 工具库（tRPC 客户端）
│   │   └── App.tsx       # 路由配置
│   └── public/           # 静态资源
├── server/                # 后端代码
│   ├── routers.ts        # tRPC API 路由
│   ├── workflow-engine.ts # AI 工作流引擎
│   ├── db-helpers.ts     # 数据库查询辅助函数
│   ├── db.ts             # 数据库连接和用户管理
│   └── _core/            # 核心框架代码
├── drizzle/              # 数据库 Schema
│   └── schema.ts         # 数据表定义
├── shared/               # 前后端共享代码
└── todo.md              # 开发任务清单
```

## 核心文件说明

### 后端核心文件

- **`server/workflow-engine.ts`**: AI 工作流引擎，包含 9 个步骤的 Prompt 和执行逻辑
- **`server/routers.ts`**: tRPC API 定义，包含项目管理和工作流执行的所有接口
- **`server/db-helpers.ts`**: 数据库操作封装，提供项目和步骤的 CRUD 方法
- **`drizzle/schema.ts`**: 数据库表结构定义

### 前端核心文件

- **`client/src/pages/Home.tsx`**: 项目列表页，支持创建新项目
- **`client/src/pages/ProjectDetail.tsx`**: 项目详情页，展示 9 步工作流和执行界面
- **`client/src/App.tsx`**: 路由配置

## 自定义 AI 服务

如果您想使用自己的 AI 服务（而非 Manus AI API），可以修改 `server/workflow-engine.ts` 中的 `executeStepWithAI` 函数：

```typescript
// 替换为您的 AI 服务调用
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function executeStepWithAI(prompt: string, context: any) {
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: "You are a product requirement analyst." },
      { role: "user", content: prompt }
    ],
  });
  
  return response.choices[0].message.content;
}
```

## 常见问题

### Q: 数据库连接失败

A: 请检查 `DATABASE_URL` 是否正确，确保数据库服务正在运行，并且用户有足够的权限。

### Q: AI 执行失败

A: 请检查 `BUILT_IN_FORGE_API_KEY` 是否正确，或者按照上述说明替换为您自己的 AI 服务。

### Q: 用户认证失败

A: 如果不需要 Manus OAuth，可以修改代码移除认证逻辑，或者实现您自己的认证系统。

## 技术栈

- **前端**: React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **后端**: Express, tRPC 11, Node.js 22
- **数据库**: MySQL/TiDB, Drizzle ORM
- **AI**: Manus AI API（可替换为 OpenAI/Claude 等）
- **认证**: Manus OAuth（可替换）

## 许可证

MIT License

## 支持

如有问题，请参考项目中的 `todo.md` 文件查看开发进度和已知问题。
