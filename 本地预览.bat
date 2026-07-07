@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\electron\path.txt" (
  echo 首次启动，正在准备 Test cat 调试环境……
  where npm >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Node.js/npm。请先安装 Node.js 22.12 或更高版本。
    pause
    exit /b 1
  )
  call npm install --cache .npm-cache
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 Test cat……（按 F12 可打开调试工具）
call npm --cache .npm-cache run preview
if errorlevel 1 pause
