from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Shop
from app.core.permissions import require, Permission, get_current_team_or_raise, QuotaChecker

router = APIRouter(prefix="/shops", tags=["shops"])


class CreateShopRequest(BaseModel):
    alias: str | None = None
    shop_domain: str
    shop_name: str | None = None
    custom_domain: str | None = None
    access_token: str
    tags: str | None = None  # 店铺标签，如"家居,户外"


@router.post("", status_code=201)
async def create_shop(
    req: CreateShopRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SHOPS),
):
    # 自动使用当前用户的团队
    team_id = current_user.team_id
    if not team_id:
        raise HTTPException(status_code=400, detail="你不在任何团队中，无法绑定店铺")

    team = await get_current_team_or_raise(team_id, current_user, db)
    checker = QuotaChecker(team)
    if not await checker.check_shops(db):
        raise HTTPException(status_code=403, detail="店铺数量已达上限")

    shop = Shop(
        team_id=team_id, created_by=current_user.id,
        shop_domain=req.shop_domain,
        shop_name=req.shop_name or req.shop_domain,
        alias=req.alias,
        custom_domain=req.custom_domain,
        access_token_encrypted=req.access_token,
        tags=req.tags,
    )
    db.add(shop)
    await db.commit()
    await db.refresh(shop)
    return {
        "id": shop.id, "shop_domain": shop.shop_domain,
        "alias": shop.alias, "tags": shop.tags,
    }


@router.get("")
async def list_shops(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "super_admin":
        shops = await db.scalars(select(Shop))
    else:
        shops = await db.scalars(select(Shop).where(Shop.team_id == current_user.team_id))
    return [{
        "id": s.id, "team_id": s.team_id,
        "shop_domain": s.shop_domain, "shop_name": s.shop_name,
        "alias": s.alias, "custom_domain": s.custom_domain, "tags": s.tags,
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat() + "+00:00" if s.created_at else None,
    } for s in shops]
