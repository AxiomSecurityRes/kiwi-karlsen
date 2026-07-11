# 🧩 Lichess 퍼즐 DB 적용 (중요: 파일 크기 주의!)

기본 `data/puzzles.csv` 는 헤더만 있는 빈 파일입니다. 아래처럼 **일부만 샘플링**해서
넣으세요. 전체 파일(압축 해제 시 ~1GB)을 그대로 넣으면 안 됩니다.

## ⚠️ 반드시 지켜야 할 것
- **GitHub 는 100MB 초과 파일을 거부**합니다. 전체 CSV(수백 MB~1GB)는 push 자체가 안 됩니다.
- 서버는 시작 시 퍼즐을 메모리에 로드합니다. 무료 플랜(512MB)을 고려해 **2만~4만 개**를 권장합니다.
- 혹시 큰 파일을 넣어도 서버는 자동으로 `MAX_PUZZLES`(기본 40000)개만 무작위 표본추출하여
  로드하므로 죽지는 않지만, GitHub push 제한 때문에라도 샘플링은 필수입니다.

## 방법 (윈도우 PowerShell, zstd 필요)
zstd: https://github.com/facebook/zstd/releases

    cd C:\Users\twtru\Desktop\kiwi-karlsen
    Invoke-WebRequest https://database.lichess.org/lichess_db_puzzle.csv.zst -OutFile p.csv.zst
    zstd -d p.csv.zst -o p.csv
    # 헤더 + 무작위 2만 개만 추출 (약 3~4MB → GitHub OK)
    Get-Content p.csv -TotalCount 1 | Set-Content data\puzzles.csv
    Get-Content p.csv | Select-Object -Skip 1 | Get-Random -Count 20000 | Add-Content data\puzzles.csv
    # 임시파일 삭제(커밋 안 되게)
    Remove-Item p.csv, p.csv.zst
    git add data/puzzles.csv
    git commit -m "puzzle DB 2만개"
    git push

배포 후 `/health` 의 `"puzzles"` 숫자로 로드된 개수를 확인할 수 있습니다.

## CSV 형식 (Lichess 표준 그대로)
    PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags

- Moves[0] = 자동 재생되는 상대 수, Moves[1..] = 정답.
- Rating → 앱의 레이팅 범위 필터, Themes → 유형 드롭다운(한글).

## 더 많이/적게 로드하려면
Render 환경변수 `MAX_PUZZLES` 조정 (예: 60000). 무료 플랜은 5만 이하 권장.
