import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import (achievements, auth, bots, engine, friends, openings, puzzles,
               security, sitesettings, streak, training)
from datetime import datetime, timedelta

from .config import settings
from .database import SessionLocal, get_db, init_db
from .models import (AdminAction, DirectMessage, Friendship, Game, Notification,
                     PuzzleAttempt, RushSession, SecurityEvent, SiteSetting, User)
from .realtime import server
from .schemas import (AdminFriendAdd, AdminPasswordReset, AdminStatsUpdate,
                      AdminStreakUpdate, AdminUserUpdate, AnnounceBody, BotMoveRequest,
                      DailySolveBody, DMBody, FriendRequestBody, FriendRespondBody,
                      LoginRequest, ProfileUpdate, PuzzleSolvedRequest, RushResultBody,
                      SettingUpdate, UsernameChange)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: 테이블 생성 + 퍼즐 로드 + 이벤트 루프 캡처
    import asyncio
    init_db()
    puzzles.load_puzzles()
    server.set_loop(asyncio.get_running_loop())
    # 사이트 설정 로드(런타임 변경 가능 값)
    _db = SessionLocal()
    try:
        sitesettings.load(_db)
    finally:
        _db.close()
    yield
    # 종료 시: 정리할 작업 없음


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

# CORS: 기본은 동일 출처만. 필요 시 ALLOWED_ORIGINS 로 지정(쉼표 구분).
_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or [],
    allow_origin_regex=None if _origins else r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


def _client_ip(request: Request) -> str:
    """프록시(Render) 뒤에서의 실제 클라이언트 IP."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def _log_security(kind: str, *, request: Request, user_id=None, username: str = "",
                  detail: str = "") -> None:
    """보안 이벤트 기록(비밀번호/토큰은 절대 저장하지 않음, IP는 해시)."""
    try:
        db = SessionLocal()
        try:
            db.add(SecurityEvent(
                kind=kind,
                user_id=user_id,
                username=(username or "")[:40],
                ip_hash=security.hash_ip(_client_ip(request)),
                path=str(request.url.path)[:120],
                detail=(detail or "")[:500],
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    method = request.method

    # 인메모리 저장소 주기적 정리(무한 증가 방지). 내부에서 5분 간격으로만 실제 실행.
    security.cleanup()

    # 정적 파일/헬스체크는 레이트 리밋 없이 통과(헤더는 부여)
    if path.startswith("/api/"):
        policy = security.policy_for_path(method, path)
        ip = _client_ip(request)
        ip_key = security.hash_ip(ip)

        # 인증된 사용자면 사용자 단위로도 카운트(공유 IP 환경 대응)
        uid = None
        authz = request.headers.get("authorization", "")
        if authz.lower().startswith("bearer "):
            uid = auth.get_user_id_by_token(authz[7:].strip())

        allowed, retry = security.rate_check(ip_key, policy)
        if allowed and uid:
            allowed, retry = security.rate_check(f"u{uid}", policy)

        if not allowed:
            _log_security("rate_limited", request=request, user_id=uid,
                          detail=f"policy={policy}")
            resp = JSONResponse(
                status_code=429,
                content={"detail": f"요청이 너무 많습니다. {retry}초 후 다시 시도해주세요."},
            )
            resp.headers["Retry-After"] = str(retry)
            for k, v in security.SECURITY_HEADERS.items():
                resp.headers[k] = v
            return resp

        # 점검 모드: 관리자와 인증/헬스 경로를 제외하고 차단
        if sitesettings.get("maintenance_mode", False):
            allow_paths = ("/api/login", "/api/me", "/api/site")
            is_admin_req = False
            if uid:
                _db = SessionLocal()
                try:
                    _u = _db.query(User).filter(User.id == uid).first()
                    is_admin_req = bool(_u and _u.is_admin)
                finally:
                    _db.close()
            if not is_admin_req and not path.startswith("/api/admin") and path not in allow_paths:
                resp = JSONResponse(
                    status_code=503,
                    content={"detail": "현재 점검 중입니다. 잠시 후 다시 이용해주세요."},
                )
                for k, v in security.SECURITY_HEADERS.items():
                    resp.headers[k] = v
                return resp

        # 봇/자동화 감지 (읽기 전용 통계, 차단은 임계값 초과 시에만)
        if uid:
            security.note_activity(uid)
            score = security.bot_score(uid)
            if score >= 0.9:
                total = security.add_suspicion(uid, 1.0)
                if total in (5.0, 20.0, 50.0):  # 로그 폭주 방지: 특정 지점에서만 기록
                    _log_security("bot_suspect", request=request, user_id=uid,
                                  detail=f"score={score:.2f} suspicion={total:.0f}")

    response = await call_next(request)
    for k, v in security.SECURITY_HEADERS.items():
        response.headers[k] = v

    # ---- 캐시 제어 ----
    # 앱 코드(HTML/JS/CSS)는 재배포 즉시 반영돼야 한다.
    # 브라우저가 옛 api.js 를 쥐고 있으면 "API.xxx is not a function" 같은 오류가 난다.
    # 반면 엔진 WASM/폰트/이미지 같은 큰 정적 자원은 오래 캐시해도 안전하다.
    if not path.startswith("/api/"):
        lower = path.lower()
        if lower.endswith((".html", ".js", ".css")) or lower in ("/", ""):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        elif lower.startswith("/assets/engine/"):
            # 엔진(stockfish.wasm 등)은 크고 잘 바뀌지 않는다
            response.headers["Cache-Control"] = "public, max-age=604800"
        elif lower.endswith((".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".woff", ".woff2", ".mp3", ".ogg", ".wav")):
            response.headers["Cache-Control"] = "public, max-age=86400"
    else:
        # API 응답은 캐시하지 않는다
        response.headers["Cache-Control"] = "no-store"

    return response

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
def register(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    if not req.password:
        raise HTTPException(status_code=400, detail="비밀번호를 입력해주세요.")
    if not sitesettings.get("registration_open", True):
        raise HTTPException(status_code=403, detail="현재 신규 회원가입이 중지되었습니다.")
    if security.is_weak_password(req.password):
        raise HTTPException(status_code=400, detail="너무 흔한 비밀번호입니다. 다른 비밀번호를 사용해주세요.")
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
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    if not req.password:
        raise HTTPException(status_code=400, detail="비밀번호를 입력해주세요.")
    ip_hash = security.hash_ip(_client_ip(request))

    # 무차별 대입 방어: 잠금 중이면 즉시 거부
    locked = security.login_locked(ip_hash, req.username)
    if locked:
        _log_security("login_locked", request=request, username=req.username,
                      detail=f"remain={locked}s")
        raise HTTPException(status_code=429,
                            detail=f"로그인 시도가 너무 많습니다. {locked}초 후 다시 시도해주세요.")

    user, err = auth.login(db, req.username, req.password)
    if err:
        lock_for = security.record_login_failure(ip_hash, req.username)
        _log_security("login_failed", request=request, username=req.username,
                      detail=f"lock={lock_for}s" if lock_for else "")
        raise HTTPException(status_code=401, detail=err)
    if user.banned:
        _log_security("banned_login", request=request, user_id=user.id, username=user.username)
        raise HTTPException(status_code=403, detail="정지된 계정입니다.")
    security.clear_login_failures(ip_hash, req.username)
    achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
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




@app.post("/api/puzzles/solved")
def puzzle_solved(req: PuzzleSolvedRequest, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    """퍼즐 결과 처리.

    - rated=False 면 레이팅/통계에 반영하지 않는다(연습 모드).
    - 같은 퍼즐은 하루에 한 번만 채점된다(실패 후 재시도 성공으로 중복 집계되는 것 방지).
    """
    p = puzzles.get_puzzle(req.puzzle_id)
    p_rating = p["rating"] if p else 1200

    if not req.rated:
        return {
            "ok": True, "rated": False, "puzzle_id": req.puzzle_id, "success": req.success,
            "puzzleRatingBefore": round(user.puzzle_rating),
            "puzzleRatingAfter": round(user.puzzle_rating),
            "puzzleRatingChange": 0,
            "counted": False,
            "streak": None, "newAchievements": [],
        }

    # 이미 채점한 퍼즐이면 다시 반영하지 않는다
    already = db.query(PuzzleAttempt).filter(
        PuzzleAttempt.user_id == user.id,
        PuzzleAttempt.puzzle_id == req.puzzle_id,
    ).first()
    if already:
        return {
            "ok": True, "rated": True, "puzzle_id": req.puzzle_id, "success": req.success,
            "puzzleRatingBefore": round(user.puzzle_rating),
            "puzzleRatingAfter": round(user.puzzle_rating),
            "puzzleRatingChange": 0,
            "counted": False,
            "alreadyAttempted": True,
            "firstResult": bool(already.success),
            "streak": None, "newAchievements": [],
        }

    before, after = training.update_puzzle_rating(user, p_rating, req.success)
    db.add(PuzzleAttempt(user_id=user.id, puzzle_id=req.puzzle_id,
                         success=1 if req.success else 0,
                         rating_change=after - before))
    streak_info = streak.update_streak(user) if req.success else None
    db.commit()
    new_ach = achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
    return {
        "ok": True,
        "rated": True,
        "counted": True,
        "puzzle_id": req.puzzle_id,
        "success": req.success,
        "puzzleRatingBefore": before,
        "puzzleRatingAfter": after,
        "puzzleRatingChange": after - before,
        "streak": streak_info,
        "newAchievements": new_ach,
    }


# ---------- 친구 ----------
@app.get("/api/users/search")
def users_search(q: str = Query(default=""), user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"users": []}
    safe_q = security.escape_like(q)
    rows = db.query(User).filter(
        User.username.ilike(f"%{safe_q}%", escape="\\"), User.id != user.id
    ).limit(10).all()
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
    achievements.notify(db, target_id, "friend",
                        f"👥 {user.username} 님이 친구 요청을 보냈습니다.", "/index.html")
    return {"ok": True, "status": fr.status}


@app.post("/api/friends/respond")
def friend_respond(req: FriendRespondBody, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    ok, err = friends.respond_request(db, user.id, req.request_id, req.accept)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if req.accept:
        achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
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
    if not sitesettings.get("dm_enabled", True):
        raise HTTPException(status_code=403, detail="현재 DM 기능이 비활성화되어 있습니다.")
    if not friends.are_friends(db, user.id, req.to_id):
        raise HTTPException(status_code=403, detail="친구에게만 메시지를 보낼 수 있습니다.")
    dm = friends.save_dm(db, user.id, req.to_id, req.text)
    if not dm:
        raise HTTPException(status_code=400, detail="빈 메시지입니다.")
    payload = {"type": "dm", "fromId": user.id, "fromName": user.username,
               "toId": req.to_id, "text": dm.text, "ts": dm.to_dict()["ts"]}
    server.notify(req.to_id, payload)  # 상대가 온라인이면 실시간 전달
    achievements.notify(db, req.to_id, "dm",
                        f"💬 {user.username}: {dm.text[:60]}", "/index.html")
    return {"ok": True, "message": dm.to_dict()}


# ==========================================================================
#  Step 4 — 일일 퍼즐 · 퍼즐 러시 · 오프닝 · 업적 · 알림 · 아카이브
# ==========================================================================

# ---------- 일일 퍼즐 ----------
@app.get("/api/puzzles/daily")
def puzzle_daily(db: Session = Depends(get_db)):
    p = training.get_daily(db)
    if not p:
        raise HTTPException(status_code=404, detail="퍼즐 데이터가 없습니다. 관리자에게 문의하세요.")
    return {"puzzle": p, "day": training.today_str()}


@app.get("/api/puzzles/daily/status")
def puzzle_daily_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return training.daily_status(db, user)


@app.post("/api/puzzles/daily/solved")
def puzzle_daily_solved(req: DailySolveBody, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    first = training.record_daily(db, user, req.success, req.seconds)
    if first and req.success:
        streak.update_streak(user)
        db.commit()
    new_ach = achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
    return {"ok": True, "firstAttempt": first, "newAchievements": new_ach,
            **training.daily_status(db, user)}


# ---------- 퍼즐 러시 ----------
@app.get("/api/rush/modes")
def rush_modes():
    return {"modes": [{"id": k, **v} for k, v in training.RUSH_MODES.items()]}


@app.get("/api/rush/puzzles")
def rush_puzzle_set(count: int = Query(default=60, ge=5, le=150)):
    ps = training.rush_puzzles(count)
    if not ps:
        raise HTTPException(status_code=404, detail="퍼즐 데이터가 없습니다.")
    return {"puzzles": ps}


@app.post("/api/rush/result")
def rush_result(req: RushResultBody, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    res = training.record_rush(db, user, req.mode, req.score, req.misses)
    streak.update_streak(user)
    db.commit()
    new_ach = achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
    return {"ok": True, **res, "newAchievements": new_ach}


@app.get("/api/rush/leaderboard")
def rush_leaderboard(mode: str = Query(default="3m"), db: Session = Depends(get_db)):
    return {"mode": mode, "leaderboard": training.rush_leaderboard(db, mode)}


@app.get("/api/rush/history")
def rush_history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(RushSession).filter(
        RushSession.user_id == user.id
    ).order_by(RushSession.id.desc()).limit(20).all()
    return {"sessions": [r.to_dict() for r in rows]}


@app.get("/api/puzzles/leaderboard")
def puzzle_leaderboard(db: Session = Depends(get_db)):
    return {"leaderboard": training.puzzle_leaderboard(db)}


# ---------- 오프닝 탐색기 ----------
@app.get("/api/openings")
def openings_explore(moves: str = Query(default="")):
    """moves: 쉼표 구분 SAN 수순 (예: e4,e5,Nf3)"""
    seq = [m.strip() for m in moves.split(",") if m.strip()] if moves else []
    current = openings.lookup(seq)
    return {
        "moves": seq,
        "opening": current,
        "continuations": openings.continuations(seq),
        "total": openings.count(),
        "positions": openings.position_count(),
    }


@app.get("/api/openings/search")
def openings_search(q: str = Query(default="")):
    return {"results": openings.search(q)}


@app.post("/api/openings/book")
def openings_book(body: dict):
    """게임 리뷰용 — 각 수가 '이론(정석)'인지 판정.

    body: {"moves": ["e4","e5","Nf3", ...]}  (SAN)
    반환: {"book": [true, true, false, ...]}  수마다 이론 여부
    """
    moves = body.get("moves") or []
    if not isinstance(moves, list) or len(moves) > 300:
        raise HTTPException(status_code=400, detail="잘못된 수순입니다.")
    moves = [str(m)[:8] for m in moves]
    return {"book": openings.book_flags(moves), "positions": openings.position_count()}


# ---------- 업적 ----------
@app.get("/api/achievements")
def achievements_list(user: User = Depends(current_user), db: Session = Depends(get_db)):
    new_ach = achievements.evaluate(db, user, {"friends": len(friends.list_friends(db, user.id))})
    return {"achievements": achievements.list_for_user(db, user), "new": new_ach}


@app.get("/api/achievements/{username}")
def achievements_of(username: str, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.username.ilike(username)).first()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"achievements": [a for a in achievements.list_for_user(db, u) if a["earned"]]}


# ---------- 알림 ----------
@app.get("/api/notifications")
def notifications_list(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Notification).filter(
        Notification.user_id == user.id
    ).order_by(Notification.id.desc()).limit(50).all()
    return {
        "notifications": [n.to_dict() for n in rows],
        "unread": achievements.unread_count(db, user.id),
    }


@app.post("/api/notifications/read")
def notifications_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read == 0
    ).update({"is_read": 1})
    db.commit()
    return {"ok": True, "unread": 0}


@app.delete("/api/notifications")
def notifications_clear(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id).delete()
    db.commit()
    return {"ok": True}


# ---------- 게임 아카이브 (PGN 내려받기) ----------
@app.get("/api/games/archive")
def games_archive(result: str = Query(default=""), opponent: str = Query(default=""),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Game).filter((Game.white_id == user.id) | (Game.black_id == user.id))
    if result.strip() in ("1-0", "0-1", "1/2-1/2"):
        q = q.filter(Game.result == result.strip())
    if opponent.strip():
        safe_q = security.escape_like(opponent.strip())
        q = q.filter(
            (Game.white_name.ilike(f"%{safe_q}%", escape="\\")) |
            (Game.black_name.ilike(f"%{safe_q}%", escape="\\"))
        )
    rows = q.order_by(Game.id.desc()).limit(100).all()
    out = []
    for g in rows:
        d = g.summary_dict()
        me_white = (g.white_id == user.id)
        if g.result == "1/2-1/2":
            d["outcome"] = "draw"
        elif (g.result == "1-0") == me_white:
            d["outcome"] = "win"
        else:
            d["outcome"] = "loss"
        d["opponent"] = g.black_name if me_white else g.white_name
        out.append(d)
    return {"games": out}


@app.get("/api/games/archive/pgn")
def games_archive_pgn(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """내 전체 기보를 하나의 PGN 파일로 내려받기."""
    rows = db.query(Game).filter(
        (Game.white_id == user.id) | (Game.black_id == user.id)
    ).order_by(Game.id.asc()).limit(500).all()
    chunks = []
    for g in rows:
        date_str = g.created_at.strftime("%Y.%m.%d") if g.created_at else "????.??.??"
        header = (
            f'[Event "Kiwi Karlsen Online"]\n'
            f'[Site "kiwi-karlsen"]\n'
            f'[Date "{date_str}"]\n'
            f'[White "{g.white_name}"]\n'
            f'[Black "{g.black_name}"]\n'
            f'[Result "{g.result}"]\n'
            f'[Termination "{g.reason}"]\n'
        )
        body = (g.pgn or "").strip()
        chunks.append(header + "\n" + body + f" {g.result}\n")
    text = "\n".join(chunks) if chunks else ""
    return Response(
        content=text,
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="{user.username}_games.pgn"'},
    )


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
    # 저장 시점 정화(제어문자/스크립트 패턴 제거). 출력 시점에도 프런트엔드가 이스케이프.
    if req.first_name is not None: user.first_name = security.sanitize_text(req.first_name, 40)
    if req.last_name is not None: user.last_name = security.sanitize_text(req.last_name, 40)
    if req.location is not None: user.location = security.sanitize_text(req.location, 80)
    if req.country is not None: user.country = security.sanitize_text(req.country, 40)
    if req.bio is not None: user.bio = security.sanitize_text(req.bio, 1000, allow_newlines=True)
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
        "memory": security.store_sizes(),
    }


@app.get("/api/admin/users")
def admin_users(q: str = Query(default=""), admin: User = Depends(admin_user),
                db: Session = Depends(get_db)):
    query = db.query(User)
    if q.strip():
        safe_q = security.escape_like(q.strip())
        query = query.filter(User.username.ilike(f"%{safe_q}%", escape="\\"))
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


@app.get("/api/admin/security")
def admin_security_log(kind: str = Query(default=""), admin: User = Depends(admin_user),
                       db: Session = Depends(get_db)):
    """보안 감사 로그(최근 200건). IP는 해시로만 저장되어 개인정보가 노출되지 않는다."""
    q = db.query(SecurityEvent)
    if kind.strip():
        q = q.filter(SecurityEvent.kind == kind.strip())
    rows = q.order_by(SecurityEvent.id.desc()).limit(200).all()
    return {"events": [e.to_dict() for e in rows]}


@app.get("/api/admin/suspicious")
def admin_suspicious(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    """봇 의심 사용자 목록(실시간 행동 분석 기반)."""
    out = []
    for uid, score in list(security._suspicion.items()):
        u = db.query(User).filter(User.id == uid).first()
        if not u:
            continue
        out.append({
            "id": u.id, "username": u.username,
            "suspicion": round(score, 1),
            "botScore": round(security.bot_score(uid), 2),
            "banned": bool(u.banned),
        })
    out.sort(key=lambda x: x["suspicion"], reverse=True)
    return {"suspicious": out[:50]}


@app.post("/api/admin/clear_suspicion/{user_id}")
def admin_clear_suspicion(user_id: int, admin: User = Depends(admin_user)):
    security.reset_suspicion(user_id)
    return {"ok": True}


# ==========================================================================
#  관리자 전권 (Step 2) — 스트릭/전적/친구/DM/게임/퍼즐/사이트 설정
#  모든 행위는 AdminAction 감사 로그에 기록된다.
# ==========================================================================

def _audit(db: Session, admin: User, action: str, *, target_type: str = "",
           target_id: str = "", target_name: str = "", detail: str = "") -> None:
    """관리자 행위 감사 로그 기록."""
    try:
        db.add(AdminAction(
            admin_id=admin.id,
            admin_name=admin.username[:40],
            action=action[:50],
            target_type=target_type[:20],
            target_id=str(target_id)[:40],
            target_name=(target_name or "")[:40],
            detail=(detail or "")[:500],
        ))
        db.commit()
    except Exception:
        db.rollback()


def _get_target(db: Session, user_id: int) -> User:
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return u


# ---------- 사용자 상세(모든 정보 한눈에) ----------
@app.get("/api/admin/user/{user_id}/full")
def admin_user_full(user_id: int, admin: User = Depends(admin_user),
                    db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    fl = friends.list_friends(db, u.id)
    pending = db.query(Friendship).filter(
        Friendship.status == "pending",
        (Friendship.requester_id == u.id) | (Friendship.addressee_id == u.id),
    ).count()
    games = db.query(Game).filter(
        (Game.white_id == u.id) | (Game.black_id == u.id)
    ).order_by(Game.id.desc()).limit(20).all()
    dm_count = db.query(DirectMessage).filter(
        (DirectMessage.sender_id == u.id) | (DirectMessage.recipient_id == u.id)
    ).count()
    events = db.query(SecurityEvent).filter(
        SecurityEvent.user_id == u.id
    ).order_by(SecurityEvent.id.desc()).limit(20).all()
    return {
        "user": {
            **u.public_dict(),
            "banned": bool(u.banned),
            "streakLast": u.streak_last,
            "rd": round(u.rd, 1),
            "usernameChangedAt": u.username_changed_at.isoformat() if u.username_changed_at else "",
        },
        "friends": [{"id": f.id, "username": f.username, "rating": round(f.rating)} for f in fl],
        "pendingRequests": pending,
        "games": [g.summary_dict() for g in games],
        "dmCount": dm_count,
        "botScore": round(security.bot_score(u.id), 2),
        "suspicion": round(security.get_suspicion(u.id), 1),
        "securityEvents": [e.to_dict() for e in events],
    }


# ---------- 스트릭 관리 ----------
@app.post("/api/admin/user/{user_id}/streak")
def admin_set_streak(user_id: int, req: AdminStreakUpdate,
                     admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    changed = []
    if req.current is not None:
        u.streak_current = int(req.current); changed.append(f"current={req.current}")
    if req.best is not None:
        u.streak_best = int(req.best); changed.append(f"best={req.best}")
    if req.last is not None:
        u.streak_last = security.sanitize_text(req.last, 10); changed.append(f"last={u.streak_last}")
    # 일관성: best 는 current 보다 작을 수 없다
    if u.streak_best < u.streak_current:
        u.streak_best = u.streak_current
    db.commit()
    _audit(db, admin, "set_streak", target_type="user", target_id=u.id,
           target_name=u.username, detail=", ".join(changed))
    return {"ok": True, "streakCurrent": u.streak_current, "streakBest": u.streak_best,
            "streakLast": u.streak_last}


# ---------- 전적 / 레이팅 관리 ----------
@app.post("/api/admin/user/{user_id}/stats")
def admin_set_stats(user_id: int, req: AdminStatsUpdate,
                    admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    changed = []
    if req.wins is not None: u.wins = int(req.wins); changed.append(f"wins={req.wins}")
    if req.losses is not None: u.losses = int(req.losses); changed.append(f"losses={req.losses}")
    if req.draws is not None: u.draws = int(req.draws); changed.append(f"draws={req.draws}")
    if req.rating is not None: u.rating = float(req.rating); changed.append(f"rating={req.rating}")
    if req.rd is not None: u.rd = float(req.rd); changed.append(f"rd={req.rd}")
    db.commit()
    _audit(db, admin, "set_stats", target_type="user", target_id=u.id,
           target_name=u.username, detail=", ".join(changed))
    return {"ok": True, "user": u.public_dict()}


# ---------- 비밀번호 재설정 ----------
@app.post("/api/admin/user/{user_id}/password")
def admin_reset_password(user_id: int, req: AdminPasswordReset,
                         admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    err = auth.validate_password(req.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if security.is_weak_password(req.new_password):
        raise HTTPException(status_code=400, detail="너무 흔한 비밀번호입니다.")
    u.password_hash = auth._hash_password(req.new_password)
    db.commit()
    # 비밀번호 원문은 절대 로그에 남기지 않는다
    _audit(db, admin, "reset_password", target_type="user", target_id=u.id,
           target_name=u.username, detail="비밀번호 재설정")
    return {"ok": True}


# ---------- 친구 관계 관리 ----------
@app.get("/api/admin/user/{user_id}/friends")
def admin_user_friends(user_id: int, admin: User = Depends(admin_user),
                       db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    rows = db.query(Friendship).filter(
        (Friendship.requester_id == u.id) | (Friendship.addressee_id == u.id)
    ).all()
    out = []
    for r in rows:
        other_id = r.addressee_id if r.requester_id == u.id else r.requester_id
        other = db.query(User).filter(User.id == other_id).first()
        out.append({
            "friendshipId": r.id,
            "otherId": other_id,
            "otherName": other.username if other else "(삭제됨)",
            "status": r.status,
            "direction": "sent" if r.requester_id == u.id else "received",
        })
    return {"friendships": out}


@app.delete("/api/admin/friendship/{friendship_id}")
def admin_delete_friendship(friendship_id: int, admin: User = Depends(admin_user),
                            db: Session = Depends(get_db)):
    fr = db.query(Friendship).filter(Friendship.id == friendship_id).first()
    if not fr:
        raise HTTPException(status_code=404, detail="친구 관계를 찾을 수 없습니다.")
    a = db.query(User).filter(User.id == fr.requester_id).first()
    b = db.query(User).filter(User.id == fr.addressee_id).first()
    names = f"{a.username if a else '?'} ↔ {b.username if b else '?'}"
    db.delete(fr)
    db.commit()
    _audit(db, admin, "delete_friendship", target_type="friendship",
           target_id=friendship_id, detail=names)
    return {"ok": True}


@app.post("/api/admin/friendship")
def admin_add_friendship(req: AdminFriendAdd, admin: User = Depends(admin_user),
                         db: Session = Depends(get_db)):
    a = _get_target(db, req.user_a)
    b = _get_target(db, req.user_b)
    if a.id == b.id:
        raise HTTPException(status_code=400, detail="같은 사용자입니다.")
    existing = friends.relationship(db, a.id, b.id)
    if existing:
        existing.status = "accepted"
    else:
        db.add(Friendship(requester_id=a.id, addressee_id=b.id, status="accepted"))
    db.commit()
    _audit(db, admin, "add_friendship", target_type="friendship",
           detail=f"{a.username} ↔ {b.username}")
    return {"ok": True}


# ---------- DM 관리 ----------
@app.get("/api/admin/user/{user_id}/dms")
def admin_user_dms(user_id: int, admin: User = Depends(admin_user),
                   db: Session = Depends(get_db)):
    u = _get_target(db, user_id)
    rows = db.query(DirectMessage).filter(
        (DirectMessage.sender_id == u.id) | (DirectMessage.recipient_id == u.id)
    ).order_by(DirectMessage.id.desc()).limit(100).all()
    names = {x.id: x.username for x in db.query(User).all()}
    return {"messages": [{
        **m.to_dict(),
        "fromName": names.get(m.sender_id, "?"),
        "toName": names.get(m.recipient_id, "?"),
    } for m in rows]}


@app.delete("/api/admin/dm/{dm_id}")
def admin_delete_dm(dm_id: int, admin: User = Depends(admin_user),
                    db: Session = Depends(get_db)):
    m = db.query(DirectMessage).filter(DirectMessage.id == dm_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    db.delete(m)
    db.commit()
    _audit(db, admin, "delete_dm", target_type="dm", target_id=dm_id, detail="메시지 삭제")
    return {"ok": True}


# ---------- 게임 관리 ----------
@app.get("/api/admin/games")
def admin_games(q: str = Query(default=""), admin: User = Depends(admin_user),
                db: Session = Depends(get_db)):
    query = db.query(Game)
    if q.strip():
        safe_q = security.escape_like(q.strip())
        query = query.filter(
            (Game.white_name.ilike(f"%{safe_q}%", escape="\\")) |
            (Game.black_name.ilike(f"%{safe_q}%", escape="\\"))
        )
    rows = query.order_by(Game.id.desc()).limit(100).all()
    return {"games": [g.summary_dict() for g in rows]}


@app.delete("/api/admin/game/{game_id}")
def admin_delete_game(game_id: int, admin: User = Depends(admin_user),
                      db: Session = Depends(get_db)):
    g = db.query(Game).filter(Game.id == game_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="게임을 찾을 수 없습니다.")
    label = f"{g.white_name} vs {g.black_name}"
    db.delete(g)
    db.commit()
    _audit(db, admin, "delete_game", target_type="game", target_id=game_id, detail=label)
    return {"ok": True}


# ---------- 사이트 설정 ----------
@app.get("/api/admin/settings")
def admin_get_settings(admin: User = Depends(admin_user)):
    return {"settings": sitesettings.all_settings()}


@app.post("/api/admin/settings")
def admin_set_setting(req: SettingUpdate, admin: User = Depends(admin_user),
                      db: Session = Depends(get_db)):
    ok, err = sitesettings.set_value(db, req.key, req.value)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    _audit(db, admin, "set_setting", target_type="site", target_id=req.key,
           detail=f"{req.key} = {req.value}")
    return {"ok": True, "settings": sitesettings.all_settings()}


# ---------- 공지 방송 (접속 중인 모든 사용자에게) ----------
@app.post("/api/admin/announce")
def admin_announce(req: AnnounceBody, admin: User = Depends(admin_user),
                   db: Session = Depends(get_db)):
    text = security.sanitize_text(req.text, 500)
    if not text:
        raise HTTPException(status_code=400, detail="내용이 비어 있습니다.")
    sent = 0
    for uid in list(server.online.keys()):
        server.notify(uid, {"type": "announce", "text": text, "from": admin.username})
        sent += 1
    # 접속 여부와 무관하게 모든 사용자에게 알림 저장
    for (uid,) in db.query(User.id).all():
        achievements.notify(db, uid, "announce", f"📢 공지: {text}", "/index.html")
    _audit(db, admin, "announce", target_type="site", detail=f"{sent}명에게 발송: {text[:80]}")
    return {"ok": True, "sent": sent}


# ---------- 관리자 행위 감사 로그 ----------
@app.get("/api/admin/actions")
def admin_actions(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(AdminAction).order_by(AdminAction.id.desc()).limit(200).all()
    return {"actions": [a.to_dict() for a in rows]}


# ---------- 공개: 사이트 설정 일부 (공지/점검 표시용) ----------
@app.get("/api/site")
def public_site():
    return {
        "motd": sitesettings.get("motd", ""),
        "maintenance": sitesettings.get("maintenance_mode", False),
        "registrationOpen": sitesettings.get("registration_open", True),
        "chatEnabled": sitesettings.get("chat_enabled", True),
        "dmEnabled": sitesettings.get("dm_enabled", True),
        "reviewEnabled": sitesettings.get("review_enabled", True),
        "version": settings.VERSION,
    }


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


# ---------- 퍼즐 ID 조회 (캐치올: 구체적 /api/puzzles/* 라우트보다 뒤에 정의해야 함) ----------
@app.get("/api/puzzles/{puzzle_id}")
def puzzle_by_id(puzzle_id: str):
    p = puzzles.get_puzzle(puzzle_id)
    if not p:
        raise HTTPException(status_code=404, detail="퍼즐을 찾을 수 없습니다.")
    return p
