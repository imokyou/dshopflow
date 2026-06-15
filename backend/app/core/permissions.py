from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.dependencies import get_current_user, get_db
from app.models import User, Team, Shop, ImportTask, QuotaRule


class Permission:
    CREATE_TEAM = "create_team"
    MANAGE_TEAM_MEMBERS = "manage_team_members"
    MANAGE_SHOPS = "manage_shops"
    IMPORT_PRODUCT = "import_product"
    EDIT_PRODUCT = "edit_product"
    DELETE_PRODUCT = "delete_product"
    MANAGE_PRICING = "manage_pricing"
    VIEW_AUDIT_LOG = "view_audit_log"
    MANAGE_SUBSCRIPTIONS = "manage_subscriptions"


ROLE_PERMISSIONS = {
    "super_admin": {
        Permission.CREATE_TEAM, Permission.MANAGE_TEAM_MEMBERS,
        Permission.MANAGE_SHOPS, Permission.IMPORT_PRODUCT,
        Permission.EDIT_PRODUCT, Permission.DELETE_PRODUCT,
        Permission.MANAGE_PRICING, Permission.VIEW_AUDIT_LOG,
        Permission.MANAGE_SUBSCRIPTIONS,
    },
    "manager": {
        Permission.MANAGE_TEAM_MEMBERS, Permission.MANAGE_SHOPS,
        Permission.IMPORT_PRODUCT, Permission.EDIT_PRODUCT,
        Permission.DELETE_PRODUCT, Permission.MANAGE_PRICING,
        Permission.VIEW_AUDIT_LOG,
    },
    "member": {
        Permission.IMPORT_PRODUCT, Permission.EDIT_PRODUCT,
        Permission.DELETE_PRODUCT, Permission.MANAGE_PRICING,
    },
}


class PermissionChecker:
    """FastAPI-native permission checker as a callable dependency."""

    def __init__(self, permission: str):
        self.permission = permission

    async def __call__(self, current_user: User = Depends(get_current_user)):
        user_perms = ROLE_PERMISSIONS.get(current_user.role, set())
        if self.permission not in user_perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {self.permission}"
            )
        return current_user


# 便捷函数 — 在路由中使用: Depends(PermissionChecker("create_team"))
def require(permission: str):
    return Depends(PermissionChecker(permission))


async def get_current_team_or_raise(
    team_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if current_user.role != "super_admin" and current_user.team_id != team_id:
        raise HTTPException(status_code=403, detail="Access denied: wrong team")
    return team


class QuotaChecker:
    def __init__(self, team: Team):
        self.team = team
        self._quota = None

    async def _load(self, db: AsyncSession):
        if self._quota is None:
            team = await db.get(Team, self.team.id)
            if team and team.plan_id:
                self._quota = await db.get(QuotaRule, team.plan_id)

    async def check_monthly_import(self, db: AsyncSession) -> bool:
        await self._load(db)
        if not self._quota or self._quota.monthly_import_limit == 0:
            return True
        count = await db.scalar(
            select(func.count(ImportTask.id)).where(
                ImportTask.team_id == self.team.id,
                ImportTask.created_at >= func.date_trunc("month", func.now()),
            )
        )
        return count < self._quota.monthly_import_limit

    async def check_team_members(self, db: AsyncSession) -> bool:
        await self._load(db)
        if not self._quota or self._quota.max_team_members == 0:
            return True
        count = await db.scalar(
            select(func.count(User.id)).where(User.team_id == self.team.id)
        )
        return count < self._quota.max_team_members

    async def check_shops(self, db: AsyncSession) -> bool:
        await self._load(db)
        if not self._quota or self._quota.max_shops == 0:
            return True
        count = await db.scalar(
            select(func.count(Shop.id)).where(Shop.team_id == self.team.id)
        )
        return count < self._quota.max_shops
