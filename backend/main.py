import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import auth, bots, engine, friends, puzzles, streak
from .config import settings
from .database import get_db, init_db
from .models import DirectMessage, Friendship, Game, User
from .realtime import server
from .schemas import (BotMoveRequest, DMBody, FriendRequestBody, FriendRespondBody,
                      LoginRequest, PuzzleSolvedRequest)


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
    return user


# ---------- 인증 라우트 ----------
@app.post("/api/register")
def register(req: LoginRequest, db: Session = Depends(get_db)):
    if not req.password:
        raise HTTPException(status_code=400, detail="비밀번호를 입력해주세요.")
    user, err = auth.register(db, req.username, req.password)
    if err:
        raise HTTPException(status_code=400, detail=err)
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
