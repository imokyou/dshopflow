from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import User, Invitation
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token


async def register_user(
    db: AsyncSession,
    email: str,
    password: str,
    name: str | None = None,
    invitation_token: str | None = None,
) -> dict:
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise ValueError("Email already registered")

    user_count = await db.scalar(select(func.count(User.id)))
    is_first = user_count == 0

    team_id = None
    role = "member"

    if is_first:
        role = "super_admin"
    elif invitation_token:
        invitation = await db.scalar(
            select(Invitation).where(Invitation.token == invitation_token)
        )
        if not invitation or invitation.accepted_at:
            raise ValueError("Invalid or expired invitation")
        team_id = invitation.team_id
        role = invitation.role
        invitation.accepted_at = datetime.now(timezone.utc)
    else:
        raise ValueError("Registration requires an invitation or must be the first user")

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name,
        role=role,
        team_id=team_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(user.id, user.email, user.role, user.team_id)
    refresh_token = create_refresh_token(user.id)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": _user_dict(user),
    }


async def login_user(db: AsyncSession, email: str, password: str) -> dict:
    user = await db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(password, user.password_hash):
        raise ValueError("Invalid email or password")
    if not user.is_active:
        raise ValueError("Account is deactivated")

    access_token = create_access_token(user.id, user.email, user.role, user.team_id)
    refresh_token = create_refresh_token(user.id)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": _user_dict(user),
    }


async def refresh_access_token(db: AsyncSession, refresh_token_str: str) -> dict:
    try:
        payload = decode_token(refresh_token_str)
        if payload.get("type") != "refresh":
            raise ValueError("Not a refresh token")
        user_id = payload["sub"]
        user = await db.get(User, user_id)
        if not user or not user.is_active:
            raise ValueError("User not found or inactive")
    except Exception:
        raise ValueError("Invalid refresh token")

    access_token = create_access_token(user.id, user.email, user.role, user.team_id)
    new_refresh = create_refresh_token(user.id)

    return {
        "access_token": access_token,
        "refresh_token": new_refresh,
        "user": _user_dict(user),
    }


def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "team_id": user.team_id,
    }
