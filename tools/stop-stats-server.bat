@echo off
chcp 65001 >nul
title MmaGuessr 统计后端 - 停止服务
echo 正在停止 MmaGuessr 统计后端 (端口 8787) ...
setlocal
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
    echo 找到进程 PID: %%p，正在结束...
    taskkill /F /PID %%p >nul 2>&1
)
echo.
echo [完成] 服务已停止。重新启动请运行 start-stats-server.bat
pause
