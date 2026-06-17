from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, SpuRule, iso_utc
from app.core.permissions import require, Permission

router = APIRouter(prefix="/spu-rules", tags=["spu-rules"])


class SpuRuleIn(BaseModel):
    name: str | None = None
    code: str | None = None
    remark: str | None = None


def _ser(r: SpuRule) -> dict:
    return {"id": r.id, "name": r.name, "code": r.code, "remark": r.remark,
            "created_at": (iso_utc(r.created_at)) if r.created_at else None}


@router.get("")
async def list_spu_rules(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(SpuRule)
    if current_user.role != "super_admin":
        stmt = stmt.where(SpuRule.team_id == current_user.team_id)
    rows = list(await db.scalars(stmt.order_by(SpuRule.created_at.desc())))
    return [_ser(r) for r in rows]


@router.post("", status_code=201)
async def create_spu_rule(
    req: SpuRuleIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    if not req.name or not req.code:
        raise HTTPException(status_code=400, detail="名称和编码不能为空")
    r = SpuRule(team_id=current_user.team_id, name=req.name.strip(), code=req.code.strip(), remark=req.remark)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _ser(r)


@router.put("/{rule_id}")
async def update_spu_rule(
    rule_id: str,
    req: SpuRuleIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    r = await db.get(SpuRule, rule_id)
    if not r:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and r.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    if req.name is not None:
        r.name = req.name.strip()
    if req.code is not None:
        r.code = req.code.strip()
    if req.remark is not None:
        r.remark = req.remark
    await db.commit()
    await db.refresh(r)
    return _ser(r)


@router.delete("/{rule_id}")
async def delete_spu_rule(
    rule_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.DELETE_PRODUCT),
):
    r = await db.get(SpuRule, rule_id)
    if not r:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and r.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    await db.delete(r)
    await db.commit()
    return {"ok": True}
