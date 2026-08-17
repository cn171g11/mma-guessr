# 测试指南

后端测试为 Go（`go test`），`backend/test/*_test.go` 直接对装配好的 HTTP handler 发起真实请求（使用 `httptest`，无需外部依赖）。

## 覆盖范围

`backend/test/auth_e2e_test.go` 覆盖认证全流程（对应原 Node `auth.e2e.test.ts`）：

- 注册 / 登录（邮箱或用户名）
- 验证码：发送、60s 重发限频、错误校验
- 刷新令牌：旋转换发、旧令牌复用拒绝
- 登出与令牌吊销
- 登录防爆破（5 次失败锁 15 分钟）
- 游客会话创建、游客绑定注册、进度迁移
- 防账号枚举：已注册/未注册邮箱返回一致

另在集成环境中做启动冒烟：`/api/health` 返回 `status: ok`。

## 运行

```bash
cd backend
go build ./...
go vet ./...
go test ./...     # 含 test/ 下全部 e2e 测试（内存 SQLite，无需外部服务）
```

- 测试使用内存 SQLite（`:memory:`），启动即建表，无遗留文件
- SMTP 未配置时验证码打印到服务日志（开发模式）；测试通过 `VerificationStore.SendCode` 直接获取明文验证码

## CI

CI 的 `backend-checks.yml` 运行 `go vet` + `go build` + 全量 `go test` + race 套件。