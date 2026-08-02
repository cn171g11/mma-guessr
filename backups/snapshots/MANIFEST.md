# MmaGuessr 多版本备份清单 (MANIFEST)

> 生成时间: 2026-08-02T10:18:29.523Z
> 备份方式: git tag（远程）+ git archive 快照（本地 backups/snapshots/*.zip）
> 每个 zip 均含对应版本工作树的完整文件（含新增/修改/删除后的最终状态）

| 版本 | 提交 | 日期 | 文件数 | 快照大小 | SHA256（前12位） | 版本说明 |
|------|------|------|--------|----------|------------------|----------|
| **v1.0.0** | `c7d7f40` | 2026-07-28 | 7 | 35.2 KB | `2c16f0018cbf` | Initial commit: MmaGuessr street-view geolocation game + GitHub Pages setup |
| **v1.7.0** | `9ec8192` | 2026-07-28 | 13 | 73.4 KB | `3279808afb51` | feat: 街景扩展至港澳台(新增18个验证点位+台北101坐标修正) + 搜索半径扩至1.3km + 更新记录时间精确到秒 v1.7.0 |
| **v1.8.0** | `339cf73` | 2026-07-29 | 12 | 72.3 KB | `8cb8e6a3d68f` | feat(v1.8.0): 题库去重173→167 + Notion文档入口 + 移动端地图折叠按钮 |
| **v1.9.0** | `3f081c0` | 2026-07-29 | 12 | 88.6 KB | `b541ba01be1c` | feat(v1.9.0): 中国模式(+117街景 167→284) + 挑战模式合并限时/竞赛(5轮120s) + 主界面UI升级 |
| **v1.9.1** | `d42a10c` | 2026-07-29 | 9 | 42.9 KB | `ec671fb4aee1` | chore(v1.9.1): 删除admin.html + 更新Notion文档为最新(284条) + 版本升级 |
| **v1.10.0** | `bee9aff` | 2026-07-30 | 9 | 45.9 KB | `2ff398565df8` | v1.10.0: 计分系统全面重构 — 分区参数 + α平衡系数 + dMin阈值 |
| **v1.11.0** | `b3620f6` | 2026-07-30 | 9 | 47.8 KB | `b1d7442c6b98` | v1.11.0: 历史记录面板 — 本地存储 + Mapillary原街景回看 + r1/r2回合排列 |
| **v1.12.0** | `0130eea` | 2026-07-30 | 14 | 56.3 KB | `959246622774` | v1.12.0: 中国街景点位全面排查 — 逐点Mapillary验证 + 七城新增 |
| **v1.13.0** | `bebbdda` | 2026-07-31 | 17 | 97.1 KB | `ddd32bfadd26` | v1.13.0: 地图锁定 + 横屏适配 + 错误报告导出 + 世界点位扩充176 |
| **v1.14.0** | `6a6dbc8` | 2026-08-01 | 20 | 173.3 KB | `9dc238b23616` | v1.14.0 补充: 区域平衡 — 非洲/美洲/大洋洲题量补强至与欧洲/亚洲持平 |
| **v1.15.0** | `2551da4` | 2026-08-02 | 21 | 182.6 KB | `968958203348` | v1.15.0: 数据统计 — 访问PV/UV + 游玩轮次 + 可视化图表 + 可选Node后端 |

## 版本文件明细

### v1.0.0 (c7d7f40) — 7 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
```

### v1.7.0 (9ec8192) — 13 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
admin.html
admin.template.html
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
tools/build-admin.js
validate_hmt.py
```

### v1.8.0 (339cf73) — 12 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
admin.html
admin.template.html
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
tools/build-admin.js
```

### v1.9.0 (3f081c0) — 12 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
admin.html
admin.template.html
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
tools/build-admin.js
```

### v1.9.1 (d42a10c) — 9 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
```

### v1.10.0 (bee9aff) — 9 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
```

### v1.11.0 (b3620f6) — 9 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/add-china.js
tools/add-hmt.js
```

### v1.12.0 (0130eea) — 14 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/.verify-report.json
tools/_gen-cn-list.js
tools/_stats.js
tools/add-china.js
tools/add-hmt.js
tools/apply-cn-cleanup.js
tools/verify-cn-streetview.js
```

### v1.13.0 (bebbdda) — 17 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/.verify-report.json
tools/.world-expand-report.json
tools/.world-expand-report2.json
tools/add-china.js
tools/add-hmt.js
tools/apply-cn-cleanup.js
tools/apply-world-expand.js
tools/verify-cn-streetview.js
tools/verify-world-expand.js
tools/verify-world-expand2.js
```

### v1.14.0 (6a6dbc8) — 20 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/.v114-valid.json
tools/.verify-report.json
tools/.world-expand-report.json
tools/.world-expand-report2.json
tools/add-china.js
tools/add-hmt.js
tools/apply-cn-cleanup.js
tools/apply-v114.js
tools/apply-world-expand.js
tools/verify-cn-streetview.js
tools/verify-v114.js
tools/verify-world-expand.js
tools/verify-world-expand2.js
```

### v1.15.0 (2551da4) — 21 个文件
```
.gitignore
.nojekyll
MmaGuessr.html
README.md
game.html
index-prototype.html
index.html
tools/.v114-valid.json
tools/.verify-report.json
tools/.world-expand-report.json
tools/.world-expand-report2.json
tools/add-china.js
tools/add-hmt.js
tools/apply-cn-cleanup.js
tools/apply-v114.js
tools/apply-world-expand.js
tools/stats-server.js
tools/verify-cn-streetview.js
tools/verify-v114.js
tools/verify-world-expand.js
tools/verify-world-expand2.js
```
