# 测试指南

后端测试使用 Vitest + supertest，直接对 Express 应用发起真实 HTTP 请求（不启动端口，无网络依赖）。

## 覆盖范围

`backend/test/auth.e2e.test.ts` 覆盖认证全流程：

- 注册 / 登录（邮箱或用户名）
- 验证码：发送、限频、错误校验
- 刷新令牌：旋转换发、旧令牌复用吊销
- 登出与令牌吊销
- 登录防爆破（5 次失败锁 15 分钟）
- 游客会话创建、游客绑定注册、进度迁移

另在集成环境中做启动冒烟：`/api/health` 返回 `status: ok`。

## 运行

```bash
cd backend
npm run db:up          # 启动 PostgreSQL + Redis（或使用任意可用的实例）
npm run db:migrate     # 建表（test.mjs 也会自动执行）
npm test               # vitest run
npm run test:watch     # 监听模式
```

- 测试以开发模式读取默认 `DATABASE_URL` / `REDIS_URL`（与 `docker-compose.yml` 一致）
- SMTP 未配置时验证码打印到服务日志，测试从日志捕获验证码

推荐使用运维脚本（自动自检依赖、迁移、执行测试）：

```bash
npm run script:test               # 自检 → 迁移 → 测试
npm run script:test -- --coverage # 覆盖率
```

## CI

集成测试在 CI 中通过 `docker/service` 临时启动 PostgreSQL + Redis 容器执行：

- `backend.yml` 手动触发 `mode=integration`
- `release.yml` 发布时默认执行（`includeIntegration=true`）

详见 [deploy.md](deploy.md)。