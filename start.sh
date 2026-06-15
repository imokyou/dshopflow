#!/usr/bin/env bash
# DropShipFlow 一键启动：同时拉起后端(:8000) + 管理后台(:3000)
# 用法：在项目根目录执行  ./start.sh   （Ctrl+C 可同时关闭两个服务）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
mkdir -p logs

# ── 选择 python 解释器 ──
PYTHON=""
for c in \
  "/opt/homebrew/Caskroom/miniconda/base/bin/python3" \
  "$(command -v python3 || true)" \
  "$(command -v python || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then PYTHON="$c"; break; fi
done
if [ -z "$PYTHON" ]; then echo "❌ 找不到 python3，请先安装 Python"; exit 1; fi

echo "🐍 使用 Python: $PYTHON"
echo "──────────────────────────────────────"

# ── 启动后端 ──
echo "🚀 启动后端 http://localhost:8000 ..."
( cd "$ROOT/backend" && PYTHONPATH=. "$PYTHON" -m uvicorn app.main:app --port 8000 \
    > "$ROOT/logs/backend.log" 2>&1 ) &
BACKEND_PID=$!

# ── 启动管理后台 ──
echo "🚀 启动管理后台 http://localhost:3000 ..."
( cd "$ROOT/admin" && npx next dev --port 3000 \
    > "$ROOT/logs/admin.log" 2>&1 ) &
ADMIN_PID=$!

# ── 退出时一起清理 ──
cleanup() {
  echo ""
  echo "🛑 正在关闭服务..."
  kill "$BACKEND_PID" "$ADMIN_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$ADMIN_PID" 2>/dev/null || true
  echo "✅ 已停止"
  exit 0
}
trap cleanup INT TERM

echo "──────────────────────────────────────"
echo "✅ 启动中（首次编译需几十秒）"
echo "   后端日志: logs/backend.log"
echo "   后台日志: logs/admin.log"
echo "   管理后台: http://localhost:3000"
echo "   按 Ctrl+C 关闭两个服务"
echo "──────────────────────────────────────"

# 实时输出两边日志，方便看启动情况/报错
touch logs/backend.log logs/admin.log
tail -n +1 -f logs/backend.log logs/admin.log &
TAIL_PID=$!

# 任一服务退出则整体退出
wait -n "$BACKEND_PID" "$ADMIN_PID" 2>/dev/null || true
kill "$TAIL_PID" 2>/dev/null || true
cleanup
