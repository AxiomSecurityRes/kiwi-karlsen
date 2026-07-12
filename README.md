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

---

# 🔧 v3 업데이트 (회원가입/보안 · 스트릭 · 모바일 터치)

## 1) 보안 회원가입 / 로그인
- `/api/register`(회원가입)와 `/api/login`(로그인) 분리, 비밀번호 필수(6자 이상).
- 비밀번호는 PBKDF2-HMAC-SHA256(20만 회) 해싱으로 저장.
- 토큰은 서버 비밀키(KIWI_SECRET)로 서명된 무상태 토큰 → 재배포해도 유효.
- 로그인 화면에서 "로그인 ↔ 회원가입" 전환.
> ⚠️ `KIWI_SECRET` 환경변수를 반드시 고정값으로 설정하세요. 값이 바뀌면 기존 토큰이 무효화됩니다.

## 2) 스트릭(연속 활동 일수)
- 접속·퍼즐 풀이·대국 종료 시 자동 갱신, 로비에 현재/최고 스트릭 표시.
- 어제 활동 → +1, 하루라도 건너뛰면 1로 초기화.

## 3) 모바일 터치 이동
- 기물을 탭하면 갈 수 있는 칸을 점으로 표시, 목적지를 탭하면 이동.
- 보드 영역 `touch-action: none` 으로 드래그 시 화면 스크롤 방지.
- 터치 기기는 탭 이동, 데스크톱은 드래그 + 클릭 모두 지원.

## 남은 로드맵 (다음 배치 예정)
- Lichess 퍼즐 DB(수만 개) 레이팅/유형별 필터
- 친구 추가 + 친구 채팅
- 분석 보드 / 게임 리뷰

---

# 🔧 v4 업데이트 (퍼즐 DB · 친구 · 분석/리뷰)

## 1) Lichess 퍼즐 DB — 레이팅 & 유형별
- `data/puzzles.csv` 를 Lichess 전체 DB로 교체하면 수만~수백만 퍼즐 사용 가능
  (방법: `scripts/download_puzzles.md`).
- 퍼즐 페이지에 **유형(테마) 선택** 추가 — 백랭크 메이트, 포크, 핀, 엔드게임 등
  Lichess 테마를 한글 표시명으로 제공(개수 많은 순).
- `/api/puzzles/themes`, `/api/puzzles/random?min=&max=&theme=` 지원.

## 2) 친구 + 채팅
- 사용자 이름으로 친구 요청 → 수락/거절, 친구 목록(온라인/대국중 표시).
- 친구끼리 **언제나 DM 채팅** 가능(대국 중이 아니어도). 메시지는 DB에 저장되고
  상대가 온라인이면 WebSocket으로 실시간 전달, 오프라인이면 다음 접속 시 확인.
- `/api/friends/*`, `/api/users/search`, `/api/friends/dm`.

## 3) 분석 보드 & 게임 리뷰 (analysis.html)
- 자유 분석 보드: 기물 이동/무르기/뒤집기/초기화, 실시간 엔진 평가(평가 바 + 점수 + 추천수).
- 키보드 ←/→ 로 수 탐색, 기보 클릭으로 해당 국면 이동.
- **게임 리뷰**: 내 최근 게임 목록에서 '리뷰' 클릭 또는 PGN 붙여넣기 →
  '전체 분석'으로 모든 수를 엔진 평가하여 최선/좋음/부정확/실수/대실수로 분류,
  백/흑 요약 통계 표시.
- 엔진은 브라우저 Stockfish(WASM) 우선, 없으면 내장 JS 알파-베타로 평가.

> 분석/리뷰 엔진은 같은 도메인의 `frontend/assets/engine/stockfish.js` 가 있으면
> 가장 정확합니다. 없으면 내장 엔진(얕은 탐색)으로 동작합니다.

---

# 🔧 v5 — A급 버그 수정

1. **모바일 터치**: 보드의 모든 사각형에 `touch-action: none` 적용 → 화면 스크롤 가로채기
   해결. 터치 기기는 `touchend` 로 직접 탭 처리하여 기물 선택→이동 범위 점 표시→이동이
   확실히 동작.
2. **게임 리뷰 접근**: 봇/온라인 대국 종료 모달에 **📊 게임 리뷰** 버튼 추가. 누르면 방금
   둔 게임의 PGN을 분석 페이지로 넘겨 자동으로 전체 분석.
3. **엔진 평가 버그 수정(중요)**: `engine.js` 의 `evaluate` 함수 이름 충돌로 JS 폴백 엔진과
   분석 평가가 깨지던 문제 수정(`staticEval` 로 분리).
4. **친구 실시간**: `Socket` 참조 오류로 DM/친구 알림이 안 붙던 문제 수정.
5. **퍼즐 DB**: 검증된 퍼즐 18개(레이팅 500~1300, 5개 테마) 기본 번들 → 유형/난이도 필터
   즉시 동작. 전체 Lichess DB 적용법은 `scripts/download_puzzles.md` 참고.
6. **버전 표시**: 푸터와 `/health` 에 버전(v5) 표기 → 배포 반영 여부 확인용.

---

# 🔧 v7 업데이트

1. **ELO 정밀 강도 모델**: 봇이 '최선수 계산 후 ELO 확률로 인간형 실수'를 두는
   방식으로 전환 — 표기 ELO와 실제 강도의 괴리를 크게 줄임(추정치).
   봇 선택 화면에 **ELO 슬라이더(100~3200, 100 단위)** + 레이팅대별 설명 추가.
2. **게임 리뷰 속도**: 워커 풀 병렬 평가(자동 1~4개) + movetime 기반 평가로 전환.
   설정에서 속도/정밀 선택 가능. (기존 대비 수 배 빠름, 진행률에 수/초 표시)
3. **리뷰 정확도**: 센티폰 → **승률(%) 기반 분류**로 전환. 크게 이기고 있는 국면에서는
   평가 하락에 자연히 관대해짐(chess.com 방식). 정확도(%)와 **예상 레이팅** 표시,
   체크메이트 수 보호 가드, 평가 그래프(클릭 이동) 추가.
4. **모바일 리뷰 버그**: 수 이동 시 페이지가 아래로 스크롤되던 문제 수정
   (기보 컨테이너 내부만 스크롤).
5. **퍼즐**: 내장 퍼즐 전부 제거. `data/puzzles.csv` 에 Lichess DB를 넣으면 자동 적용.
   레이팅 범위(min/max, 100 단위) + 유형 필터로 훈련. 비어 있으면 업로드 안내 표시.
6. **설정(⚙️)**: 모든 페이지 상단에 설정 버튼 — 효과음 on/off·볼륨,
   리뷰 분석 속도/병렬 워커 수, 실시간 평가 시간, 축하 효과 on/off.
7. **기타**: 봇 대국 힌트(💡)·무르기(↩) 추가.

---

# 🔧 v8 — 치명적 버그 수정
- **거대 퍼즐 CSV 로 인한 서버 크래시 수정**: 큰 파일을 올려도 서버가 죽어 사이트 전체
  (봇 슬라이더·게임 리뷰 포함)가 먹통이 되던 문제 해결. 스트리밍 + 저수지 표본추출로
  최대 MAX_PUZZLES(기본 40000)개만 메모리에 로드(피크 ~50MB). 손상 파일도 startup 안전.
- 퍼즐 업로드 안내에 파일 크기(GitHub 100MB 제한) 경고 및 샘플링 절차 명확화.
- 참고: v7 의 ELO 슬라이더/게임 리뷰 기능 자체는 정상이며, 위 서버 크래시로 인해
  페이지가 열리지 않아 안 보였던 것입니다. `/health` 와 푸터의 버전(v8)으로 배포 확인 가능.

---

# 🔧 v9 업데이트

1. **게임 리뷰 11단계 분류**(나무위키 표기): 탁월한 수·훌륭한 수·최선의 수·뛰어난 수·
   좋은 수·이론에 있는 수·강제·부정확한 수·실수·놓친 수·블런더. '강제'(합법수 1개)와
   '놓친 수'(강제 메이트/큰 이점 놓침) 추가.
2. **리뷰 정확도 보정**: 승률 기반에 **절대 물질 손실 가드** 추가 —
   너무 이기거나 지고 있을 때 기물을 헌납해도 '최고'로 뜨던 문제 수정
   (기물 손실 시 최소 부정확/실수/블런더로 강등).
3. **퍼즐 테마 숨김**: 풀이 중에는 테마를 감추고, 힌트·정답 보기·해결 시에만 공개(스포일러 방지).
4. **프로필**: 이름/성/위치/국가/OTB 레이팅/자기소개 편집, 사용자명 변경(90일 쿨다운),
   내/타인 프로필 및 레이팅·최근 게임 보기(`/profile.html?u=사용자명`).
5. **관리자 모드**(`/admin.html`): 관리자만 접근. 사이트 현황, 사용자 검색/레이팅 조정/
   정지·해제/관리자 지정·해제/삭제, 퍼즐 DB 재로드.
   - 관리자 지정: **환경변수 `ADMIN_USERNAME`(기본 `brady`)** 과 같은 이름으로 가입/로그인하면
     자동으로 관리자. 또는 **가장 먼저 가입한 계정**도 관리자.
6. 기존 DB에도 새 컬럼이 자동 마이그레이션됩니다(SQLite ALTER TABLE).

---

# 🔧 v15 — 최종 QA

## 고친 것
1. **오프닝 이름 영문 표기** (부제로 한글 병기). 예: `Sicilian: Najdorf (B90)`
2. **메모리 누수 수정** — 레이트리밋/실패기록/활동추적 딕셔너리의 키가 영구히 쌓이던 문제.
   5분마다 만료 항목을 자동 정리하는 청소부 추가. (500개 → 0개 정리 검증)
3. **퍼즐 조회 성능 89배 개선** — 레이팅 정렬 인덱스 + 이진 탐색 도입.
   러시 세트 생성 364ms → **4.1ms**, 퍼즐 랜덤 10.5ms → **2.2ms** (4만 개 DB 기준)
4. `render.yaml` 에 새 환경변수(ADMIN_USERNAME, MAX_PUZZLES, ALLOWED_ORIGINS) 반영
5. 관리자 대시보드에 인메모리 저장소 크기 진단 추가

## QA 결과
- **인증**: 전 라우트(67개) 런타임 검증 — 관리자 라우트 23개 전부 비관리자 403 차단, 민감정보 노출 0
- **성능**: 10만 행 CSV → 4만 개 로드 0.85초, 피크 메모리 108MB (무료 플랜 512MB 대비 여유)
- **접근성**: alt/lang/viewport/title, focus-visible, prefers-reduced-motion, 44px 터치 타겟
- **통합 테스트 27개 전부 통과**, 7개 페이지 런타임 오류 0, JS 17개 파일 문법 통과

배포 방법은 `DEPLOY.md` 참고.

---

# 🔧 v17 — 캐시된 옛 페이지 자동 갱신 + 오프닝 확장

## 1. "다른 페이지만 옛 UI가 보이는" 문제 해결
브라우저는 HTML 을 **페이지마다 따로** 캐시합니다. 로비에서 Ctrl+F5 를 해도
play.html, puzzles.html 등은 여전히 옛 버전이 뜰 수 있었습니다.

**버전 감시기(version-check.js)** 를 추가했습니다.
- 각 HTML 에 `<meta name="kiwi-version">` 를 박아둡니다.
- 페이지가 열리면 서버의 실제 버전(`/api/site`)과 비교합니다.
- 다르면 캐시를 우회해 **한 번만 자동으로 다시 불러옵니다.**
  (무한 새로고침 방지 장치 포함)

이제 재배포하면 사용자가 아무것도 하지 않아도 모든 페이지가 최신으로 갱신됩니다.

## 2. 오프닝 84종 → **176종**
모든 수순을 python-chess 로 합법성 검증했습니다(중복 0).
- 시실리안 20종(나이도르프·드래곤·스베시니코프·타이마노프·알라핀·로소림·그랑프리…)
- 루이 로페즈 13종(베를린·마샬 어택·오픈·클로즈드·익스체인지·슐리만…)
- 이탈리안/투 나이츠(에반스 갬빗·프라이드 리버·트랙슬러)
- 프렌치·카로칸·피르츠·알레힌·스칸디나비아 각 변형
- 퀸즈 갬빗·슬라브·세미슬라브·님초/퀸즈/킹즈 인디언·그륀펠트·카탈란·베노니·벤코
- 잉글리시·레티·더치·버드·런던·콜 시스템 등
- 첫 수 선택지 12개(e4, d4, Nf3, c4, f4, b3, b4, g4, e3, a3, Nc3, Na3)

## 배포 시 주의
버전을 올릴 때는 반드시 아래를 실행하세요. 안 그러면 캐시 문제가 재발합니다.

    python scripts/bump_version.py 18
