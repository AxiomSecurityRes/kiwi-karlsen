# Stockfish WASM 엔진 설치

봇 대국은 브라우저에서 실행되는 Stockfish WASM 을 기본으로 사용합니다.
같은 도메인(Same-Origin)에서 Web Worker 로 로드해야 CORS 문제가 없으므로,
엔진 파일을 `frontend/assets/engine/` 안에 직접 배치하세요.

## 방법 1) npm 패키지에서 복사
npm i stockfish 후, node_modules/stockfish/src 안의
`stockfish.js`(+ 필요한 .wasm 파일)을 frontend/assets/engine/ 로 복사합니다.

## 방법 2) lichess / nmrugg 빌드 사용
https://github.com/lichess-org/stockfish.js 또는
https://github.com/nmrugg/stockfish.js 의 릴리스에서
단일 파일 빌드(`stockfish.js`)를 받아 frontend/assets/engine/stockfish.js 로 둡니다.

## 엔진이 없을 때
엔진 파일이 없거나 로드에 실패하면, 프런트엔드는 자동으로
백엔드 `/api/bot/move` 엔드포인트로 폴백합니다.
백엔드에서 강한 봇을 쓰려면 서버에 Stockfish 바이너리를 설치하고
환경변수 STOCKFISH_PATH 를 설정하세요. 미설치 시 내장 휴리스틱 봇이 동작합니다.
