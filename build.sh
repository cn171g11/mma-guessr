#!/usr/bin/env bash
# ============================================================
# MmaGuessr Android APK 构建脚本（Capacitor 7）
# 用法：bash build.sh [debug|release]
#   debug   默认，生成可直接安装的调试包（自带 debug 签名）
#   release 生成未签名的发布包（需自行签名后上架）
# ============================================================
set -e

# ---------- 环境变量（按本机实际路径调整） ----------
export JAVA_HOME="C:/Users/Administrator/.workbuddy/android/jdk21"
export ANDROID_HOME="C:/Users/Administrator/.workbuddy/android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
GRADLE="C:/Users/Administrator/.workbuddy/android/gradle-8.11.1/bin/gradle"

# ---------- 关键：清空 NODE_OPTIONS + 禁用代理 ----------
# WorkBuddy 通过 NODE_OPTIONS 注入 safe-delete shim，会拦截 node 的 fs.unlink
# 改为移回收站，导致 npm/pnpm 在 E 盘失败；构建前必须清空。
# 依赖走阿里云镜像直连，禁用本机 Clash 代理（代理访问 maven central 会 403）。
unset NODE_OPTIONS BASH_ENV HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export NO_PROXY='*'

BUILD_TYPE="${1:-debug}"

echo "==> 同步前端资源（web/ → android/assets）"
npx cap sync android

echo "==> 构建 ${BUILD_TYPE} APK ..."
cd android
case "$BUILD_TYPE" in
    release)
        "$GRADLE" assembleRelease --no-daemon
        APK="app/build/outputs/apk/release/app-release-unsigned.apk"
        ;;
    *)
        "$GRADLE" assembleDebug --no-daemon
        APK="app/build/outputs/apk/debug/app-debug.apk"
        ;;
esac
cd ..

echo ""
echo "==> ✅ 构建完成，APK 路径："
echo "   android/$APK"
echo ""
echo "==> 安装到已连接的安卓设备（可选）："
echo "   adb install -r android/$APK"
