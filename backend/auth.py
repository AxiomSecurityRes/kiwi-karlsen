import hashlib
import os
import secrets
from typing import Optional

from sqlalchemy.orm import Session

from .models import User

# token -> user_id (인메모리 세션 스토어)
_TOKENS: dict[str, int] = {}


def _hash_password(password: str, salt: Optional[bytes] = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return salt.hex() + "$" + dk.hex()


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split("$", 1)
        return secrets.compare_digest(_hash_password(password, bytes.fromhex(salt_hex)), stored)
    except Exception:
        return False


def login_or_register(db: Session, username: str, password: Optional[str]) -> tuple[Optional[User], Optional[str]]:
    """(user, error) 반환. 사용자가 없으면 생성, 있으면 비밀번호 검증."""
    username = username.strip()
    if not username:
        return None, "사용자 이름이 비어 있습니다."

    user = db.query(User).filter(User.username == username).first()

    if user is None:
        user = User(
            username=username,
            password_hash=_hash_password(password) if password else None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user, None

    # 기존 사용자: 비밀번호가 설정되어 있으면 검증
    if user.password_hash:
        if not password or not _verify_password(password, user.password_hash):
            return None, "비밀번호가 올바르지 않습니다."
    return user, None


def issue_token(user: User) -> str:
    token = secrets.token_urlsafe(32)
    _TOKENS[token] = user.id
    return token


def get_user_id_by_token(token: str) -> Optional[int]:
    return _TOKENS.get(token)


def revoke_token(token: str) -> None:
    _TOKENS.pop(token, None)
