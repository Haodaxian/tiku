#!/bin/bash
# 在 macOS 上打包（pkg 单文件版 + Electron 桌面版）
#
# 为什么必须在 Mac 上跑：pkg 和 electron-builder 都只允许在 macOS 上构建 mac 目标，
# Windows / Linux 上会直接报 "only for 'win'" / "supported only on macOS"。
#
# 用法（Mac 终端里）：
#   cd 到项目目录
#   chmod +x tools/build-mac.sh
#   ./tools/build-mac.sh
#
# @author zz_lxf
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo ""
echo "  题库与讲义系统 · macOS 打包"
echo "  项目目录：$ROOT"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  没有找到 node，请先安装 Node.js LTS（https://nodejs.org）。"
  exit 1
fi
echo "  Node 版本：$(node -v)"

# 国内网络用镜像下载 electron 运行时，快很多；不设置也能走官方源
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

if [ ! -d node_modules/pkg ] && [ ! -d node_modules/@yao-pkg ]; then
  echo "  首次运行，安装依赖…"
  npm install
fi

# 架构：Apple 芯片 / Intel 可以都打，也可以只打当前这台
ARCHS="${1:-universal}"
case "$ARCHS" in
  arm64) TARGETS="node22-macos-arm64" ;;
  x64)   TARGETS="node22-macos-x64" ;;
  *)     TARGETS="node22-macos-arm64 node22-macos-x64" ;;
esac

echo ""
echo "  1/3 打 pkg 单文件版（$TARGETS）"
for t in $TARGETS; do
  if [ "$t" = "node22-macos-arm64" ]; then
    OUT="dist/题库与讲义系统-mac-Apple芯片"
  else
    OUT="dist/题库与讲义系统-mac-Intel"
  fi
  npx pkg . --targets "$t" --output "$OUT"
  chmod +x "$OUT"
  echo "    √ $OUT"
done

echo ""
echo "  2/3 打 Electron 桌面版（zip，含 .app）"
npx electron-builder --mac zip --config electron-builder.json

echo ""
echo "  3/3 生成发布压缩包"
node tools/build.js zip

echo ""
echo "  全部完成。"
echo "  程序在 dist 目录，发布压缩包在 dist/发布包 目录。"
echo "  给 Mac 用户时连同「启动-Mac.command」一起发（Apple 芯片需要它做本地签名）。"
echo ""
