/* 체스 엔진 래퍼 — Stockfish 18 (NNUE) 3중 폴백 + ELO 강도 모델 + 병렬 리뷰 평가.
 *
 *   1순위: 브라우저 WASM Stockfish 18
 *          - crossOriginIsolated 이면 멀티스레드 빌드(stockfish-18-lite.js)
 *          - 아니면 단일 스레드 빌드(stockfish-18-lite-single.js) — 모바일 포함 전 브라우저
 *   2순위: 백엔드 /api/bot/move (봇 대국 전용)
 *   3순위: 브라우저 내장 JS 알파-베타 (엔진 로드 실패 시 최소 동작 보장)
 *
 * ⚠️ SF18 NNUE 는 고전 평가와 달리 차례(tempo) 편향이 없다.
 *    이전 코드의 TEMPO_CP 보정 해킹은 제거했다(이제 오히려 오차를 만든다).
 *    UCI 의 'score cp' 는 '차례인 쪽(side-to-move)' 관점이며,
 *    백 관점 = 백 차례면 그대로, 흑 차례면 부호 반전.
 */
const Engine = (() => {
  /* ---------- 엔진 빌드 선택 ---------- */
  const ENGINE_BASE = "/assets/engine/";
  const THREADED_URL = ENGINE_BASE + "stockfish-18-lite.js";
  const SINGLE_URL   = ENGINE_BASE + "stockfish-18-lite-single.js";

  const isolated = (typeof self !== "undefined" && self.crossOriginIsolated === true);
  const CORES = Math.max(1, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2);
  // 멀티스레드 빌드는 격리 환경에서만. 아니면 단일 스레드.
  let ENGINE_URL = isolated ? THREADED_URL : SINGLE_URL;
  let threaded = isolated;
  const MAIN_THREADS = threaded ? Math.max(1, Math.min(CORES, 8)) : 1;
  const MAIN_HASH = threaded ? 64 : 16;

  let worker = null;
  let ready = false;
  let initTried = false;
  let engineName = "";
  let pendingResolve = null;
  let pendingEval = null;
  let lastEval = { score: null, mate: null, best: null, depth: 0 };
  let mode = "내장 JS 엔진";

  function setting(key, dflt) {
    try { if (window.KiwiSettings) return window.KiwiSettings.get(key, dflt); } catch (e) {}
    return dflt;
  }

  /* ---------- 초기화 ---------- */
  function init() {
    return new Promise((resolve) => {
      if (initTried) { resolve(ready); return; }
      initTried = true;
      // 엔진 파일 존재 확인(정적 호스팅이 text/html 로 응답하면 실패로 간주)
      fetch(ENGINE_URL, { method: "HEAD" })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (!res.ok || ct.includes("text/html")) {
            // 멀티스레드 URL 이 없으면 단일 스레드로 한 번 더 시도
            if (ENGINE_URL !== SINGLE_URL) {
              ENGINE_URL = SINGLE_URL; threaded = false;
              return fetch(ENGINE_URL, { method: "HEAD" }).then((r2) => {
                if (!r2.ok) { mode = "백엔드/내장 엔진"; resolve(false); return; }
                spawnMain(resolve);
              }).catch(() => { mode = "백엔드/내장 엔진"; resolve(false); });
            }
            mode = "백엔드/내장 엔진"; resolve(false); return;
          }
          spawnMain(resolve);
        })
        .catch(() => { mode = "백엔드/내장 엔진"; resolve(false); });
    });
  }

  function spawnMain(resolve) {
    try {
      worker = new Worker(ENGINE_URL);
      let gotUci = false;
      // 대용량 WASM(≈7MB) 다운로드 + 컴파일 여유 있게
      const timeout = setTimeout(() => {
        if (!ready) {
          // 멀티스레드 초기화 실패 → 단일 스레드로 한 번 재시도
          if (threaded) { cleanup(); threaded = false; ENGINE_URL = SINGLE_URL; retrySingle(resolve); return; }
          cleanup(); mode = "백엔드/내장 엔진"; resolve(false);
        }
      }, 20000);
      worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("id name")) { engineName = line.slice(8).trim(); }
        else if (line.startsWith("uciok")) {
          // 엔진 옵션 설정 후 준비 확인
          if (threaded) worker.postMessage("setoption name Threads value " + MAIN_THREADS);
          worker.postMessage("setoption name Hash value " + MAIN_HASH);
          worker.postMessage("setoption name UCI_LimitStrength value false");
          worker.postMessage("setoption name MultiPV value 1");
          gotUci = true;
          worker.postMessage("isready");
        } else if (line.startsWith("readyok") && gotUci) {
          ready = true;
          mode = (engineName || "Stockfish") + (threaded ? " (WASM · " + MAIN_THREADS + " threads)" : " (WASM · 단일)");
          clearTimeout(timeout);
          resolve(true);
        } else {
          handleSearchLine(line);
        }
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        if (threaded) { cleanup(); threaded = false; ENGINE_URL = SINGLE_URL; retrySingle(resolve); return; }
        cleanup(); mode = "백엔드/내장 엔진"; resolve(false);
      };
      worker.postMessage("uci");
    } catch (err) {
      if (threaded) { cleanup(); threaded = false; ENGINE_URL = SINGLE_URL; retrySingle(resolve); return; }
      cleanup(); mode = "백엔드/내장 엔진"; resolve(false);
    }
  }

  // 멀티스레드 실패 시 단일 스레드로 폴백 스폰
  function retrySingle(resolve) {
    try {
      worker = new Worker(SINGLE_URL);
      let gotUci = false;
      const to = setTimeout(() => { if (!ready) { cleanup(); mode = "백엔드/내장 엔진"; resolve(false); } }, 20000);
      worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("id name")) engineName = line.slice(8).trim();
        else if (line.startsWith("uciok")) {
          worker.postMessage("setoption name Hash value 16");
          worker.postMessage("setoption name UCI_LimitStrength value false");
          gotUci = true; worker.postMessage("isready");
        } else if (line.startsWith("readyok") && gotUci) {
          ready = true; mode = (engineName || "Stockfish") + " (WASM · 단일)";
          clearTimeout(to); resolve(true);
        } else handleSearchLine(line);
      };
      worker.onerror = () => { clearTimeout(to); cleanup(); mode = "백엔드/내장 엔진"; resolve(false); };
      worker.postMessage("uci");
    } catch (e) { cleanup(); mode = "백엔드/내장 엔진"; resolve(false); }
  }

  // 메인 워커의 탐색 라인 처리(단일 평가 / 봇 수)
  function handleSearchLine(line) {
    if (line.startsWith("info") && line.indexOf("score") !== -1 && pendingEval) {
      if (line.indexOf("lowerbound") !== -1 || line.indexOf("upperbound") !== -1) return;
      const dM = line.match(/ depth (\d+)/);
      const d = dM ? parseInt(dM[1], 10) : 0;
      if (d < (lastEval.depth || 0)) return;
      const cpM = line.match(/score cp (-?\d+)/);
      const mateM = line.match(/score mate (-?\d+)/);
      const pvM = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (cpM) { lastEval.score = parseInt(cpM[1], 10); lastEval.mate = null; }
      if (mateM) { lastEval.mate = parseInt(mateM[1], 10); lastEval.score = null; }
      if (pvM) { lastEval.best = pvM[1]; }
      if (d) lastEval.depth = d;
    } else if (line.startsWith("bestmove")) {
      const mv = line.split(" ")[1];
      if (pendingEval) {
        const r = pendingEval; pendingEval = null;
        if (mv && mv !== "(none)" && !lastEval.best) lastEval.best = mv;
        r({ ...lastEval });
      } else if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(mv); }
    }
  }

  function cleanup() { if (worker) { try { worker.terminate(); } catch (e) {} } worker = null; ready = false; }

  function workerBestMove(fen, depth, movetime) {
    return new Promise((resolve) => {
      if (!ready || !worker) { resolve(null); return; }
      pendingResolve = resolve;
      worker.postMessage("setoption name UCI_LimitStrength value false");
      worker.postMessage("setoption name MultiPV value 1");
      worker.postMessage("position fen " + fen);
      worker.postMessage(`go depth ${depth} movetime ${movetime}`);
      setTimeout(() => { if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(null); } }, movetime + 6000);
    });
  }

  async function backendMove(fen, level, elo) {
    try { const { uci } = await API.botMove(fen, level, elo); return uci; }
    catch (e) { return null; }
  }

  /* ================================================================
   *  내장 JS 알파-베타 (WASM 로드 실패 시에만 사용)
   * ================================================================ */
  const PVAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  function staticEval(g) {
    if (g.in_checkmate()) return g.turn() === "w" ? -100000 : 100000;
    if (g.in_draw() || g.in_stalemate() || g.insufficient_material()) return 0;
    let score = 0;
    const board = g.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      score += (sq.color === "w" ? 1 : -1) * PVAL[sq.type];
    }
    return score;
  }

  function quiesce(g, alpha, beta, color, depth) {
    const standPat = color * staticEval(g);
    if (depth <= 0) return standPat;
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    const caps = g.moves({ verbose: true }).filter((m) => m.captured || m.promotion);
    if (!caps.length) return standPat;
    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    caps.sort((a, b) => (VAL[b.captured] || 0) - (VAL[a.captured] || 0));
    for (const m of caps) {
      g.move(m);
      const val = -quiesce(g, -beta, -alpha, -color, depth - 1);
      g.undo();
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;
  }

  function negamax(g, depth, alpha, beta, color) {
    if (g.game_over()) return color * staticEval(g);
    if (depth === 0) return quiesce(g, alpha, beta, color, 4);
    let best = -Infinity;
    const moves = g.moves({ verbose: true }).sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
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

  function rankMoves(fen, depth) {
    const g = new Chess(fen);
    const legal = g.moves({ verbose: true });
    const color = g.turn() === "w" ? 1 : -1;
    const ranked = [];
    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const ordered = legal.slice().sort((a, b) => {
      const ca = a.captured ? VAL[a.captured] || 0 : 0;
      const cb = b.captured ? VAL[b.captured] || 0 : 0;
      return cb - ca;
    });
    let alpha = -Infinity;
    for (const m of ordered) {
      g.move(m);
      let val;
      if (g.in_checkmate()) val = 100000;
      else val = -negamax(g, depth, -Infinity, -alpha, -color);
      g.undo();
      if (val > alpha) alpha = val;
      ranked.push({ uci: m.from + m.to + (m.promotion || ""), score: val });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  function jsBestMove(fen, depth) {
    const r = rankMoves(fen, Math.max(1, depth - 1));
    return r.length ? r[0].uci : null;
  }

  function jsEval(fen, depth) {
    const g = new Chess(fen);
    if (g.in_checkmate()) return { score: null, mate: g.turn() === "w" ? -1 : 1, best: null };
    if (g.in_stalemate() || g.in_draw()) return { score: 0, mate: null, best: null };
    const legal = g.moves({ verbose: true });
    if (!legal.length) return { score: 0, mate: null, best: null };
    // 홀짝(side-to-move) 편향 방지: 총 플라이가 짝수가 되도록 d 를 홀수로.
    let d = Math.max(1, depth | 0);
    if (d % 2 === 0) d += 1;
    const ranked = rankMoves(fen, d);
    return { score: Math.round(ranked[0].score), mate: null, best: ranked[0].uci, moverPOV: true };
  }

  /* ---------- ELO 강도 모델 (봇 대국) ---------- */
  function eloParams(elo) {
    elo = Math.max(100, Math.min(3200, elo || 1200));
    return {
      elo,
      depth: Math.max(6, Math.min(18, 6 + Math.floor(elo / 250))),
      movetime: Math.max(100, Math.min(900, 80 + Math.floor(elo / 4))),
      pErr: Math.max(0.02, Math.min(0.93, 1.15 - elo / 2400)),
      maxLoss: 30 + Math.round(1000 * Math.exp(-elo / 700)),
    };
  }

  function pickErrorMove(fen, maxLoss) {
    let ranked;
    try { ranked = rankMoves(fen, 1); } catch (e) { return null; }
    if (ranked.length < 2) return null;
    const bestScore = ranked[0].score;
    const cands = ranked.filter((r) => { const loss = bestScore - r.score; return loss > 0 && loss <= maxLoss; });
    if (!cands.length) return null;
    const T = Math.max(20, maxLoss / 2);
    const weights = cands.map((r) => Math.exp(-(bestScore - r.score) / T));
    const sum = weights.reduce((a, b) => a + b, 0);
    let x = Math.random() * sum;
    for (let i = 0; i < cands.length; i++) { x -= weights[i]; if (x <= 0) return cands[i].uci; }
    return cands[cands.length - 1].uci;
  }

  async function getMoveForElo(fen, elo, randomMoveFn) {
    const cfg = eloParams(elo);
    let best = null;
    if (ready) best = await workerBestMove(fen, cfg.depth, cfg.movetime);
    if (!best || best === "(none)") best = await backendMove(fen, null, cfg.elo);
    if (!best) best = jsBestMove(fen, 3);
    if (!best) return randomMoveFn ? randomMoveFn() : null;
    if (Math.random() < cfg.pErr) {
      const err = pickErrorMove(fen, cfg.maxLoss);
      if (err) return err;
    }
    return best;
  }

  async function getBestMove(fen, bot, randomMoveFn) {
    const elo = (bot && (bot.customElo || bot.approx_rating)) || 1200;
    return getMoveForElo(fen, elo, randomMoveFn);
  }

  /* ================================================================
   *  단일 평가 (분석 보드 실시간) — 백 관점, tempo 편향 없음
   * ================================================================ */
  const evalCache = new Map();
  const EVAL_CACHE_MAX = 400;
  function cacheGet(fen, depth) { const hit = evalCache.get(fen); return (hit && hit.depth >= depth) ? hit : null; }
  function cachePut(fen, val) {
    if (evalCache.size >= EVAL_CACHE_MAX) { evalCache.delete(evalCache.keys().next().value); }
    evalCache.set(fen, val);
  }

  async function evaluate(fen) {
    const depth = setting("evalDepth", 16);
    const turn = fen.split(" ")[1] === "b" ? -1 : 1;

    const cached = cacheGet(fen, depth);
    if (cached) return { ...cached };

    if (ready) {
      lastEval = { score: null, mate: null, best: null, depth: 0 };
      const capMs = 8000;
      const r = await new Promise((resolve) => {
        pendingEval = resolve;
        worker.postMessage("setoption name MultiPV value 1");
        worker.postMessage("setoption name UCI_LimitStrength value false");
        worker.postMessage("position fen " + fen);
        worker.postMessage(`go depth ${depth}`);
        setTimeout(() => { if (pendingEval) { const x = pendingEval; pendingEval = null; x({ ...lastEval }); } }, capMs);
      });
      if (r) {
        const out = { best: r.best, score: null, mate: null, depth: r.depth || 0, engine: "stockfish" };
        // UCI score 는 차례 관점 → 백 관점 변환(부호). tempo 보정 없음.
        if (r.mate != null) out.mate = turn === 1 ? r.mate : -r.mate;
        else if (r.score != null) out.score = turn === 1 ? r.score : -r.score;
        cachePut(fen, out);
        return { ...out };
      }
    }

    const r = jsEval(fen, 1);
    if (r.mate == null && r.score != null && r.moverPOV) r.score = turn === 1 ? r.score : -r.score;
    r.depth = 2; r.engine = "js";
    cachePut(fen, r);
    return { ...r };
  }

  /* ================================================================
   *  병렬 리뷰 평가 (워커 풀) — 위치 단위 병렬, 각 워커 단일 스레드
   * ================================================================ */
  function spawnEvalWorker() {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(ENGINE_URL); } catch (e) { resolve(null); return; }
      let gotUci = false;
      const to = setTimeout(() => { try { w.terminate(); } catch (e) {} resolve(null); }, 20000);
      w.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("uciok")) {
          // 풀 워커는 위치 단위 병렬이므로 각자 1스레드·소용량 해시
          w.postMessage("setoption name Threads value 1");
          w.postMessage("setoption name Hash value 16");
          w.postMessage("setoption name UCI_LimitStrength value false");
          gotUci = true; w.postMessage("isready");
        } else if (line.startsWith("readyok") && gotUci) { clearTimeout(to); w.onmessage = null; resolve(w); }
      };
      w.onerror = () => { clearTimeout(to); resolve(null); };
      w.postMessage("uci");
    });
  }

  /**
   * 리뷰용 정밀 분석 — MultiPV 2 로 1·2순위 수와 평가를 함께 얻는다.
   * 반환: [{ cp, best, second, bestCpStm, secondCpStm, mate, mateStm, depth }]
   *   - cp        : 백 관점 평가 (tempo 편향 없음)
   *   - bestCpStm : 차례인 쪽 관점 1순위 평가 (승률 계산용)
   */
  async function reviewEvaluateMulti(fens, onProgress) {
    const depth = setting("reviewDepth", threaded ? 18 : 15);
    const results = new Array(fens.length).fill(null);
    let done = 0;

    if (ready) {
      let poolSize = setting("reviewWorkers", 0);
      if (!poolSize) poolSize = Math.max(1, Math.min(threaded ? CORES : (CORES - 1), 6));
      const spawns = [];
      for (let i = 0; i < poolSize; i++) spawns.push(spawnEvalWorker());
      const pool = (await Promise.all(spawns)).filter(Boolean);
      if (pool.length) {
        let next = 0;
        const runner = async (w) => {
          for (;;) {
            const i = next++;
            if (i >= fens.length) break;
            results[i] = await multiOnWorker(w, fens[i], depth);
            done++;
            if (onProgress) onProgress(done, fens.length);
          }
        };
        await Promise.all(pool.map(runner));
        pool.forEach((w) => { try { w.terminate(); } catch (e) {} });
        return results;
      }
    }

    // 폴백: 내장 엔진 (MultiPV 없음)
    for (let i = 0; i < fens.length; i++) {
      const turn = fens[i].split(" ")[1] === "b" ? -1 : 1;
      const r = jsEval(fens[i], 1);
      const whiteCp = (r.mate == null && r.score != null && r.moverPOV)
        ? (turn === 1 ? r.score : -r.score) : (r.score || 0);
      results[i] = {
        cp: whiteCp, bestCpStm: turn === 1 ? whiteCp : -whiteCp, secondCpStm: null,
        best: r.best || null, second: null,
        mate: r.mate != null ? r.mate : null, mateStm: null, depth: 2,
      };
      done++;
      if (onProgress) onProgress(done, fens.length);
    }
    return results;
  }

  function multiOnWorker(w, fen, depth) {
    return new Promise((resolve) => {
      const wtm = fen.split(" ")[1] !== "b";
      const pvs = {};
      const to = setTimeout(() => { w.onmessage = null; resolve(pack()); }, 20000);

      function pack() {
        const p1 = pvs[1] || {};
        const p2 = pvs[2] || null;
        const cpStm = p1.cpStm != null ? p1.cpStm : 0;          // 차례 관점
        const whiteCp = wtm ? cpStm : -cpStm;                   // 백 관점(부호 변환만)
        return {
          cp: whiteCp,
          bestCpStm: p1.cpStm != null ? p1.cpStm : null,
          secondCpStm: p2 && p2.cpStm != null ? p2.cpStm : null,
          best: p1.move || null,
          second: p2 ? p2.move : null,
          mate: p1.mate != null ? (wtm ? p1.mate : -p1.mate) : null,
          mateStm: p1.mate != null ? p1.mate : null,
          depth: p1.depth || 0,
        };
      }

      w.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("bestmove")) { clearTimeout(to); w.onmessage = null; resolve(pack()); return; }
        if (!line.startsWith("info") || line.indexOf("score") === -1) return;
        if (line.indexOf("lowerbound") !== -1 || line.indexOf("upperbound") !== -1) return;
        const dM = line.match(/ depth (\d+)/);
        const d = dM ? parseInt(dM[1], 10) : 0;
        const pvM = line.match(/ multipv (\d+)/);
        const pv = pvM ? parseInt(pvM[1], 10) : 1;
        const mvM = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
        if (!d || !mvM) return;
        if (pvs[pv] && pvs[pv].depth > d) return;
        const cpM = line.match(/score cp (-?\d+)/);
        const mtM = line.match(/score mate (-?\d+)/);
        let cpStm = null, mate = null;
        if (cpM) { cpStm = parseInt(cpM[1], 10); }             // tempo 보정 없음
        else if (mtM) { mate = parseInt(mtM[1], 10); cpStm = mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100; }
        pvs[pv] = { depth: d, cpStm, move: mvM[1], mate };
      };

      w.postMessage("setoption name MultiPV value 2");
      w.postMessage("setoption name UCI_LimitStrength value false");
      w.postMessage("position fen " + fen);
      w.postMessage("go depth " + depth);
    });
  }

  // (호환) 단일 PV 리뷰 — 일부 구버전 호출 대비. 내부적으로 Multi 를 재사용.
  async function reviewEvaluate(fens, onProgress) {
    const multi = await reviewEvaluateMulti(fens, onProgress);
    return multi.map((m) => ({
      best: m.best,
      score: m.mate != null ? null : m.cp,
      mate: m.mate != null ? m.mate : null,
      depth: m.depth,
    }));
  }

  function usingWasm() { return ready; }
  function usingThreads() { return ready && threaded; }
  function describe() { return mode; }

  return {
    init, getBestMove, getMoveForElo, evaluate, reviewEvaluate, reviewEvaluateMulti,
    eloParams, usingWasm, usingThreads, describe,
  };
})();
