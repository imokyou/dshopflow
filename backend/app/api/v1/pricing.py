from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, PricingRule, iso_utc
from app.core.permissions import require, Permission, get_current_team_or_raise

router = APIRouter(prefix="/pricing-rules", tags=["pricing"])


class CreatePricingRuleRequest(BaseModel):
    name: str
    priority: int = 0
    conditions: list = []
    formula: dict = {}


class UpdatePricingRuleRequest(BaseModel):
    name: str | None = None
    priority: int | None = None
    conditions: list | None = None
    formula: dict | None = None


@router.post("", status_code=201)
async def create_rule(
    req: CreatePricingRuleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_PRICING),
):
    # 自动使用当前用户的团队
    team_id = current_user.team_id
    if not team_id:
        raise HTTPException(status_code=400, detail="你不在任何团队中")
    rule = PricingRule(
        team_id=team_id, created_by=current_user.id,
        name=req.name, priority=req.priority,
        conditions=req.conditions, formula=req.formula,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "name": rule.name, "priority": rule.priority}


@router.get("")
async def list_rules(
    team_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "super_admin" and not team_id:
        rules = await db.scalars(select(PricingRule).order_by(PricingRule.priority.desc()))
    else:
        tid = team_id or current_user.team_id
        rules = await db.scalars(
            select(PricingRule).where(PricingRule.team_id == tid).order_by(PricingRule.priority.desc())
        )
    return [{
        "id": r.id, "team_id": r.team_id,
        "name": r.name, "priority": r.priority,
        "conditions": r.conditions or [],
        "formula": r.formula or {},
        "is_active": r.is_active,
        "created_at": (iso_utc(r.created_at)) if r.created_at else None,
    } for r in rules]


@router.put("/{rule_id}")
async def update_rule(
    rule_id: str, req: UpdatePricingRuleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_PRICING),
):
    rule = await db.get(PricingRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and rule.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    if req.name is not None:
        rule.name = req.name
    if req.priority is not None:
        rule.priority = req.priority
    if req.conditions is not None:
        rule.conditions = req.conditions
    if req.formula is not None:
        rule.formula = req.formula
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "name": rule.name, "priority": rule.priority}


@router.put("/{rule_id}/toggle-active")
async def toggle_rule_active(
    rule_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_PRICING),
):
    rule = await db.get(PricingRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and rule.team_id != current_user.team_id:
        raise HTTPException(status_code=403)
    rule.is_active = not rule.is_active
    await db.commit()
    return {"id": rule.id, "is_active": rule.is_active}
