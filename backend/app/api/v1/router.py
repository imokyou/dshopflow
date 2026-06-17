import re
from pathlib import Path
from fastapi import APIRouter, HTTPException
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
from app.api.v1.materials import router as materials_router
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
api_router.include_router(materials_router)


# ── 本地图片服务 ──
# 仅允许安全的文件名字符（字母/数字/点/下划线/连字符），禁止路径分隔符与 ..
_SAFE_FILENAME = re.compile(r"^[A-Za-z0-9._-]+$")


@api_router.get("/media/{filename}")
async def serve_media(filename: str):
    """提供本地存储的图片（开发环境用，生产用 S3/CDN）"""
    # 防路径遍历：拒绝含分隔符/.. 的文件名
    if not _SAFE_FILENAME.match(filename) or filename in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    base_dir = Path(settings.LOCAL_STORAGE_DIR).resolve()
    filepath = (base_dir / filename).resolve()

    # 二次防御：解析后的真实路径必须仍位于存储目录内
    if not filepath.is_relative_to(base_dir):
        raise HTTPException(status_code=400, detail="Invalid path")

    if not filepath.exists():
        # 在存储目录下递归查找（同样校验结果仍在 base_dir 内）
        candidates = [
            p for p in base_dir.rglob(filename)
            if p.resolve().is_relative_to(base_dir)
        ]
        if candidates:
            filepath = candidates[0]
        else:
            raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)


@api_router.get("/ping")
async def ping():
    return {"pong": True}
