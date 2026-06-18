import asyncio
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Shop, Team, iso_utc
from app.core.permissions import require, Permission, get_current_team_or_raise, QuotaChecker
from app.core.crypto import encrypt_secret, decrypt_secret
from app.integrations.shopify import oauth
from app.services import platform_settings_service as platform_settings

router = APIRouter(prefix="/shops", tags=["shops"])


class CreateShopRequest(BaseModel):
    alias: str | None = None
    shop_domain: str
    shop_name: str | None = None
    custom_domain: str | None = None
    access_token: str
    tags: str | None = None  # 店铺标签，如"家居,户外"


@router.post("", status_code=201)
async def create_shop(
    req: CreateShopRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    # 自动使用当前用户的团队
    team_id = current_user.team_id
    if not team_id:
        raise HTTPException(status_code=400, detail="你不在任何团队中，无法绑定店铺")

    team = await get_current_team_or_raise(team_id, current_user, db)
    checker = QuotaChecker(team)
    if not await checker.check_shops(db):
        raise HTTPException(status_code=403, detail="店铺数量已达上限")

    norm = oauth.normalize_shop(req.shop_domain)
    if not norm:
        raise HTTPException(status_code=400, detail="店铺 handle/域名不正确：填 handle（如 dshopflow）或完整 xxx.myshopify.com")

    shop = Shop(
        team_id=team_id, created_by=current_user.id,
        shop_domain=norm,
        shop_name=req.shop_name or norm,
        alias=req.alias,
        custom_domain=req.custom_domain,
        access_token_encrypted=encrypt_secret(req.access_token),
        tags=req.tags,
    )
    db.add(shop)
    await db.commit()
    await db.refresh(shop)
    return {
        "id": shop.id, "shop_domain": shop.shop_domain,
        "alias": shop.alias, "tags": shop.tags,
    }


class UpdateShopRequest(BaseModel):
    alias: str | None = None
    shop_domain: str | None = None
    shop_name: str | None = None
    custom_domain: str | None = None
    access_token: str | None = None  # 留空表示不修改 token
    tags: str | None = None
    is_active: bool | None = None


async def _owned_shop(shop_id: str, current_user: User, db: AsyncSession) -> Shop:
    shop = await db.get(Shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="店铺不存在")
    if current_user.role != "super_admin" and shop.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="无权访问")
    return shop


@router.put("/{shop_id}")
async def update_shop(
    shop_id: str,
    req: UpdateShopRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    shop = await _owned_shop(shop_id, current_user, db)
    need_recheck = False

    if req.shop_domain is not None:
        norm = oauth.normalize_shop(req.shop_domain)
        if not norm:
            raise HTTPException(status_code=400, detail="店铺 handle/域名不正确：填 handle（如 dshopflow）或完整 xxx.myshopify.com")
        if norm != shop.shop_domain:
            dup = await db.scalar(select(Shop).where(  # 同团队下域名唯一
                Shop.team_id == shop.team_id, Shop.shop_domain == norm, Shop.id != shop.id
            ))
            if dup:
                raise HTTPException(status_code=400, detail="该团队下已存在相同域名的店铺")
            shop.shop_domain = norm
            need_recheck = True
    if req.alias is not None:
        shop.alias = req.alias
    if req.shop_name is not None:
        shop.shop_name = req.shop_name
    if req.custom_domain is not None:
        shop.custom_domain = req.custom_domain
    if req.tags is not None:
        shop.tags = req.tags
    if req.is_active is not None:
        shop.is_active = req.is_active
    if req.access_token:  # 非空才改 token
        shop.access_token_encrypted = encrypt_secret(req.access_token)
        need_recheck = True

    if need_recheck:  # 域名或 token 变了 → 重置连接状态待重新检测
        shop.conn_status = "unknown"
        shop.conn_checked_at = None
        shop.conn_error = None

    await db.commit()
    await db.refresh(shop)
    return {
        "id": shop.id, "alias": shop.alias, "shop_domain": shop.shop_domain,
        "shop_name": shop.shop_name, "custom_domain": shop.custom_domain,
        "tags": shop.tags, "is_active": shop.is_active, **_conn_fields(shop),
    }


@router.delete("/{shop_id}")
async def delete_shop(
    shop_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    shop = await _owned_shop(shop_id, current_user, db)
    await db.delete(shop)
    await db.commit()
    return {"ok": True}


@router.get("/{shop_id}/token")
async def get_shop_token(
    shop_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    """返回该店铺的明文 access_token（仅本团队/超管），便于复制到本地开发使用。"""
    shop = await _owned_shop(shop_id, current_user, db)
    return {"shop_domain": shop.shop_domain, "access_token": decrypt_secret(shop.access_token_encrypted) or ""}


# ── Shopify OAuth 接入 ──

@router.get("/oauth/install")
async def oauth_install(
    shop: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    """返回 Shopify 授权 URL（前端拿到后跳转）。回调落前端商户后台页。"""
    cfg = await platform_settings.get_shopify_config(db)
    if not cfg["api_key"] or not cfg["admin_base_url"]:
        raise HTTPException(status_code=500, detail="尚未配置 Shopify App（请在『平台设置』填 API key 与管理后台地址）")
    if not current_user.team_id:
        raise HTTPException(status_code=400, detail="你不在任何团队中，无法绑定店铺")
    norm = oauth.normalize_shop(shop)
    if not norm:
        raise HTTPException(status_code=400, detail="店铺域名格式不正确，应形如 xxx.myshopify.com")
    state = oauth.sign_state(current_user.team_id, current_user.id)
    url = oauth.build_install_url(
        norm, state, api_key=cfg["api_key"], scopes=cfg["scopes"],
        redirect_uri=oauth.frontend_callback_url(cfg["admin_base_url"]),
    )
    return {"url": url}


class OAuthExchangeRequest(BaseModel):
    params: dict  # 前端把回调页 URL 的全部 query 原样回传（用于 hmac 校验 + 取 code/state/shop）


@router.post("/oauth/exchange")
async def oauth_exchange(req: OAuthExchangeRequest, db: AsyncSession = Depends(get_db)):
    """前端回调页拿到 code 后调此：验 hmac+state → 换 token → upsert 店铺。
    鉴权靠签名的 state（含 team/user），secret 只在后端用。"""
    params = req.params or {}
    shop = oauth.normalize_shop(params.get("shop", ""))
    code = params.get("code")
    state = params.get("state", "")
    if not shop or not code:
        return {"ok": False, "error": "缺少 shop 或 code"}

    cfg = await platform_settings.get_shopify_config(db)
    if not oauth.verify_hmac(params, cfg["api_secret"]):
        return {"ok": False, "error": "HMAC 校验失败（请求可能被伪造）"}
    st = oauth.verify_state(state)
    if not st:
        return {"ok": False, "error": "state 无效或已过期，请重新发起授权"}

    try:
        tok = await oauth.exchange_code(shop, code, api_key=cfg["api_key"], api_secret=cfg["api_secret"])
        access_token = tok.get("access_token")
        if not access_token:
            return {"ok": False, "error": "未取得 access_token"}
    except Exception as e:
        return {"ok": False, "error": f"换取 token 失败: {e}"[:160]}

    team_id = st["team_id"]
    existing = await db.scalar(
        select(Shop).where(Shop.team_id == team_id, Shop.shop_domain == shop)
    )
    if existing:
        existing.access_token_encrypted = encrypt_secret(access_token)
        existing.is_active = True
    else:
        team = await db.get(Team, team_id)
        if team is None:
            return {"ok": False, "error": "团队不存在"}
        checker = QuotaChecker(team)
        if not await checker.check_shops(db):
            return {"ok": False, "error": "店铺数量已达上限"}
        db.add(Shop(
            team_id=team_id, created_by=st.get("user_id"),
            shop_domain=shop, shop_name=shop,
            access_token_encrypted=encrypt_secret(access_token),
        ))
    await db.commit()
    return {"ok": True, "shop": shop}


async def _check_shop_conn(domain: str, token: str) -> dict:
    """调 Shopify shop.json 检测连接，返回 {status, error, shop_name}（不落库）。"""
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(
                f"https://{domain}/admin/api/2024-01/shop.json",
                headers={"X-Shopify-Access-Token": token or ""},
            )
        if resp.status_code == 200:
            info = resp.json().get("shop", {})
            return {"status": "ok", "error": None, "shop_name": info.get("name")}
        # 401/403 = token 失效/无权；其它给状态码
        return {"status": "failed", "error": f"HTTP {resp.status_code}", "shop_name": None}
    except Exception as e:
        return {"status": "failed", "error": str(e)[:200], "shop_name": None}


def _persist_conn(shop: Shop, r: dict) -> None:
    shop.conn_status = r["status"]
    # 存 naive UTC（与全库时间一致；读出时统一加 +00:00，避免 aware 双时区后缀致前端 NaN）
    shop.conn_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    shop.conn_error = r["error"]


def _conn_fields(s: Shop) -> dict:
    return {
        "conn_status": s.conn_status or "unknown",
        "conn_checked_at": iso_utc(s.conn_checked_at) if s.conn_checked_at else None,
        "conn_error": s.conn_error,
    }


async def _team_shops(current_user: User, db: AsyncSession) -> list[Shop]:
    if current_user.role == "super_admin":
        return list(await db.scalars(select(Shop)))
    return list(await db.scalars(select(Shop).where(Shop.team_id == current_user.team_id)))


@router.post("/{shop_id}/test")
async def test_shop_connection(
    shop_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    """手动检测单个店铺连接（并落库状态）。"""
    shop = await db.get(Shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="店铺不存在")
    if current_user.role != "super_admin" and shop.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="无权访问")
    r = await _check_shop_conn(shop.shop_domain, decrypt_secret(shop.access_token_encrypted) or "")
    _persist_conn(shop, r)
    await db.commit()
    return {"ok": r["status"] == "ok", "shop_name": r["shop_name"], **_conn_fields(shop)}


@router.post("/refresh-status")
async def refresh_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    """并发检测当前团队（超管为全部）所有店铺连接，落库并返回各店铺状态。供前端定时刷新。"""
    shops = await _team_shops(current_user, db)
    results = await asyncio.gather(
        *[_check_shop_conn(s.shop_domain, decrypt_secret(s.access_token_encrypted) or "") for s in shops],
        return_exceptions=True,
    )
    for s, r in zip(shops, results):
        if isinstance(r, dict):
            _persist_conn(s, r)
    await db.commit()
    return [{"id": s.id, **_conn_fields(s)} for s in shops]


@router.get("")
async def list_shops(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    shops = await _team_shops(current_user, db)
    return [{
        "id": s.id, "team_id": s.team_id,
        "shop_domain": s.shop_domain, "shop_name": s.shop_name,
        "alias": s.alias, "custom_domain": s.custom_domain, "tags": s.tags,
        "is_active": s.is_active,
        "created_at": iso_utc(s.created_at) if s.created_at else None,
        **_conn_fields(s),
    } for s in shops]
