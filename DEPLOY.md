# 🚀 Kiwi Karlsen 배포 가이드 (v27)

## 1. 최초 배포

### 1-1. 압축 풀어 덮어쓰기
zip을 풀어 기존 `kiwi-karlsen` 폴더 내용을 전부 덮어씁니다.
> Stockfish 엔진이 이제 **번들되어 있으므로** 따로 넣을 필요가 없습니다.

### 1-2. 커밋 & 푸시 (한 줄씩)
    cd "C:\Users\twtru\Desktop\kiwi-karlsen"
    git add .
    git commit -m "v27"
    git push

### 1-3. Render 환경변수 (대시보드 → Environment)
| 변수 | 값 | 설명 |
|---|---|---|
| `KIWI_SECRET` | (자동 생성) | 토큰 서명 + 비밀번호 페퍼. **절대 바꾸지 마세요.** |
| `ADMIN_USERNAME` | `brady` | 이 이름으로 가입/로그인 시 자동 관리자 |
| `MAX_PUZZLES` | `40000` | 메모리에 올릴 최대 퍼즐 수 (무료 512MB 기준) |

## 2. 퍼즐 데이터 (필수 — 안 넣으면 퍼즐 기능이 비어 있음)
`data/puzzles.csv`는 헤더만 있습니다. Lichess DB를 **일부만 샘플링**해서 넣으세요
(전체는 1GB라 GitHub 100MB 제한에 걸립니다).

PowerShell (zstd 또는 7-Zip 필요):
    cd C:\Users\twtru\Desktop\kiwi-karlsen
    Invoke-WebRequest https://database.lichess.org/lichess_db_puzzle.csv.zst -OutFile p.csv.zst
    zstd -d p.csv.zst -o p.csv
    Get-Content p.csv -TotalCount 1 | Set-Content data\puzzles.csv
    Get-Content p.csv | Select-Object -Skip 1 | Get-Random -Count 20000 | Add-Content data\puzzles.csv
    Remove-Item p.csv, p.csv.zst
    git add data/puzzles.csv; git commit -m "puzzle DB"; git push

## 3. 배포 확인
1. `https://<앱>.onrender.com/health` → `"version":"v27"` 확인
2. 로비에서 **Ctrl+F5** 한 번 (이후 페이지는 자동 갱신)
3. `ADMIN_USERNAME`(기본 `brady`)로 가입 → 상단에 "관리자" 메뉴 표시
4. 프로필 → 계정 보안 → **2단계 인증** 켜기 권장

## 4. 버전 올리는 법 (중요)
재배포 전 **반드시** 실행하세요. 캐시 문제와 버전 불일치를 한 번에 해결합니다.
    python scripts/bump_version.py 28

## 5. 알아둘 점
- **무료 플랜 DB는 휘발성** — 재배포 시 SQLite 초기화. 영구 보관하려면 PostgreSQL(`DATABASE_URL` + `psycopg2-binary`) 연결.
- **콜드 스타트** — 15분 미사용 시 잠듦. UptimeRobot으로 `/health`를 5분마다 호출하면 완화.
- 온라인 대국·퍼즐 전투는 WebSocket을 씁니다. Render는 WS를 지원합니다.
