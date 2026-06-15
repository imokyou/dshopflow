from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Team, SubscriptionPlan
from app.core.security import hash_password
from app.core.permissions import require, Permission, get_current_team_or_raise

router = APIRouter(prefix="/teams", tags=["teams"])


class CreateTeamRequest(BaseModel):
    name: str
    plan_id: str | None = None
    manager_email: EmailStr
    manager_password: str
    manager_name: str | None = None


@router.post("", status_code=201)
async def create_team(
    req: CreateTeamRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.CREATE_TEAM),
):
    # 检查邮箱是否已被注册
    existing = await db.scalar(select(User).where(User.email == req.manager_email))
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    team = Team(name=req.name, plan_id=req.plan_id, created_by=current_user.id)
    db.add(team)
    await db.flush()

    # 直接创建管理者账号
    manager = User(
        email=req.manager_email,
        password_hash=hash_password(req.manager_password),
        name=req.manager_name or req.name + " 管理者",
        role="manager",
        team_id=team.id,
    )
    db.add(manager)
    await db.commit()
    await db.refresh(team)

    return {
        "id": team.id,
        "name": team.name,
        "manager_email": req.manager_email,
    }


@router.get("")
async def list_teams(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.CREATE_TEAM),
):
    teams = await db.scalars(select(Team))
    result = []
    for t in teams:
        count = await db.scalar(select(func.count(User.id)).where(User.team_id == t.id))
        plan_name = t.plan.name if t.plan else "免费"
        plan_slug = t.plan.slug if t.plan else "free"
        result.append({
            "id": t.id,
            "name": t.name,
            "plan_id": t.plan_id,
            "plan_name": plan_name,
            "plan_slug": plan_slug,
            "member_count": count,
            "is_active": t.is_active,
            "created_at": t.created_at.strftime("%Y-%m-%d") if t.created_at else None,
            "updated_at": t.updated_at.strftime("%Y-%m-%d") if t.updated_at else None,
        })
    return result


@router.get("/{team_id}")
async def get_team(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    team = await get_current_team_or_raise(team_id, current_user, db)
    members = await db.scalars(select(User).where(User.team_id == team_id))
    return {
        "id": team.id,
        "name": team.name,
        "plan_id": team.plan_id,
        "plan_name": team.plan.name if team.plan else "免费",
        "plan_slug": team.plan.slug if team.plan else "free",
        "is_active": team.is_active,
        "created_at": team.created_at.strftime("%Y-%m-%d") if team.created_at else None,
        "updated_at": team.updated_at.strftime("%Y-%m-%d") if team.updated_at else None,
        "members": [{"id": m.id, "email": m.email, "name": m.name, "role": m.role} for m in members],
    }


class UpdateTeamRequest(BaseModel):
    name: str | None = None
    plan_id: str | None = None


@router.put("/{team_id}")
async def update_team(
    team_id: str,
    req: UpdateTeamRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.CREATE_TEAM),
):
    team = await get_current_team_or_raise(team_id, current_user, db)
    if req.name is not None:
        team.name = req.name
    if req.plan_id is not None:
        team.plan_id = req.plan_id
    await db.commit()
    await db.refresh(team)
    return {"id": team.id, "name": team.name, "plan_id": team.plan_id}
