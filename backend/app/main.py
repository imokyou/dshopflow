from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.v1.auth import router as auth_router
from app.api.v1.router import api_router

app = FastAPI(
    title="DropShipFlow API",
    version="0.1.0",
    docs_url="/api/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,  # 正确匹配 chrome-extension:// 来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def _startup_migrate():
    # 跨库建表：以 ORM 模型为准建缺失的表（SQLite/Postgres 通用、幂等，新库一步到位）
    import app.models  # noqa: F401 确保所有表注册到 Base.metadata
    from app.database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # SQLite 既有 dev 库的增量补列（内部已 guard：仅 sqlite 跑，Postgres 直接跳过）
    from app.db_migrate import ensure_schema
    await ensure_schema()
    # 恢复中断的转入队列任务
    try:
        from app.api.v1.products import resume_pending_jobs
        await resume_pending_jobs()
    except Exception:
        import logging
        logging.getLogger("dropshipflow").exception("resume_pending_jobs failed on startup")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
