"""对称加密工具 — 用于存储 Shopify access_token / AI Provider API Key 等敏感凭据。

设计要点：
- 加密密钥优先取环境变量 CREDENTIAL_ENCRYPTION_KEY（标准 Fernet key）；
  缺失时从 SECRET_KEY 派生，保证开发环境可直接运行。
- 向后兼容：历史明文数据在 decrypt 时无法解密会原样返回，
  因此无需一次性数据迁移即可平滑上线（写入即加密，读取自动识别）。
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

# 加密串前缀，用于快速识别"已加密"与"历史明文"
_PREFIX = "enc::"


def _get_fernet() -> Fernet:
    key = getattr(settings, "CREDENTIAL_ENCRYPTION_KEY", "") or os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    if key:
        return Fernet(key.encode() if isinstance(key, str) else key)
    # 从 SECRET_KEY 派生一个稳定的 32 字节 Fernet key
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    derived = base64.urlsafe_b64encode(digest)
    return Fernet(derived)


def encrypt_secret(plaintext: str | None) -> str | None:
    """加密敏感串。空值原样返回。已加密的串不重复加密。"""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_PREFIX):
        return plaintext
    token = _get_fernet().encrypt(plaintext.encode()).decode()
    return _PREFIX + token


def decrypt_secret(value: str | None) -> str | None:
    """解密敏感串。历史明文（无前缀或无法解密）原样返回，保证向后兼容。"""
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value  # 历史明文
    token = value[len(_PREFIX):]
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        # 密钥变更或数据损坏：不抛异常，返回 None 避免把密文当 key 使用
        return None
