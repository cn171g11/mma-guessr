# 构建指南

## 前端

前端为**纯静态项目**（HTML/CSS/JS），没有构建步骤：`frontend/src/` 下文件即最终产物，浏览器直接加载。

开发时只需保证代码风格统一（在 `frontend/` 目录下执行）：

```bash
cd frontend
npm install              # 仅安装 Prettier（开发工具）
npm run format           # 格式化 src/ 与 tools/ 下全部代码
npm run format:check     # 检查代码风格（CI 使用）
```

## 后端

```bash
cd backend
npm run typecheck        # TypeScript 类型检查（tsc --noEmit）
npm run lint             # ESLint
npm run format:check     # Prettier 风格检查
npm run build            # tsc 编译到 dist/
npm run start            # 运行编译产物（node dist/index.js）
```

也可用运维脚本一键执行：`npm run script:check` / `npm run script:build`，见 [scripts.md](scripts.md)。

## Docker 镜像

`backend/Dockerfile` 为多阶段构建（`node:20-alpine`，构建产物后精简运行）：

```bash
# 本地构建镜像
npm run script:build -- --docker --tag mma-guessr-backend:v1.0

# 推送 GHCR（需先 docker login ghcr.io）
npm run script:deploy -- --push
```

CI 中的镜像构建与推送见 [deploy.md](deploy.md)。

## 提交前检查

```bash
cd frontend && npm run format:check
cd backend  && npm run typecheck && npm run lint && npm run format:check
```