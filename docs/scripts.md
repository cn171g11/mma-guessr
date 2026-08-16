# 运维命令（Go）

后端为 Go 单二进制，不再有 Node 脚本。全部命令在 `backend/` 目录下执行。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `go build ./...` | 编译全部包（快速发现编译错误） |
| `go vet ./...` | 静态检查（unreachable、printf 格式、锁拷贝等） |
| `go test ./...` | 单元测试 + 全量 e2e（httptest + 内存 SQLite，无外部服务） |
| `go test -race -timeout 300s ./test/` | 竞态检测套件 |
| `go run ./cmd/server` | 启动开发服务（自动建表） |
| `go run ./cmd/seed -data <data.js>` | 题库导入（幂等 upsert，默认解析 `../frontend/src/js/data.js`） |
| `gofmt -l .` | 列出未格式化文件 |
| `gosec`（`go run github.com/securego/gosec/v2/cmd/gosec@latest ./...`） | 安全扫描（G101/G115/G124/G202/G404/G705 等规则） |

## 示例

```bash
# 全量质量检查（与 CI 一致）
go build ./... && go vet ./... && go test ./...

# 构建产物并启动
go build -o mma-guessr ./cmd/server
PORT=3000 SQLITE_PATH=mma_guessr.db ./mma-guessr

# 导入题库
go run ./cmd/seed -data ../frontend/src/js/data.js

# 冒烟验证
curl -s http://localhost:3000/api/health
```

## 说明

- 所有命令以非零退出码结束，可直接用于 CI
- `cmd/seed` 解析 `frontend/src/js/data.js` 的 `LOCATIONS` 数组字面量（不执行 JS），按 `name` 幂等 upsert
- 服务启动即执行幂等迁移（`CREATE TABLE IF NOT EXISTS` + 成就种子），无需单独 migrate 步骤
