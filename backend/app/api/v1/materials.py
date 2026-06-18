"""素材库 API —— 商品图片素材 + AI 视觉描述。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Material, iso_utc
from app.core.permissions import require, Permission
from app.core import worker

router = APIRouter(prefix="/materials", tags=["materials"])


def _ts(dt):
    return (iso_utc(dt)) if dt else None


def _item(m: Material) -> dict:
    return {
        "id": m.id, "product_id": m.product_id, "source_pool_id": m.source_pool_id,
        "spu": m.spu, "sku": m.sku, "image_url": m.image_url,
        "description": m.description, "status": m.status, "error": m.error,
        "position": m.position, "s3_uploaded": bool(m.s3_uploaded),
        "created_at": _ts(m.created_at), "updated_at": _ts(m.updated_at),
    }


def _not_uploaded_clause():
    # 未转存到 S3 且是外部 http(s) 图（S3 URL 也是 http，但那些 s3_uploaded=True 已排除）
    return ((Material.s3_uploaded.is_(False)) | (Material.s3_uploaded.is_(None))) & (Material.image_url.like("http%"))


@router.get("")
async def list_materials(
    product_id: str | None = Query(None),
    spu: str | None = Query(None),
    sku: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Material)
    if current_user.role != "super_admin":
        stmt = stmt.where(Material.team_id == current_user.team_id)
    if product_id:
        stmt = stmt.where(Material.product_id == product_id)
    if spu:
        stmt = stmt.where(Material.spu == spu)
    if sku:
        stmt = stmt.where(Material.sku == sku)
    if status:
        stmt = stmt.where(Material.status == status)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Material.spu.ilike(like), Material.sku.ilike(like), Material.description.ilike(like)))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    # 状态计数（用于前端筛选徽标）
    counts = {"pending": 0, "running": 0, "done": 0, "failed": 0}
    cstmt = select(Material.status, func.count()).select_from(Material)
    if current_user.role != "super_admin":
        cstmt = cstmt.where(Material.team_id == current_user.team_id)
    for st, cnt in (await db.execute(cstmt.group_by(Material.status))).all():
        counts[st] = cnt

    # 未上传 S3 的素材数（用于批量上传按钮显示）
    s3stmt = select(func.count()).select_from(Material).where(_not_uploaded_clause())
    if current_user.role != "super_admin":
        s3stmt = s3stmt.where(Material.team_id == current_user.team_id)
    s3_pending = await db.scalar(s3stmt)

    stmt = stmt.order_by(Material.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = list(await db.scalars(stmt))
    return {"items": [_item(m) for m in rows], "total": total, "counts": counts,
            "s3_pending": s3_pending or 0, "page": page, "page_size": page_size}


async def _owned(material_id: str, current_user: User, db: AsyncSession) -> Material:
    m = await db.get(Material, material_id)
    if not m:
        raise HTTPException(status_code=404, detail="素材不存在")
    if current_user.role != "super_admin" and m.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="无权访问")
    return m


class UpdateMaterialRequest(BaseModel):
    description: str | None = None


@router.put("/{material_id}")
async def update_material(
    material_id: str, req: UpdateMaterialRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    m = await _owned(material_id, current_user, db)
    if req.description is not None:
        m.description = req.description
        m.status = "done"
        m.error = None
    await db.commit()
    await db.refresh(m)
    return _item(m)


class UploadS3Request(BaseModel):
    ids: list[str] | None = None   # 指定素材；不传则处理本团队所有未上传的
    limit: int = 80                # 每次最多处理多少张（前端可循环调用直到 remaining=0）


@router.post("/upload-s3")
async def upload_materials_s3(
    req: UploadS3Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    """批量把素材图转存到自建 S3（已上传的跳过）。返回本次结果 + 剩余未上传数。"""
    from app.services import platform_settings_service as platform_settings
    from app.services.image_service import image_service

    s3cfg = await platform_settings.get_s3_config(db)
    if s3cfg.get("backend") != "s3" or not s3cfg.get("bucket"):
        raise HTTPException(status_code=400, detail="未配置 S3：请先在『平台设置 → 图片存储』选 S3 并填好")

    stmt = select(Material).where(_not_uploaded_clause())
    if current_user.role != "super_admin":
        stmt = stmt.where(Material.team_id == current_user.team_id)
    if req.ids:
        stmt = stmt.where(Material.id.in_(req.ids))
    batch = list(await db.scalars(stmt.order_by(Material.created_at.asc()).limit(max(1, min(req.limit, 200)))))

    uploaded = failed = 0
    if batch:
        img_map = await image_service.mirror_batch([m.image_url for m in batch], prefix="dsf/material", s3cfg=s3cfg)
        for m in batch:
            new = img_map.get(m.image_url)
            if new:
                m.image_url = new
                m.s3_uploaded = True
                uploaded += 1
            else:
                failed += 1
        await db.commit()

    # 剩余未上传数（团队范围）
    rstmt = select(func.count()).select_from(Material).where(_not_uploaded_clause())
    if current_user.role != "super_admin":
        rstmt = rstmt.where(Material.team_id == current_user.team_id)
    remaining = await db.scalar(rstmt)
    return {"uploaded": uploaded, "failed": failed, "remaining": remaining or 0}


@router.post("/{material_id}/regenerate", status_code=202)
async def regenerate_material(
    material_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    m = await _owned(material_id, current_user, db)
    m.status = "pending"
    m.error = None
    await db.commit()
    worker.notify()
    return {"ok": True, "id": m.id}
