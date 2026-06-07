# Stockfish 백엔드 엔진을 포함한 배포용 이미지
FROM python:3.11-slim

# C++ Stockfish 엔진 설치
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 백엔드 엔진이 자동으로 Stockfish 를 사용하도록 경로 지정
ENV STOCKFISH_PATH=/usr/games/stockfish
ENV PUZZLE_FILE=data/puzzles.csv

# Render 는 $PORT 를 주입한다. 기본값 10000.
ENV PORT=10000
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}
