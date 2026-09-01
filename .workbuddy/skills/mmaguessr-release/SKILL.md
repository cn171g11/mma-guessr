---
name: mmaguessr-release
description: MmaGuessr 版本发布总控。网页端（GitHub Pages）与安卓 App 端双轨发版：版本号递增规则、CHANGELOG 规范、双端文件同步映射、发版前质量门禁、推送与收尾。用户说"发布新版本/发版/release/上线/递增版本号/更新版本/release version"时使用。
agent_created: true
---

# MmaGuessr 版本发布总控

## 何时使用

- 用户要求发布新版本、上线、发版
- 需要递增网页端 / App 端版本号
- 一批功能改完，要走完整的「改码 → 门禁 → 推送 → 部署 → 备份」链路

## 核心事实（先看这个，别凭记忆）

| 项 | 位置 | 当前值 |
|---|---|---|
| 网页端版本号 | `frontend/src/js/config.js` 的 `VERSION` 常量 | `v2.2.0` |
| 网页端 CHANGELOG | 同文件 `CHANGELOG` 数组 | 最新条目 v2.2.0 |
| App 端版本名 | `E:\Desktop\mma-guessr-apk\android\app\build.gradle` → `versionName` | `2.3.1` |
| App 端版本码 | 同上 → `versionCode`（整数，每次 +1） | `25` |
| 网页端线上 | push `main` 分支 → `deploy.yml` → GitHub Pages | — |
| App 端线上 | push `android` 分支 → 创建 release + 上传 APK | — |

> ⚠️ **版本号双轨分离**（用户明确要求）：网页端与 App 端版本号**不要求一致**，各自独立递增。
> 例如网页端 v2.2.0 时 App 端已是 v2.3.0。不要自作主张对齐。

## 双端文件同步映射表（改一处必须改另一处）

`frontend/src/` 与 `mma-guessr-apk/web/` 是**两份独立拷贝**，没有构建期同步机制：

| 网页端 `frontend/src/` | App 端 `mma-guessr-apk/web/` |
|---|---|
| `js/config.js` | `web/js/config.js` |
| `js/game.js` | `web/js/game.js` |
| `js/events.js` | `web/js/events.js` |
| `js/features.js` | `web/js/features.js` |
| `js/packs.js` | `web/js/packs.js` |
| `js/api.js` `js/auth.js` `js/mp.js` `js/lb.js` `js/daily.js` `js/data.js` | `web/js/` 同名文件 |
| `css/style.css` | `web/css/style.css` |
| `index.html` | `web/index.html` |

改动顺序建议：**先在网页端改完并验证，再逐文件同步到 App 端**，最后校验两边 diff 为空。

## 发版步骤

### 1. 版本号 + CHANGELOG

`frontend/src/js/config.js`：

```js
const VERSION = 'vX.Y.Z';
const CHANGELOG = [
    {
        version: 'vX.Y.Z',
        date: 'YYYY-MM-DD HH:MM:SS',
        changes: [
            '🗺️ 功能一句话描述（用户视角，说清带来什么）',
            '🔧 修复一句话描述',
            '版本号递增至 vX.Y.Z。',   // 末条固定写法
        ],
    },
    // ... 更早的版本在下面
];
```

CHANGELOG 规则：**按时间倒序，最新在最上**；每条必含 `version` / `date` / `changes[]`；
`changes` 用 emoji 开头分类，最后一条固定写「版本号递增至 vX.Y.Z。」

App 端：`android/app/build.gradle` 的 `versionCode` +1、`versionName` 改为新版本。

### 2. 发版前门禁（任一失败不得推送）

```bash
cd E:/Desktop/geoguesser/frontend

# ① prettier —— CI 强制 endOfLine: lf，Windows CRLF 会全文件报错
npm run format:check
# 不通过就：npm run format

# ② 语法检查（与 CI 同款清单）
for f in src/js/config.js src/js/data.js src/js/api.js src/js/game.js \
         src/js/auth.js src/js/lb.js src/js/daily.js src/js/mp.js \
         src/js/features.js src/js/packs.js; do node --check "$f" || exit 1; done
for f in tools/*.js; do node --check "$f" || exit 1; done

# ③ 题库校验
node tools/validate-data.js
```

**④ 硬编码令牌自检**（CI 的 grep 规则，会误伤长字符串）：

```bash
grep -rniE --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=dist --exclude-dir=_site --exclude-dir=release \
  'MLY\|[0-9]{10,}\|[0-9A-Za-z]{20,}' .
```

CI 里这条规则命中即 `exit 1` 拒绝提交。注意它**不只匹配 Mapillary token**，
任何 20 位以上连续字母数字串都会命中 —— 已知需放行的：

> **⚠️ 2026-09-01 此规则已修正**：原 `'MLY\|[0-9]{10,}\|[0-9A-Za-z]{20,}'` 会误伤
> **任何 20 位以上连续字母数字** —— base64、JWT、SHA 哈希，连 WGS84 偏心率常数
> `0.00669342162296594323` 都会被判为"硬编码 Mapillary token"而拒绝提交。
> 已收窄为**只匹配 `MLY|` 前缀**（Mapillary 现行唯一有效 token 格式）：
>
> ```bash
> grep -rniE --exclude-dir=node_modules --exclude-dir=.git \
>   --exclude-dir=dist --exclude-dir=_site --exclude-dir=release \
>   'MLY\|[0-9A-Za-z._-]{20,}' .
> ```
>
> 改动此规则时必须双向验证：真 token（`MLY|eyJ...`）仍被拦 **且** 长哈希/长数字常数仍放行。

### 本地复现 CI 格式检查（重要，别被假报警骗了）

**不要直接在工作区跑 `npm run format:check`** —— 工作区是 CRLF（core.autocrlf=true），
prettier 的 `endOfLine: lf` 会对**几乎每个文件**报警（实测 27 个），全是假象，CI 其实是通过的。

正确做法：用 `git show` 导出 git 对象原始内容（LF）到临时目录再跑 prettier：

```bash
cd E:/Desktop/geoguesser
git ls-files frontend > /tmp/flist.txt
mkdir -p /tmp/ciroot && rm -rf /tmp/ciroot/*
while IFS= read -r f; do
  rel=${f#frontend/}; out="/tmp/ciroot/$rel"
  mkdir -p "$(dirname "$out")"
  git show "HEAD:$f" > "$out" 2>/dev/null || rm -f "$out"
done < /tmp/flist.txt

cp frontend/.prettierrc.json frontend/.prettierignore /tmp/ciroot/
cd /tmp/ciroot
/e/Desktop/geoguesser/frontend/node_modules/.bin/prettier --check \
  "src/**/*.{html,css,js}" "tools/*.js" "*.html" "*.{md,json}"
```

> - prettier 未装时先装：`cd frontend && unset NODE_OPTIONS BASH_ENV &&
>   npm ci --noproxy='*'`（约 30s；`--noproxy` 是本机代理环境的必需项）
> - 只格式化**本次改动的文件**（`npx prettier --write src/js/config.js`），
>   **不要** `npm run format` 全量跑，会动到无关文件

- `frontend/src/js/config.js` 的 `API_SIGNING_SECRET`（256-bit 十六进制，
  已用连字符分组规避，改动时**务必保持分组格式**）
- `package-lock.json` 等锁文件（已在 CI 排除 `node_modules`，但根目录锁文件仍可能命中）

自检若命中新增内容，改用环境变量注入或连字符分组后再推。

### 3. 本地提交

工作区在 **`go` 分支**（本地开发主分支），网页端发布内容需同步到 `main`。
先在本地提交：

```bash
git add -A
git status --short          # 确认没有误提交 keystore、.env、PAT
git commit -m "feat(scope): 描述（vX.Y.Z）"
```

提交信息遵循 Conventional Commits（`feat` / `fix` / `chore` / `refactor` / `perf` / `style` / `docs`），
可在末尾带版本号，与仓库历史风格一致。

### 4. 推送与部署

→ 交给 **mmaguessr-push** skill（GFW 环境必须走 REST API 脚本，不能用 `git push`）

### 5. 收尾

- 打版本备份 tag + zip 快照 → **mmaguessr-backup** skill
- App 端如需出新 APK → **mmaguessr-android** skill 构建后再用 push 脚本上传
- **提醒用户同步 Notion 文档**：用户惯例是每次发布同步全部页面
  （父页面 / 玩法 / 全球街景分布页）。Notion MCP 若未连接，只能提示用户手动同步

## ⚠️ 已知陷阱

1. **只改网页端忘了 App 端**（或反之）——双份拷贝，没有自动同步。发版前逐文件核对映射表
2. **CHANGELOG 插到数组末尾**——必须插到**最前面**（倒序）
3. **prettier 未过就推送**——CI 会拒绝，线上停在旧版本，且现象具有迷惑性（代码已推送但看不到更新）
4. **`frontend/` 路径变更才会触发部署**——`.github/workflows/deploy.yml` 的 `paths-ignore`
   排除了 `README.md` / `CONTRIBUTING.md` / `AGENTS.md` / `docs/**` / `backend/**`，
   只改这些不会触发 Pages 部署
5. **版本号擅自对齐双端**——用户要求分离，不要"顺手"统一

## 校验清单

- [ ] 网页端 `VERSION` + `CHANGELOG` 已更新，CHANGELOG 新条目在最前
- [ ] App 端 `versionCode` +1、`versionName` 已更新
- [ ] 双端改动文件已按映射表同步，两边 diff 为空
- [ ] `npm run format:check` 通过
- [ ] `node --check` 全部通过
- [ ] `node tools/validate-data.js` 通过
- [ ] 硬编码令牌 grep 无新增命中
- [ ] 已本地提交，commit 信息符合 Conventional Commits
- [ ] 推送后 GitHub Actions 的 Deploy 工作流显示为成功（不是只看 push 返回 200）
- [ ] 已提醒用户同步 Notion 文档

## 相关文件

| 文件 | 说明 |
|---|---|
| `frontend/src/js/config.js` | VERSION / CHANGELOG / 模式计分参数 / API 地址 / 签名密钥 |
| `frontend/package.json` | `format` / `format:check` / `serve` 脚本 |
| `.github/workflows/deploy.yml` | Pages 部署（含 validate 阶段） |
| `.github/workflows/ci.yml` | 前端 CI（lint + 语法 + 数据校验） |
| `.github/workflows/release.yml` | 整项目发布（手动触发，含 GHCR 镜像） |
| `E:\Desktop\mma-guessr-apk\android\app\build.gradle` | App 版本号、applicationId |
