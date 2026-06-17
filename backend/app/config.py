import os
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


DEV_SECRET_KEY = "dev-secret-change-in-production"


class Settings(BaseSettings):
    APP_NAME: str = "DropShipFlow"
    DEBUG: bool = False  # 默认生产安全；本地开发显式设 DEBUG=true
    SECRET_KEY: str = DEV_SECRET_KEY
    # 凭据加密密钥（Fernet）。留空则由 crypto 模块从 SECRET_KEY 派生
    CREDENTIAL_ENCRYPTION_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    DATABASE_URL: str = "sqlite+aiosqlite:///./dropshipflow.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    # 允许的前端来源（精确匹配）；插件来源用下方正则单独匹配
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "https://admin.dropshipflow.com",
    ]
    # 匹配任意 chrome-extension:// 来源（CORSMiddleware 不支持通配子串，需用正则）
    CORS_ORIGIN_REGEX: str = r"^chrome-extension://[a-p]+$"

    # ── Image storage ──
    STORAGE_BACKEND: str = "local"  # "local" | "s3"
    LOCAL_STORAGE_DIR: str = str(PROJECT_ROOT / "storage")
    S3_BUCKET: str = ""
    S3_ENDPOINT: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_PUBLIC_URL_PREFIX: str = ""

    # ── Shopify OAuth ──
    SHOPIFY_API_KEY: str = ""          # Partner App 的 Client ID / API key
    SHOPIFY_API_SECRET: str = ""       # Partner App 的 Client secret（敏感，放 .env）
    SHOPIFY_SCOPES: str = "write_products,read_products"
    SHOPIFY_APP_BASE_URL: str = ""     # 后端公网 https base（开发用内网穿透域名），用于拼 OAuth 回调
    ADMIN_BASE_URL: str = "http://localhost:3000"  # 授权完成后跳回的管理后台地址

    # ── ComfyUI ──
    COMFYUI_BASE_URL: str = "http://localhost:8188"
    COMFYUI_TIMEOUT: int = 300

    # ── Pipeline ──
    PIPELINE_MAX_RETRIES: int = 3
    PIPELINE_IMAGE_CONCURRENCY: int = 4
    DEFAULT_EXCHANGE_RATE: float = 7.25  # 1 USD = 7.25 CNY (fallback)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # 容忍 .env 中未声明的额外变量，避免启动崩溃


@lru_cache()
def get_settings() -> Settings:
    s = Settings()
    # 生产环境（非 DEBUG）必须覆盖默认 SECRET_KEY，否则 JWT 可被伪造
    if not s.DEBUG and s.SECRET_KEY == DEV_SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY 仍为默认开发值，生产环境必须通过环境变量设置一个强随机密钥。"
        )
    return s


settings = get_settings()
