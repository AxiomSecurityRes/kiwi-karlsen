# 🧩 Lichess 퍼즐 데이터베이스 적용 방법

기본 제공 `data/puzzles.csv` 에는 **검증된 백랭크 메이트 18개**(레이팅 500~1300, 여러 테마)가
들어 있어 유형/난이도 필터가 바로 동작합니다. 실전용 수만~수백만 퍼즐을 쓰려면
아래 절차로 Lichess 공개 DB를 적용하세요.

> 중요: Lichess 전체 파일은 압축 해제 시 약 1.5GB(400만+ 퍼즐)라
> GitHub(파일당 100MB 제한)에 그대로 올릴 수 없습니다. 반드시 일부만 샘플링해서
> 커밋하거나(권장), 외부 저장소에서 받아오도록 해야 합니다.

---

## 권장 방법: 일부만 샘플링해서 커밋 (가장 간단)

윈도우 PowerShell 기준입니다. (zstd 압축 해제 도구 필요)

### 1) 다운로드
    cd C:\Users\twtru\Desktop\kiwi-karlsen
    Invoke-WebRequest https://database.lichess.org/lichess_db_puzzle.csv.zst -OutFile puzzles_full.csv.zst

### 2) 압축 해제 (zstd: https://github.com/facebook/zstd/releases)
    zstd -d puzzles_full.csv.zst -o puzzles_full.csv

### 3) 원하는 만큼만 추출 (예: 무작위 2만 개)
헤더 1줄 + 무작위 2만 줄만 골라 data/puzzles.csv 로 저장합니다.
2만 개면 무료 플랜에서도 가볍게 동작합니다(약 3~4MB).

    Get-Content puzzles_full.csv -TotalCount 1 | Set-Content data\puzzles.csv
    Get-Content puzzles_full.csv | Select-Object -Skip 1 | Get-Random -Count 20000 | Add-Content data\puzzles.csv

### 4) 커밋 & 배포
    git add data/puzzles.csv
    git commit -m "puzzle DB: Lichess 2만개 적용"
    git push

Render가 자동 재배포하면서 서버 시작 시 backend/puzzles.py 가 자동으로 읽어들입니다.
별도 코드 수정이 전혀 필요 없습니다. 퍼즐 페이지의 유형/난이도 드롭다운에
실제 테마(포크, 핀, 엔드게임 등)가 채워집니다.

---

## CSV 형식 (Lichess 표준 — 그대로 호환)
    PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags

- FEN: 퍼즐 시작 직전 국면
- Moves: 공백 구분 UCI 수열. Moves[0] = 자동 재생되는 상대 수, Moves[1] 부터가 정답.
- Rating: 난이도 -> 앱의 난이도 필터(min/max)에 사용.
- Themes: 공백 구분 테마 코드 -> 앱의 유형 드롭다운(한글 표시)에 사용.

## 다른 경로를 쓰려면 (선택)
    PUZZLE_FILE=data/my_puzzles.csv

## 메모리 주의 (Render 무료 플랜)
무료 플랜 RAM은 512MB입니다. 퍼즐은 시작 시 메모리에 로드되므로
5만 개 이하를 권장합니다.
