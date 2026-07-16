/* analysis.html — 분석 보드 + 게임 리뷰 (승률 기반 분류, 정확도/예상ELO, 평가 그래프) */
(function () {
  const $ = (id) => document.getElementById(id);

  let board = null;
  let tapHandle = null;
  let game = new Chess();
  let mainline = [];             // [{san, uci, fenAfter}]
  let ply = 0;
  let orientation = "white";
  let evals = [];                // evals[i] = {cp, best, terminal} 백관점
  let classifications = [];
  let winPcts = [];              // winPcts[i] = 백 승률 %
  let reviewing = false;
  let startFen = new Chess().fen();
  let lastDepth = 0;
  let reviewColor = null;   // 최근 게임 리뷰 시 내 색
  let reviewGameId = null;
  let moveData = [];        // 수별 상세 데이터 (통찰용)
  let reviewStats = null;
  let reviewCounts = null;

  // 11단계 분류 (chess.com / 나무위키 표기)
  const CLASS_INFO = {
    brilliant:  { ko: "탁월한 수",     color: "#1bb7a6", icon: "!!", fx: true },
    great:      { ko: "훌륭한 수",     color: "#3aa0ff", icon: "!",  fx: true },
    best:       { ko: "최선의 수",     color: "#2e9b53", icon: "★" },
    excellent:  { ko: "뛰어난 수",     color: "#5aa832", icon: "✓" },
    good:       { ko: "좋은 수",       color: "#9bbf5a", icon: "✓" },
    book:       { ko: "이론에 있는 수", color: "#a98b6a", icon: "📖" },
    forced:     { ko: "강제",          color: "#8a97a6", icon: "=" },
    inaccuracy: { ko: "부정확한 수",   color: "#e0a526", icon: "?!" },
    mistake:    { ko: "실수",          color: "#e07b39", icon: "?" },
    missed:     { ko: "놓친 수",       color: "#d96b8a", icon: "×" },
    blunder:    { ko: "블런더",        color: "#c0392b", icon: "??" },
  };
  const BOOK_PLIES = 10;
  const PVAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const MATE = 100000;

  // ---------- 보드 ----------
  function buildBoard(fen) {
    if (board) board.destroy();
    board = Chessboard("analysis-board", {
      draggable: !TapMove.isTouch(),
      position: fen || "start",
      orientation,
      pieceTheme: window.kiwiPieceTheme,
      onDragStart, onDrop, onSnapEnd,
    });
    if (tapHandle) tapHandle.clear();
    tapHandle = TapMove.attach({
      boardId: "analysis-board",
      getGame: () => game,
      canMove: () => ply === mainline.length,
      getMoverColor: () => game.turn(),
      doMove: (from, to) => { userMove(from, to); },
    });
  }

  function onDragStart(source, piece) {
    if (ply !== mainline.length) return false;
    if ((game.turn() === "w" && piece.search(/^b/) !== -1) ||
        (game.turn() === "b" && piece.search(/^w/) !== -1)) return false;
  }
  function onDrop(source, target) { return userMove(source, target) ? undefined : "snapback"; }
  function onSnapEnd() { board.position(game.fen()); }

  function userMove(from, to) {
    if (ply !== mainline.length) return false;
    const mv = game.move({ from, to, promotion: "q" });
    if (!mv) { Sounds.play("illegal"); return false; }
    if (tapHandle) tapHandle.clear();
    mainline.push({ san: mv.san, uci: from + to + (mv.promotion || ""), fenAfter: game.fen() });
    ply = mainline.length;
    evals = []; classifications = []; winPcts = [];
    $("reviewSummary").classList.add("hidden");
    $("evalGraph").innerHTML = "";
    board.position(game.fen());
    Sounds.playForMove(mv, game.in_check());
    renderMoves();
    evalCurrent();
    return true;
  }

  function fenAtPly(p) { return p === 0 ? startFen : mainline[p - 1].fenAfter; }

  function gotoPly(p) {
    p = Math.max(0, Math.min(mainline.length, p));
    ply = p;
    const fen = fenAtPly(p);
    game = new Chess(fen);
    if (tapHandle) tapHandle.clear();
    board.position(fen);
    renderMoves();
    renderGraphCursor();
    evalCurrent();
    maybeCelebrate(p);
  }

  // ---------- 승률/평가 ----------
  function cpToWinPct(cp) {
    // lichess 공식: Win% = 50 + 50*(2/(1+exp(-0.00368208*cp)) - 1)
    const c = Math.max(-3000, Math.min(3000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }
  function evalCp(ev) {
    if (!ev) return 0;
    return ev.cp != null ? ev.cp : 0;
  }
  function scoreToText(cp) {
    // cp 인코딩: 백이 N수 후 메이트 → MATE - N*100 / 흑이 N수 후 메이트 → -MATE + N*100
    // 이미 외통난 국면은 정확히 ±MATE (N=0)
    if (cp >= MATE - 5000) {
      const n = Math.round((MATE - cp) / 100);
      return n <= 0 ? "#" : "+M" + n;
    }
    if (cp <= -MATE + 5000) {
      const n = Math.round((cp + MATE) / 100);
      return n <= 0 ? "#" : "-M" + n;
    }
    const v = cp / 100;
    return (v >= 0 ? "+" : "") + v.toFixed(2);
  }
  function renderEvalBar(cp) {
    $("evalWhite").style.height = cpToWinPct(cp) + "%";
  }

  async function evalCurrent() {
    const fen = game.fen();
    // 리뷰 완료 상태면 저장된 평가 재사용 (재계산 없음 → 즉시)
    if (evals.length === mainline.length + 1 && evals[ply]) {
      const e = evals[ply];
      const d = e.depth ? `  (depth ${e.depth})` : "";
      $("evalText").textContent = "평가: " + scoreToText(e.cp) + d + (e.best ? "   최선수: " + e.best : "");
      renderEvalBar(e.cp);
      return;
    }
    $("evalText").textContent = "분석 중…";
    const g = new Chess(fen);
    let cp, best = null;
    if (g.in_checkmate()) cp = g.turn() === "w" ? -MATE : MATE;
    else if (g.in_stalemate() || g.in_draw()) cp = 0;
    else {
      const ev = await Engine.evaluate(fen);
      if (ev && ev.mate != null) cp = ev.mate > 0 ? MATE - ev.mate * 100 : -MATE - ev.mate * 100;
      else cp = (ev && ev.score != null) ? ev.score : 0;
      best = ev && ev.best;
      lastDepth = (ev && ev.depth) || 0;
    }
    const depthTxt = lastDepth ? `  (depth ${lastDepth})` : "";
    $("evalText").textContent =
      "평가: " + scoreToText(cp) + depthTxt + (best ? "   최선수: " + best : "");
    renderEvalBar(cp);
    if (best && ply === mainline.length) $("bestLine").textContent = "엔진 추천: " + best;
  }

  // ---------- 기보 (모바일 스크롤 버그 수정: 컨테이너 내부만 스크롤) ----------
  function renderMoves() {
    const box = $("analysisMoves");
    if (!mainline.length) { box.innerHTML = '<p class="muted">아직 수가 없습니다.</p>'; return; }
    let html = "";
    for (let i = 0; i < mainline.length; i += 2) {
      html += `<span class="mv-num">${i / 2 + 1}.</span>` + moveSpan(i);
      if (i + 1 < mainline.length) html += moveSpan(i + 1);
      html += " ";
    }
    box.innerHTML = html;
    const cur = box.querySelector(`[data-ply="${ply}"]`);
    if (cur) {
      // scrollIntoView 는 페이지 전체를 스크롤시킴(모바일 버그) → 컨테이너만 스크롤
      box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
    }
  }

  function moveSpan(i) {
    const m = mainline[i];
    const cls = classifications[i];
    const info = cls ? CLASS_INFO[cls] : null;
    const active = (i + 1 === ply) ? " mv-active" : "";
    let badge = "";
    if (info) {
      const fxCls = info.fx ? " mv-fx" : "";
      badge = `<sup class="mv-badge${fxCls}" style="color:${info.color}" title="${info.ko}">${info.icon}</sup>`;
    }
    return `<span class="mv${active}" data-ply="${i + 1}">${m.san}${badge}</span> `;
  }
  // CSP(script-src 'self')는 인라인 onclick 을 차단하므로 이벤트 위임을 쓴다.
  $("analysisMoves").addEventListener("click", (e) => {
    const el = e.target.closest("[data-ply]");
    if (!el) return;
    const p = parseInt(el.getAttribute("data-ply"), 10);
    if (!isNaN(p)) gotoPly(p);
  });

  function maybeCelebrate(p) {
    if (p < 1) return;
    if (window.KiwiSettings && !KiwiSettings.get("celebrateFx", true)) return;
    const cls = classifications[p - 1];
    if (cls === "brilliant" || cls === "great") {
      const info = CLASS_INFO[cls];
      const fx = document.createElement("div");
      fx.className = "celebrate";
      fx.style.color = info.color;
      fx.innerHTML = `<span>${info.icon}</span><b>${info.ko}</b>`;
      document.body.appendChild(fx);
      setTimeout(() => fx.remove(), 1400);
      try { Sounds.play(cls === "brilliant" ? "win" : "move"); } catch (e) {}
    }
  }

  // ---------- 게임 리뷰 ----------
  function terminalEval(fen) {
    const g = new Chess(fen);
    if (g.in_checkmate()) return { cp: g.turn() === "w" ? -MATE : MATE, best: null, terminal: true };
    if (g.in_stalemate() || g.in_draw() || g.insufficient_material()) return { cp: 0, best: null, terminal: true };
    return null;
  }

  function material(fen, color) {
    const g = new Chess(fen);
    const b = g.board();
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      s += (p.color === color ? 1 : -1) * (PVAL[p.type] || 0);
    }
    return s;
  }

  function isSacrifice(i, moverColor, afterMoverWin) {
    try {
      const before = material(fenAtPly(i), moverColor);
      const afterOurMove = fenAtPly(i + 1);
      const oppBest = evals[i + 1] && evals[i + 1].best;
      let resultFen = afterOurMove;
      if (oppBest) {
        const g = new Chess(afterOurMove);
        const m = g.move({ from: oppBest.slice(0, 2), to: oppBest.slice(2, 4), promotion: oppBest[4] || "q" });
        if (m) resultFen = g.fen();
      }
      const after = material(resultFen, moverColor);
      return (before - after) >= 1.5 && afterMoverWin >= 45;
    } catch (e) { return false; }
  }

  // 승률(%) 하락 기반 + 절대 물질 손실 가드로 분류
  // drop: 승률 하락(%), cpDrop: 절대 센티폰 손실(mover 관점), legalCount: 합법수 개수,
  // hadMate: 두기 전 mover가 강제 메이트 보유, gaveMate: 이 수로 mover가 외통
  function classifyMove(ctx) {
    const { i, drop, cpDrop, isBest, beforeWin, afterWin, moverColor,
            gaveMate, hadMate, stillMate, legalCount, isBook } = ctx;

    // 강제: 합법수가 하나뿐 (선택지가 없음) — 실력과 무관
    if (legalCount === 1) return "forced";

    // 이 수로 외통 → 최고/뛰어난 수
    if (gaveMate) return isBest ? "best" : "excellent";

    // 이론(오프닝): 오프닝 DB(3,800종)에 있는 국면이면 무조건 이론
    // — 평가 엔진이 부정확해도 Italian Game 같은 정석이 '부정확함'으로 찍히지 않는다.
    if (isBook) return "book";

    // 놓친 수: 강제 메이트를 갖고 있었는데 **메이트 기회를 날린** 경우만.
    //   메이트 수순대로 잘 두고 있으면(M3 → M2) 여전히 메이트이므로 놓친 수가 아니다.
    if (hadMate && !gaveMate && !stillMate && afterWin >= 45) return "missed";
    // 놓친 수: 확실히 이기고 있었는데(85%+) 큰 이점을 날림 — 단, 아직 안 짐
    if (beforeWin >= 85 && drop >= 12 && afterWin >= 50 && !stillMate) return "missed";

    // 탁월/훌륭 (최선수일 때만)
    if (isBest && drop <= 2 && cpDrop <= 40 && isSacrifice(i, moverColor, afterWin)) return "brilliant";
    if (isBest && drop <= 1 && legalCount <= 3 && beforeWin >= 30 && beforeWin <= 70 && afterWin >= 45) return "great";

    // 최선수면 최고 (엔진이 동의하므로 통하는 희생도 최고)
    if (isBest) return "best";

    // 승률 하락 기준 1차 등급
    let tier;
    if (drop <= 1) tier = "best";
    else if (drop <= 3) tier = "excellent";
    else if (drop <= 7) tier = "good";
    else if (drop <= 12) tier = "inaccuracy";
    else if (drop <= 22) tier = "mistake";
    else tier = "blunder";

    // 물질 손실 가드: 최선수가 아닌데 실질적 기물/이점을 내줬다면
    // (매우 이기거나 지고 있어 승률 변화가 작아도) 최소 등급을 강제한다.
    // → "이기고 있을 때 기물 헌납이 최고로 뜨는" 문제 방지
    const RANK = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];
    function atLeast(t) { return RANK.indexOf(tier) < RANK.indexOf(t) ? t : tier; }
    if (cpDrop >= 700) tier = atLeast("blunder");   // 룩+ 급 손실
    else if (cpDrop >= 300) tier = atLeast("mistake"); // 마이너피스 급 손실
    else if (cpDrop >= 150) tier = atLeast("inaccuracy");

    return tier;
  }

  // 수당 정확도 (lichess CAPS 근사) → 게임 정확도 & 예상 ELO
  function moveAccuracy(drop) {
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
  }
  function estimateElo(avgDrop) {
    // 평균 승률 손실 → 추정 레이팅 (경험적 곡선, 근사치)
    return Math.max(100, Math.min(3200, Math.round(3200 * Math.exp(-avgDrop / 12) / 50) * 50));
  }

  async function fullReview() {
    if (reviewing || !mainline.length) return;
    reviewing = true;
    $("btnFullReview").disabled = true;
    $("reviewLoading").classList.add("show");
    $("reviewProgress").textContent = "0%";

    const N = mainline.length;
    const fens = [];
    for (let i = 0; i <= N; i++) fens.push(fenAtPly(i));

    // 1) 엔진 정밀 분석 (MultiPV 2 — 1·2순위 수와 평가)
    const raw = await Engine.reviewEvaluateMulti(fens, (done, total) => {
      $("reviewProgress").textContent = Math.round((done / total) * 100) + "%";
    });

    // 2) 이론(정석) 판정 — 오프닝 DB 3,800여 종
    let bookFlags = new Array(N).fill(false);
    try {
      const r = await API.openingsBook(mainline.map((m) => m.san));
      if (r && Array.isArray(r.book)) bookFlags = r.book;
    } catch (e) { /* 서버 조회 실패 시 이론 판정 생략 */ }

    // 3) 수별 분석
    const R = window.KiwiReview;
    evals = raw.map((e) => ({
      cp: e.cp,
      best: e.best,
      depth: e.depth,
      terminal: false,
    }));
    winPcts = evals.map((e) => R.winPercent(e.cp));
    classifications = new Array(N).fill(null);
    moveData = [];

    const accByColor = { white: [], black: [] };
    const winsByColor = { white: [], black: [] };
    const lossByColor = { white: [], black: [] };
    const counts = {
      white: emptyCounts(), black: emptyCounts(),
    };
    const tactics = {
      white: { total: 0, found: 0 }, black: { total: 0, found: 0 },
    };

    for (let i = 0; i < N; i++) {
      const before = raw[i];
      const after = raw[i + 1];
      const moverWhite = (i % 2 === 0);
      const color = moverWhite ? "white" : "black";
      const mv = mainline[i];

      // mover 관점 승률
      const winBefore = R.winPercent(before.bestCpStm != null ? before.bestCpStm : (moverWhite ? before.cp : -before.cp));
      const afterStm = after.bestCpStm != null ? after.bestCpStm : (moverWhite ? -after.cp : after.cp);
      const winAfter = 100 - R.winPercent(afterStm);   // 상대 차례 관점 → mover 관점

      const bestWin = winBefore;
      const secondWin = before.secondCpStm != null ? R.winPercent(before.secondCpStm) : null;

      const playedUci = mv.from + mv.to + (mv.promotion || "");
      const isBest = before.best === playedUci;

      let legalCount = 2;
      try { legalCount = new Chess(fens[i]).moves().length; } catch (e) {}

      const sacrifice = R.isSacrifice(Chess, fens[i], mv);
      const gaveMate = (() => {
        try { return new Chess(fens[i + 1]).in_checkmate(); } catch (e) { return false; }
      })();
      const hadMate = before.mateStm != null && before.mateStm > 0;
      const stillMate = after.mateStm != null && after.mateStm < 0;

      const cls = R.classify({
        winBefore, winAfter, isBest, bestWin, secondWin,
        isBook: !!bookFlags[i],
        legalCount, hadMate, gaveMate, stillMate, sacrifice,
      });
      classifications[i] = cls;

      const acc = R.moveAccuracy(winBefore, winAfter);
      const loss = Math.max(0, winBefore - winAfter);

      // 게임 단계
      let material = 62, inBook = !!bookFlags[i];
      try { material = R.nonPawnMaterial(new Chess(fens[i])); } catch (e) {}
      const phase = R.phaseOf(i, material, inBook);

      // 전술 판별 — 결정적 국면에서 최선을 찾았는가
      const tactical = R.isTacticalPosition(bestWin, secondWin);
      if (tactical) {
        tactics[color].total++;
        if (isBest) tactics[color].found++;
      }

      counts[color][cls] = (counts[color][cls] || 0) + 1;
      // 이론/강제는 정확도 평균에서 제외 (실력과 무관)
      if (cls !== "book" && cls !== "forced") {
        accByColor[color].push(acc);
        winsByColor[color].push(winBefore);
        lossByColor[color].push(loss);
      }

      moveData.push({
        ply: i + 1,
        moveNo: Math.floor(i / 2) + 1,
        color,
        san: mv.san,
        uci: playedUci,
        piece: mv.piece,
        from: mv.from,
        to: mv.to,
        captured: mv.captured || null,
        isCapture: !!mv.captured,
        isCastle: mv.flags.indexOf("k") !== -1 || mv.flags.indexOf("q") !== -1,
        castleSide: mv.flags.indexOf("k") !== -1 ? "king" : (mv.flags.indexOf("q") !== -1 ? "queen" : null),
        isPromotion: !!mv.promotion,
        isCheck: mv.san.indexOf("+") !== -1 || mv.san.indexOf("#") !== -1,
        classification: cls,
        accuracy: Math.round(acc * 10) / 10,
        loss: Math.round(loss * 10) / 10,
        cpBefore: before.cp,
        cpAfter: after.cp,
        winBefore: Math.round(winBefore * 10) / 10,
        winAfter: Math.round(winAfter * 10) / 10,
        phase,
        isBook: !!bookFlags[i],
        isBest,
        isTactic: tactical,
        tacticFound: tactical && isBest,
        bestMove: before.best,
        depth: before.depth,
      });
    }

    // 4) 게임 정확도 (Lichess 방식)
    const stats = {};
    ["white", "black"].forEach((c) => {
      const accs = accByColor[c];
      const acc = R.gameAccuracy(accs, winsByColor[c]);
      const avgLoss = lossByColor[c].length
        ? lossByColor[c].reduce((a, b) => a + b, 0) / lossByColor[c].length : 0;
      stats[c] = {
        accuracy: Math.round(acc * 10) / 10,
        avgLoss: Math.round(avgLoss * 10) / 10,
        estElo: R.estimateElo(acc, avgLoss),
        moves: accs.length,
        tacticsTotal: tactics[c].total,
        tacticsFound: tactics[c].found,
        tacticsPct: tactics[c].total
          ? Math.round((tactics[c].found / tactics[c].total) * 100) : 0,
      };
    });
    reviewStats = stats;
    reviewCounts = counts;

    $("reviewLoading").classList.remove("show");
    $("btnFullReview").disabled = false;
    renderSummary(counts, stats);
    renderGraph();
    renderMoves();
    reviewing = false;

    saveReviewToInsights(counts, stats);
  }

  function emptyCounts() {
    const o = {};
    window.KiwiReview.CLASSES.forEach((c) => { o[c] = 0; });
    return o;
  }

  /** 리뷰 결과 + 수별 상세 데이터를 통찰에 저장 */
  async function saveReviewToInsights(counts, stats) {
    if (!API.getToken()) return;
    try {
      const color = reviewColor || "white";
      const st = stats[color] || {};
      await API.insightsSaveReview({
        gameId: reviewGameId || null,
        color,
        accuracy: st.accuracy || 0,
        estElo: st.estElo || 0,
        avgLoss: st.avgLoss || 0,
        counts: counts[color] || {},
        tacticsTotal: st.tacticsTotal || 0,
        tacticsFound: st.tacticsFound || 0,
        moves: moveData.filter((m) => m.color === color),
        opponentAccuracy: (stats[color === "white" ? "black" : "white"] || {}).accuracy || 0,
      });
    } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }

  /** 내 색(백/흑)을 추정해 리뷰 결과를 서버에 저장 */
  async function saveReviewToInsights(counts, stats, drops) {
    if (!API.getToken()) return;
    try {
      const me = API.getUser();
      // 최근 게임에서 불러온 리뷰면 내 색을 알 수 있다. 아니면 백 기준.
      let color = reviewColor || "white";
      const side = counts[color] || {};
      const st = stats[color] || { accuracy: 0, estElo: 0 };
      const ds = drops[color] || [];
      const avgLoss = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;

      await API.insightsSaveReview({
        gameId: reviewGameId || null,
        color,
        accuracy: st.accuracy || 0,
        estElo: st.estElo || 0,
        avgLoss,
        counts: {
          brilliant: side.brilliant || 0, great: side.great || 0, best: side.best || 0,
          excellent: side.excellent || 0, good: side.good || 0, book: side.book || 0,
          forced: side.forced || 0, inaccuracy: side.inaccuracy || 0,
          mistake: side.mistake || 0, missed: side.missed || 0, blunder: side.blunder || 0,
        },
      });
    } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }

  function renderSummary(counts, stats) {
    const R = window.KiwiReview;
    const rows = R.CLASSES.map((c) => {
      const w = counts.white[c] || 0;
      const b = counts.black[c] || 0;
      if (!w && !b) return "";
      return `<div class="sum-row">
        <span class="rv-icon rv-${c}">${R.CLASS_ICON[c]}</span>
        <span class="rv-name">${R.CLASS_KO[c]}</span>
        <span class="rv-w">${w}</span>
        <span class="rv-b">${b}</span>
      </div>`;
    }).join("");

    const sw = stats.white, sb = stats.black;
    $("reviewSummary").innerHTML = `
      <div class="review-summary">
        <div class="sum-title">📊 게임 리뷰</div>
        <div class="rv-head">
          <span></span><span></span><span>⚪ 백</span><span>⚫ 흑</span>
        </div>
        <div class="sum-row rv-acc">
          <span class="rv-icon">🎯</span>
          <span class="rv-name">정확도</span>
          <span class="rv-w"><b>${sw.accuracy}%</b></span>
          <span class="rv-b"><b>${sb.accuracy}%</b></span>
        </div>
        <div class="sum-row">
          <span class="rv-icon">📈</span>
          <span class="rv-name">예상 레이팅</span>
          <span class="rv-w">${sw.estElo}</span>
          <span class="rv-b">${sb.estElo}</span>
        </div>
        <div class="sum-row">
          <span class="rv-icon">⚡</span>
          <span class="rv-name">전술 포착</span>
          <span class="rv-w">${sw.tacticsFound}/${sw.tacticsTotal} (${sw.tacticsPct}%)</span>
          <span class="rv-b">${sb.tacticsFound}/${sb.tacticsTotal} (${sb.tacticsPct}%)</span>
        </div>
        <div class="rv-divider"></div>
        ${rows}
        <p class="muted" style="margin-top:8px;font-size:0.75rem;">
          평균 승률 손실: 백 ${sw.avgLoss}% · 흑 ${sb.avgLoss}% ·
          분석 깊이 depth ${(evals[0] && evals[0].depth) || "-"}
        </p>
      </div>`;
  }

  // ---------- 평가 그래프 (클릭 이동) ----------
  function renderGraph() {
    const box = $("evalGraph");
    if (!winPcts.length) { box.innerHTML = ""; return; }
    const W = 560, H = 90;
    const n = winPcts.length;
    const x = (i) => (i / Math.max(1, n - 1)) * W;
    const y = (wp) => H - (wp / 100) * H;
    let path = `M ${x(0)} ${y(winPcts[0])}`;
    for (let i = 1; i < n; i++) path += ` L ${x(i)} ${y(winPcts[i])}`;
    let area = path + ` L ${x(n - 1)} ${H} L 0 ${H} Z`;
    box.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:90px;display:block;background:#33332a;border-radius:8px;cursor:pointer;" id="evalGraphSvg">` +
      `<path d="${area}" fill="#fbfaf3" opacity="0.92"/>` +
      `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-dasharray="4 4" stroke-width="1"/>` +
      `<line id="graphCursor" x1="0" y1="0" x2="0" y2="${H}" stroke="#e0a526" stroke-width="2"/>` +
      `</svg>`;
    const svg = $("evalGraphSvg");
    svg.addEventListener("click", (e) => {
      const rect = svg.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      gotoPly(Math.round(frac * (n - 1)));
    });
    renderGraphCursor();
  }
  function renderGraphCursor() {
    const cur = document.getElementById("graphCursor");
    if (!cur || !winPcts.length) return;
    const W = 560;
    const xx = (ply / Math.max(1, winPcts.length - 1)) * W;
    cur.setAttribute("x1", xx); cur.setAttribute("x2", xx);
  }

  // ---------- PGN / 최근 게임 ----------
  function loadFromPgn(pgn) {
    const g = new Chess();
    if (!g.load_pgn(pgn)) {
      $("bestLine").textContent = "⚠️ PGN을 읽을 수 없습니다. 형식을 확인하세요.";
      return false;
    }
    const history = g.history({ verbose: true });
    const replay = new Chess();
    mainline = [];
    history.forEach((m) => {
      const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (mv) mainline.push({ san: mv.san, uci: m.from + m.to + (m.promotion || ""), fenAfter: replay.fen() });
    });
    startFen = new Chess().fen();
    evals = []; classifications = []; winPcts = [];
    reviewing = false;
    $("reviewSummary").classList.add("hidden");
    $("evalGraph").innerHTML = "";
    gotoPly(mainline.length);
    $("bestLine").textContent = `${mainline.length}수 로드 완료. '전체 분석'으로 리뷰하세요.`;
    return true;
  }

  async function loadRecentGames() {
    if (!API.getToken()) return;
    try {
      const { games } = await API.recentGames();
      const box = $("recentGames");
      if (!games || !games.length) { box.innerHTML = '<p class="muted">아직 기록된 게임이 없습니다.</p>'; return; }
      box.innerHTML = "";
      games.forEach((g) => {
        const row = document.createElement("div");
        row.className = "player-row";
        const res = g.result === "1-0" ? "백승" : g.result === "0-1" ? "흑승" : "무";
        const E = window.kiwiEscapeHtml;
        row.innerHTML = `<span class="name">${E(g.white)} vs ${E(g.black)}</span><span class="rating">${E(res)}</span>`;
        const btn = document.createElement("button");
        btn.className = "btn small"; btn.textContent = "리뷰";
        btn.onclick = async () => {
          const detail = await API.gameDetail(g.id);
          if (detail && detail.pgn) {
            const me = API.getUser();
            reviewColor = (me && detail.whiteId === me.id) ? "white" : "black";
            reviewGameId = g.id;
            if (loadFromPgn(detail.pgn)) fullReview();
          } else $("bestLine").textContent = "이 게임에는 기보(PGN)가 없습니다.";
        };
        row.appendChild(btn);
        box.appendChild(row);
      });
    } catch (e) { /* noop */ }
  }

  // ---------- 버튼 ----------
  $("btnFirst").addEventListener("click", () => gotoPly(0));
  $("btnPrev").addEventListener("click", () => gotoPly(ply - 1));
  $("btnNext").addEventListener("click", () => gotoPly(ply + 1));
  $("btnLast").addEventListener("click", () => gotoPly(mainline.length));
  $("btnFlip").addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    board.orientation(orientation);
  });
  $("btnTakeback").addEventListener("click", () => {
    if (ply !== mainline.length || !mainline.length) return;
    mainline.pop();
    evals = []; classifications = []; winPcts = [];
    $("evalGraph").innerHTML = "";
    gotoPly(mainline.length);
  });
  $("btnReset").addEventListener("click", () => {
    mainline = []; evals = []; classifications = []; winPcts = []; reviewing = false;
    startFen = new Chess().fen();
    $("reviewSummary").classList.add("hidden");
    $("evalGraph").innerHTML = "";
    gotoPly(0);
    $("bestLine").textContent = "기물을 움직이면 실시간으로 평가합니다.";
  });
  $("btnFullReview").addEventListener("click", fullReview);
  $("btnLoadPgn").addEventListener("click", () => {
    const pgn = $("pgnInput").value.trim();
    if (pgn) loadFromPgn(pgn);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); gotoPly(ply - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); gotoPly(ply + 1); }
  });

  // ---------- 초기화 ----------
  (async function init() {
    buildBoard("start");
    renderMoves();
    const strong = await Engine.init();
    const em = $("engineMode");
    if (strong) {
      em.textContent = "엔진: " + Engine.describe();
      em.classList.remove("engine-warn");
    } else {
      em.innerHTML =
        "⚠️ <b>Stockfish 엔진이 없어 평가가 부정확합니다.</b><br>" +
        "정확한 분석·게임 리뷰를 하려면 <code>frontend/assets/engine/stockfish.js</code> 를 추가하세요. " +
        "(현재: " + window.kiwiEscapeHtml(Engine.describe()) + ")";
      em.classList.add("engine-warn");
    }
    $("evalText").textContent = "기물을 움직여 분석을 시작하세요.";
    // 클럽 보드에서 공유한 국면(FEN) 열기
    let storedFen = null;
    try { storedFen = localStorage.getItem("kiwi_review_fen"); } catch (e) {}
    if (storedFen) {
      try { localStorage.removeItem("kiwi_review_fen"); } catch (e) {}
      try {
        game = new Chess(storedFen);
        startFen = storedFen;
        mainline = [];
        ply = 0;
        board.position(storedFen);
        renderMoves();
        evalCurrent();
        $("bestLine").textContent = "클럽에서 공유한 국면을 불러왔습니다.";
        loadRecentGames();
        return;
      } catch (e) { /* 잘못된 FEN 이면 무시 */ }
    }

    let stored = null;
    try { stored = localStorage.getItem("kiwi_review_pgn"); } catch (e) {}
    if (stored) {
      try { localStorage.removeItem("kiwi_review_pgn"); } catch (e) {}
      if (loadFromPgn(stored)) {
        $("bestLine").textContent = "방금 둔 게임을 불러왔습니다. 자동 분석을 시작합니다…";
        fullReview();
      }
    } else {
      evalCurrent();
    }
    loadRecentGames();
  })();
})();
