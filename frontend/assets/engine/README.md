# Kiwi Karlsen — 브라우저 체스 엔진 (Stockfish 18 NNUE)

이 폴더에는 최신 **Stockfish 18 (NNUE)** WASM 엔진이 들어 있습니다.
분석·게임 리뷰·봇 대국이 모두 이 엔진을 사용합니다.

## 포함된 빌드
| 파일 | 용도 | 크기 | 요구사항 |
|------|------|------|----------|
| `stockfish-18-lite-single.js/.wasm` | **기본** 단일 스레드 NNUE | ~7MB | 없음 (모바일 포함 전 브라우저) |
| `stockfish-18-lite.js/.wasm` | 멀티스레드 NNUE (더 빠름/깊음) | ~7MB | `crossOriginIsolated` (COOP+COEP 헤더) |

`engine.js` 로더가 실행 환경을 감지해 자동으로 최적 빌드를 고릅니다.
- 교차 출처 격리(`crossOriginIsolated === true`)면 멀티스레드 빌드를 로드하고
  `Threads`(CPU 코어 수)·`Hash`를 설정합니다.
- 아니면 단일 스레드 빌드를 로드합니다(그래도 사람보다 훨씬 강함).
- 둘 다 실패하면 내장 JS 알파-베타 엔진으로 폴백합니다.

## 왜 교체했나
이전 클래식 Stockfish는 (1) 구버전이라 약하고, (2) 고전 평가의
차례(tempo) 편향으로 분석이 부정확했습니다. SF18 NNUE는 tempo 편향이
없고 평가가 훨씬 정확합니다. 따라서 `engine.js`의 tempo 보정 해킹을
제거했습니다.

## 업데이트 방법
```
npm pack stockfish            # 최신 tarball
tar xzf stockfish-*.tgz
cp package/bin/stockfish-18-lite-single.{js,wasm} .
cp package/bin/stockfish-18-lite.{js,wasm} .
```
파일명(js/wasm)의 basename은 반드시 일치해야 합니다. 워커가
`자기경로.js → 자기경로.wasm`으로 wasm을 찾기 때문입니다.

License: GPLv3 (Stockfish) — LICENSE-stockfish.txt 참고.
