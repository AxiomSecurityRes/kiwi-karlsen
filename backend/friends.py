"""친구 관계 + 다이렉트 메시지(DM) 도우미."""
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .models import DirectMessage, Friendship, User


def _pair_query(db: Session, a_id: int, b_id: int):
    return db.query(Friendship).filter(
        or_(
            (Friendship.requester_id == a_id) & (Friendship.addressee_id == b_id),
            (Friendship.requester_id == b_id) & (Friendship.addressee_id == a_id),
        )
    )


def relationship(db: Session, a_id: int, b_id: int) -> Optional[Friendship]:
    return _pair_query(db, a_id, b_id).first()


def are_friends(db: Session, a_id: int, b_id: int) -> bool:
    rel = relationship(db, a_id, b_id)
    return bool(rel and rel.status == "accepted")


def send_request(db: Session, requester_id: int, username: str) -> tuple[Optional[Friendship], Optional[str]]:
    target = db.query(User).filter(User.username.ilike(username.strip())).first()
    if not target:
        return None, "해당 사용자를 찾을 수 없습니다."
    if target.id == requester_id:
        return None, "자기 자신에게는 요청할 수 없습니다."
    existing = relationship(db, requester_id, target.id)
    if existing:
        if existing.status == "accepted":
            return None, "이미 친구입니다."
        # 상대가 이미 나에게 요청한 상태면 수락 처리
        if existing.addressee_id == requester_id:
            existing.status = "accepted"
            db.commit()
            return existing, None
        return None, "이미 친구 요청을 보냈습니다."
    fr = Friendship(requester_id=requester_id, addressee_id=target.id, status="pending")
    db.add(fr)
    db.commit()
    db.refresh(fr)
    return fr, None


def respond_request(db: Session, user_id: int, request_id: int, accept: bool) -> tuple[bool, Optional[str]]:
    fr = db.query(Friendship).filter(Friendship.id == request_id).first()
    if not fr or fr.addressee_id != user_id or fr.status != "pending":
        return False, "유효하지 않은 요청입니다."
    if accept:
        fr.status = "accepted"
    else:
        db.delete(fr)
    db.commit()
    return True, None


def list_friends(db: Session, user_id: int) -> list[User]:
    rows = db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
    ).all()
    friend_ids = [r.addressee_id if r.requester_id == user_id else r.requester_id for r in rows]
    if not friend_ids:
        return []
    return db.query(User).filter(User.id.in_(friend_ids)).all()


def list_incoming_requests(db: Session, user_id: int) -> list[dict]:
    rows = db.query(Friendship).filter(
        Friendship.status == "pending", Friendship.addressee_id == user_id
    ).all()
    out = []
    for r in rows:
        u = db.query(User).filter(User.id == r.requester_id).first()
        if u:
            out.append({"requestId": r.id, "fromId": u.id, "fromName": u.username, "rating": round(u.rating)})
    return out


def save_dm(db: Session, sender_id: int, recipient_id: int, text: str) -> Optional[DirectMessage]:
    from .security import sanitize_text
    text = sanitize_text(text, 1000, allow_newlines=True)
    if not text:
        return None
    dm = DirectMessage(sender_id=sender_id, recipient_id=recipient_id, text=text)
    db.add(dm)
    db.commit()
    db.refresh(dm)
    return dm


def dm_history(db: Session, a_id: int, b_id: int, limit: int = 100) -> list[dict]:
    rows = db.query(DirectMessage).filter(
        or_(
            (DirectMessage.sender_id == a_id) & (DirectMessage.recipient_id == b_id),
            (DirectMessage.sender_id == b_id) & (DirectMessage.recipient_id == a_id),
        )
    ).order_by(DirectMessage.created_at.asc()).limit(limit).all()
    return [m.to_dict() for m in rows]
