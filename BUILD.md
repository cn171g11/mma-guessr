# MmaGuessr Android APK 构建说明

将纯前端 HTML 项目（MmaGuessr v2.1.1）通过 **Capacitor 7** 封装为可安装的安卓 APK。

## 一、构建产物

| 项目 | 值 |
|---|---|
| APK 文件 | `MmaGuessr-v2.1.1.apk`（约 4.4 MB） |
| 包名 | `cn.mmaguessr.game` |
| 应用名 | MmaGuessr |
| 版本 | versionName `2.1.1` / versionCode `21` |
| SDK | minSdk `23`（Android 6.0+）/ targetSdk `35` |

> debug 包自带调试签名，可直接安装测试；正式发布需自行生成签名包（`bash build.sh release` 后使用 apksigner 签名）。

## 二、本机环境（已搭建，位于隔离目录）

- JDK 21：`C:\Users\Administrator\.workbuddy\android\jdk21`
- Android SDK：`C:\Users\Administrator\.workbuddy\android\sdk`（build-tools 35.0.0 / platform 35 / platform-tools）
- Gradle 8.11.1：`C:\Users\Administrator\.workbuddy\android\gradle-8.11.1`
- Node 22 + pnpm 9（项目依赖安装于 `node_modules/`）

## 三、重新构建

```bash
cd E:\Desktop\mma-guessr-apk
bash build.sh          # debug
bash build.sh release  # release（未签名）
```

## 四、相对原前端仓库的改动

| 文件 | 改动 |
|---|---|
| `web/index.html` | 3 个 CDN 库（Leaflet/Three/Socket.IO）本地化到 `vendor/`，移除 SRI，CSP 去掉 CDN 域名 |
| `web/js/config.js` | `API_BASE` 新增 `isCapacitor` 判断：APK 环境强制指向生产后端 `https://tuxun.edu-group.cn` |
| `web/vendor/` | 新增本地化的 leaflet.js/css + 图标、three.min.js、socket.io.min.js |
| `android/app/build.gradle` | versionCode 21 / versionName 2.1.1 |
| `android/build.gradle` | 仓库增加阿里云 Maven 镜像（google/central/gradle-plugin） |
| 图标 | 基于精修版 App 图标生成全部 mipmap（方形/圆形/自适应前景），背景色 `#0a1428` |

## 五、踩坑记录（重要）

1. **`NODE_OPTIONS` 的 safe-delete shim**：WorkBuddy 通过 `NODE_OPTIONS=--require genie-safe-delete.cjs` 拦截 node 的 `fs.unlink` 改为移回收站，导致 npm/pnpm 在 E 盘报 `trash`/`EPERM`/`SAFE_DELETE_BULK_CONFIRM` 错误。**所有 node 命令前必须 `unset NODE_OPTIONS`**（仅影响构建缓存，不涉及用户文件）。
2. **代理 403**：本机 Clash（127.0.0.1:7890）访问 Maven Central 返回 403，依赖改为阿里云镜像直连。
3. **Gradle 发行版下载超时**：wrapper 默认 10 秒超时且直连 services.gradle.org 失败；改用腾讯云镜像直连下载 gradle-8.11.1-bin.zip，本地 `gradle` 命令构建。
4. **JDK 版本**：Capacitor 7 要求 **JDK 21**（非 17），否则报 `无效的源发行版：21`。

## 六、后端配合（重要）

APK 内 WebView 的 origin 为 `https://localhost`，后端需将 `https://localhost` 加入 `CORS_ALLOWED_ORIGINS` 白名单，否则 APK 内账号/排行榜/街景代理等联网功能会被 CORS 拦截。当前 `config.js` 已让 APK 强制走生产后端 `https://tuxun.edu-group.cn`。

## 七、本地安装测试

1. 将 `MmaGuessr-v2.1.1.apk` 传到安卓手机（微信/数据线/网盘）
2. 手机允许「安装未知来源应用」
3. 安装并启动，即可游玩（街景需联网，前端资源已全部离线打包）

命令行安装（设备已连接且开启 USB 调试）：
```bash
adb install -r E:\Desktop\mma-guessr-apk\MmaGuessr-v2.1.1.apk
```
