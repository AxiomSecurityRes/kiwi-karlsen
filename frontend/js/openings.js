/* openings.html — 탐색기(게임 수·승률·레이팅 범위) + 오프닝 배우기 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  /* ==================== 탭 ==================== */
  document.querySelectorAll("#opTabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#opTabs .tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.getAttribute("data-tab")).classList.remove("hidden");
      if (btn.getAttribute("data-tab") === "tabLearn") loadCurriculum();
      else if (board) setTimeout(() => board.resize(), 50);
    });
  });

  /* ==================== 탐색기 ==================== */
  let game = new Chess();
  let board = null;
  let tapHandle = null;
  let orientation = "white";
  let history = [];

  const RATING_LABELS = {
    0: "0–1000", 1000: "1000+", 1200: "1200+", 1400: "1400+", 1600: "1600+",
    1800: "1800+", 2000: "2000+", 2200: "2200+", 2500: "2500+",
  };
  const SPEED_LABELS = {
    ultraBullet: "초단기", bullet: "불릿", blitz: "블리츠",
    rapid: "래피드", classical: "클래식", correspondence: "통신",
  };
  let selRatings = [1600, 1800, 2000, 2200, 2500];
  let selSpeeds = ["blitz", "rapid", "classical"];

  function buildChips() {
    $("expRatings").innerHTML = Object.keys(RATING_LABELS).map((r) => {
      const v = parseInt(r, 10);
      return `<button class="chip ${selRatings.includes(v) ? "on" : ""}" data-r="${v}">${esc(RATING_LABELS[r])}</button>`;
    }).join("");
    $("expSpeeds").innerHTML = Object.keys(SPEED_LABELS).map((s) =>
      `<button class="chip ${selSpeeds.includes(s) ? "on" : ""}" data-s="${esc(s)}">${esc(SPEED_LABELS[s])}</button>`
    ).join("");

    $("expRatings").querySelectorAll(".chip").forEach((c) => {
      c.addEventListener("click", () => {
        const v = parseInt(c.getAttribute("data-r"), 10);
        const i = selRatings.indexOf(v);
        if (i >= 0) { if (selRatings.length > 1) selRatings.splice(i, 1); }
        else selRatings.push(v);
        buildChips();
        refresh();
      });
    });
    $("expSpeeds").querySelectorAll(".chip").forEach((c) => {
      c.addEventListener("click", () => {
        const v = c.getAttribute("data-s");
        const i = selSpeeds.indexOf(v);
        if (i >= 0) { if (selSpeeds.length > 1) selSpeeds.splice(i, 1); }
        else selSpeeds.push(v);
        buildChips();
        refresh();
      });
    });
  }

  function buildBoard() {
    board = Chessboard("opening-board", {
      draggable: !TapMove.isTouch(),
      position: "start",
      orientation,
      pieceTheme: window.kiwiPieceTheme,
      onDragStart, onDrop, onSnapEnd,
    });
    tapHandle = TapMove.attach({
      boardId: "opening-board",
      getGame: () => game,
      canMove: () => true,
      getMoverColor: () => game.turn(),
      doMove: (from, to) => { playMove({ from, to, promotion: "q" }); },
    });
  }
  function onDragStart(source, piece) {
    if ((game.turn() === "w" && piece.search(/^b/) !== -1) ||
        (game.turn() === "b" && piece.search(/^w/) !== -1)) return false;
  }
  function onDrop(source, target) {
    return playMove({ from: source, to: target, promotion: "q" }) ? undefined : "snapback";
  }
  function onSnapEnd() { board.position(game.fen()); }

  function playMove(mv) {
    const m = game.move(mv);
    if (!m) { Sounds.play("illegal"); return false; }
    if (tapHandle) tapHandle.clear();
    history.push(m.san);
    board.position(game.fen());
    Sounds.playForMove(m, game.in_check());
    refresh();
    return true;
  }
  function playSan(san) {
    const m = game.move(san);
    if (!m) return;
    if (tapHandle) tapHandle.clear();
    history.push(m.san);
    board.position(game.fen());
    Sounds.playForMove(m, game.in_check());
    refresh();
  }

  function renderMoveLine() {
    if (!history.length) {
      $("opMoves").textContent = "기물을 움직이거나 오른쪽에서 수를 고르세요.";
      return;
    }
    let out = "";
    for (let i = 0; i < history.length; i += 2) {
      out += `${i / 2 + 1}. ${history[i]} ${history[i + 1] || ""} `;
    }
    $("opMoves").textContent = out.trim();
  }

  function bar(w, d, b) {
    return `<span class="wdl">
      <span class="wdl-w" style="width:${w}%"></span>
      <span class="wdl-d" style="width:${d}%"></span>
      <span class="wdl-b" style="width:${b}%"></span>
    </span>`;
  }

  /** 서버 프록시가 429(공유 IP 레이트리밋) 등으로 실패했을 때,
   *  사용자 브라우저에서 Lichess 를 직접 조회한다. 각자 IP 를 쓰므로
   *  공유 IP 제한을 우회할 수 있다. 실패하면 null 을 돌려 로컬 통계를 쓴다. */
  async function fetchLichessDirect(src) {
    try {
      const play = uciHistory();
      const base = src === "masters"
        ? "https://explorer.lichess.ovh/masters"
        : "https://explorer.lichess.ovh/lichess";
      const p = new URLSearchParams();
      if (play) p.set("play", play);
      p.set("moves", "12");
      p.set("topGames", "0");
      if (src !== "masters") {
        p.set("variant", "standard");
        p.set("recentGames", "0");
        selRatings.forEach((r) => p.append("ratings", String(r)));
        selSpeeds.forEach((s) => p.append("speeds", s));
      }
      const res = await fetch(base + "?" + p.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const raw = await res.json();
      // 서버와 동일한 형태로 정규화
      const white = raw.white || 0, draws = raw.draws || 0, black = raw.black || 0;
      const total = white + draws + black;
      const moves = (raw.moves || []).map((m) => {
        const w = m.white || 0, d = m.draws || 0, b = m.black || 0, t = w + d + b;
        return t ? {
          san: m.san || "", uci: m.uci || "", games: t, white: w, draws: d, black: b,
          whitePct: +(w / t * 100).toFixed(1), drawPct: +(d / t * 100).toFixed(1),
          blackPct: +(b / t * 100).toFixed(1), share: 0,
          avgRating: m.averageRating || m.averageOpponentRating || null,
        } : null;
      }).filter(Boolean);
      const mt = moves.reduce((a, m) => a + m.games, 0) || 1;
      moves.forEach((m) => { m.share = +(m.games / mt * 100).toFixed(1); });
      moves.sort((a, b2) => b2.games - a.games);
      return {
        source: src, total, white, draws, black,
        whitePct: total ? +(white / total * 100).toFixed(1) : 0,
        drawPct: total ? +(draws / total * 100).toFixed(1) : 0,
        blackPct: total ? +(black / total * 100).toFixed(1) : 0,
        moves, opening: raw.opening || null, direct: true, fallback: false, reason: "",
      };
    } catch (e) { return null; }
  }

  /** 현재 수순을 UCI CSV 로 (Lichess play 파라미터용) */
  function uciHistory() {
    try {
      const g = new Chess();
      const out = [];
      for (const san of history) {
        const m = g.move(san);
        if (!m) break;
        out.push(m.from + m.to + (m.promotion || ""));
      }
      return out.join(",");
    } catch (e) { return ""; }
  }

  async function refresh() {
    renderMoveLine();
    const src = $("expSource").value;
    $("expOnlineOnly").style.display = src === "lichess" ? "" : "none";
    $("expMoves").innerHTML = '<p class="muted">불러오는 중…</p>';

    try {
      let data = await API.explorer(history, selRatings, selSpeeds, src);

      // 서버 프록시가 실패(429 등)했고 온라인 소스를 원했다면,
      // 브라우저에서 직접 Lichess 를 조회해 본다.
      if (data.fallback && (src === "lichess" || src === "masters")) {
        const direct = await fetchLichessDirect(src);
        if (direct) data = direct;
      }

      // 오프닝 이름
      if (data.opening) {
        $("opName").textContent = data.opening.name;
        $("opEco").textContent = `${data.opening.eco} · ${data.opening.moves.join(" ")}`;
      } else {
        $("opName").textContent = history.length ? "정석에서 벗어남" : "시작 국면";
        $("opEco").textContent = "";
      }

      // 요약
      const srcLabel = data.source === "lichess" ? "Lichess"
        : (data.source === "masters" ? "마스터 DB" : "이 사이트");
      const reasonKo = {
        ratelimit: "Lichess 요청 한도 초과(잠시 후 자동 복구)",
        network: "Lichess 연결 실패",
        http: "Lichess 응답 오류",
        cooldown: "Lichess 재시도 대기 중",
      }[data.reason] || "Lichess 조회 실패";
      const note = data.fallback
        ? `<span class="exp-warn">⚠️ ${esc(reasonKo)} — 이 사이트 게임으로 대체</span>`
        : (data.direct ? '<span class="muted">· 브라우저 직접 조회</span>'
                       : (data.cached ? '<span class="muted">· 캐시됨</span>' : ""));
      if (!data.total) {
        $("expSummary").innerHTML =
          `<div class="muted">이 국면의 통계가 없습니다. ${note}</div>`;
      } else {
        $("expSummary").innerHTML = `
          <div class="exp-total">
            <b>${data.total.toLocaleString()}</b>판 <span class="muted">(${esc(srcLabel)})</span> ${note}
          </div>
          ${bar(data.whitePct, data.drawPct, data.blackPct)}
          <div class="wdl-legend">
            <span>백 ${data.whitePct}%</span><span>무 ${data.drawPct}%</span><span>흑 ${data.blackPct}%</span>
          </div>`;
      }

      // 수순 테이블
      if (!data.moves.length) {
        $("expMoves").innerHTML = '<p class="muted">이 국면에서 기록된 수가 없습니다. 자유롭게 두어 보세요.</p>';
        return;
      }
      $("expMoves").innerHTML = `
        <div class="exp-head">
          <span>수</span><span>게임 수</span><span>백 / 무 / 흑</span>
        </div>` +
        data.moves.map((m) => `
        <button class="exp-move" data-san="${esc(m.san)}">
          <span class="em-san">${esc(m.san)}</span>
          <span class="em-games">
            ${m.games.toLocaleString()}
            <small>${m.share}%</small>
          </span>
          <span class="em-bar">
            ${bar(m.whitePct, m.drawPct, m.blackPct)}
            <small>${m.whitePct}% / ${m.drawPct}% / ${m.blackPct}%</small>
          </span>
        </button>`).join("");

      $("expMoves").querySelectorAll(".exp-move").forEach((b) => {
        b.addEventListener("click", () => playSan(b.getAttribute("data-san")));
      });
    } catch (e) {
      $("expMoves").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  $("expSource").addEventListener("change", refresh);
  $("opBack").addEventListener("click", () => {
    if (!history.length) return;
    game.undo(); history.pop();
    if (tapHandle) tapHandle.clear();
    board.position(game.fen());
    refresh();
  });
  $("opFlip").addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    board.orientation(orientation);
  });
  $("opReset").addEventListener("click", () => {
    game = new Chess(); history = [];
    if (tapHandle) tapHandle.clear();
    board.position("start");
    refresh();
  });

  /* ==================== 배우기 ==================== */
  let lBoard = null;
  let lTap = null;
  let lGame = new Chess();
  let curOpening = null;     // { key, eco, name, moves }
  let lPly = 0;
  let lMode = "study";       // study | quiz
  let quizCorrect = 0, quizWrong = 0;
  let autoTimer = null;

  async function loadCurriculum() {
    try {
      const data = await API.learnCurriculum();
      if (data.stats) {
        const s = data.stats;
        $("learnStats").innerHTML = `
          <div class="stat-box"><div class="stat-num">${s.mastered}</div><div class="stat-label">마스터</div></div>
          <div class="stat-box"><div class="stat-num">${s.studied}</div><div class="stat-label">학습 중</div></div>
          <div class="stat-box"><div class="stat-num">${s.totalOpenings}</div><div class="stat-label">전체</div></div>
          <div class="stat-box"><div class="stat-num">${s.attempts}</div><div class="stat-label">시도</div></div>`;
      } else {
        $("learnStats").innerHTML = '<p class="muted">로그인하면 진도가 저장됩니다.</p>';
      }

      $("learnUnits").innerHTML = data.units.map((u) => `
        <div class="learn-unit">
          <div class="lu-head">
            <span class="lu-level">${u.level}</span>
            <span class="lu-title">${esc(u.title)}<small>${esc(u.desc)}</small></span>
            <span class="lu-prog">${u.mastered}/${u.total}</span>
          </div>
          <div class="lu-items">
            ${u.openings.map((o) => `
              <button class="lu-item ${o.mastered ? "mastered" : ""}" data-key="${esc(o.key)}">
                <b>${esc(o.name)}</b>
                <small>${esc(o.eco)} · ${o.plies}수${o.bestScore ? ` · 최고 ${o.bestScore}점` : ""}</small>
                ${o.mastered ? '<span class="lu-check">✅</span>' : ""}
              </button>`).join("")}
          </div>
        </div>`).join("");

      // 오프닝 클릭 → 학습 시작
      const all = {};
      data.units.forEach((u) => u.openings.forEach((o) => { all[o.key] = o; }));
      $("learnUnits").querySelectorAll(".lu-item").forEach((b) => {
        b.addEventListener("click", () => startOpening(all[b.getAttribute("data-key")]));
      });
    } catch (e) {
      $("learnUnits").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  function startOpening(o) {
    if (!o) return;
    curOpening = o;
    $("learnHome").classList.add("hidden");
    $("learnPlay").classList.remove("hidden");
    $("lpTitle").textContent = o.name;
    $("lpEco").textContent = `${o.eco} · ${o.moves.length}수`;
    $("lpResult").innerHTML = "";
    setMode("study");
  }

  function buildLearnBoard() {
    if (lBoard) lBoard.destroy();
    lBoard = Chessboard("learn-board", {
      draggable: !TapMove.isTouch(),
      position: "start",
      pieceTheme: window.kiwiPieceTheme,
      onDragStart: (src, piece) => {
        if (lMode !== "quiz") return false;
        if ((lGame.turn() === "w" && piece.search(/^b/) !== -1) ||
            (lGame.turn() === "b" && piece.search(/^w/) !== -1)) return false;
      },
      onDrop: (src, tgt) => (quizMove(src, tgt) ? undefined : "snapback"),
      onSnapEnd: () => lBoard.position(lGame.fen()),
    });
    if (lTap) lTap.clear();
    lTap = TapMove.attach({
      boardId: "learn-board",
      getGame: () => lGame,
      canMove: () => lMode === "quiz",
      getMoverColor: () => lGame.turn(),
      doMove: (from, to) => { quizMove(from, to); },
    });
  }

  function setMode(mode) {
    lMode = mode;
    stopAuto();
    lGame = new Chess();
    lPly = 0;
    quizCorrect = 0; quizWrong = 0;
    $("lpStudyBtn").classList.toggle("active", mode === "study");
    $("lpStudyBtn").classList.toggle("secondary", mode !== "study");
    $("lpQuizBtn").classList.toggle("active", mode === "quiz");
    $("lpQuizBtn").classList.toggle("secondary", mode !== "quiz");
    $("lpControls").style.display = mode === "study" ? "flex" : "none";
    $("lpQuizPanel").classList.toggle("hidden", mode !== "quiz");
    $("lpResult").innerHTML = "";

    buildLearnBoard();
    renderLearnMoves();

    if (mode === "study") {
      $("lpStatus").textContent = "학습 모드 — ▶ 로 수순을 따라가 보세요.";
    } else {
      $("lpStatus").textContent = "퀴즈 — 외운 수순을 직접 두어 보세요.";
      updateQuizHud();
      maybeAutoOpponent();
    }
  }

  function renderLearnMoves() {
    if (!curOpening) return;
    const mv = curOpening.moves;
    let html = "";
    for (let i = 0; i < mv.length; i += 2) {
      html += `<span class="mv-num">${i / 2 + 1}.</span>`;
      html += moveChip(i, mv[i]);
      if (i + 1 < mv.length) html += moveChip(i + 1, mv[i + 1]);
      html += " ";
    }
    $("lpMoveList").innerHTML = html;
  }
  function moveChip(i, san) {
    // 퀴즈 모드에서는 아직 두지 않은 수를 가린다
    const hidden = (lMode === "quiz" && i >= lPly);
    const active = (i === lPly - 1) ? " mv-active" : "";
    return `<span class="mv${active}">${hidden ? "?" : esc(san)}</span> `;
  }

  // ---- 학습 모드 ----
  function stepTo(p) {
    if (!curOpening) return;
    p = Math.max(0, Math.min(curOpening.moves.length, p));
    lGame = new Chess();
    for (let i = 0; i < p; i++) lGame.move(curOpening.moves[i]);
    lPly = p;
    if (lTap) lTap.clear();
    lBoard.position(lGame.fen());
    renderLearnMoves();
    if (p > 0) Sounds.play("move");
    $("lpStatus").textContent = p === 0
      ? "시작 국면"
      : `${p}수: ${curOpening.moves[p - 1]}`;
  }
  $("lpPrev").addEventListener("click", () => { stopAuto(); stepTo(lPly - 1); });
  $("lpNext").addEventListener("click", () => { stopAuto(); stepTo(lPly + 1); });
  $("lpAuto").addEventListener("click", () => {
    if (autoTimer) { stopAuto(); return; }
    $("lpAuto").textContent = "⏸ 정지";
    autoTimer = setInterval(() => {
      if (!curOpening || lPly >= curOpening.moves.length) { stopAuto(); return; }
      stepTo(lPly + 1);
    }, 900);
  });
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    $("lpAuto").textContent = "▶▶ 자동 재생";
  }

  // ---- 퀴즈 모드 ----
  function updateQuizHud() {
    if (!curOpening) return;
    $("lpCorrect").textContent = quizCorrect;
    $("lpWrong").textContent = quizWrong;
    $("lpProgress").textContent = `${lPly}/${curOpening.moves.length}`;
  }

  /** 퀴즈에서 사용자가 두는 색을 정한다: 첫 수가 백이면 백, 아니면 흑 */
  function userPlaysWhite() { return true; }   // 항상 양쪽 다 맞히게(수순 전체 암기)

  function quizMove(from, to) {
    if (lMode !== "quiz" || !curOpening) return false;
    if (lPly >= curOpening.moves.length) return false;

    const expected = curOpening.moves[lPly];
    const test = new Chess(lGame.fen());
    const m = test.move({ from, to, promotion: "q" });
    if (!m) { Sounds.play("illegal"); return false; }

    if (m.san === expected) {
      lGame.move(expected);
      lPly++;
      quizCorrect++;
      Sounds.play("move");
      $("lpHint").textContent = "";
      if (lTap) lTap.clear();
      lBoard.position(lGame.fen());
      renderLearnMoves();
      updateQuizHud();
      if (lPly >= curOpening.moves.length) finishQuiz();
      return true;
    }

    // 오답
    quizWrong++;
    Sounds.play("illegal");
    $("lpHint").textContent = `❌ ${m.san} 은(는) 이 정석의 수가 아닙니다. 다시 시도해보세요.`;
    updateQuizHud();
    return false;
  }

  function maybeAutoOpponent() { /* 전체 수순 암기 방식이라 자동 응수 없음 */ }

  async function finishQuiz() {
    const total = quizCorrect + quizWrong;
    const score = total ? Math.round((quizCorrect / total) * 100) : 0;
    $("lpStatus").textContent = "🎉 수순을 모두 맞혔습니다!";
    Sounds.play("win");

    let extra = "";
    if (API.getToken()) {
      try {
        const r = await API.learnResult(curOpening.key, score);
        const p = r.progress;
        extra = p.mastered
          ? '<span class="lp-master">🏅 마스터!</span>'
          : `<span class="muted">90점 이상이면 마스터 (최고 ${p.bestScore}점)</span>`;
        if (r.newAchievements && r.newAchievements.length && window.kiwiNotifyRefresh) {
          window.kiwiNotifyRefresh();
        }
      } catch (e) { /* noop */ }
    } else {
      extra = '<span class="muted">로그인하면 진도가 저장됩니다.</span>';
    }
    $("lpResult").innerHTML =
      `<div class="status">점수 <b>${score}점</b> (정답 ${quizCorrect} / 오답 ${quizWrong}) ${extra}</div>`;
  }

  $("lpStudyBtn").addEventListener("click", () => setMode("study"));
  $("lpQuizBtn").addEventListener("click", () => setMode("quiz"));
  $("lpRetry").addEventListener("click", () => setMode("quiz"));
  $("lpBack").addEventListener("click", () => {
    stopAuto();
    $("learnPlay").classList.add("hidden");
    $("learnHome").classList.remove("hidden");
    loadCurriculum();
  });

  /* ==================== 초기화 ==================== */
  buildChips();
  buildBoard();
  refresh();
})();
