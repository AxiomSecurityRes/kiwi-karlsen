# Lichess 퍼즐 데이터베이스 연동

기본 제공되는 `data/puzzles.csv` 에는 검증된 샘플 퍼즐 5개가 들어 있습니다.
실전용 대량 퍼즐(수백만 개)을 쓰려면 Lichess 공개 DB 를 받아 교체하세요.

## 1) 전체 데이터베이스 다운로드 (~270MB 압축)
```bash
# zstd 설치 (미설치 시)
#   Ubuntu: apt-get install zstd   |   macOS: brew install zstd
wget https://database.lichess.org/lichess_db_puzzle.csv.zst
zstd -d lichess_db_puzzle.csv.zst -o data/puzzles.csv
```
압축 해제 시 약 1.5GB, 400만+ 퍼즐입니다.

## 2) (권장) 일부만 추출해서 가볍게 쓰기
전체는 무료 호스팅에 부담되므로, 상위 N개만 잘라 쓰는 것을 권장합니다.
```bash
# 헤더 + 무작위 2만 개만 추출
head -1 full_puzzle.csv > data/puzzles.csv
tail -n +2 full_puzzle.csv | shuf | head -20000 >> data/puzzles.csv
```

## 3) CSV 형식 (Lichess 표준 — 그대로 호환)
```
PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
```
- **FEN**: 퍼즐 시작 직전 국면
- **Moves**: 공백 구분 UCI 수열. `Moves[0]` 은 자동 재생되는 상대 수,
  `Moves[1]` 부터가 풀이자의 정답 수열입니다.
- **Rating**: 난이도. 프런트엔드의 난이도 필터(min/max)에 사용됩니다.

별도 코드 수정 없이 `data/puzzles.csv` 만 교체하면
서버 시작 시 `backend/puzzles.py` 가 자동으로 읽어들입니다.

## 4) 환경변수로 다른 경로 지정 (선택)
```
PUZZLE_FILE=data/my_puzzles.csv
```
