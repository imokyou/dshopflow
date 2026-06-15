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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def _startup_migrate():
    # 幂等迁移：商品管理模块（products 扩展 + collections），不影响选品池
    from app.db_migrate import ensure_schema
    await ensure_schema()
    # 恢复中断的转入队列任务
    try:
        from app.api.v1.products import resume_pending_jobs
        await resume_pending_jobs()
    except Exception:
        pass


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
