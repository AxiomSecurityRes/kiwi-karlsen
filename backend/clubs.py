"""체스 클럽 — 생성 / 가입 / 공지물 / 채팅 / 클럽 보드.

권한
  owner  : 클럽 개설자. 삭제·관리자 임명·모든 글/채팅 삭제 가능.
  admin  : 공지 작성·고정, 글/채팅 삭제, 구성원 추방 가능.
  member : 글 작성·채팅 가능.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

import chess
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import Club, ClubMember, ClubMessage, ClubPost, User
from .security import sanitize_text

MAX_CLUBS_PER_USER = 5          # 개설 상한 (스팸 방지)
MAX_POSTS = 100
MAX_MESSAGES = 200

ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}


# ---------------------------------------------------------------------------
# 유틸
# ---------------------------------------------------------------------------
def make_slug(name: str) -> str:
    """이름 → URL 안전한 slug. 한글은 그대로 두되 위험 문자만 제거."""
    s = unicodedata.normalize("NFKC", name).strip().lower()
    s = re.sub(r"[^\w가-힣\- ]+", "", s)
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    return s[:40] or "club"


def unique_slug(db: Session, name: str) -> str:
    base = make_slug(name)
    slug = base
    n = 2
    while db.query(Club).filter(Club.slug == slug).first():
        suffix = f"-{n}"
        slug = base[: 40 - len(suffix)] + suffix
        n += 1
        if n > 500:
            break
    return slug


def member_count(db: Session, club_id: int) -> int:
    return db.query(ClubMember).filter(ClubMember.club_id == club_id).count()


def role_of(db: Session, club_id: int, user_id: Optional[int]) -> Optional[str]:
    if not user_id:
        return None
    row = db.query(ClubMember).filter(
        ClubMember.club_id == club_id, ClubMember.user_id == user_id
    ).first()
    return row.role if row else None


def can_moderate(role: Optional[str]) -> bool:
    return role in ("owner", "admin")


# ---------------------------------------------------------------------------
# 클럽
# ---------------------------------------------------------------------------
def create(db: Session, user: User, name: str, description: str,
           emoji: str, is_public: bool) -> tuple[Optional[Club], Optional[str]]:
    name = sanitize_text(name, 60)
    if len(name) < 2:
        return None, "클럽 이름은 2자 이상이어야 합니다."

    owned = db.query(Club).filter(Club.owner_id == user.id).count()
    if owned >= MAX_CLUBS_PER_USER:
        return None, f"클럽은 최대 {MAX_CLUBS_PER_USER}개까지 만들 수 있습니다."

    if db.query(Club).filter(func.lower(Club.name) == name.lower()).first():
        return None, "같은 이름의 클럽이 이미 있습니다."

    club = Club(
        slug=unique_slug(db, name),
        name=name,
        description=sanitize_text(description, 500, allow_newlines=True),
        emoji=(emoji or "🏰")[:8],
        owner_id=user.id,
        is_public=1 if is_public else 0,
    )
    db.add(club)
    db.commit()
    db.refresh(club)

    db.add(ClubMember(club_id=club.id, user_id=user.id, role="owner"))
    db.commit()
    return club, None


def list_clubs(db: Session, q: str = "", user_id: Optional[int] = None,
               mine: bool = False, limit: int = 50) -> list[dict]:
    query = db.query(Club)
    if mine and user_id:
        ids = [m.club_id for m in db.query(ClubMember).filter(ClubMember.user_id == user_id).all()]
        if not ids:
            return []
        query = query.filter(Club.id.in_(ids))
    if q.strip():
        from .security import escape_like
        safe = escape_like(q.strip())
        query = query.filter(Club.name.ilike(f"%{safe}%", escape="\\"))

    rows = query.order_by(Club.id.desc()).limit(limit).all()
    out = []
    for cl in rows:
        d = cl.to_dict(member_count(db, cl.id))
        d["myRole"] = role_of(db, cl.id, user_id)
        out.append(d)
    # 구성원 많은 순으로
    out.sort(key=lambda x: x["members"], reverse=True)
    return out


def get_by_slug(db: Session, slug: str) -> Optional[Club]:
    return db.query(Club).filter(Club.slug == slug).first()


def detail(db: Session, club: Club, user_id: Optional[int]) -> dict:
    members = db.query(ClubMember).filter(ClubMember.club_id == club.id).all()
    names = {u.id: u for u in db.query(User).filter(
        User.id.in_([m.user_id for m in members] or [0])
    ).all()}

    member_list = []
    for m in members:
        u = names.get(m.user_id)
        if not u:
            continue
        member_list.append({
            "id": u.id,
            "username": u.username,
            "rating": round(u.rating),
            "role": m.role,
        })
    member_list.sort(key=lambda x: (-ROLE_RANK.get(x["role"], 0), -x["rating"]))

    d = club.to_dict(len(member_list))
    d["myRole"] = role_of(db, club.id, user_id)
    d["memberList"] = member_list
    d["ownerName"] = names.get(club.owner_id).username if names.get(club.owner_id) else ""
    return d


def join(db: Session, club: Club, user: User) -> tuple[bool, Optional[str]]:
    if role_of(db, club.id, user.id):
        return False, "이미 가입한 클럽입니다."
    if not club.is_public:
        return False, "비공개 클럽입니다. 운영진의 초대가 필요합니다."
    db.add(ClubMember(club_id=club.id, user_id=user.id, role="member"))
    db.commit()
    return True, None


def leave(db: Session, club: Club, user: User) -> tuple[bool, Optional[str]]:
    row = db.query(ClubMember).filter(
        ClubMember.club_id == club.id, ClubMember.user_id == user.id
    ).first()
    if not row:
        return False, "가입하지 않은 클럽입니다."
    if row.role == "owner":
        return False, "개설자는 탈퇴할 수 없습니다. 클럽을 삭제하거나 소유권을 넘기세요."
    db.delete(row)
    db.commit()
    return True, None


def set_role(db: Session, club: Club, actor_role: str, target_id: int,
             role: str) -> tuple[bool, Optional[str]]:
    if actor_role != "owner":
        return False, "개설자만 역할을 변경할 수 있습니다."
    if role not in ("admin", "member"):
        return False, "잘못된 역할입니다."
    row = db.query(ClubMember).filter(
        ClubMember.club_id == club.id, ClubMember.user_id == target_id
    ).first()
    if not row:
        return False, "구성원이 아닙니다."
    if row.role == "owner":
        return False, "개설자의 역할은 바꿀 수 없습니다."
    row.role = role
    db.commit()
    return True, None


def kick(db: Session, club: Club, actor_role: str, target_id: int) -> tuple[bool, Optional[str]]:
    if not can_moderate(actor_role):
        return False, "권한이 없습니다."
    row = db.query(ClubMember).filter(
        ClubMember.club_id == club.id, ClubMember.user_id == target_id
    ).first()
    if not row:
        return False, "구성원이 아닙니다."
    if row.role == "owner":
        return False, "개설자는 추방할 수 없습니다."
    if row.role == "admin" and actor_role != "owner":
        return False, "관리자는 개설자만 추방할 수 있습니다."
    db.delete(row)
    db.commit()
    return True, None


def delete_club(db: Session, club: Club) -> None:
    db.query(ClubMessage).filter(ClubMessage.club_id == club.id).delete()
    db.query(ClubPost).filter(ClubPost.club_id == club.id).delete()
    db.query(ClubMember).filter(ClubMember.club_id == club.id).delete()
    db.delete(club)
    db.commit()


# ---------------------------------------------------------------------------
# 공지물 / 게시글 (클럽 보드)
# ---------------------------------------------------------------------------
def _valid_fen(fen: str) -> str:
    fen = (fen or "").strip()
    if not fen:
        return ""
    try:
        chess.Board(fen)
        return fen[:100]
    except Exception:
        return ""


def _valid_pgn(pgn: str) -> str:
    """PGN 을 SAN 수순으로 정규화. 잘못됐으면 빈 문자열."""
    pgn = (pgn or "").strip()
    if not pgn:
        return ""
    tokens = [t for t in pgn.replace("\n", " ").split()
              if t and not t[0].isdigit() and t not in ("1-0", "0-1", "1/2-1/2", "*")]
    if not tokens:
        return ""
    board = chess.Board()
    good: list[str] = []
    for san in tokens[:120]:
        try:
            board.push_san(san)
            good.append(san)
        except Exception:
            break
    return " ".join(good)


def create_post(db: Session, club: Club, user: User, title: str, body: str,
                fen: str = "", pgn: str = "", pinned: bool = False,
                role: str = "member") -> tuple[Optional[ClubPost], Optional[str]]:
    title = sanitize_text(title, 120)
    if len(title) < 2:
        return None, "제목을 입력해주세요."
    post = ClubPost(
        club_id=club.id,
        user_id=user.id,
        author_name=user.username[:40],
        title=title,
        body=sanitize_text(body, 3000, allow_newlines=True),
        fen=_valid_fen(fen),
        pgn=_valid_pgn(pgn),
        pinned=1 if (pinned and can_moderate(role)) else 0,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post, None


def posts(db: Session, club: Club) -> list[dict]:
    rows = db.query(ClubPost).filter(ClubPost.club_id == club.id).order_by(
        ClubPost.pinned.desc(), ClubPost.id.desc()
    ).limit(MAX_POSTS).all()
    return [p.to_dict() for p in rows]


def delete_post(db: Session, club: Club, post_id: int, user: User,
                role: str) -> tuple[bool, Optional[str]]:
    p = db.query(ClubPost).filter(
        ClubPost.id == post_id, ClubPost.club_id == club.id
    ).first()
    if not p:
        return False, "게시글을 찾을 수 없습니다."
    if p.user_id != user.id and not can_moderate(role):
        return False, "권한이 없습니다."
    db.delete(p)
    db.commit()
    return True, None


def pin_post(db: Session, club: Club, post_id: int, pinned: bool,
             role: str) -> tuple[bool, Optional[str]]:
    if not can_moderate(role):
        return False, "운영진만 고정할 수 있습니다."
    p = db.query(ClubPost).filter(
        ClubPost.id == post_id, ClubPost.club_id == club.id
    ).first()
    if not p:
        return False, "게시글을 찾을 수 없습니다."
    p.pinned = 1 if pinned else 0
    db.commit()
    return True, None


# ---------------------------------------------------------------------------
# 채팅
# ---------------------------------------------------------------------------
def messages(db: Session, club: Club, after_id: int = 0) -> list[dict]:
    q = db.query(ClubMessage).filter(ClubMessage.club_id == club.id)
    if after_id:
        q = q.filter(ClubMessage.id > after_id)
        rows = q.order_by(ClubMessage.id.asc()).limit(MAX_MESSAGES).all()
    else:
        rows = q.order_by(ClubMessage.id.desc()).limit(60).all()
        rows = list(reversed(rows))
    return [m.to_dict() for m in rows]


def send_message(db: Session, club: Club, user: User,
                 text: str) -> tuple[Optional[ClubMessage], Optional[str]]:
    text = sanitize_text(text, 600, allow_newlines=False)
    if not text:
        return None, "빈 메시지입니다."
    m = ClubMessage(club_id=club.id, user_id=user.id,
                    author_name=user.username[:40], text=text)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m, None


def delete_message(db: Session, club: Club, msg_id: int, user: User,
                   role: str) -> tuple[bool, Optional[str]]:
    m = db.query(ClubMessage).filter(
        ClubMessage.id == msg_id, ClubMessage.club_id == club.id
    ).first()
    if not m:
        return False, "메시지를 찾을 수 없습니다."
    if m.user_id != user.id and not can_moderate(role):
        return False, "권한이 없습니다."
    db.delete(m)
    db.commit()
    return True, None


def stats(db: Session, user: User) -> dict:
    joined = db.query(ClubMember).filter(ClubMember.user_id == user.id).count()
    owned = db.query(Club).filter(Club.owner_id == user.id).count()
    return {"joined": joined, "owned": owned}
