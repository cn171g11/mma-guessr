# 题库维护

题库源数据位于 `frontend/src/js/data.js` 的 `LOCATIONS` 常量，并派生 `WORLD_LOCATIONS` / `CHINA_LOCATIONS`（按名称前缀区分）。当前共 **1570 题**（中国 332 · 世界 1238）。

> 后端同步：`backend` 侧通过 `go run ./cmd/seed -data <data.js>` 将同一份数据导入 SQLite `locations` 表
> （幂等 upsert，按 `name` 唯一键），供 `/api/locations/random` 等在线接口使用；详见
> [database.md](database.md)。

## 条目结构

```js
{ name: '中国北京·天安门广场', lat: 39.9055, lng: 116.3976, region: 'asia', difficulty: 1 }
```

| 字段 | 说明 |
| --- | --- |
| `name` | 地点名称，需唯一且非空；以「中国」开头归入中国模式 |
| `lat` / `lng` | 坐标（WGS84） |
| `region` | 大洲：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania` |
| `difficulty` | 1（超著名地标）~ 5（偏远超难） |

## 工具脚本（`frontend/tools/`）

在 `frontend/` 目录下执行：

| 脚本 | 用途 |
| --- | --- |
| `add-china.js` | 向题库批量插入中国街景点位 |
| `add-hmt.js` | 向题库批量插入港澳台街景点位 |
| `apply-v114.js` / `apply-cn-cleanup.js` / `apply-world-expand.js` | 历史版本批量改写（一次性迁移用，可归档） |
| `validate-data.js` | 题库完整性校验（CI 使用，纯本地无网络） |
| `verify-cn-streetview.js` | 逐点调用 Mapillary API 验证中国点位街景覆盖 |
| `verify-world-expand.js` / `verify-world-expand2.js` | 候选世界点位覆盖验证（并发调用，输出报告） |
| `verify-v114.js` / `verify-backup.js` | 历史数据核验 |
| `gen-backup-manifest.js` | 生成备份 MANIFEST（对应旧备份方案，见 [BACKUP_outdated.md](BACKUP_outdated.md)） |

> ⚠️ 脚本直接读写 `frontend/src/js/data.js`，运行后请重新执行 `npm run format`。

## 校验规则（`validate-data.js`）

- 题库可解析且总量 = 期望值（默认 `1570`，可用环境变量 `EXPECTED_LOCATIONS` 覆盖）
- 地点名称唯一且非空
- `region` 属于六大洲之一；`difficulty` 为 1-5 的整数；`lat` / `lng` 在合法范围
- 派生题库 `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 声明存在且计数一致

```bash
cd frontend
node tools/validate-data.js                 # 校验（期望 1570）
EXPECTED_LOCATIONS=1600 node tools/validate-data.js   # 自定义期望值
```

## 街景覆盖验证（CI）

`streetview.yml` 手动触发，用 `secrets.MAPILLARY_TOKEN` 运行选定的验证脚本，报告存为 artifact：

1. Actions 页 → Street View Coverage Verification (manual) → Run workflow
2. 选择脚本与可选期望题量
3. 完成后下载 `verify-report` artifact 查看 `.verify-report.json` 等文件

未配置 Secret 时脚本回退到内置 token（额度有限，建议配置专属低权限 token）。