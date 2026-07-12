"""런타임 사이트 설정 — 관리자가 재배포 없이 즉시 변경할 수 있는 값들.

DB(site_settings)에 저장하고 프로세스 메모리에 캐싱한다.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import SiteSetting

# 기본값 정의: key -> (기본값, 타입, 설명)
DEFAULTS: dict[str, tuple[Any, str, str]] = {
    "maintenance_mode": (False, "bool", "점검 모드 (관리자 외 접근 차단)"),
    "registration_open": (True, "bool", "신규 회원가입 허용"),
    "motd": ("", "str", "공지사항 (로비 상단에 표시)"),
    "max_bot_elo": (3200, "int", "봇 대국 최대 ELO"),
    "puzzle_rating_min": (100, "int", "퍼즐 최소 레이팅"),
    "puzzle_rating_max": (3500, "int", "퍼즐 최대 레이팅"),
    "chat_enabled": (True, "bool", "대국 중 채팅 허용"),
    "dm_enabled": (True, "bool", "친구 DM 허용"),
    "review_enabled": (True, "bool", "게임 리뷰 기능 허용"),
    "guest_play": (True, "bool", "비로그인 봇 대국 허용"),
}

_cache: dict[str, Any] = {}
_loaded = False


def _parse(raw: str, kind: str) -> Any:
    if kind == "bool":
        return str(raw).lower() in ("1", "true", "yes", "on")
    if kind == "int":
        try:
            return int(raw)
        except (TypeError, ValueError):
            return 0
    return raw if raw is not None else ""


def _serialize(value: Any, kind: str) -> str:
    if kind == "bool":
        return "true" if value else "false"
    return str(value)


def load(db: Session) -> dict[str, Any]:
    """DB에서 전체 설정을 읽어 캐시에 적재."""
    global _loaded
    out: dict[str, Any] = {}
    rows = {}
    try:
        rows = {r.key: r.value for r in db.query(SiteSetting).all()}
    except Exception:
        rows = {}
    for key, (default, kind, _desc) in DEFAULTS.items():
        if key in rows:
            out[key] = _parse(rows[key], kind)
        else:
            out[key] = default
    _cache.clear()
    _cache.update(out)
    _loaded = True
    return out


def get(key: str, default: Any = None) -> Any:
    """캐시에서 설정 값 조회(요청 경로에서 DB 접근 없이 빠르게)."""
    if key in _cache:
        return _cache[key]
    if key in DEFAULTS:
        return DEFAULTS[key][0]
    return default


def all_settings() -> list[dict]:
    """관리자 UI 용: 값 + 타입 + 설명."""
    out = []
    for key, (default, kind, desc) in DEFAULTS.items():
        out.append({
            "key": key,
            "value": get(key, default),
            "type": kind,
            "desc": desc,
            "default": default,
        })
    return out


def set_value(db: Session, key: str, value: Any) -> tuple[bool, Optional[str]]:
    """설정 변경 후 캐시 갱신."""
    if key not in DEFAULTS:
        return False, "알 수 없는 설정 키입니다."
    _default, kind, _desc = DEFAULTS[key]
    if kind == "int":
        try:
            value = int(value)
        except (TypeError, ValueError):
            return False, "정수 값이 필요합니다."
    elif kind == "bool":
        value = bool(value)
    else:
        value = str(value)[:500]

    row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if row:
        row.value = _serialize(value, kind)
    else:
        db.add(SiteSetting(key=key, value=_serialize(value, kind)))
    db.commit()
    _cache[key] = value
    return True, None


def is_loaded() -> bool:
    return _loaded
