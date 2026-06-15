#!/usr/bin/env bash
# 重启：先停掉 :8000/:3000，再重新启动
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "🔄 重启 DropShipFlow ..."
./stop.sh
echo "⏳ 等待端口释放..."
sleep 2
exec ./start.sh
