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
    if (cp >= MATE - 5000) return "+M";
    if (cp <= -MATE + 5000) return "-M";
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
      $("evalText").textContent = "평가: " + scoreToText(e.cp) + (e.best ? "   최선수: " + e.best : "");
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
    }
    $("evalText").textContent = "평가: " + scoreToText(cp) + (best ? "   최선수: " + best : "");
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
    return `<span class="mv${active}" data-ply="${i + 1}" onclick="window.kiwiGoto(${i + 1})">${m.san}${badge}</span> `;
  }
  window.kiwiGoto = (p) => gotoPly(p);

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
    const { i, drop, cpDrop, isBest, beforeWin, afterWin, moverColor, gaveMate, hadMate, legalCount } = ctx;

    // 강제: 합법수가 하나뿐 (선택지가 없음) — 실력과 무관
    if (legalCount === 1) return "forced";

    // 이 수로 외통 → 최고/뛰어난 수
    if (gaveMate) return isBest ? "best" : "excellent";

    // 이론(오프닝): 초반 정상 수
    if (i < BOOK_PLIES && drop <= 5 && cpDrop <= 60 && Math.abs(beforeWin - 50) < 20) return "book";

    // 놓친 수: 강제 메이트가 있었는데 놓침 (여전히 안 지고 있으면)
    if (hadMate && !gaveMate && afterWin >= 45) return "missed";
    // 놓친 수: 확실히 이기고 있었는데(85%+) 큰 이점을 날림 — 단, 아직 안 짐
    if (beforeWin >= 85 && drop >= 12 && afterWin >= 50) return "missed";

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
    if (!mainline.length || reviewing) return;
    reviewing = true;
    $("reviewLoading").classList.add("show");
    $("btnFullReview").disabled = true;
    const t0 = Date.now();

    // 1) 국면 목록: 종료국면은 즉시 계산, 나머지만 엔진 병렬 평가
    const N = mainline.length;
    evals = new Array(N + 1).fill(null);
    const idxToEval = [];
    const fensToEval = [];
    for (let i = 0; i <= N; i++) {
      const t = terminalEval(fenAtPly(i));
      if (t) evals[i] = t;
      else { idxToEval.push(i); fensToEval.push(fenAtPly(i)); }
    }
    const engineResults = await Engine.reviewEvaluate(fensToEval, (done, total) => {
      const el = Date.now() - t0;
      $("reviewProgress").textContent = `분석 중… ${done}/${total} (${(done / (el / 1000)).toFixed(1)}수/초)`;
    });
    engineResults.forEach((ev, k) => {
      let cp;
      if (ev && ev.mate != null) cp = ev.mate > 0 ? MATE - ev.mate * 100 : -MATE - ev.mate * 100;
      else cp = (ev && ev.score != null) ? ev.score : 0;
      evals[idxToEval[k]] = { cp, best: ev && ev.best, terminal: false };
    });

    // 2) 승률 및 분류
    winPcts = evals.map((e) => cpToWinPct(e.cp));
    classifications = new Array(N).fill(null);
    const counts = { white: {}, black: {} };
    const drops = { white: [], black: [] };
    for (let i = 0; i < N; i++) {
      const moverWhite = (i % 2 === 0);
      const beforeWin = moverWhite ? winPcts[i] : 100 - winPcts[i];
      const afterWin = moverWhite ? winPcts[i + 1] : 100 - winPcts[i + 1];
      const drop = Math.max(0, beforeWin - afterWin);
      // 절대 센티폰 손실 (mover 관점, 메이트 왜곡 방지 위해 ±2000 로 제한)
      const clamp = (x) => Math.max(-2000, Math.min(2000, x));
      const beforeCpMover = clamp(moverWhite ? evals[i].cp : -evals[i].cp);
      const afterCpMover = clamp(moverWhite ? evals[i + 1].cp : -evals[i + 1].cp);
      const cpDrop = Math.max(0, beforeCpMover - afterCpMover);
      const bestUci = evals[i].best;
      const isBest = !!(bestUci && mainline[i].uci.slice(0, 4) === bestUci.slice(0, 4));
      const gaveMate = !!(evals[i + 1].terminal && Math.abs(evals[i + 1].cp) >= MATE);
      // 두기 전 mover가 강제 메이트를 갖고 있었나 (백관점 cp가 mover쪽 MATE급)
      const preCpMover = moverWhite ? evals[i].cp : -evals[i].cp;
      const hadMate = preCpMover >= MATE - 5000;
      let legalCount = 0;
      try { legalCount = new Chess(fenAtPly(i)).moves().length; } catch (e) { legalCount = 2; }
      const cls = classifyMove({
        i, drop, cpDrop, isBest, beforeWin, afterWin,
        moverColor: moverWhite ? "w" : "b", gaveMate, hadMate, legalCount,
      });
      classifications[i] = cls;
      const side = moverWhite ? "white" : "black";
      counts[side][cls] = (counts[side][cls] || 0) + 1;
      drops[side].push(drop);
    }

    // 3) 정확도 & 예상 ELO
    const stats = {};
    for (const side of ["white", "black"]) {
      const ds = drops[side];
      if (ds.length) {
        const acc = ds.map(moveAccuracy).reduce((a, b) => a + b, 0) / ds.length;
        const avgDrop = ds.reduce((a, b) => a + b, 0) / ds.length;
        stats[side] = { accuracy: acc, estElo: estimateElo(avgDrop) };
      } else stats[side] = { accuracy: 0, estElo: null };
    }

    $("reviewLoading").classList.remove("show");
    $("btnFullReview").disabled = false;
    renderSummary(counts, stats);
    renderGraph();
    renderMoves();
    reviewing = false;
  }

  function renderSummary(counts, stats) {
    const order = ["brilliant", "great", "best", "excellent", "good", "book", "forced", "inaccuracy", "mistake", "missed", "blunder"];
    function row(side, label) {
      const st = stats[side];
      let head = `<b>${label}</b> — 정확도 <b>${st.accuracy.toFixed(1)}%</b>` +
        (st.estElo ? ` · 예상 레이팅 <b>≈${st.estElo}</b>` : "");
      let cells = order.filter((k) => counts[side][k]).map((k) => {
        const info = CLASS_INFO[k];
        return `<span style="color:${info.color};font-weight:700;">${info.icon} ${info.ko} ${counts[side][k]}</span>`;
      }).join(" · ");
      if (!cells) cells = '<span class="muted">기록 없음</span>';
      return `<div class="sum-row">${head}<br>${cells}</div>`;
    }
    $("reviewSummary").innerHTML =
      `<div class="sum-title">📊 게임 리뷰 결과</div>` +
      row("white", "⚪ 백") + row("black", "⚫ 흑") +
      `<div class="muted" style="margin-top:6px;font-size:0.8rem;">그래프/수를 클릭하면 해당 국면으로 이동합니다. 예상 레이팅은 이 한 판 기준의 근사치입니다.</div>`;
    $("reviewSummary").classList.remove("hidden");
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
        row.innerHTML = `<span class="name">${g.white} vs ${g.black}</span><span class="rating">${res}</span>`;
        const btn = document.createElement("button");
        btn.className = "btn small"; btn.textContent = "리뷰";
        btn.onclick = async () => {
          const detail = await API.gameDetail(g.id);
          if (detail && detail.pgn) { if (loadFromPgn(detail.pgn)) fullReview(); }
          else $("bestLine").textContent = "이 게임에는 기보(PGN)가 없습니다.";
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
    await Engine.init();
    $("engineMode").textContent = "엔진: " + Engine.describe();
    $("evalText").textContent = "기물을 움직여 분석을 시작하세요.";
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
