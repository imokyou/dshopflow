import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Collection, Product, iso_utc
from app.core.permissions import require, Permission

router = APIRouter(prefix="/collections", tags=["collections"])


class CollectionIn(BaseModel):
    title: str | None = None
    handle: str | None = None
    body_html: str | None = None


def _slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w一-鿿]+", "-", s).strip("-")
    return s or "collection"


def _ser(c: Collection, count: int | None = None) -> dict:
    d = {"id": c.id, "title": c.title, "handle": c.handle, "body_html": c.body_html,
         "created_at": (iso_utc(c.created_at)) if c.created_at else None}
    if count is not None:
        d["product_count"] = count
    return d


@router.get("")
async def list_collections(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(Collection)
    if current_user.role != "super_admin":
        stmt = stmt.where(Collection.team_id == current_user.team_id)
    rows = list(await db.scalars(stmt.order_by(Collection.created_at.desc())))
    return [_ser(c) for c in rows]


@router.post("", status_code=201)
async def create_collection(
    req: CollectionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    if not req.title:
        raise HTTPException(status_code=400, detail="合集名称不能为空")
    c = Collection(team_id=current_user.team_id, title=req.title,
                   handle=req.handle or _slug(req.title), body_html=req.body_html)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _ser(c)


@router.put("/{collection_id}")
async def update_collection(
    collection_id: str,
    req: CollectionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    c = await db.get(Collection, collection_id)
    if not c:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and c.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    if req.title is not None:
        c.title = req.title
    if req.handle is not None:
        c.handle = req.handle
    if req.body_html is not None:
        c.body_html = req.body_html
    await db.commit()
    await db.refresh(c)
    return _ser(c)


@router.delete("/{collection_id}")
async def delete_collection(
    collection_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.DELETE_PRODUCT),
):
    c = await db.get(Collection, collection_id)
    if not c:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and c.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    await db.delete(c)
    await db.commit()
    return {"ok": True}
