"""인증: 안전한 비밀번호 해싱(PBKDF2) + 서명 토큰(HMAC).

토큰은 서버 비밀키(KIWI_SECRET)로 서명된 무상태(stateless) 토큰이라
서버를 재시작/재배포해도 유효합니다(메모리 의존 없음).
형식:  base64(user_id.issued_at).base64(hmac_sha256)
"""
import base64
import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

from sqlalchemy.orm import Session

from .config import settings
from .models import User

TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30일
MIN_PASSWORD_LEN = 6
MIN_USERNAME_LEN = 2
MAX_USERNAME_LEN = 20


# ---------- 비밀번호 ----------
def _hash_password(password: str, salt: Optional[bytes] = None) -> str:
    if salt is None:
        salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return salt.hex() + "$" + dk.hex()


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split("$", 1)
        candidate = _hash_password(password, bytes.fromhex(salt_hex))
        return hmac.compare_digest(candidate, stored)
    except Exception:
        return False


def validate_username(username: str) -> Optional[str]:
    username = username.strip()
    if len(username) < MIN_USERNAME_LEN:
        return f"사용자 이름은 {MIN_USERNAME_LEN}자 이상이어야 합니다."
    if len(username) > MAX_USERNAME_LEN:
        return f"사용자 이름은 {MAX_USERNAME_LEN}자 이하여야 합니다."
    if not all(c.isalnum() or c in "_-." for c in username):
        return "사용자 이름은 영문/숫자/_-. 만 사용할 수 있습니다."
    return None


def validate_password(password: str) -> Optional[str]:
    if not password or len(password) < MIN_PASSWORD_LEN:
        return f"비밀번호는 {MIN_PASSWORD_LEN}자 이상이어야 합니다."
    if len(password) > 128:
        return "비밀번호가 너무 깁니다."
    return None


# ---------- 회원가입 / 로그인 ----------
def register(db: Session, username: str, password: str) -> tuple[Optional[User], Optional[str]]:
    username = username.strip()
    err = validate_username(username) or validate_password(password)
    if err:
        return None, err
    # 대소문자 무시 중복 검사
    exists = db.query(User).filter(User.username.ilike(username)).first()
    if exists:
        return None, "이미 사용 중인 사용자 이름입니다."
    user = User(username=username, password_hash=_hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, None


def login(db: Session, username: str, password: str) -> tuple[Optional[User], Optional[str]]:
    username = username.strip()
    user = db.query(User).filter(User.username.ilike(username)).first()
    # 사용자 존재 여부를 노출하지 않도록 동일 메시지 사용
    if not user or not user.password_hash or not _verify_password(password, user.password_hash):
        return None, "사용자 이름 또는 비밀번호가 올바르지 않습니다."
    return user, None


# ---------- 서명 토큰 ----------
def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_token(user: User) -> str:
    payload = f"{user.id}.{int(time.time())}"
    sig = hmac.new(settings.SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{_b64e(payload.encode())}.{_b64e(sig)}"


def get_user_id_by_token(token: str) -> Optional[int]:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64d(payload_b64)
        expected = hmac.new(settings.SECRET.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64d(sig_b64), expected):
            return None
        user_id_str, issued_str = payload.decode().split(".", 1)
        if int(issued_str) + TOKEN_TTL_SECONDS < int(time.time()):
            return None  # 만료
        return int(user_id_str)
    except Exception:
        return None


def revoke_token(token: str) -> None:
    # 무상태 토큰이라 서버 측 폐기는 비밀키 교체로만 가능. 클라이언트가 폐기.
    pass
