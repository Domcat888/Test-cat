#!/bin/zsh

ROOT="${0:A:h}"
cd "$ROOT" || exit 1

if [[ ! -x "node_modules/.bin/electron" || ! -f "node_modules/electron/path.txt" ]]; then
  echo "首次启动，正在准备 Test cat 调试环境……"
  if ! command -v npm >/dev/null 2>&1; then
    echo "未找到 Node.js/npm。请先安装 Node.js 22.12 或更高版本。"
    read "?按回车关闭窗口……"
    exit 1
  fi
  npm install --cache .npm-cache || {
    echo "依赖安装失败，请检查网络后重试。"
    read "?按回车关闭窗口……"
    exit 1
  }
fi

echo "正在启动 Test cat……（按 F12 可打开调试工具）"
npm --cache .npm-cache run preview
STATUS=$?

if [[ $STATUS -ne 0 ]]; then
  echo "Test cat 启动失败，错误代码：$STATUS"
  read "?按回车关闭窗口……"
fi
