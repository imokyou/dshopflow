from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import FileResponse
from app.api.v1.teams import router as teams_router
from app.api.v1.shops import router as shops_router
from app.api.v1.imports import router as imports_router
from app.api.v1.products import router as products_router
from app.api.v1.collections import router as collections_router
from app.api.v1.spu_rules import router as spu_rules_router
from app.api.v1.pricing import router as pricing_router
from app.api.v1.admin import router as admin_router
from app.api.v1.product_pool import router as product_pool_router
from app.config import settings

api_router = APIRouter()
api_router.include_router(teams_router)
api_router.include_router(shops_router)
api_router.include_router(imports_router)
api_router.include_router(products_router)
api_router.include_router(collections_router)
api_router.include_router(spu_rules_router)
api_router.include_router(pricing_router)
api_router.include_router(admin_router)
api_router.include_router(product_pool_router)


# ── 本地图片服务 ──
@api_router.get("/media/{filename}")
async def serve_media(filename: str):
    """提供本地存储的图片（开发环境用，生产用 S3/CDN）"""
    filepath = Path(settings.LOCAL_STORAGE_DIR) / filename
    if not filepath.exists():
        # 尝试在存储目录下递归查找
        candidates = list(Path(settings.LOCAL_STORAGE_DIR).rglob(filename))
        if candidates:
            filepath = candidates[0]
        else:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)


@api_router.get("/ping")
async def ping():
    return {"pong": True}
