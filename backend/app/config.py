import os
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    APP_NAME: str = "DropShipFlow"
    DEBUG: bool = True
    SECRET_KEY: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    DATABASE_URL: str = "sqlite+aiosqlite:///./dropshipflow.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    CORS_ORIGINS: list[str] = [
        "chrome-extension://*",
        "http://localhost:3000",
        "https://admin.dropshipflow.com",
    ]

    # ── Image storage ──
    STORAGE_BACKEND: str = "local"  # "local" | "s3"
    LOCAL_STORAGE_DIR: str = str(PROJECT_ROOT / "storage")
    S3_BUCKET: str = ""
    S3_ENDPOINT: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_PUBLIC_URL_PREFIX: str = ""

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


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
