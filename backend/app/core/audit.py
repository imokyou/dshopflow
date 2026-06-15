import json
import time
from datetime import datetime, timezone
from sqlalchemy import event
from app.database import async_session, Base
from app.models import AuditLog


# ── Audit Logger ──
def log_audit(db, user_id: str, team_id: str | None, action: str,
              entity_type: str, entity_id: str = None, entity_label: str = None,
              old_values: dict = None, new_values: dict = None,
              ip_address: str = None, user_agent: str = None, extra: dict = None):
    log = AuditLog(
        team_id=team_id, user_id=user_id, action=action,
        entity_type=entity_type, entity_id=str(entity_id) if entity_id else None,
        entity_label=entity_label, old_values=old_values, new_values=new_values,
        ip_address=ip_address, user_agent=user_agent, extra_data=extra or {},
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)


# ── Session Tracker (Redis) ──
import redis as _redis
from app.config import settings

_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = _redis.from_url(settings.REDIS_URL)
        except Exception:
            _redis_client = None
    return _redis_client


def track_session(user_id: str, metadata: dict):
    r = _get_redis()
    if r:
        key = f"active_session:{user_id}"
        data = {**metadata, "last_activity": int(time.time())}
        r.setex(key, 900, json.dumps(data))  # 15 min TTL


def get_active_sessions() -> list[dict]:
    r = _get_redis()
    if not r:
        return []
    sessions = []
    for key in r.scan_iter("active_session:*"):
        data = r.get(key)
        if data:
            sessions.append(json.loads(data))
    return sorted(sessions, key=lambda s: s.get("last_activity", 0), reverse=True)


def get_online_count() -> int:
    r = _get_redis()
    if not r:
        return 0
    return sum(1 for _ in r.scan_iter("active_session:*"))


def force_logout_user(user_id: str):
    r = _get_redis()
    if r:
        key = f"active_session:{user_id}"
        data = r.get(key)
        if data:
            session = json.loads(data)
            jti = session.get("jti")
            if jti:
                ttl = r.ttl(key)
                if ttl > 0:
                    r.setex(f"jwt_blacklist:{jti}", ttl, "revoked")
        r.delete(key)


def is_token_blacklisted(jti: str) -> bool:
    r = _get_redis()
    if not r:
        return False
    return r.exists(f"jwt_blacklist:{jti}") > 0
