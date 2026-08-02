' MmaGuessr 统计后端 - 隐藏窗口启动器
' 放入 Windows 启动文件夹即可开机自动运行（无黑窗）
' 启动文件夹: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
Set ws = CreateObject("WScript.Shell")
ws.Run """E:\Desktop\geoguesser\tools\start-stats-server.bat""", 0, False
