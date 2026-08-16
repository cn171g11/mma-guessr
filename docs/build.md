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

后端为 **Go + SQLite 单二进制**（纯标准库 + modernc sqlite，无 CGO）：

```bash
cd backend
go build ./...                    # 编译全部包
go vet ./...                      # 静态检查
go test ./...                     # 单元测试 + e2e（内存 SQLite，无外部依赖）
go build -o mma-guessr ./cmd/server   # 生成可执行文件
./mma-guessr                      # 启动（自动建表）
```

### 交叉编译（多平台产物）

`CGO_ENABLED=0` 下可交叉编译任意平台（无 CGO 依赖）：

```bash
cd backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o mma-guessr-linux-amd64 ./cmd/server
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o mma-guessr-windows-amd64.exe ./cmd/server
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o mma-guessr-darwin-arm64 ./cmd/server
```

## Docker 镜像

`backend/Dockerfile` 为多阶段构建（`golang:1.26-alpine` 编译 → `alpine:3.21` 精简运行，非 root 用户）：

```bash
cd backend
docker build --build-arg VERSION=v1.0.0 -t mma-guessr-backend:v1.0.0 .
```

运行：

```bash
docker run -d -p 3000:3000 \
  -v mma-data:/app/data \
  -e NODE_ENV=production \
  -e JWT_ACCESS_SECRET="$(openssl rand -base64 64)" \
  -e JWT_REFRESH_SECRET="$(openssl rand -base64 64)" \
  -e VERIFY_CODE_SECRET="$(openssl rand -base64 64)" \
  mma-guessr-backend:v1.0.0
```

## 提交前检查

```bash
cd frontend && npm run format:check
cd backend  && go build ./... && go vet ./... && go test ./...
```
