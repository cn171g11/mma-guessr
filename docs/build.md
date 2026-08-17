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
go build ./...                    # 编译全部包（仅校验，不产可执行文件）
go vet ./...                      # 静态检查
go test ./...                     # 单元测试 + e2e（内存 SQLite，无外部依赖）
./scripts/build.ps1               # Windows 构建到 bin\mma-guessr.exe（Linux/macOS 用 ./scripts/build.sh）
./bin/mma-guessr                  # 启动（自动建表）
```

构建产物统一输出到 `backend/bin/`（已 gitignore），不会混入源码目录：

```bash
cd backend
./scripts/build.ps1 -Version v1.2.3        # 注入版本号（Windows PowerShell）
./scripts/build.sh v1.2.3                   # 注入版本号（Linux/macOS）
./scripts/build.sh                          # 仅构建当前平台
```

### 交叉编译（多平台产物）

`CGO_ENABLED=0` 下可交叉编译任意平台（无 CGO 依赖）。构建脚本识别 `GOOS`/`GOARCH`
环境变量并自动追加 `.exe` 后缀与 `-<os>-<arch>` 文件名：

```bash
cd backend
$env:GOOS="linux";  ./scripts/build.ps1    # Windows → linux/amd64
$env:GOOS="windows"; ./scripts/build.ps1   # Windows → windows/amd64
GOOS=linux GOARCH=arm64 ./scripts/build.sh # Linux/macOS → linux/arm64
```

手动交叉编译（与 release.yml 相同的命名规则）：

```bash
cd backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bin/mma-guessr-linux-amd64 ./cmd/server
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o bin/mma-guessr-windows-amd64.exe ./cmd/server
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o bin/mma-guessr-darwin-arm64 ./cmd/server
```

> 提示：如需给长期运行的服务设定内存上限，可设置环境变量 `GOMEMLIMIT`（字节）与
> `GOGC`（百分比），后端启动时会显式应用，跨平台生效（详见 `.env.example`）。

### 排行榜缓存重建

服务会在每日 UTC 0 点自动重建总榜与今日日榜缓存（`cmd/server` 内置）。若数据库恢复
或自动重建未运行，可手动执行（等价于原 Node 的 `rebuild-leaderboards` CLI）：

```bash
cd backend
go run ./cmd/rebuild-leaderboards   # 从 scores 表重建并清理过期日榜键
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
