@echo off
chcp 65001 >nul
title MmaGuessr 统计后端服务
echo ============================================
echo   MmaGuessr 统计后端服务 (v1.15.0)
echo ============================================
echo.
cd /d "%~dp0"

REM ---- 检查依赖 ----
if not exist "node_modules\express" (
    echo [首次运行] 正在安装依赖 express + better-sqlite3 ...
    call "%~dp0install-deps.bat" || goto :fail
)

echo [启动] 服务监听 0.0.0.0:8787 ...
echo [提示] 本机访问:   http://localhost:8787
echo [提示] 局域网访问: http://192.168.1.4:8787
echo [提示] 游戏接入:   访问游戏时 URL 追加 ?api=http://192.168.1.4:8787
echo [提示] 数据库:     %~dp0..\data\mma-stats.db
echo.
echo 按 Ctrl+C 可停止服务（统计数据不会丢失）。
echo ============================================
node "stats-server.js" --port 8787
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [错误] 启动失败，请检查 Node.js 是否安装、端口 8787 是否被占用。
pause
exit /b 1
