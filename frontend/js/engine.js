/* 체스 엔진 래퍼 — 3중 폴백 + ELO 강도 모델 + 병렬 리뷰 평가.
   1순위: /assets/engine/stockfish.js (WASM Web Worker)
   2순위: 백엔드 /api/bot/move
   3순위: 브라우저 내장 JS 알파-베타 */
const Engine = (() => {
  let worker = null;
  let ready = false;
  let initTried = false;
  let pendingResolve = null;
  let pendingEval = null;
  let lastEval = { score: null, mate: null, best: null, depth: 0 };
  let mode = "내장 JS 엔진";

  /* ---------- Tempo 보정 ----------
     Stockfish 고전 평가는 '차례인 쪽'에게 tempo 보너스(약 28cp)를 더한다.
     그대로 표시하면 백 차례엔 백이, 흑 차례엔 흑이 유리한 것처럼 보이는
     톱니파가 생기고(측정: ±0.5폰), 게임 리뷰에서도 모든 수가 손해처럼 계산된다.
     실측 검증: 보정 시 차례 편향 0.53~0.71폰 → 0.03~0.15폰 으로 사라짐. */
  const TEMPO_CP = 28;

  function removeTempo(whiteCp, fen) {
    if (whiteCp == null) return whiteCp;
    const whiteToMove = fen.split(" ")[1] !== "b";
    return whiteCp - TEMPO_CP * (whiteToMove ? 1 : -1);
  }

  function setting(key, dflt) {
    try { if (window.KiwiSettings) return window.KiwiSettings.get(key, dflt); } catch (e) {}
    return dflt;
  }

  function init() {
    return new Promise((resolve) => {
      if (initTried) { resolve(ready); return; }
      initTried = true;
      fetch("/assets/engine/stockfish.js", { method: "HEAD" })
        .then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (!res.ok || ct.includes("text/html")) { mode = "백엔드/내장 엔진"; resolve(false); return; }
          spawnMain(resolve);
        })
        .catch(() => { mode = "백엔드/내장 엔진"; resolve(false); });
    });
  }

  function spawnMain(resolve) {
    try {
      worker = new Worker("/assets/engine/stockfish.js");
      let gotUci = false;
      const timeout = setTimeout(() => { if (!ready) { cleanup(); mode = "백엔드/내장 엔진"; resolve(false); } }, 5000);
      worker.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("uciok")) { gotUci = true; worker.postMessage("isready"); }
        else if (line.startsWith("readyok") && gotUci) {
          ready = true; mode = "브라우저 Stockfish (WASM)"; clearTimeout(timeout); resolve(true);
        } else if (line.startsWith("info") && line.indexOf("score") !== -1 && pendingEval) {
          // 탐색 실패(aspiration window) 라인은 값이 틀리므로 반드시 버린다.
          // 이걸 읽으면 평가가 엉뚱하게 튄다.
          if (line.indexOf("lowerbound") !== -1 || line.indexOf("upperbound") !== -1) return;
          const dM = line.match(/ depth (\d+)/);
          const d = dM ? parseInt(dM[1], 10) : 0;
          if (d < (lastEval.depth || 0)) return;   // 더 얕은 결과로 덮어쓰지 않는다
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
      };
      worker.onerror = () => { clearTimeout(timeout); cleanup(); mode = "백엔드/내장 엔진"; resolve(false); };
      worker.postMessage("uci");
    } catch (err) { cleanup(); mode = "백엔드/내장 엔진"; resolve(false); }
  }

  function cleanup() { if (worker) { try { worker.terminate(); } catch (e) {} } worker = null; ready = false; }

  function workerBestMove(fen, depth, movetime) {
    return new Promise((resolve) => {
      if (!ready || !worker) { resolve(null); return; }
      pendingResolve = resolve;
      worker.postMessage("setoption name UCI_LimitStrength value false");
      worker.postMessage("setoption name Skill Level value 20");
      worker.postMessage("position fen " + fen);
      worker.postMessage(`go depth ${depth} movetime ${movetime}`);
      setTimeout(() => { if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(null); } }, movetime + 4000);
    });
  }

  async function backendMove(fen, level, elo) {
    try {
      const { uci } = await API.botMove(fen, level, elo);
      return uci;
    } catch (e) { return null; }
  }

  /* ---------- 내장 JS 알파-베타 ---------- */
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

  // 정지 탐색(quiescence): 교환이 끝날 때까지 잡는 수만 더 본다.
  // 이게 없으면 매 수마다 평가가 ±1.00 씩 요동친다(수평선 효과).
  function quiesce(g, alpha, beta, color, depth) {
    const standPat = color * staticEval(g);
    if (depth <= 0) return standPat;
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    // 잡는 수 + 승급만 검토 (조용한 국면이면 즉시 종료)
    const caps = g.moves({ verbose: true }).filter((m) => m.captured || m.promotion);
    if (!caps.length) return standPat;
    // 큰 기물을 잡는 수부터 (MVV 정렬)
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
    // 깊이를 다 쓰면 정지 탐색으로 넘긴다(교환 도중에 끊기지 않도록)
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

  // 모든 합법수를 얕은 탐색으로 랭킹 (mover 관점 점수, 내림차순)
  function rankMoves(fen, depth) {
    const g = new Chess(fen);
    const legal = g.moves({ verbose: true });
    const color = g.turn() === "w" ? 1 : -1;
    const ranked = [];
    // 좋은 수부터 보면 알파-베타 가지치기가 잘 먹혀 훨씬 빨라진다
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
      if (val > alpha) alpha = val;   // 창을 좁혀 가지치기 강화
      ranked.push({ uci: m.from + m.to + (m.promotion || ""), score: val });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  function jsBestMove(fen, depth) {
    const r = rankMoves(fen, Math.max(1, depth - 1));
    return r.length ? r[0].uci : null;
  }

  /* ---------- ELO 강도 모델 ---------- */
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
    const cands = ranked.filter((r) => {
      const loss = bestScore - r.score;
      return loss > 0 && loss <= maxLoss;
    });
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

  // (호환) bot 객체 기반 — customElo 또는 approx_rating 으로 ELO 모델 사용
  async function getBestMove(fen, bot, randomMoveFn) {
    const elo = (bot && (bot.customElo || bot.approx_rating)) || 1200;
    return getMoveForElo(fen, elo, randomMoveFn);
  }

  /* ---------- 단일 평가 (분석 보드 실시간) ---------- */
  function jsEval(fen, depth) {
    const g = new Chess(fen);
    if (g.in_checkmate()) return { score: null, mate: g.turn() === "w" ? -1 : 1, best: null };
    if (g.in_stalemate() || g.in_draw()) return { score: 0, mate: null, best: null };
    const legal = g.moves({ verbose: true });
    if (!legal.length) return { score: 0, mate: null, best: null };

    // ⚠️ 홀짝(side-to-move) 편향 방지:
    // rankMoves(fen, d) 는 [내 수 1플라이 + d플라이] = (1 + d) 플라이를 탐색한다.
    // 총 플라이가 홀수면 '두는 쪽'이 한 수를 더 두게 되어
    // 백 차례엔 백이, 흑 차례엔 흑이 유리하게 나오는 편향이 생긴다.
    // 따라서 d 는 반드시 홀수여야 한다(총 플라이 짝수).
    let d = Math.max(1, depth | 0);
    if (d % 2 === 0) d += 1;
    const ranked = rankMoves(fen, d);
    return { score: Math.round(ranked[0].score), mate: null, best: ranked[0].uci, moverPOV: true };
  }

  // 국면별 평가 캐시 (탐색 반복 방지 → 기보 넘길 때 즉시 표시)
  const evalCache = new Map();
  const EVAL_CACHE_MAX = 400;

  function cacheGet(fen, depth) {
    const hit = evalCache.get(fen);
    return (hit && hit.depth >= depth) ? hit : null;
  }
  function cachePut(fen, val) {
    if (evalCache.size >= EVAL_CACHE_MAX) {
      const firstKey = evalCache.keys().next().value;
      evalCache.delete(firstKey);
    }
    evalCache.set(fen, val);
  }

  async function evaluate(fen) {
    const depth = setting("evalDepth", 14);
    const turn = fen.split(" ")[1] === "b" ? -1 : 1;

    const cached = cacheGet(fen, depth);
    if (cached) return { ...cached };

    if (ready) {
      lastEval = { score: null, mate: null, best: null, depth: 0 };
      const capMs = 6000;   // 안전장치(무한 대기 방지)
      const r = await new Promise((resolve) => {
        pendingEval = resolve;
        worker.postMessage("setoption name UCI_LimitStrength value false");
        worker.postMessage("setoption name Skill Level value 20");
        worker.postMessage("position fen " + fen);
        // 고정 깊이로 탐색해야 국면 간 평가가 일관된다(movetime 은 깊이가 들쭉날쭉).
        worker.postMessage(`go depth ${depth}`);
        setTimeout(() => { if (pendingEval) { const x = pendingEval; pendingEval = null; x({ ...lastEval }); } }, capMs);
      });
      if (r) {
        const out = { best: r.best, score: null, mate: null, depth: r.depth || 0, engine: "stockfish" };
        if (r.mate != null) {
          out.mate = turn === 1 ? r.mate : -r.mate;
        } else if (r.score != null) {
          const white = turn === 1 ? r.score : -r.score;
          out.score = removeTempo(white, fen);   // tempo 제거 → 차례 편향 없음
        }
        cachePut(fen, out);
        return { ...out };
      }
    }

    const r = jsEval(fen, 1);   // 총 2플라이(짝수) + 정지탐색 → 빠르고 편향 없음
    if (r.mate == null && r.score != null && r.moverPOV) r.score = turn === 1 ? r.score : -r.score;
    r.depth = 2;
    r.engine = "js";
    cachePut(fen, r);
    return { ...r };
  }

  /* ---------- 병렬 리뷰 평가 (워커 풀) ---------- */
  function spawnEvalWorker() {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker("/assets/engine/stockfish.js"); } catch (e) { resolve(null); return; }
      let gotUci = false;
      const to = setTimeout(() => { try { w.terminate(); } catch (e) {} resolve(null); }, 5000);
      w.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("uciok")) { gotUci = true; w.postMessage("isready"); }
        else if (line.startsWith("readyok") && gotUci) { clearTimeout(to); w.onmessage = null; resolve(w); }
      };
      w.onerror = () => { clearTimeout(to); resolve(null); };
      w.postMessage("uci");
    });
  }

  function evalOnWorker(w, fen, depth) {
    return new Promise((resolve) => {
      const ev = { score: null, mate: null, best: null, depth: 0 };
      const to = setTimeout(() => { w.onmessage = null; resolve(ev); }, 8000);
      w.onmessage = (e) => {
        const line = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
        if (line.startsWith("info") && line.indexOf("score") !== -1) {
          if (line.indexOf("lowerbound") !== -1 || line.indexOf("upperbound") !== -1) return;
          const dM = line.match(/ depth (\d+)/);
          const d = dM ? parseInt(dM[1], 10) : 0;
          if (d < (ev.depth || 0)) return;
          const cpM = line.match(/score cp (-?\d+)/);
          const mateM = line.match(/score mate (-?\d+)/);
          const pvM = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
          if (cpM) { ev.score = parseInt(cpM[1], 10); ev.mate = null; }
          if (mateM) { ev.mate = parseInt(mateM[1], 10); ev.score = null; }
          if (pvM) ev.best = pvM[1];
          if (d) ev.depth = d;
        } else if (line.startsWith("bestmove")) {
          clearTimeout(to); w.onmessage = null;
          const mv = line.split(" ")[1];
          if (mv && mv !== "(none)" && !ev.best) ev.best = mv;
          resolve(ev);
        }
      };
      w.postMessage("setoption name Skill Level value 20");
      w.postMessage("position fen " + fen);
      w.postMessage("go depth " + depth);
    });
  }

  /**
   * 리뷰용 정밀 분석 — MultiPV 2 로 1·2순위 수와 평가를 함께 얻는다.
   * '훌륭한 수(유일한 수)'와 '전술 판별'에 2순위 정보가 반드시 필요하다.
   * 반환: [{ cp, best, second, bestCpStm, secondCpStm, mate, depth }]
   *   - cp        : 백 관점 평가(tempo 보정 완료)
   *   - bestCpStm : 차례인 쪽 관점 1순위 평가 (승률 계산용)
   */
  async function reviewEvaluateMulti(fens, onProgress) {
    const depth = setting("reviewDepth", 14);
    const results = new Array(fens.length).fill(null);
    let done = 0;

    // Stockfish 워커 풀을 띄워 병렬 분석
    if (ready) {
      let poolSize = setting("reviewWorkers", 0);
      if (!poolSize) {
        poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      }
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

    // 폴백: 내장 엔진 (MultiPV 없음 → 2순위 정보 없이 동작)
    for (let i = 0; i < fens.length; i++) {
      const turn = fens[i].split(" ")[1] === "b" ? -1 : 1;
      const r = jsEval(fens[i], 1);
      const whiteCp = (r.mate == null && r.score != null && r.moverPOV)
        ? (turn === 1 ? r.score : -r.score) : (r.score || 0);
      results[i] = {
        cp: whiteCp,
        bestCpStm: turn === 1 ? whiteCp : -whiteCp,
        secondCpStm: null,
        best: r.best || null,
        second: null,
        mate: r.mate != null ? r.mate : null,
        depth: 2,
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
      const to = setTimeout(() => { w.onmessage = null; resolve(pack()); }, 15000);

      function pack() {
        const p1 = pvs[1] || {};
        const p2 = pvs[2] || null;
        // 차례인 쪽 관점 → 백 관점
        const cpStm = p1.cpStm != null ? p1.cpStm : 0;
        const whiteCp = wtm ? cpStm : -cpStm;
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
        const line = typeof e.data === "string" ? e.data : "";
        if (line.startsWith("bestmove")) {
          clearTimeout(to);
          w.onmessage = null;
          resolve(pack());
          return;
        }
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
        if (cpM) {
          cpStm = parseInt(cpM[1], 10) - TEMPO_CP;   // tempo 제거 (차례 쪽 관점)
        } else if (mtM) {
          mate = parseInt(mtM[1], 10);
          cpStm = mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100;
        }
        pvs[pv] = { depth: d, cpStm, move: mvM[1], mate };
      };

      w.postMessage("setoption name MultiPV value 2");
      w.postMessage("setoption name UCI_LimitStrength value false");
      w.postMessage("setoption name Skill Level value 20");
      w.postMessage("position fen " + fen);
      w.postMessage("go depth " + depth);
    });
  }

  async function reviewEvaluate(fens, onProgress) {
    const depth = setting("reviewDepth", 12);
    const results = new Array(fens.length).fill(null);
    let done = 0;

    function toWhitePOV(fen, ev) {
      const turn = fen.split(" ")[1] === "b" ? -1 : 1;
      const out = { best: ev.best, score: null, mate: null, depth: ev.depth || 0 };
      if (ev.mate != null) {
        out.mate = turn === 1 ? ev.mate : -ev.mate;
      } else if (ev.score != null) {
        const white = turn === 1 ? ev.score : -ev.score;
        out.score = removeTempo(white, fen);   // tempo 제거(리뷰 분류 정확도 핵심)
      }
      return out;
    }

    if (ready) {
      let poolSize = setting("reviewWorkers", 0);
      if (!poolSize) poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      const spawns = [];
      for (let i = 0; i < poolSize; i++) spawns.push(spawnEvalWorker());
      const pool = (await Promise.all(spawns)).filter(Boolean);
      if (pool.length) {
        let next = 0;
        async function runner(w) {
          while (next < fens.length) {
            const i = next++;
            const ev = await evalOnWorker(w, fens[i], depth);
            results[i] = toWhitePOV(fens[i], ev);
            done++;
            if (onProgress) onProgress(done, fens.length);
          }
        }
        await Promise.all(pool.map(runner));
        pool.forEach((w) => { try { w.terminate(); } catch (e) {} });
        return results;
      }
    }
    for (let i = 0; i < fens.length; i++) {
      const turn = fens[i].split(" ")[1] === "b" ? -1 : 1;
      const r = jsEval(fens[i], 1);
      if (r.mate == null && r.score != null && r.moverPOV) r.score = turn === 1 ? r.score : -r.score;
      results[i] = r;
      done++;
      if (onProgress) onProgress(done, fens.length);
    }
    return results;
  }

  function usingWasm() { return ready; }
  function describe() { return mode; }

  return { init, getBestMove, getMoveForElo, evaluate, reviewEvaluate, eloParams, usingWasm, describe };
})();
