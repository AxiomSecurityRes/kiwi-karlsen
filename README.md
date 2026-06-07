# 🥝 Kiwi Karlsen.com

키위새 마스코트 테마의 온라인 체스 플랫폼. 봇 대국(8단계), 실시간 멀티플레이어,
Glicko-2 레이팅, 퍼즐 트레이너를 제공합니다.

## 기능
- **봇 대국**: Kiwi Baby ~ Kiwi Grandmaster 8단계. 브라우저 Stockfish(WASM) 기본,
  백엔드 Stockfish/휴리스틱 폴백.
- **실시간 멀티플레이어**: WebSocket 기반 온라인 목록 + 도전 + 대국.
- **레이팅**: Glicko-2 시스템으로 승/무/패 반영.
- **퍼즐**: Lichess 형식 CSV 로딩 & 서빙.
- **효과음 / 키위 테마 UI**.

## 기술 스택
- Backend: Python · FastAPI · WebSocket · python-chess(연동 엔진은 C++ Stockfish)
- Frontend: HTML · CSS · Vanilla JS · chess.js · chessboard.js
- DB: SQLite(기본) / SQLAlchemy

## 디렉토리 구조
```
kiwi-karlsen/
├── README.md
├── requirements.txt
├── Procfile
├── render.yaml
├── runtime.txt
├── .gitignore
├── data/puzzles.csv
├── scripts/download_engine.md
├── backend/
│   ├── __init__.py  config.py  database.py  models.py  schemas.py
│   ├── auth.py  glicko.py  bots.py  engine.py  puzzles.py
│   ├── realtime.py  main.py
└── frontend/
    ├── index.html  play.html  puzzles.html
    ├── css/style.css
    ├── js/  (api, sounds, socket, lobby, online-game, engine, bot-game, puzzles)
    └── assets/  (img, engine, sounds)
```

## 로컬 실행
```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
# 브라우저: http://localhost:8000
```

## Stockfish WASM 엔진(선택, 봇 강화)
`scripts/download_engine.md` 참고. 없어도 백엔드 폴백으로 동작합니다.

---

# 🚀 GitHub 연동 방법

## 1. Git 초기화 & 첫 커밋
프로젝트 폴더(`kiwi-karlsen/`)에서:
```bash
cd kiwi-karlsen
git init
git add .
git commit -m "Initial commit: Kiwi Karlsen.com 체스 플랫폼"
```

## 2. GitHub 저장소 생성
1. https://github.com 로그인 → 우측 상단 **+** → **New repository**
2. Repository name: `kiwi-karlsen` (원하는 이름)
3. Public/Private 선택 (Render 무료 연동은 둘 다 가능)
4. **README/.gitignore/license 는 추가하지 말 것** (이미 로컬에 있음) → **Create repository**

## 3. 원격 연결 & 푸시
GitHub가 안내하는 URL을 사용합니다 (HTTPS 예시):
```bash
git branch -M main
git remote add origin https://github.com/<당신의계정>/kiwi-karlsen.git
git push -u origin main
```
- 푸시 시 인증을 요구하면 GitHub **Personal Access Token**(Settings → Developer settings →
  Personal access tokens)을 비밀번호 대신 입력합니다.

## 4. 이후 변경사항 반영
```bash
git add .
git commit -m "변경 내용 설명"
git push
```

---

# ☁️ Render.com 배포 방법

## 방법 A) render.yaml 자동 인식 (권장)
저장소 루트에 포함된 `render.yaml` 덕분에 거의 클릭만으로 배포됩니다.

1. https://render.com 가입/로그인 (GitHub 계정으로 로그인하면 편함)
2. 대시보드 → **New +** → **Blueprint**
3. GitHub 저장소(`kiwi-karlsen`) 선택 → Render가 `render.yaml`을 읽어 서비스를 자동 구성
4. **Apply** 클릭 → 빌드 & 배포 시작
5. 완료되면 `https://kiwi-karlsen.onrender.com` 같은 URL이 생성됩니다.

## 방법 B) 수동 설정 (Web Service)
1. 대시보드 → **New +** → **Web Service**
2. GitHub 저장소 연결 → `kiwi-karlsen` 선택
3. 설정값 입력:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
   - **Instance Type**: `Free`
4. (선택) **Environment Variables** 추가:
   - `KIWI_SECRET` = 임의의 긴 문자열
   - `PUZZLE_FILE` = `data/puzzles.csv`
   - `STOCKFISH_PATH` = (백엔드 Stockfish 바이너리를 설치한 경우에만 그 경로)
5. **Create Web Service** → 빌드 후 배포 완료.

> ⚠️ **WebSocket 안내**: Render의 Web Service는 WebSocket을 기본 지원합니다.
> 별도 설정 없이 `/ws` 엔드포인트가 동작합니다. (HTTPS 도메인에서는 자동으로 `wss://` 사용)

> ⚠️ **SQLite 휘발성**: Render 무료 플랜은 재배포/재시작 시 파일시스템이 초기화되어
> SQLite DB(레이팅/기보)가 사라집니다. 영구 저장이 필요하면:
> - Render에서 **PostgreSQL** 인스턴스를 만들고, 그 **Internal Database URL**을
>   환경변수 `DATABASE_URL`로 지정하세요. (드라이버: `pip install psycopg2-binary` 추가 필요)
> - 또는 유료 플랜의 **Persistent Disk**를 마운트하세요.

## 강한 백엔드 봇(선택): Stockfish 바이너리 설치
무료 플랜은 클라이언트 WASM 엔진만으로도 봇이 동작하지만, 백엔드에서 진짜
Stockfish를 돌리려면 `Dockerfile`로 배포하고 apt로 stockfish를 설치한 뒤
`STOCKFISH_PATH=/usr/games/stockfish` 처럼 지정하면 됩니다.

---

# ⏰ 24시간 가동 (UptimeRobot)

Render 무료 플랜은 약 15분간 트래픽이 없으면 슬립 상태가 됩니다.
주기적 핑으로 깨어 있게 만들려면:

1. https://uptimerobot.com 가입/로그인
2. **+ New Monitor**
3. 설정:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Kiwi Karlsen`
   - **URL**: `https://<당신의앱>.onrender.com/health`
   - **Monitoring Interval**: `5 minutes`
4. **Create Monitor**

이제 5분마다 `/health` 가 호출되어 서비스가 깨어 있는 상태를 유지합니다.
(`/health` 와 `/ping` 두 경량 엔드포인트 모두 사용 가능합니다.)

> 참고: 슬립 후 첫 요청은 깨어나는 데 수십 초가 걸릴 수 있습니다. 완전한 무중단을
> 원하면 Render 유료 플랜(슬립 없음)을 사용하세요.

---

## 라이선스 / 데이터 출처
- 퍼즐 데이터 형식은 Lichess Open Database(https://database.lichess.org/#puzzles)와 호환됩니다.
  대량 데이터가 필요하면 해당 CSV를 받아 `data/puzzles.csv`로 교체하세요.
- Stockfish는 GPL 라이선스 엔진입니다.

---

# 🔧 v2 업데이트 (버그 수정 & 기능 추가)

## 수정된 이슈
1. **봇 엔진 항상 동작**: Stockfish 미설치 시에도 백엔드 알파-베타 엔진 + 브라우저 내장
   JS 엔진(3중 폴백)으로 봇이 반드시 수를 둡니다. Stockfish 설치 시 더 강해집니다.
2. **온라인 목록 정상화**: WebSocket 하트비트(25초)로 유휴 연결 종료를 방지하고,
   `/api/online` REST 폴백 + 5초 주기 폴링으로 목록이 항상 채워집니다.
3. **퍼즐 로직 개선**: 오답 시 잠기지 않고 재시도 가능, '정답 보기' 기능 추가.
   Lichess CSV 교체만으로 수백만 퍼즐 연동(`scripts/download_puzzles.md`).
4. **시간 제한 / 채팅 / 무승부**:
   - 온라인 대국: 서버 권위 클럭(1·3·5·10·30분 + 증가초), 시간 초과 자동 패배,
     실시간 채팅, 무승부 제안/수락/거절, 기권.
   - 봇 대국: 시간 제한(제한없음·3·5·10·30분) 선택 + 클럭.

## Stockfish 백엔드 엔진을 쓰는 배포 (선택)
무료 플랜은 내장 엔진으로 충분하지만, 진짜 Stockfish 를 백엔드에서 돌리려면
포함된 `Dockerfile` 로 배포하세요 (Render Docker 런타임, Starter 플랜 이상):

`render.yaml` 의 web 서비스를 다음과 같이 바꾸면 됩니다:
```yaml
services:
  - type: web
    name: kiwi-karlsen
    runtime: docker
    plan: starter
    dockerfilePath: ./Dockerfile
    healthCheckPath: /health
    envVars:
      - key: KIWI_SECRET
        generateValue: true
```
Docker 이미지가 `apt-get install stockfish` 로 엔진을 설치하고
`STOCKFISH_PATH=/usr/games/stockfish` 를 자동 지정합니다.
