/* 체스 엔진 래퍼 — 3중 폴백 구조.
   1순위: 같은 도메인의 /assets/engine/stockfish.js 를 Web Worker(WASM) 로 구동.
   2순위: 백엔드 /api/bot/move (서버 Stockfish 또는 파이썬 알파-베타).
   3순위: 브라우저 내장 JS 알파-베타 (오프라인/오류 시에도 항상 동작). */
const Engine = (() => {
  let worker = null;
  let ready = false;
  let initTried = false;
  let pendingResolve = null;
  let pendingEval = null;
  let lastEval = { score: null, mate: null, best: null };
  let mode = "내장 JS 엔진";

  function init() {
    return new Promise((resolve) => {
      if (initTried) { resolve(ready); return; }
      initTried = true;
      // stockfish.js 존재 여부를 먼저 확인 (없으면 Worker 생성 자체를 건너뜀)
      fetch("/assets/engine/stockfish.js", { method: "HEAD" })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (!res.ok || ct.includes("text/html")) {
            mode = "백엔드/내장 엔진";
            resolve(false);
            return;
          }
          spawnWorker(resolve);
        })
        .catch(() => { mode = "백엔드/내장 엔진"; resolve(false); });
    });
  }

  function spawnWorker(resolve) {
    try {
      worker = new Worker("/assets/engine/stockfish.js");
      let gotUci = false;
      const timeout = setTimeout(() => {
        if (!ready) { cleanup(); mode = "백엔드/내장 엔진"; resolve(false); }
      }, 5000);

      worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("uciok")) {
          gotUci = true;
          worker.postMessage("isready");
        } else if (line.startsWith("readyok") && gotUci) {
          ready = true;
          mode = "브라우저 Stockfish (WASM)";
          clearTimeout(timeout);
          resolve(true);
        } else if (line.startsWith("info") && line.indexOf("score") !== -1 && pendingEval) {
          // 평가 정보 누적 (마지막 깊이의 값을 사용)
          const cpM = line.match(/score cp (-?\d+)/);
          const mateM = line.match(/score mate (-?\d+)/);
          const pvM = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
          if (cpM) { lastEval.score = parseInt(cpM[1], 10); lastEval.mate = null; }
          if (mateM) { lastEval.mate = parseInt(mateM[1], 10); lastEval.score = null; }
          if (pvM) { lastEval.best = pvM[1]; }
        } else if (line.startsWith("bestmove")) {
          const mv = line.split(" ")[1];
          if (pendingEval) {
            const r = pendingEval; pendingEval = null;
            if (mv && mv !== "(none)" && !lastEval.best) lastEval.best = mv;
            r({ ...lastEval });
          } else if (pendingResolve) {
            const r = pendingResolve; pendingResolve = null; r(mv);
          }
        }
      };
      worker.onerror = () => { clearTimeout(timeout); cleanup(); mode = "백엔드/내장 엔진"; resolve(false); };
      worker.postMessage("uci");
    } catch (err) {
      cleanup(); mode = "백엔드/내장 엔진"; resolve(false);
    }
  }

  function cleanup() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
    ready = false;
  }

  function workerMove(fen, params) {
    return new Promise((resolve) => {
      if (!ready || !worker) { resolve(null); return; }
      pendingResolve = resolve;
      if (params.elo) {
        worker.postMessage("setoption name UCI_LimitStrength value true");
        worker.postMessage("setoption name UCI_Elo value " + params.elo);
      } else {
        worker.postMessage("setoption name UCI_LimitStrength value false");
        worker.postMessage("setoption name Skill Level value " + params.skill);
      }
      worker.postMessage("position fen " + fen);
      worker.postMessage(`go depth ${params.depth} movetime ${params.movetime}`);
      setTimeout(() => {
        if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(null); }
      }, params.movetime + 4000);
    });
  }

  async function backendMove(fen, level) {
    try {
      const { uci } = await API.botMove(fen, level);
      return uci;
    } catch (e) {
      return null;
    }
  }

  /* ---------- 3순위: 브라우저 내장 JS 알파-베타 ---------- */
  const PVAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  function staticEval(g) {
    if (g.in_checkmate()) return g.turn() === "w" ? -100000 : 100000;
    if (g.in_draw() || g.in_stalemate() || g.insufficient_material()) return 0;
    let score = 0;
    const board = g.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = board[r][c];
        if (!sq) continue;
        const v = PVAL[sq.type];
        score += sq.color === "w" ? v : -v;
      }
    }
    return score;
  }

  function negamax(g, depth, alpha, beta, color) {
    if (depth === 0 || g.game_over()) return color * staticEval(g);
    let best = -Infinity;
    const moves = g.moves({ verbose: true })
      .sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
    for (const m of moves) {
      g.move(m);
      const val = -negamax(g, depth - 1, -beta, -alpha, -color);
      g.undo();
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function jsEngineMove(fen, bot) {
    const g = new Chess(fen);
    const legal = g.moves({ verbose: true });
    if (!legal.length) return null;
    // 즉시 외통
    for (const m of legal) {
      g.move(m); const mate = g.in_checkmate(); g.undo();
      if (mate) return m.from + m.to + (m.promotion || "");
    }
    if (bot.randomness && Math.random() < bot.randomness) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      return m.from + m.to + (m.promotion || "");
    }
    const depth = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3 }[bot.level] || 2;
    const color = g.turn() === "w" ? 1 : -1;
    let best = legal[0], bestVal = -Infinity, alpha = -Infinity;
    const ordered = legal.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
    for (const m of ordered) {
      g.move(m);
      let val = -negamax(g, depth - 1, -Infinity, -alpha, -color);
      g.undo();
      val += (Math.random() * 6 - 3);
      if (val > bestVal) { bestVal = val; best = m; }
      if (bestVal > alpha) alpha = bestVal;
    }
    return best.from + best.to + (best.promotion || "");
  }

  /* ---------- 평가(분석/리뷰용) ---------- */
  function workerEval(fen, depth) {
    return new Promise((resolve) => {
      if (!ready || !worker) { resolve(null); return; }
      lastEval = { score: null, mate: null, best: null };
      pendingEval = resolve;
      worker.postMessage("setoption name UCI_LimitStrength value false");
      worker.postMessage("setoption name Skill Level value 20");
      worker.postMessage("position fen " + fen);
      worker.postMessage(`go depth ${depth}`);
      setTimeout(() => {
        if (pendingEval) { const r = pendingEval; pendingEval = null; r({ ...lastEval }); }
      }, 6000);
    });
  }

  function jsEval(fen, depth) {
    const g = new Chess(fen);
    if (g.in_checkmate()) {
      // 둘 차례가 외통 = 진 쪽
      return { score: null, mate: g.turn() === "w" ? -1 : 1, best: null };
    }
    const legal = g.moves({ verbose: true });
    if (!legal.length) return { score: 0, mate: null, best: null };
    const color = g.turn() === "w" ? 1 : -1;
    let best = legal[0], bestVal = -Infinity, alpha = -Infinity;
    const ordered = legal.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
    for (const m of ordered) {
      g.move(m);
      const val = -negamax(g, depth - 1, -Infinity, -alpha, -color);
      g.undo();
      if (val > bestVal) { bestVal = val; best = m; }
      if (bestVal > alpha) alpha = bestVal;
    }
    // bestVal 은 둘 차례 관점 → 백 관점으로 변환
    const whiteScore = color === 1 ? bestVal : -bestVal;
    return { score: Math.round(whiteScore), mate: null,
             best: best.from + best.to + (best.promotion || "") };
  }

  /** 분석용 평가. 반환: {score(백관점 센티폰)|null, mate(백관점 수)|null, best(uci)} */
  async function evaluate(fen, depth) {
    depth = depth || 12;
    const turn = fen.split(" ")[1] === "b" ? -1 : 1;
    if (ready) {
      const r = await workerEval(fen, depth);
      if (r) {
        // WASM 점수는 '둘 차례' 관점 → 백 관점으로 변환
        const out = { best: r.best, score: null, mate: null };
        if (r.mate != null) out.mate = turn === 1 ? r.mate : -r.mate;
        else if (r.score != null) out.score = turn === 1 ? r.score : -r.score;
        return out;
      }
    }
    // 폴백: 내장 JS 평가
    return jsEval(fen, Math.min(depth, 3));
  }

  /* ---------- 메인 진입점 ---------- */
  async function getBestMove(fen, bot, randomMoveFn) {
    if (bot.randomness && Math.random() < bot.randomness && randomMoveFn) {
      const rnd = randomMoveFn();
      if (rnd) return rnd;
    }
    // 1순위: WASM
    if (ready) {
      const mv = await workerMove(fen, bot);
      if (mv && mv !== "(none)") return mv;
    }
    // 2순위: 백엔드
    const bmv = await backendMove(fen, bot.level);
    if (bmv) return bmv;
    // 3순위: 브라우저 내장 JS 엔진 (항상 성공)
    const jmv = jsEngineMove(fen, bot);
    if (jmv) return jmv;
    return randomMoveFn ? randomMoveFn() : null;
  }

  function usingWasm() { return ready; }
  function describe() { return mode; }

  return { init, getBestMove, evaluate, usingWasm, describe };
})();
