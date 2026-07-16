# 브라우저 Stockfish 엔진 (Stockfish 18 NNUE)

`frontend/assets/engine/` 에 최신 Stockfish 18 NNUE WASM 이 이미 포함돼 있습니다.
분석·게임 리뷰·봇 대국이 모두 이 엔진을 사용합니다.

포함 파일:
- `stockfish-18-lite-single.js` / `.wasm` — 기본(단일 스레드, CORS 헤더 불필요, 모바일 포함)
- `stockfish-18-lite.js` / `.wasm` — 멀티스레드(더 빠름, `crossOriginIsolated` 필요)

`engine.js` 로더가 `crossOriginIsolated` 여부를 감지해 자동으로 최적 빌드를 고릅니다.
멀티스레드를 켜려면 서버가 다음 응답 헤더를 보내야 합니다(이미 backend/security.py 에 설정됨):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin   (모든 응답)
```

## 업데이트
```
npm pack stockfish
tar xzf stockfish-*.tgz
cp package/bin/stockfish-18-lite-single.{js,wasm} frontend/assets/engine/
cp package/bin/stockfish-18-lite.{js,wasm}        frontend/assets/engine/
```
js 와 wasm 의 basename 은 반드시 같아야 합니다(워커가 `자기경로.js→.wasm` 로 wasm 을 찾음).

License: GPLv3 — `frontend/assets/engine/LICENSE-stockfish.txt`
