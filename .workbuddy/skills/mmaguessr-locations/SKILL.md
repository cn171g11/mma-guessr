---
name: mmaguessr-locations
description: MmaGuessr 街景题库扩充与校验。向 data.js 的 LOCATIONS 添加/修改地点、同步 4 处联动（派生题库、CI 期望值、文档计数）、跑 validate-data.js 与 Mapillary 覆盖验证、导入后端 SQLite。用户说"加题/扩充题库/加点位/新地点/题库校验/validate data/Mapillary 验证"时使用。
agent_created: true
---

# MmaGuessr 题库扩充与校验

## 核心事实

- 源数据：`frontend/src/js/data.js` 的 `LOCATIONS` 常量
- 派生题库：同文件 `WORLD_LOCATIONS` / `CHINA_LOCATIONS`（按 `name` 是否以「中国」开头区分）
- 当前规模：**1570 题**（中国 332 · 世界 1238）
- 后端副本：SQLite `locations` 表，靠 `cmd/seed` 从同一份 data.js 导入

## 条目格式

```js
{ name: '中国北京·天安门广场', lat: 39.9055, lng: 116.3976, region: 'asia', difficulty: 1 }
```

| 字段 | 约束 |
|---|---|
| `name` | **唯一且非空**。以「中国」开头 → 归入中国模式（`CHINA_LOCATIONS`） |
| `lat` / `lng` | WGS84 坐标，须在合法范围 |
| `region` | 六选一：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania`。**中国点位也填 `asia`** |
| `difficulty` | 1（超著名地标）~ 5（偏远超难）整数 |

## ⚠️ 加题必须联动 4 处（最易漏）

| # | 位置 | 要改什么 |
|---|---|---|
| 1 | `frontend/src/js/data.js` | `LOCATIONS` 数组追加条目 |
| 2 | 同文件 | `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 派生数组**同步更新**，validate 会校验计数一致 |
| 3 | `.github/workflows/ci.yml` **和** `deploy.yml` | 两处的 `EXPECTED_LOCATIONS: 1570` 都要改成新总数（**两个文件，别只改一个**） |
| 4 | `docs/locations.md` | 顶部题数说明「1570 题（中国 332 · 世界 1238）」 |

漏改第 3 项 → CI 直接失败；漏改第 2 项 → `validate-data.js` 报派生题库计数不一致。

## 脚本速查（均在 `frontend/` 目录下执行）

| 脚本 | 用途 |
|---|---|
| `tools/add-china.js` | 批量插入中国街景点位。**目标城市数组内置在脚本里**，用前需先改脚本内的城市/点位列表 |
| `tools/add-hmt.js` | 批量插入港澳台点位（同上，改脚本内数据） |
| `tools/validate-data.js` | 无网络完整性校验，CI 同款 |
| `tools/verify-cn-streetview.js` | 逐点调 Mapillary API 验证中国点位覆盖，同时搜索新城市（**慢**） |
| `tools/verify-world-expand.js` / `verify-world-expand2.js` | 世界候选点位验证，并发调用，输出 `.world-expand-report*.json` |
| `tools/apply-v114.js` / `apply-cn-cleanup.js` / `apply-world-expand.js` | 历史一次性批量迁移脚本，已归档，新需求不要复用 |
| `tools/verify-v114.js` / `verify-backup.js` | 历史数据核验（注：`verify-backup.js` 属备份链路，见 mmaguessr-backup） |

```bash
cd E:/Desktop/geoguesser/frontend

# 校验（默认期望 1570）
node tools/validate-data.js

# 自定义期望值（加题后先这样试跑，确认无误再改 CI）
EXPECTED_LOCATIONS=1600 node tools/validate-data.js
```

### validate-data.js 校验规则

- 题库可被完整解析，且总数 = 期望值
- 地点名称唯一、非空
- `region` 属六大洲；`difficulty` 为 1-5 整数；`lat` / `lng` 在合法范围
- `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 声明存在且计数一致

任何一项失败即非零退出，可供 GitHub Actions 直接使用。

## Mapillary 覆盖验证

**Token 规则：脚本只接受环境变量，不内置密钥，未设置直接 `exit 1`。**

```bash
export MAPILLARY_TOKEN=<你的 token>     # 从环境变量读，绝不写进脚本/仓库
cd E:/Desktop/geoguesser/frontend
node tools/verify-cn-streetview.js
```

不想本地跑（慢、且要 token）时，用 GitHub Actions 手动触发：

`.github/workflows/streetview.yml` → `workflow_dispatch` → 选 `script`
（`verify-cn-streetview` / `verify-world-expand` / `verify-world-expand2`）→ 填 `expectTotal`。
它会自动跑 validate 前置校验，再调 API（用仓库 secrets 里的 token），最后把报告 JSON 作为 artifact 上传。

## 改完必做

```bash
# 脚本直接改写 data.js 文本，格式会被打乱，必须重新格式化
cd E:/Desktop/geoguesser/frontend
npm run format

# 同步到后端 SQLite（按 name 幂等 upsert，可重复执行）
cd ../backend
go run ./cmd/seed -data ../frontend/src/js/data.js
```

种子导入**不执行 JS**，只解析 `LOCATIONS` 数组字面量（括号配对 + 字符串感知），所以
data.js 里不要在数组内嵌复杂表达式。

## 区域平衡约束

v1.14.0 起确立的硬性规则，加题时遵守：

- **题库隔离**：中国题与世界题分开抽取，中国题占比 ≤ 20%
- **六大洲均衡**：新增世界点位时避免全部堆在同一个大洲

## ⚠️ 已知陷阱

1. **只改 CI 的一个文件** —— `ci.yml` 和 `deploy.yml` 各有一处 `EXPECTED_LOCATIONS`，两处都要改
2. **忘了派生题库** —— `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 是手写的，validate 会卡计数
3. **加了题不跑 `npm run format`** —— 脚本改写后的 data.js 格式会乱，CI prettier 必挂
4. **把 token 写进脚本** —— CI 的 grep 规则会拒绝提交，脚本也刻意设计成只认环境变量
5. **忘了后端 seed** —— 网页端题库更新了但 `/api/locations/random` 仍返回旧数据
6. **坐标来源** —— 数据来自 Mapillary，新点位**需逐点验证**街景覆盖，不要凭想象填坐标

## 校验清单

- [ ] `LOCATIONS` 条目格式正确、name 唯一
- [ ] `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 已同步
- [ ] `ci.yml` + `deploy.yml` 的 `EXPECTED_LOCATIONS` 已改为新总数
- [ ] `docs/locations.md` 题数说明已更新
- [ ] `node tools/validate-data.js` 通过（用新期望值）
- [ ] `npm run format` 已跑，`npm run format:check` 通过
- [ ] 新点位已跑 Mapillary 覆盖验证（本地或 Actions）
- [ ] 已执行 `go run ./cmd/seed` 同步后端
- [ ] 中国题占比 ≤ 20%，六大洲分布无明显倾斜

## 相关文件

| 文件 | 说明 |
|---|---|
| `frontend/src/js/data.js` | 题库源数据（LOCATIONS + 两个派生数组） |
| `docs/locations.md` | 题库维护规范（条目结构、脚本表、校验规则） |
| `.github/workflows/streetview.yml` | 手动触发的街景覆盖验证 |
| `backend/cmd/seed` | 题库导入 SQLite 的 CLI |
