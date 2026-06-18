"""Shopify OAuth 工具：店铺域名校验、state 签名/校验、回调 HMAC 校验、构建授权 URL、用 code 换 token。

平台侧一个 Partner App（API key/secret 来自配置），各团队对自己店铺授权。
state 用项目 SECRET_KEY 签的短期 JWT（含 team_id/user_id），做 CSRF + 携带归属，无需服务端存储。
"""
import hmac
import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt

from app.config import settings

_SHOP_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$")
_STATE_TTL_MINUTES = 10
_STATE_TYP = "shopify_oauth"


def normalize_shop(shop: str) -> str | None:
    """把用户输入规整成 xxx.myshopify.com，并校验格式；非法返回 None。
    支持：纯 handle（dshopflow）、完整 xxx.myshopify.com、以及粘贴
    admin.shopify.com/store/<handle> 后台地址（自动提取 handle）。"""
    if not shop:
        return None
    s = shop.strip().lower()
    m = re.search(r"admin\.shopify\.com/store/([a-z0-9][a-z0-9-]*)", s)
    if m:
        s = m.group(1)  # 从后台地址提取 handle
    else:
        s = re.sub(r"^https?://", "", s).split("/")[0].strip()
    if "." not in s:  # 只填了 handle → 补全
        s = f"{s}.myshopify.com"
    return s if _SHOP_RE.match(s) else None


def frontend_callback_url(admin_base_url: str) -> str:
    """回调落前端（商户后台）：授权完 Shopify 跳回此页，前端再把 code 转给后端 exchange。"""
    return f"{(admin_base_url or '').rstrip('/')}/shops/oauth/callback"


def sign_state(team_id: str, user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": _STATE_TYP,
        "team_id": team_id,
        "user_id": user_id,
        "nonce": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(minutes=_STATE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def verify_state(token: str) -> dict | None:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except Exception:
        return None
    if data.get("typ") != _STATE_TYP:
        return None
    return data


def build_install_url(shop: str, state: str, *, api_key: str, scopes: str, redirect_uri: str) -> str:
    from urllib.parse import urlencode
    q = urlencode({
        "client_id": api_key,
        "scope": scopes,
        "redirect_uri": redirect_uri,
        "state": state,
    })
    return f"https://{shop}/admin/oauth/authorize?{q}"


def verify_hmac(params: dict, secret: str) -> bool:
    """校验 Shopify 回调 HMAC：除 hmac/signature 外所有参数按键排序 key=value 用 & 连接，
    HMAC-SHA256(secret) 十六进制，与传入 hmac 常数时间比较。"""
    received = params.get("hmac")
    if not received or not secret:
        return False
    msg = "&".join(
        f"{k}={v}" for k, v in sorted(params.items()) if k not in ("hmac", "signature")
    )
    digest = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, received)


async def exchange_code(shop: str, code: str, *, api_key: str, api_secret: str) -> dict:
    """用授权 code 换 access_token。返回 {access_token, scope}。"""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"https://{shop}/admin/oauth/access_token",
            json={"client_id": api_key, "client_secret": api_secret, "code": code},
        )
        resp.raise_for_status()
        return resp.json()
