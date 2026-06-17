"""素材库 API —— 商品图片素材 + AI 视觉描述。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Material
from app.core.permissions import require, Permission
from app.core import worker

router = APIRouter(prefix="/materials", tags=["materials"])


def _ts(dt):
    return (dt.isoformat() + "+00:00") if dt else None


def _item(m: Material) -> dict:
    return {
        "id": m.id, "product_id": m.product_id, "source_pool_id": m.source_pool_id,
        "spu": m.spu, "sku": m.sku, "image_url": m.image_url,
        "description": m.description, "status": m.status, "error": m.error,
        "position": m.position,
        "created_at": _ts(m.created_at), "updated_at": _ts(m.updated_at),
    }


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

    stmt = stmt.order_by(Material.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = list(await db.scalars(stmt))
    return {"items": [_item(m) for m in rows], "total": total, "counts": counts, "page": page, "page_size": page_size}


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
