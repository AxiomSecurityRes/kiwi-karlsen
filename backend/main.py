import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import auth, bots, engine, friends, puzzles, streak
from datetime import datetime, timedelta

from .config import settings
from .database import get_db, init_db
from .models import DirectMessage, Friendship, Game, User
from .realtime import server
from .schemas import (AdminUserUpdate, BotMoveRequest, DMBody, FriendRequestBody,
                      FriendRespondBody, LoginRequest, ProfileUpdate,
                      PuzzleSolvedRequest, UsernameChange)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: 테이블 생성 + 퍼즐 로드 + 이벤트 루프 캡처
    import asyncio
    init_db()
    puzzles.load_puzzles()
    server.set_loop(asyncio.get_running_loop())
    yield
    # 종료 시: 정리할 작업 없음


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


# ---------- 헬스체크 (UptimeRobot 용) ----------
@app.get("/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.VERSION, "puzzles": puzzles.count()}


@app.get("/ping")
def ping():
    return JSONResponse({"pong": True})


# ---------- 인증 의존성 ----------
def current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    token = ""
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    user_id = auth.get_user_id_by_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")
    if user.banned:
        raise HTTPException(status_code=403, detail="정지된 계정입니다.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="관리자만 접근할 수 있습니다.")
    return user


# ---------- 인증 라우트 ----------
@app.post("/api/register")
def register(req: LoginRequest, db: Session = Depends(get_db)):
    if not req.password:
        raise HTTPException(status_code=400, detail="비밀번호를 입력해주세요.")
    user, err = auth.register(db, req.username, req.password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    # 첫 사용자 또는 지정된 관리자 이름이면 관리자 권한 부여
    total_users = db.query(User).count()
    if total_users == 1 or user.username.lower() == settings.ADMIN_USERNAME.lower():
        user.is_admin = 1
    streak.update_streak(user)
    db.commit()
    token = auth.issue_token(user)
    return {"token": token, "user": user.public_dict()}


@app.post("/api/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    if not req.password:
        raise HTTPException(status_code=400, detail="비밀번호를 입력해주세요.")
    user, err = auth.login(db, req.username, req.password)
    if err:
        raise HTTPException(status_code=401, detail=err)
    if user.banned:
        raise HTTPException(status_code=403, detail="정지된 계정입니다.")
    # 지정된 관리자 이름이면 로그인 시에도 관리자 보장
    if user.username.lower() == settings.ADMIN_USERNAME.lower() and not user.is_admin:
        user.is_admin = 1
    streak.update_streak(user)
    db.commit()
    token = auth.issue_token(user)
    return {"token": token, "user": user.public_dict()}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"user": user.public_dict()}


@app.post("/api/streak/ping")
def streak_ping(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """앱 접속 시 호출 — 오늘 활동으로 스트릭 갱신."""
    result = streak.update_streak(user)
    db.commit()
    return {"streak": result}



# ---------- 봇 ----------
@app.get("/api/bots")
def get_bots():
    return {"bots": bots.list_bots()}


@app.post("/api/bot/move")
def bot_move(req: BotMoveRequest):
    """클라이언트 WASM 엔진 폴백용 백엔드 봇 수."""
    try:
        uci = engine.best_move(req.fen, req.level, req.elo)
        return {"uci": uci}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 온라인 플레이어 (WebSocket 목록의 REST 폴백) ----------
@app.get("/api/online")
def online_players():
    return {"players": server.online_list()}


# ---------- 리더보드 ----------
@app.get("/api/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.rating.desc()).limit(50).all()
    return {"leaderboard": [u.public_dict() for u in rows]}


# ---------- 퍼즐 ----------
@app.get("/api/puzzles/themes")
def puzzle_themes():
    return {"themes": puzzles.themes(), "total": puzzles.count()}


@app.get("/api/puzzles/random")
def puzzle_random(min: int = Query(default=0), max: int = Query(default=4000),
                  theme: str = Query(default="")):
    p = puzzles.random_puzzle(min, max, theme)
    if not p:
        raise HTTPException(status_code=404, detail="퍼즐이 없습니다.")
    return p


@app.get("/api/puzzles/{puzzle_id}")
def puzzle_by_id(puzzle_id: str):
    p = puzzles.get_puzzle(puzzle_id)
    if not p:
        raise HTTPException(status_code=404, detail="퍼즐을 찾을 수 없습니다.")
    return p


@app.post("/api/puzzles/solved")
def puzzle_solved(req: PuzzleSolvedRequest, authorization: str = Header(default=""),
                  db: Session = Depends(get_db)):
    # 로그인 사용자가 퍼즐을 풀면 스트릭 갱신
    streak_info = None
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    uid = auth.get_user_id_by_token(token) if token else None
    if uid and req.success:
        user = db.query(User).filter(User.id == uid).first()
        if user:
            streak_info = streak.update_streak(user)
            db.commit()
    return {"ok": True, "puzzle_id": req.puzzle_id, "success": req.success, "streak": streak_info}


# ---------- 친구 ----------
@app.get("/api/users/search")
def users_search(q: str = Query(default=""), user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"users": []}
    rows = db.query(User).filter(User.username.ilike(f"%{q}%"), User.id != user.id).limit(10).all()
    return {"users": [{"id": u.id, "username": u.username, "rating": round(u.rating)} for u in rows]}


@app.post("/api/friends/request")
def friend_request(req: FriendRequestBody, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    fr, err = friends.send_request(db, user.id, req.username)
    if err:
        raise HTTPException(status_code=400, detail=err)
    # 상대가 온라인이면 실시간 알림
    target_id = fr.addressee_id if fr.requester_id == user.id else fr.requester_id
    server.notify(target_id, {"type": "friend_event", "event": "request", "fromName": user.username})
    return {"ok": True, "status": fr.status}


@app.post("/api/friends/respond")
def friend_respond(req: FriendRespondBody, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    ok, err = friends.respond_request(db, user.id, req.request_id, req.accept)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@app.get("/api/friends")
def friends_list(user: User = Depends(current_user), db: Session = Depends(get_db)):
    fl = friends.list_friends(db, user.id)
    online_ids = set(server.online.keys())
    return {"friends": [
        {"id": u.id, "username": u.username, "rating": round(u.rating),
         "online": u.id in online_ids, "inGame": bool(server.online.get(u.id) and server.online[u.id].game_id)}
        for u in fl
    ]}


@app.get("/api/friends/requests")
def friends_requests(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"requests": friends.list_incoming_requests(db, user.id)}


@app.get("/api/friends/dm/{friend_id}")
def friends_dm_history(friend_id: int, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    if not friends.are_friends(db, user.id, friend_id):
        raise HTTPException(status_code=403, detail="친구만 메시지를 볼 수 있습니다.")
    return {"messages": friends.dm_history(db, user.id, friend_id)}


@app.post("/api/friends/dm")
def friends_dm_send(req: DMBody, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    if not friends.are_friends(db, user.id, req.to_id):
        raise HTTPException(status_code=403, detail="친구에게만 메시지를 보낼 수 있습니다.")
    dm = friends.save_dm(db, user.id, req.to_id, req.text)
    if not dm:
        raise HTTPException(status_code=400, detail="빈 메시지입니다.")
    payload = {"type": "dm", "fromId": user.id, "fromName": user.username,
               "toId": req.to_id, "text": dm.text, "ts": dm.to_dict()["ts"]}
    server.notify(req.to_id, payload)  # 상대가 온라인이면 실시간 전달
    return {"ok": True, "message": dm.to_dict()}


# ---------- 게임 기록 / 리뷰 ----------
@app.get("/api/games/recent")
def games_recent(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Game).filter(
        (Game.white_id == user.id) | (Game.black_id == user.id)
    ).order_by(Game.id.desc()).limit(30).all()
    return {"games": [g.summary_dict() for g in rows]}


@app.get("/api/games/{game_id}")
def game_detail(game_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g = db.query(Game).filter(Game.id == game_id).first()
    if not g or (g.white_id != user.id and g.black_id != user.id):
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    d = g.summary_dict()
    d["pgn"] = g.pgn
    return d


# ---------- 프로필 ----------
@app.get("/api/profile/me")
def profile_me(user: User = Depends(current_user)):
    return {"profile": user.public_dict(), "canChangeName": _can_change_username(user)}


def _can_change_username(user: User) -> bool:
    if not user.username_changed_at:
        return True
    return datetime.utcnow() - user.username_changed_at >= timedelta(days=90)


@app.post("/api/profile")
def profile_update(req: ProfileUpdate, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    if req.first_name is not None: user.first_name = req.first_name.strip()[:40]
    if req.last_name is not None: user.last_name = req.last_name.strip()[:40]
    if req.location is not None: user.location = req.location.strip()[:80]
    if req.country is not None: user.country = req.country.strip()[:40]
    if req.bio is not None: user.bio = req.bio.strip()[:1000]
    if req.otb_rating is not None: user.otb_rating = int(req.otb_rating)
    db.commit()
    return {"ok": True, "profile": user.public_dict()}


@app.post("/api/profile/username")
def profile_username(req: UsernameChange, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    new = req.new_username.strip()
    if not _can_change_username(user):
        nextd = (user.username_changed_at + timedelta(days=90)).date().isoformat()
        raise HTTPException(status_code=400, detail=f"사용자명은 90일마다 변경 가능합니다. ({nextd} 이후)")
    if db.query(User).filter(User.username.ilike(new), User.id != user.id).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 사용자명입니다.")
    user.username = new
    user.username_changed_at = datetime.utcnow()
    db.commit()
    # 사용자명이 바뀌면 토큰 재발급
    return {"ok": True, "token": auth.issue_token(user), "profile": user.public_dict()}


@app.get("/api/profile/{username}")
def profile_view(username: str, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.username.ilike(username)).first()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    games = db.query(Game).filter(
        (Game.white_id == u.id) | (Game.black_id == u.id)
    ).order_by(Game.id.desc()).limit(10).all()
    return {"profile": u.public_dict(), "recentGames": [g.summary_dict() for g in games]}


# ---------- 관리자 ----------
@app.get("/api/admin/stats")
def admin_stats(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    from .models import DirectMessage, Friendship
    return {
        "users": db.query(User).count(),
        "admins": db.query(User).filter(User.is_admin == 1).count(),
        "banned": db.query(User).filter(User.banned == 1).count(),
        "games": db.query(Game).count(),
        "friendships": db.query(Friendship).filter(Friendship.status == "accepted").count(),
        "messages": db.query(DirectMessage).count(),
        "puzzles": puzzles.count(),
        "online": len(server.online),
        "version": settings.VERSION,
    }


@app.get("/api/admin/users")
def admin_users(q: str = Query(default=""), admin: User = Depends(admin_user),
                db: Session = Depends(get_db)):
    query = db.query(User)
    if q.strip():
        query = query.filter(User.username.ilike(f"%{q.strip()}%"))
    rows = query.order_by(User.id.desc()).limit(200).all()
    return {"users": [{
        "id": u.id, "username": u.username, "rating": round(u.rating),
        "games": u.wins + u.losses + u.draws, "isAdmin": bool(u.is_admin),
        "banned": bool(u.banned), "createdAt": u.created_at.isoformat() if u.created_at else "",
    } for u in rows]}


@app.post("/api/admin/user/{user_id}")
def admin_update_user(user_id: int, req: AdminUserUpdate,
                      admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if req.rating is not None:
        u.rating = float(req.rating)
    if req.is_admin is not None:
        if u.id == admin.id and not req.is_admin:
            raise HTTPException(status_code=400, detail="자신의 관리자 권한은 해제할 수 없습니다.")
        u.is_admin = 1 if req.is_admin else 0
    if req.banned is not None:
        if u.id == admin.id and req.banned:
            raise HTTPException(status_code=400, detail="자신을 정지할 수 없습니다.")
        u.banned = 1 if req.banned else 0
    db.commit()
    return {"ok": True}


@app.delete("/api/admin/user/{user_id}")
def admin_delete_user(user_id: int, admin: User = Depends(admin_user),
                      db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    if u.id == admin.id:
        raise HTTPException(status_code=400, detail="자신은 삭제할 수 없습니다.")
    db.delete(u)
    db.commit()
    return {"ok": True}


@app.post("/api/admin/reload_puzzles")
def admin_reload_puzzles(admin: User = Depends(admin_user)):
    puzzles.load_puzzles()
    return {"ok": True, "puzzles": puzzles.count()}


# ---------- WebSocket ----------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(default="")):
    from .database import SessionLocal
    user_id = auth.get_user_id_by_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
    finally:
        db.close()
    if not user:
        await websocket.close(code=4401)
        return

    await server.connect(websocket, user)
    try:
        while True:
            data = await websocket.receive_json()
            await server.handle(user.id, data)
    except WebSocketDisconnect:
        await server.disconnect(user.id)
    except Exception:
        await server.disconnect(user.id)


# ---------- 정적 프런트엔드 서빙 (반드시 라우트 등록 이후) ----------
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
