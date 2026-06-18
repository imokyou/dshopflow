"""平台级设置存取（超管后台管理）。

DB 优先、env 兜底：DB 里有值用 DB，否则回退 `.env` 里的对应配置，便于无 DB 配置时仍能跑。
secret 类（如 shopify_api_secret）加密存储，读出解密；对外（admin GET）一律掩码、不回明文。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.crypto import encrypt_secret, decrypt_secret
from app.models import PlatformSetting

SECRET_KEYS = {"shopify_api_secret", "s3_secret_key"}

# key → env 兜底默认
_ENV_FALLBACK = {
    "shopify_api_key": lambda: settings.SHOPIFY_API_KEY,
    "shopify_api_secret": lambda: settings.SHOPIFY_API_SECRET,
    "shopify_scopes": lambda: settings.SHOPIFY_SCOPES,
    "shopify_app_base_url": lambda: settings.SHOPIFY_APP_BASE_URL,
    "admin_base_url": lambda: settings.ADMIN_BASE_URL,
    # 图片存储 / S3
    "storage_backend": lambda: settings.STORAGE_BACKEND,
    "s3_endpoint": lambda: settings.S3_ENDPOINT,
    "s3_bucket": lambda: settings.S3_BUCKET,
    "s3_access_key": lambda: settings.S3_ACCESS_KEY,
    "s3_secret_key": lambda: settings.S3_SECRET_KEY,
    "s3_public_url_prefix": lambda: settings.S3_PUBLIC_URL_PREFIX,
}


async def _raw_map(db: AsyncSession) -> dict:
    rows = (await db.scalars(select(PlatformSetting))).all()
    return {r.key: r.value for r in rows}


async def get_value(db: AsyncSession, key: str) -> str:
    """取已解析的值（DB 解密优先，否则 env 兜底）。"""
    rows = await _raw_map(db)
    stored = rows.get(key)
    if stored:
        return ((decrypt_secret(stored) or "") if key in SECRET_KEYS else stored)
    fb = _ENV_FALLBACK.get(key)
    return (fb() if fb else "") or ""


async def get_shopify_config(db: AsyncSession) -> dict:
    """解析后的 Shopify OAuth 配置（供 install/callback 使用）。"""
    rows = await _raw_map(db)

    def val(key: str) -> str:
        stored = rows.get(key)
        if stored:
            return ((decrypt_secret(stored) or "") if key in SECRET_KEYS else stored)
        fb = _ENV_FALLBACK.get(key)
        return (fb() if fb else "") or ""

    return {
        "api_key": val("shopify_api_key"),
        "api_secret": val("shopify_api_secret"),
        "scopes": val("shopify_scopes") or "write_products,read_products",
        "app_base_url": val("shopify_app_base_url").rstrip("/"),
        "admin_base_url": (val("admin_base_url") or "http://localhost:3000").rstrip("/"),
    }


async def get_s3_config(db: AsyncSession) -> dict:
    """解析后的图片存储/S3 配置（供 image_service 转存使用）。"""
    rows = await _raw_map(db)

    def val(key: str) -> str:
        stored = rows.get(key)
        if stored:
            return ((decrypt_secret(stored) or "") if key in SECRET_KEYS else stored)
        fb = _ENV_FALLBACK.get(key)
        return (fb() if fb else "") or ""

    return {
        "backend": val("storage_backend") or "local",
        "endpoint": val("s3_endpoint"),
        "bucket": val("s3_bucket"),
        "access_key": val("s3_access_key"),
        "secret_key": val("s3_secret_key"),
        "public_url_prefix": val("s3_public_url_prefix"),
    }


def _callback_url(admin_base: str) -> str:
    if not admin_base:
        return ""
    from app.integrations.shopify import oauth
    return oauth.frontend_callback_url(admin_base)


async def get_public_settings(db: AsyncSession) -> dict:
    """供超管 UI 展示：secret 不回明文，只回是否已设置。"""
    rows = await _raw_map(db)

    def shown(key: str) -> str:
        stored = rows.get(key)
        if stored is not None:
            return stored  # 非密钥：DB 原值
        fb = _ENV_FALLBACK.get(key)
        return (fb() if fb else "") or ""

    return {
        "shopify_api_key": shown("shopify_api_key"),
        "shopify_scopes": shown("shopify_scopes") or "write_products,read_products",
        "shopify_app_base_url": shown("shopify_app_base_url"),
        "admin_base_url": shown("admin_base_url") or "http://localhost:3000",
        # secret 只回布尔：DB 有 或 env 有 即视为已设置
        "shopify_api_secret_set": bool(rows.get("shopify_api_secret") or settings.SHOPIFY_API_SECRET),
        # 回调地址（前端展示给用户去 Partner app 填）：落前端商户后台页（只取 origin，忽略误填 path）
        "callback_url": _callback_url(shown("admin_base_url")),
        # 图片存储 / S3（secret 不回明文）
        "storage_backend": shown("storage_backend") or "local",
        "s3_endpoint": shown("s3_endpoint"),
        "s3_bucket": shown("s3_bucket"),
        "s3_access_key": shown("s3_access_key"),
        "s3_public_url_prefix": shown("s3_public_url_prefix"),
        "s3_secret_key_set": bool(rows.get("s3_secret_key") or settings.S3_SECRET_KEY),
    }


async def set_values(db: AsyncSession, values: dict) -> None:
    """更新若干设置。secret 类加密存；secret 传空串则忽略（不覆盖已存值）。"""
    existing = {r.key: r for r in (await db.scalars(select(PlatformSetting))).all()}
    for key, raw in values.items():
        if key not in _ENV_FALLBACK:
            continue  # 只接受已知键
        if key in SECRET_KEYS:
            if not raw:  # 空 → 不动原值
                continue
            stored = encrypt_secret(raw)
        else:
            stored = raw or ""
        row = existing.get(key)
        if row:
            row.value = stored
        else:
            db.add(PlatformSetting(key=key, value=stored))
    await db.commit()
