#!/usr/bin/env bash
# 停止占用 :8000(后端) 和 :3000(管理后台) 的进程
echo "🛑 停止后端 :8000 / 管理后台 :3000 ..."
for port in 8000 3000; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  端口 $port → 结束进程 $pids"
    kill $pids 2>/dev/null || true
  else
    echo "  端口 $port 无运行进程"
  fi
done
echo "✅ 完成"
