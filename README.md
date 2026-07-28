# MmaGuessr · 街景猜位置游戏

一个以 [Mapillary](https://www.mapillary.com/) 为数据源的 GeoGuessr 风格地理猜谜游戏。观察世界各地随机街景，在地图上标记你猜测的位置，系统按实际距离计分。

支持五种模式：**经典 / 限时 / 多轮竞赛 / 区域限定 / 无限（闯关升级）**，并带有得分动画、距离可视化、历史最佳记录与成绩分享功能。

> 当前版本：**v1.6.0**

---

## 目录结构

```
geoguesser/
├── MmaGuessr.html        # 游戏主文件（核心）
├── index.html            # 个人站首页：自动跳转到 MmaGuessr.html
├── game.html             # 早期原型（自定义题库版）
├── index-prototype.html  # 早期原型（原 index.html 备份）
├── .nojekyll             # 告诉 GitHub Pages 不要启用 Jekyll 构建
├── .gitignore            # 忽略 .workbuddy/ 等工作区内部目录
└── README.md             # 本文件
```

说明：GitHub Pages 个人站点的入口固定是 `index.html`。这里让 `index.html` 直接跳转到真正的游戏 `MmaGuessr.html`。
如果你希望**打开站点就直接是游戏、不要跳转**，把 `MmaGuessr.html` 改名为 `index.html` 即可（同时删掉这个跳转用的 `index.html`）。

---

## 如何把它托管到 GitHub 个人网页（GitHub Pages）

GitHub Pages 提供两种站点，**推荐用第一种**来当“个人网页”：

| 类型 | 仓库名 | 访问地址 | 适合 |
|------|--------|----------|------|
| **用户/组织页** | 必须叫 `你的用户名.github.io` | `https://你的用户名.github.io/` | 个人主页、长期托管 |
| 项目页 | 任意仓库名 | `https://你的用户名.github.io/仓库名/` | 某个具体项目 |

本仓库已经按「用户页」的结构准备好了（根目录有 `index.html` + `.nojekyll`）。

### 第一步：在 GitHub 上建仓库

1. 登录 https://github.com
2. 右上角 **＋ → New repository**
3. **Repository name** 填：`你的用户名.github.io`
   - 例如你的账号叫 `tom123`，就填 `tom123.github.io`
   - 必须是你自己的用户名，否则无法作为个人页
4. 选 **Public**（私有仓库需要付费才能用 Pages）
5. **不要**勾选 “Add a README file”（我们已经有了）
6. 点 **Create repository**

### 第二步：把代码推上去

在本机（项目目录 `E:\Desktop\geoguesser`）打开 **Git Bash**，依次执行：

```bash
# 进入项目目录
cd E:/Desktop/geoguesser

# 设置你的提交身份（只针对本仓库，请把邮箱换成你 GitHub 绑定的邮箱）
git config user.name  "你的名字"
git config user.email "you@example.com"

# 关联远程仓库（把 tom123 换成你的用户名）
git remote add origin https://github.com/tom123/tom123.github.io.git

# 推送到 main 分支
git branch -M main
git push -u origin main
```

> 如果 push 时要输入账号密码：GitHub 已不支持密码登录，请用 **Personal Access Token（PAT）** 当密码；
> 或在本地配置 SSH key 后改用 `git@github.com:tom123/tom123.github.io.git` 这种地址。
> 生成 PAT：GitHub → Settings → Developer settings → Personal access tokens → 勾选 `repo` 权限。

### 第三步：开启 GitHub Pages

1. 进入刚创建的仓库页面
2. 点 **Settings → Pages**（左侧边栏）
3. **Build and deployment** 下：
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，目录选 **/ (root)**
   - 点 **Save**
4. 页面顶部会出现一句 “Your site is published at https://你的用户名.github.io/”
5. 等 **1～2 分钟** 让 CDN 生效，打开该地址即可玩 🎮

### （备选）用「项目页」托管

如果你不想用 `用户名.github.io` 这个特殊仓库名，也可以：
1. 建一个普通仓库，比如叫 `mma-guessr`
2. 同样 `git push` 上去
3. Settings → Pages 选 main 分支 / root
4. 访问地址就是 `https://你的用户名.github.io/mma-guessr/`

---

## 后续如何更新游戏

直接改 `MmaGuessr.html`（游戏本体），然后：

```bash
cd E:/Desktop/geoguesser
git add -A
git commit -m "更新游戏内容"
git push
```

GitHub Pages 会自动重新部署，通常 1 分钟内生效（想立刻生效可在仓库 **Actions / Pages** 里看部署进度）。

---

## 注意事项

- **`.nojekyll` 不要删**：它能阻止 GitHub 用 Jekyll 处理网站，避免把以下划线 `_` 开头的文件忽略掉（虽然本项目没用下划线文件，但留着最稳妥）。
- **CDN 依赖**：游戏通过 `unpkg.com` 加载 Leaflet 和 Mapillary JS，因此**部署后访问需要联网**，纯本地离线打不开街景和地图。
- **Mapillary Token**：`MmaGuessr.html` 里已内置一个可用的访问令牌。若街景失效，去 https://www.mapillary.com/dashboard/developers 申请免费 token，替换文件里的 `MAPILLARY_TOKEN` 即可。
- **自定义域名（可选）**：Settings → Pages → Custom domain 填入你的域名，并按提示在域名服务商处加一条 `CNAME` 解析到 `你的用户名.github.io.` 即可。
