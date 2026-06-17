from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, SubscriptionPlan, QuotaRule, AIProvider, AuditLog, Team
from app.core.permissions import require, Permission
from app.core.audit import get_active_sessions, force_logout_user, log_audit
from app.core.crypto import encrypt_secret, decrypt_secret
from app.services import platform_settings_service as platform_settings

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 平台设置（Shopify App 等，超管管理；secret 加密存、不回明文）──

class PlatformSettingsRequest(BaseModel):
    shopify_api_key: str | None = None
    shopify_api_secret: str | None = None  # 留空表示不修改
    shopify_scopes: str | None = None
    shopify_app_base_url: str | None = None
    admin_base_url: str | None = None


@router.get("/platform-settings")
async def get_platform_settings(
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SUBSCRIPTIONS),
):
    return await platform_settings.get_public_settings(db)


@router.put("/platform-settings")
async def update_platform_settings(
    req: PlatformSettingsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SUBSCRIPTIONS),
):
    # 只传非 None 的字段；secret 传空串会被 service 忽略（不覆盖原值）
    values = {k: v for k, v in req.model_dump().items() if v is not None}
    await platform_settings.set_values(db, values)
    return await platform_settings.get_public_settings(db)


# ── Me (当前用户信息) ──
@router.get("/me")
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回当前用户信息、所在团队及成员列表"""
    from sqlalchemy import func
    result = {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "name": current_user.name,
            "role": current_user.role,
            "team_id": current_user.team_id,
            "is_active": current_user.is_active,
        },
        "team": None,
        "members": [],
    }
    if current_user.team_id:
        team = await db.get(Team, current_user.team_id)
        if team:
            members = await db.scalars(select(User).where(User.team_id == current_user.team_id))
            result["team"] = {
                "id": team.id,
                "name": team.name,
                "plan_id": team.plan_id,
                "plan_name": team.plan.name if team.plan else "免费",
                "plan_slug": team.plan.slug if team.plan else "free",
                "is_active": team.is_active,
                "created_at": team.created_at.strftime("%Y-%m-%d") if team.created_at else None,
            }
            result["members"] = [{
                "id": m.id, "email": m.email, "name": m.name, "role": m.role,
                "is_active": m.is_active,
                "created_at": (m.created_at.isoformat() + "+00:00") if m.created_at else None,
                "updated_at": (m.updated_at.isoformat() + "+00:00") if m.updated_at else None,
            } for m in members]
    return result


# ── Plans ──
class CreatePlanRequest(BaseModel):
    name: str
    slug: str
    monthly_price: float = 0
    yearly_price: float = 0
    quota_rule_id: str | None = None


class UpdatePlanRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    monthly_price: float | None = None
    yearly_price: float | None = None
    quota_rule_id: str | None = None


@router.get("/plans")
async def list_plans(db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    plans = await db.scalars(select(SubscriptionPlan))
    return [{
        "id": p.id, "name": p.name, "slug": p.slug,
        "monthly_price": p.monthly_price, "yearly_price": p.yearly_price,
        "quota_rule_id": p.quota_rule_id,
        "quota_rule_name": p.quota_rule.name if p.quota_rule else None,
        "is_active": p.is_active, "sort_order": p.sort_order,
    } for p in plans]


@router.post("/plans", status_code=201)
async def create_plan(req: CreatePlanRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    plan = SubscriptionPlan(**req.model_dump())
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return {"id": plan.id, "name": plan.name}


@router.put("/plans/{plan_id}")
async def update_plan(plan_id: str, req: UpdatePlanRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    plan = await db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404)
    for field in ("name", "slug", "monthly_price", "yearly_price", "quota_rule_id"):
        val = getattr(req, field, None)
        if val is not None:
            setattr(plan, field, val)
    await db.commit()
    await db.refresh(plan)
    return {"id": plan.id, "name": plan.name, "slug": plan.slug}


@router.put("/plans/{plan_id}/toggle-active")
async def toggle_plan_active(plan_id: str, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    plan = await db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404)
    plan.is_active = not plan.is_active
    await db.commit()
    return {"id": plan.id, "is_active": plan.is_active}


# ── Quota Rules ──
class CreateQuotaRuleRequest(BaseModel):
    name: str
    max_team_members: int = 1
    max_shops: int = 1
    daily_import_limit: int = 0
    daily_image_limit: int = 0
    monthly_import_limit: int = 0
    monthly_image_limit: int = 0


class UpdateQuotaRuleRequest(BaseModel):
    name: str | None = None
    max_team_members: int | None = None
    max_shops: int | None = None
    daily_import_limit: int | None = None
    daily_image_limit: int | None = None
    monthly_import_limit: int | None = None
    monthly_image_limit: int | None = None


@router.get("/quota-rules")
async def list_quota_rules(db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    rules = await db.scalars(select(QuotaRule))
    return [{
        "id": r.id, "name": r.name,
        "max_team_members": r.max_team_members, "max_shops": r.max_shops,
        "daily_import_limit": r.daily_import_limit, "daily_image_limit": r.daily_image_limit,
        "monthly_import_limit": r.monthly_import_limit, "monthly_image_limit": r.monthly_image_limit,
        "is_active": r.is_active,
    } for r in rules]


@router.post("/quota-rules", status_code=201)
async def create_quota_rule(req: CreateQuotaRuleRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    rule = QuotaRule(**req.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "name": rule.name}


@router.put("/quota-rules/{rule_id}")
async def update_quota_rule(rule_id: str, req: UpdateQuotaRuleRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    rule = await db.get(QuotaRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404)
    for field in ("name", "max_team_members", "max_shops",
                  "daily_import_limit", "daily_image_limit",
                  "monthly_import_limit", "monthly_image_limit"):
        val = getattr(req, field, None)
        if val is not None:
            setattr(rule, field, val)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "name": rule.name}


@router.put("/quota-rules/{rule_id}/toggle-active")
async def toggle_quota_rule_active(rule_id: str, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    rule = await db.get(QuotaRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404)
    rule.is_active = not rule.is_active
    await db.commit()
    return {"id": rule.id, "is_active": rule.is_active}


# ── AI Providers ──
class CreateAIProviderRequest(BaseModel):
    name: str
    slug: str
    provider_type: str
    category: str = "text"
    api_base_url: str
    api_key: str
    default_model: str
    available_models: list[str] = []
    priority: int = 0


class UpdateAIProviderRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    provider_type: str | None = None
    category: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    available_models: list[str] | None = None
    priority: int | None = None


@router.get("/ai-providers")
async def list_ai_providers(db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    providers = await db.scalars(select(AIProvider))
    return [{
        "id": p.id, "name": p.name, "slug": p.slug,
        "provider_type": p.provider_type, "category": p.category,
        "api_base_url": p.api_base_url,
        "default_model": p.default_model,
        "priority": p.priority,
        "available_models": p.available_models or [],
        "is_active": p.is_active, "is_default": p.is_default,
    } for p in providers]


@router.post("/ai-providers", status_code=201)
async def create_ai_provider(req: CreateAIProviderRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    provider = AIProvider(
        name=req.name, slug=req.slug, provider_type=req.provider_type,
        category=req.category, api_base_url=req.api_base_url,
        api_key_encrypted=encrypt_secret(req.api_key), default_model=req.default_model,
        available_models=req.available_models, priority=req.priority,
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return {"id": provider.id, "name": provider.name}


@router.put("/ai-providers/{provider_id}")
async def update_ai_provider(provider_id: str, req: UpdateAIProviderRequest, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    p = await db.get(AIProvider, provider_id)
    if not p:
        raise HTTPException(status_code=404)
    for field in ("name", "slug", "provider_type", "category", "api_base_url", "default_model", "priority"):
        val = getattr(req, field, None)
        if val is not None:
            setattr(p, field, val)
    if req.api_key is not None:
        p.api_key_encrypted = encrypt_secret(req.api_key)
    if req.available_models is not None:
        p.available_models = req.available_models
    await db.commit()
    await db.refresh(p)
    return {"id": p.id, "name": p.name, "slug": p.slug}


@router.put("/ai-providers/{provider_id}/toggle-active")
async def toggle_ai_provider_active(provider_id: str, db: AsyncSession = Depends(get_db), _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    p = await db.get(AIProvider, provider_id)
    if not p:
        raise HTTPException(status_code=404)
    p.is_active = not p.is_active
    await db.commit()
    return {"id": p.id, "is_active": p.is_active}


class FetchModelsRequest(BaseModel):
    api_base_url: str
    api_key: str = ""
    provider_id: str | None = None


def _same_origin(url_a: str, url_b: str) -> bool:
    """比较两个 URL 的 scheme+host+port 是否一致。"""
    from urllib.parse import urlparse
    a, b = urlparse(url_a), urlparse(url_b)
    return (a.scheme, a.hostname, a.port) == (b.scheme, b.hostname, b.port)


def _ensure_safe_outbound_url(url: str) -> None:
    """SSRF 防护：仅允许 http/https 的公网地址，禁止内网/本地/链路本地/元数据地址。"""
    import ipaddress
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="仅支持 http/https 地址")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="无效的地址")
    # 解析所有 IP（含 IPv4/IPv6），任一落在私有/保留段即拒绝
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="无法解析目标主机")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="禁止访问内网/保留地址")


@router.post("/ai-providers/fetch-models")
async def fetch_models(
    req: FetchModelsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_SUBSCRIPTIONS),
):
    """代理拉取 AI 提供商的模型列表（仅管理员）"""
    import httpx
    api_key = req.api_key
    base = req.api_base_url.rstrip("/")
    # 编辑时未传 key，从 DB 读取已存储的 key —— 但仅当目标 URL 与该 provider
    # 已登记的 base_url 同源时才回填，防止把平台密钥发往攻击者指定的任意地址。
    if not api_key and req.provider_id:
        provider = await db.get(AIProvider, req.provider_id)
        if provider:
            stored_base = (provider.api_base_url or "").rstrip("/")
            if stored_base and _same_origin(base, stored_base):
                api_key = decrypt_secret(provider.api_key_encrypted)
            else:
                raise HTTPException(
                    status_code=400,
                    detail="目标地址与已登记的 Provider 地址不一致，请重新填写 API Key",
                )
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写 API Key")
    # SSRF 防护：禁止内网/本地/链路本地地址
    _ensure_safe_outbound_url(base)
    # GLM 没有 /models 端点，返回预设列表
    provider_lower = (req.api_base_url or "").lower()
    if "bigmodel" in provider_lower or "zhipu" in provider_lower:
        return {"models": [
            # 文本模型
            "glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7", "glm-4.6", "glm-4.5",
            "glm-4-plus", "glm-4-0520", "glm-4-air", "glm-4-airx",
            "glm-4-flash", "glm-4-flashx", "glm-4-long",
            # 视觉模型
            "glm-5v-turbo", "glm-4.6v", "glm-4v-plus", "glm-4v-flash",
        ]}
    headers = {"Authorization": "Bearer " + api_key}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{base}/models", headers=headers)
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", data.get("models", []))
            if isinstance(models, list):
                ids = sorted([m.get("id", m if isinstance(m, str) else "") for m in models])
                return {"models": [m for m in ids if m]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"拉取失败: {str(e)}")
    return {"models": []}


# ── Audit Logs ──
@router.get("/audit-logs")
async def list_audit_logs(
    team_id: str | None = None, action: str | None = None, limit: int = 50,
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
    _: User = require(Permission.VIEW_AUDIT_LOG),
):
    from sqlalchemy.orm import joinedload
    query = select(AuditLog).options(joinedload(AuditLog.user)).order_by(AuditLog.created_at.desc()).limit(limit)
    if current_user.role != "super_admin":
        query = query.where(AuditLog.team_id == current_user.team_id)
    elif team_id:
        query = query.where(AuditLog.team_id == team_id)
    if action:
        query = query.where(AuditLog.action == action)
    logs = await db.scalars(query)
    return [{
        "id": l.id,
        "action": l.action,
        "operator_email": l.user.email if l.user else None,
        "operator_name": l.user.name if l.user else None,
        "entity_type": l.entity_type,
        "entity_label": l.entity_label,
        "old_values": l.old_values,
        "new_values": l.new_values,
        "created_at": (l.created_at.isoformat() + "+00:00") if l.created_at else None,
    } for l in logs]


# ── Sessions + Force Logout ──
@router.get("/sessions")
async def list_sessions(_: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    return get_active_sessions()


@router.delete("/sessions/{user_id}")
async def kick_user(user_id: str, _: User = require(Permission.MANAGE_SUBSCRIPTIONS)):
    force_logout_user(user_id)
    return {"ok": True, "message": f"User {user_id} has been logged out"}


# 经此端点可授予的角色白名单（super_admin 不可经此授予）
ASSIGNABLE_ROLES = {"member", "manager"}


def _validate_assignable_role(role: str) -> None:
    if role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"非法角色: {role}（仅允许 {', '.join(sorted(ASSIGNABLE_ROLES))}）",
        )


# ── Team Members (管理者) ──
class AddMemberRequest(BaseModel):
    team_id: str
    email: str
    password: str
    name: str | None = None
    role: str = "member"  # member or manager


@router.post("/members", status_code=201)
async def add_member(
    req: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_TEAM_MEMBERS),
):
    team = await db.get(Team, req.team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if current_user.role != "super_admin" and current_user.team_id != req.team_id:
        raise HTTPException(status_code=403)
    _validate_assignable_role(req.role)
    existing = await db.scalar(select(User).where(User.email == req.email))
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    from app.core.security import hash_password
    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name or req.email.split("@")[0],
        role=req.role,
        team_id=team.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "email": user.email, "role": user.role, "name": user.name}


@router.get("/teams/{team_id}/members")
async def list_team_members(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_TEAM_MEMBERS),
):
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and current_user.team_id != team_id:
        raise HTTPException(status_code=403)
    members = await db.scalars(select(User).where(User.team_id == team_id))
    return [{
        "id": m.id,
        "email": m.email,
        "name": m.name,
        "role": m.role,
        "is_active": m.is_active,
        "created_at": (m.created_at.isoformat() + "+00:00") if m.created_at else None,
        "updated_at": (m.updated_at.isoformat() + "+00:00") if m.updated_at else None,
    } for m in members]


class UpdateMemberRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    password: str | None = None
    role: str | None = None  # member | manager


@router.put("/teams/{team_id}/members/{user_id}")
async def update_member(
    team_id: str, user_id: str, req: UpdateMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_TEAM_MEMBERS),
):
    if current_user.role != "super_admin" and current_user.team_id != team_id:
        raise HTTPException(status_code=403)
    user = await db.get(User, user_id)
    if not user or user.team_id != team_id:
        raise HTTPException(status_code=404)

    old_values = {}
    new_values = {}

    if req.name is not None:
        old_values["name"] = user.name
        user.name = req.name
        new_values["name"] = req.name
    if req.email is not None:
        # 检查新邮箱是否已被占用
        if req.email != user.email:
            dup = await db.scalar(select(User).where(User.email == req.email))
            if dup:
                raise HTTPException(status_code=400, detail="该邮箱已被注册")
        old_values["email"] = user.email
        user.email = req.email
        new_values["email"] = req.email
    if req.password is not None:
        from app.core.security import hash_password
        user.password_hash = hash_password(req.password)
        new_values["password"] = "***"

    if req.role is not None:
        _validate_assignable_role(req.role)
        old_values["role"] = user.role
        user.role = req.role
        new_values["role"] = req.role

    if new_values:
        log_audit(db, current_user.id, team_id, "user.update", "user", user_id, user.email,
                  old_values=old_values, new_values=new_values)

    await db.commit()
    await db.refresh(user)
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


@router.put("/teams/{team_id}/members/{user_id}/toggle-active")
async def toggle_member_active(
    team_id: str, user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.MANAGE_TEAM_MEMBERS),
):
    if current_user.role != "super_admin" and current_user.team_id != team_id:
        raise HTTPException(status_code=403)
    user = await db.get(User, user_id)
    if not user or user.team_id != team_id:
        raise HTTPException(status_code=404)
    user.is_active = not user.is_active
    log_audit(db, current_user.id, team_id,
              "user." + ("deactivate" if not user.is_active else "activate"),
              "user", user_id, user.email)
    await db.commit()
    return {"id": user.id, "is_active": user.is_active}
