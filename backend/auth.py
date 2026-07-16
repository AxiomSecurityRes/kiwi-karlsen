"""인증 — 전문가 수준 강화.

비밀번호
  · scrypt (메모리 하드, GPU/ASIC 공격에 강함) — OWASP 권장 파라미터
  · 서버 비밀키를 페퍼(pepper)로 사용 → DB만 유출돼도 오프라인 크래킹이 어려움
  · 기존 PBKDF2 해시는 로그인 시 자동으로 scrypt 로 업그레이드
  · 상수 시간 비교(compare_digest)로 타이밍 공격 방어

토큰
  · HMAC-SHA256 서명된 무상태 토큰 (형식: v2.payload.sig)
  · payload 에 token_version 포함 → 비밀번호 변경/전체 로그아웃 시 즉시 무효화
  · TTL 7일(기존 30일에서 단축), 발급 시각 + 논스 포함

2단계 인증(2FA)
  · TOTP (RFC 6238, SHA-1/30초/6자리) — 외부 라이브러리 없이 표준 라이브러리로 구현
  · 백업 코드 10개 (해시로 저장, 1회용)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
import time
from typing import Optional

from sqlalchemy.orm import Session

from .config import settings
from .models import User

# ---------------------------------------------------------------------------
# 정책
# ---------------------------------------------------------------------------
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7      # 7일
MIN_PASSWORD_LEN = 8                       # 6 → 8자 (OWASP 최소 권장)
MAX_PASSWORD_LEN = 128
MIN_USERNAME_LEN = 2
MAX_USERNAME_LEN = 20

# scrypt 파라미터 (OWASP: N=2^15, r=8, p=1 이상)
SCRYPT_N = 2 ** 15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_MAXMEM = 64 * 1024 * 1024   # 64MB

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _pepper() -> bytes:
    """비밀키에서 유도한 페퍼. DB가 유출돼도 이 값 없이는 크래킹이 사실상 불가."""
    return hashlib.sha256(("pepper|" + settings.SECRET).encode()).digest()


# ---------------------------------------------------------------------------
# 비밀번호 해싱
# ---------------------------------------------------------------------------
def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8") + _pepper(),
        salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
        dklen=SCRYPT_DKLEN, maxmem=SCRYPT_MAXMEM,
    )


def _hash_password(password: str, salt: Optional[bytes] = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = _scrypt(password, salt)
    return f"scrypt${salt.hex()}${dk.hex()}"


def _hash_password_pbkdf2_legacy(password: str, salt: bytes) -> str:
    """구버전 형식 검증용 (salt_hex$dk_hex)."""
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return salt.hex() + "$" + dk.hex()


def _verify_password(password: str, stored: str) -> tuple[bool, bool]:
    """(검증 성공 여부, 업그레이드 필요 여부)."""
    if not stored:
        return False, False
    try:
        if stored.startswith("scrypt$"):
            _, salt_hex, dk_hex = stored.split("$", 2)
            candidate = _scrypt(password, bytes.fromhex(salt_hex))
            return hmac.compare_digest(candidate, bytes.fromhex(dk_hex)), False
        # 구버전 PBKDF2 (salt$dk)
        salt_hex, _dk = stored.split("$", 1)
        candidate = _hash_password_pbkdf2_legacy(password, bytes.fromhex(salt_hex))
        ok = hmac.compare_digest(candidate, stored)
        return ok, ok   # 맞으면 scrypt 로 업그레이드
    except Exception:
        return False, False


# ---------------------------------------------------------------------------
# 검증 정책
# ---------------------------------------------------------------------------
def validate_username(username: str) -> Optional[str]:
    username = (username or "").strip()
    if len(username) < MIN_USERNAME_LEN:
        return f"사용자 이름은 {MIN_USERNAME_LEN}자 이상이어야 합니다."
    if len(username) > MAX_USERNAME_LEN:
        return f"사용자 이름은 {MAX_USERNAME_LEN}자 이하여야 합니다."
    if not USERNAME_RE.match(username):
        return "사용자 이름은 영문/숫자/_-. 만 사용할 수 있습니다."
    if username.lower() in ("admin", "administrator", "root", "system", "kiwi",
                            "moderator", "support", "official"):
        return "사용할 수 없는 사용자 이름입니다."
    return None


def validate_password(password: str, username: str = "") -> Optional[str]:
    if not password or len(password) < MIN_PASSWORD_LEN:
        return f"비밀번호는 {MIN_PASSWORD_LEN}자 이상이어야 합니다."
    if len(password) > MAX_PASSWORD_LEN:
        return "비밀번호가 너무 깁니다."

    # 사용자 이름을 포함하면 안 됨
    if username and len(username) >= 3 and username.lower() in password.lower():
        return "비밀번호에 사용자 이름을 넣을 수 없습니다."

    # 단순 반복/연속 패턴 차단 (aaaaaaaa, 12345678, abcdefgh)
    if len(set(password)) <= 2:
        return "너무 단순한 비밀번호입니다."
    lowered = password.lower()
    seqs = ("0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop")
    for seq in seqs:
        for i in range(len(seq) - 5):
            if seq[i:i + 6] in lowered:
                return "연속된 문자/숫자는 사용할 수 없습니다."

    # 문자 종류 2가지 이상 (영문/숫자/기호)
    kinds = sum([
        any(c.isalpha() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    ])
    if kinds < 2:
        return "영문·숫자·기호 중 2가지 이상을 조합해주세요."
    return None


# ---------------------------------------------------------------------------
# 회원가입 / 로그인
# ---------------------------------------------------------------------------
def register(db: Session, username: str, password: str) -> tuple[Optional[User], Optional[str]]:
    username = (username or "").strip()
    err = validate_username(username) or validate_password(password, username)
    if err:
        return None, err
    if db.query(User).filter(User.username.ilike(username)).first():
        return None, "이미 사용 중인 사용자 이름입니다."

    user = User(username=username, password_hash=_hash_password(password), token_version=1)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, None


def login(db: Session, username: str, password: str) -> tuple[Optional[User], Optional[str]]:
    username = (username or "").strip()
    user = db.query(User).filter(User.username.ilike(username)).first()

    # 사용자 존재 여부를 노출하지 않는다 + 타이밍 차이도 줄인다(더미 해시 검증)
    if not user or not user.password_hash:
        _scrypt(password or "x", b"0" * 16)   # 시간 균등화
        return None, "사용자 이름 또는 비밀번호가 올바르지 않습니다."

    ok, needs_upgrade = _verify_password(password, user.password_hash)
    if not ok:
        return None, "사용자 이름 또는 비밀번호가 올바르지 않습니다."

    # 구형 해시는 로그인 성공 시 조용히 scrypt 로 업그레이드
    if needs_upgrade:
        user.password_hash = _hash_password(password)
        db.commit()

    return user, None


def change_password(db: Session, user: User, new_password: str) -> Optional[str]:
    err = validate_password(new_password, user.username)
    if err:
        return err
    user.password_hash = _hash_password(new_password)
    # 기존 토큰 전부 무효화 (다른 기기 강제 로그아웃)
    user.token_version = (user.token_version or 1) + 1
    db.commit()
    return None


def revoke_all_tokens(db: Session, user: User) -> None:
    user.token_version = (user.token_version or 1) + 1
    db.commit()


# ---------------------------------------------------------------------------
# 서명 토큰
# ---------------------------------------------------------------------------
def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(user: User) -> str:
    """v2 형식: v2.<payload>.<sig>   payload = user_id.token_version.issued.nonce"""
    nonce = secrets.token_hex(6)
    payload = f"{user.id}.{user.token_version or 1}.{int(time.time())}.{nonce}"
    sig = hmac.new(settings.SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    return f"v2.{_b64e(payload.encode())}.{_b64e(sig)}"


def parse_token(token: str) -> Optional[dict]:
    """서명·만료만 검증(무상태). token_version 은 DB 조회 시 확인."""
    try:
        if token.startswith("v2."):
            _, payload_b64, sig_b64 = token.split(".", 2)
            payload = _b64d(payload_b64)
            expected = hmac.new(settings.SECRET.encode(), payload, hashlib.sha256).digest()
            if not hmac.compare_digest(_b64d(sig_b64), expected):
                return None
            uid, ver, issued, _nonce = payload.decode().split(".", 3)
            if int(issued) + TOKEN_TTL_SECONDS < int(time.time()):
                return None
            return {"user_id": int(uid), "version": int(ver), "issued": int(issued)}

        # 구버전(v1) 토큰: user_id.issued  — 호환 유지(버전 검사 없음)
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64d(payload_b64)
        expected = hmac.new(settings.SECRET.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64d(sig_b64), expected):
            return None
        uid, issued = payload.decode().split(".", 1)
        if int(issued) + TOKEN_TTL_SECONDS < int(time.time()):
            return None
        return {"user_id": int(uid), "version": None, "issued": int(issued)}
    except Exception:
        return None


def get_user_id_by_token(token: str) -> Optional[int]:
    """서명/만료만 확인하는 가벼운 조회 (미들웨어용)."""
    info = parse_token(token)
    return info["user_id"] if info else None


def user_from_token(db: Session, token: str) -> Optional[User]:
    """DB 확인까지 포함한 완전한 검증 — token_version 대조로 폐기된 토큰을 걸러낸다."""
    info = parse_token(token)
    if not info:
        return None
    user = db.query(User).filter(User.id == info["user_id"]).first()
    if not user:
        return None
    if info["version"] is not None and int(info["version"]) != int(user.token_version or 1):
        return None   # 비밀번호 변경/전체 로그아웃으로 폐기된 토큰
    return user


# ---------------------------------------------------------------------------
# 2단계 인증 (TOTP, RFC 6238)
# ---------------------------------------------------------------------------
def generate_totp_secret() -> str:
    """base32 시크릿 (20바이트)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_uri(username: str, secret: str) -> str:
    """인증 앱(Google Authenticator 등) 등록용 otpauth URI."""
    issuer = "Kiwi Karlsen"
    return (f"otpauth://totp/{issuer}:{username}?secret={secret}"
            f"&issuer={issuer.replace(' ', '%20')}&algorithm=SHA1&digits=6&period=30")


def _totp_at(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{code % 1_000_000:06d}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """앞뒤 30초 창을 허용(시계 오차 대비). 상수 시간 비교."""
    code = (code or "").strip().replace(" ", "")
    if not secret or not code.isdigit() or len(code) != 6:
        return False
    now = int(time.time()) // 30
    for drift in range(-window, window + 1):
        if hmac.compare_digest(_totp_at(secret, now + drift), code):
            return True
    return False


def generate_backup_codes(n: int = 10) -> list[str]:
    """1회용 백업 코드 (표시용 평문)."""
    return [f"{secrets.randbelow(10**5):05d}-{secrets.randbelow(10**5):05d}" for _ in range(n)]


def hash_backup_codes(codes: list[str]) -> str:
    """백업 코드는 해시로만 저장한다."""
    hashed = [hashlib.sha256((c + settings.SECRET).encode()).hexdigest()[:32] for c in codes]
    return ",".join(hashed)


def consume_backup_code(user: User, code: str) -> bool:
    """백업 코드 검증 + 1회용 소모."""
    if not user.backup_codes:
        return False
    target = hashlib.sha256(((code or "").strip() + settings.SECRET).encode()).hexdigest()[:32]
    codes = [c for c in user.backup_codes.split(",") if c]
    for i, c in enumerate(codes):
        if hmac.compare_digest(c, target):
            codes.pop(i)
            user.backup_codes = ",".join(codes)
            return True
    return False
