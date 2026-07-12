# 🚀 Kiwi Karlsen 배포 가이드 (v15)

## 1. 최초 배포 (처음 한 번만)

### 1-1. 압축 풀기
zip을 풀어 기존 `kiwi-karlsen` 폴더 내용을 전부 덮어씁니다.

### 1-2. Stockfish 엔진 복원 (중요)
zip에는 엔진 파일이 들어있지 않습니다. 아래 경로에 직접 넣으세요.

    frontend\assets\engine\stockfish.js

없어도 동작하지만, 있으면 봇·분석·게임 리뷰가 훨씬 정확해집니다.

### 1-3. 커밋 & 푸시 (한 줄씩)

    cd "C:\Users\twtru\Desktop\kiwi-karlsen"
    git add .
    git commit -m "v15: 최종 QA"
    git push

### 1-4. Render 환경변수 확인
대시보드 → 서비스 → Environment 에서 아래를 확인하세요.

| 변수 | 값 | 설명 |
|---|---|---|
| `KIWI_SECRET` | (자동 생성) | **절대 바꾸지 마세요.** 바뀌면 모든 로그인 토큰이 무효화됩니다. |
| `ADMIN_USERNAME` | `brady` | 이 이름으로 가입/로그인하면 자동 관리자 |
| `MAX_PUZZLES` | `40000` | 메모리에 올릴 최대 퍼즐 수 (무료 플랜 512MB 기준) |
| `ALLOWED_ORIGINS` | (비움) | 비워두면 같은 출처만 허용 (권장) |
| `PUZZLE_FILE` | `data/puzzles.csv` | 퍼즐 CSV 경로 |

---

## 2. 퍼즐 데이터 넣기 (필수 — 안 넣으면 퍼즐 기능이 비어 있음)

`data/puzzles.csv` 는 헤더만 있는 빈 파일입니다. Lichess 공개 DB를 넣으세요.

### 주의
- 전체 파일은 압축 해제 시 약 1GB → **GitHub 는 100MB 초과 파일을 거부합니다.**
- 반드시 **일부만 샘플링**해서 커밋하세요. 2~4만 개면 충분합니다.

### PowerShell 절차
zstd 설치: https://github.com/facebook/zstd/releases (또는 최신 7-Zip 으로 `.zst` 해제)

    cd C:\Users\twtru\Desktop\kiwi-karlsen
    Invoke-WebRequest https://database.lichess.org/lichess_db_puzzle.csv.zst -OutFile p.csv.zst
    zstd -d p.csv.zst -o p.csv
    Get-Content p.csv -TotalCount 1 | Set-Content data\puzzles.csv
    Get-Content p.csv | Select-Object -Skip 1 | Get-Random -Count 20000 | Add-Content data\puzzles.csv
    Remove-Item p.csv, p.csv.zst
    git add data/puzzles.csv
    git commit -m "puzzle DB 2만개"
    git push

배포되면 서버가 시작 시 자동으로 읽습니다. 퍼즐 페이지의 유형(테마) 드롭다운에
실제 테마(포크, 핀, 엔드게임 등)가 채워집니다.

---

## 3. 배포 확인 체크리스트

1. `https://<앱>.onrender.com/health` → `"version":"v15"` 와 `"puzzles":20000` 확인
2. 사이트 푸터에 `· v15` 표시 확인 (안 보이면 Ctrl+F5 강력 새로고침)
3. `ADMIN_USERNAME`(기본 `brady`)로 가입 → 상단에 **관리자** 메뉴가 보이는지
4. 상단 🌙 버튼으로 야행(다크) 모드 전환되는지
5. 봇 대국 → ELO 슬라이더 표시, 대국 종료 후 **게임 리뷰** 버튼 동작
6. 휴대폰에서 기물 탭 → 이동 가능 칸 점 표시, 화면이 스크롤되지 않는지

---

## 4. 관리자 계정

- `ADMIN_USERNAME` 환경변수(기본 `brady`)와 **같은 이름으로 가입/로그인**하면 자동 관리자
- 또는 **가장 먼저 가입한 계정**이 자동 관리자

관리자 페이지(`/admin.html`)에서 할 수 있는 것:
대시보드 · 사용자(스트릭/전적/비밀번호/정지/삭제) · 게임 관리 · 보안(봇 의심·감사 로그) ·
사이트 설정(점검 모드, 가입 차단, 공지) · 관리자 행위 감사 로그 · 전체 공지 방송

---

## 5. 알아둘 점

**무료 플랜의 DB는 휘발성입니다.** 재배포하면 SQLite가 초기화됩니다.
계정·게임 기록을 영구 보관하려면 PostgreSQL을 붙이세요.

1. Render 에서 PostgreSQL 생성 (무료 플랜 있음)
2. `requirements.txt` 에 `psycopg2-binary` 추가
3. 환경변수 `DATABASE_URL` 에 연결 문자열 입력

**콜드 스타트**: 무료 플랜은 15분 미사용 시 잠들어 첫 요청이 느립니다.
UptimeRobot 등으로 `/health` 를 5분마다 호출하면 완화됩니다.
