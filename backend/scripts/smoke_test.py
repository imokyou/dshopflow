#!/usr/bin/env python3
"""DropShipFlow 冒烟测试 —— 验证 S1/S2 修复在真实运行的后端上生效。

仅用 Python 标准库（urllib），无需额外依赖。在 `./restart.sh` 启动后端后运行：

    # 仅跑无需登录的安全检查
    python3 backend/scripts/smoke_test.py

    # 带上管理员账号，跑需要鉴权的检查（SSRF 拦截 / worker 存活等）
    SMOKE_EMAIL=admin@example.com SMOKE_PASSWORD=yourpass \
        python3 backend/scripts/smoke_test.py

环境变量：
    SMOKE_BASE   后端地址，默认 http://localhost:8000/api/v1
    SMOKE_EMAIL  管理员邮箱（可选）
    SMOKE_PASSWORD 管理员密码（可选）
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.environ.get("SMOKE_BASE", "http://localhost:8000/api/v1").rstrip("/")
ROOT = BASE[:-len("/api/v1")] if BASE.endswith("/api/v1") else BASE
EMAIL = os.environ.get("SMOKE_EMAIL")
PASSWORD = os.environ.get("SMOKE_PASSWORD")

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
_passed = _failed = _skipped = 0


def _req(method, path, body=None, token=None, raw_path=False):
    url = path if path.startswith("http") else BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"_raw": txt}
    except Exception as e:
        return None, {"_error": str(e)}


def check(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  {GREEN}✓{RESET} {name}")
    else:
        _failed += 1
        print(f"  {RED}✗ {name}{RESET}  {DIM}{detail}{RESET}")


def skip(name, why):
    global _skipped
    _skipped += 1
    print(f"  {YELLOW}↷ SKIP{RESET} {name}  {DIM}{why}{RESET}")


def section(t):
    print(f"\n{t}")


# ── 1. 无需鉴权的基础与安全检查 ──
section("● 基础连通性")
st, _ = _req("GET", ROOT + "/health")
check("GET /health 返回 200", st == 200, f"status={st}")
st, _ = _req("GET", "/ping")
check("GET /api/v1/ping 返回 200", st == 200, f"status={st}")

section("● S1-3 路径遍历防护（/media）")
for attack in ["../../etc/passwd", "..%2f..%2fetc%2fpasswd", ".."]:
    st, body = _req("GET", f"/media/{attack}")
    # 关键：绝不能 200 返回文件内容；预期 400（非法文件名）或 404
    ok = st in (400, 404)
    check(f"/media/{attack[:24]} 被拒绝（非 200）", ok, f"status={st}")

section("● S1-9 CORS 配置（chrome-extension 正则）")
# OPTIONS 预检：合法插件来源应被允许（带 access-control-allow-origin 回显）
req = urllib.request.Request(BASE + "/ping", method="OPTIONS")
req.add_header("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop")
req.add_header("Access-Control-Request-Method", "GET")
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        allow = r.headers.get("access-control-allow-origin")
        check("chrome-extension 来源被 CORS 放行", bool(allow), f"allow-origin={allow}")
except urllib.error.HTTPError as e:
    allow = e.headers.get("access-control-allow-origin")
    check("chrome-extension 来源被 CORS 放行", bool(allow), f"status={e.code} allow={allow}")
except Exception as e:
    skip("CORS 预检", str(e))

section("● S1-4 fetch-models 鉴权（未登录应被拒）")
st, _ = _req("POST", "/admin/ai-providers/fetch-models",
             {"api_base_url": "https://api.openai.com/v1", "api_key": "x"})
check("未登录调用 fetch-models 被拒（401/403）", st in (401, 403), f"status={st}")

# ── 2. 需要管理员鉴权的检查 ──
token = None
if EMAIL and PASSWORD:
    st, body = _req("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    if st == 200 and body.get("access_token"):
        token = body["access_token"]
        role = (body.get("user") or {}).get("role")
        section(f"● 已登录：{EMAIL}（role={role}）")
    else:
        section("● 登录失败，跳过鉴权检查")
        print(f"  {RED}登录返回 {st}: {body}{RESET}")
else:
    section("● 未提供 SMOKE_EMAIL/SMOKE_PASSWORD，跳过鉴权检查")

if token:
    section("● S1-4 SSRF 拦截（内网/非法协议）")
    st, body = _req("POST", "/admin/ai-providers/fetch-models",
                    {"api_base_url": "http://169.254.169.254/latest/meta-data", "api_key": "x"}, token)
    check("内网元数据地址被拦截（400）", st == 400, f"status={st} body={body.get('detail')}")
    st, body = _req("POST", "/admin/ai-providers/fetch-models",
                    {"api_base_url": "http://127.0.0.1:8000/v1", "api_key": "x"}, token)
    check("localhost 被拦截（400）", st == 400, f"status={st} body={body.get('detail')}")
    st, body = _req("POST", "/admin/ai-providers/fetch-models",
                    {"api_base_url": "file:///etc/passwd", "api_key": "x"}, token)
    check("非 http/https 协议被拒（400）", st == 400, f"status={st} body={body.get('detail')}")

    section("● S1-8 role 白名单（add_member 非法角色）")
    st, me = _req("GET", "/admin/me", token=token)
    team_id = (me.get("user") or {}).get("team_id") or (me.get("team") or {}).get("id")
    if team_id:
        st, body = _req("POST", "/admin/members",
                        {"team_id": team_id, "email": f"smoketest_{int(time.time())}@x.com",
                         "password": "abc12345", "role": "super_admin"}, token)
        check("授予 super_admin 被拒（400）", st == 400, f"status={st} detail={body.get('detail')}")
    else:
        skip("role 白名单", "当前账号无 team_id（可能是未分配团队的超管）")

    section("● S2-1/S2-3 后台 worker 存活（入队翻译→轮询完成）")
    st, pool = _req("GET", "/product-pool?page_size=1", token=token)
    items = (pool or {}).get("items") or []
    if st == 200 and items:
        pid = items[0]["id"]
        st, _ = _req("POST", f"/product-pool/{pid}/translate", {"language": "en"}, token)
        if st in (200, 202):
            done = False
            for _ in range(20):  # 最多等 ~20s
                time.sleep(1)
                st, logs = _req("GET", f"/product-pool/{pid}/tasks?task_type=translate", token=token)
                if isinstance(logs, list) and logs and logs[0]["status"] in ("completed", "failed"):
                    done = True
                    print(f"    {DIM}最新翻译任务状态: {logs[0]['status']}{RESET}")
                    break
            check("入队的翻译任务被 worker 处理（completed/failed）", done,
                  "20s 内未离开 pending/running —— worker 可能未启动")
        else:
            check("触发翻译返回 202", False, f"status={st}")
    else:
        skip("worker 存活", "选品池为空，请先用插件抓取一个商品再跑此项")

# ── 汇总 ──
print(f"\n{'='*48}")
print(f"  通过 {GREEN}{_passed}{RESET} | 失败 {RED}{_failed}{RESET} | 跳过 {YELLOW}{_skipped}{RESET}")
print('='*48)
sys.exit(1 if _failed else 0)
