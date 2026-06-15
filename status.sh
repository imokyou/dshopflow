#!/usr/bin/env bash
# 查看后端(:8000) / 管理后台(:3000) 运行状态
check() {
  local name="$1" port="$2" url="$3"
  local pids http
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -z "$pids" ]; then
    printf "  %-10s :%s  ❌ 未运行\n" "$name" "$port"
    return
  fi
  http=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$http" != "000" ]; then
    printf "  %-10s :%s  ✅ 运行中 (PID %s, HTTP %s)\n" "$name" "$port" "$(echo $pids | tr '\n' ' ')" "$http"
  else
    printf "  %-10s :%s  ⏳ 进程在但未响应 (PID %s, 可能仍在编译)\n" "$name" "$port" "$(echo $pids | tr '\n' ' ')"
  fi
}

echo "📊 DropShipFlow 服务状态"
echo "──────────────────────────────────────"
check "后端"     8000 "http://localhost:8000/docs"
check "管理后台" 3000 "http://localhost:3000"
echo "──────────────────────────────────────"
