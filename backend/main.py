import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import auth, bots, engine, puzzles
from .config import settings
from .database import get_db, init_db
from .models import User
from .realtime import server
from .schemas import BotMoveRequest, LoginRequest, PuzzleSolvedRequest


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: 테이블 생성 + 퍼즐 로드
    init_db()
    puzzles.load_puzzles()
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
    return {"status": "ok", "app": settings.APP_NAME, "puzzles": puzzles.count()}


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
@app.post("/api/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user, err = auth.login_or_register(db, req.username, req.password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    token = auth.issue_token(user)
    return {"token": token, "user": user.public_dict()}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"user": user.public_dict()}


# ---------- 봇 ----------
@app.get("/api/bots")
def get_bots():
    return {"bots": bots.list_bots()}


@app.post("/api/bot/move")
def bot_move(req: BotMoveRequest):
    """클라이언트 WASM 엔진 폴백용 백엔드 봇 수."""
    try:
        uci = engine.best_move(req.fen, req.level)
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
@app.get("/api/puzzles/random")
def puzzle_random(min: int = Query(default=0), max: int = Query(default=4000)):
    p = puzzles.random_puzzle(min, max)
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
def puzzle_solved(req: PuzzleSolvedRequest):
    # 데모: 기록만 응답. 운영 시 사용자 퍼즐 레이팅을 별도 관리 가능.
    return {"ok": True, "puzzle_id": req.puzzle_id, "success": req.success}


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
