/* analysis.html — 분석 보드 + 게임 리뷰 */
(function () {
  const $ = (id) => document.getElementById(id);

  let board = null;
  let tapHandle = null;
  let game = new Chess();        // 현재 표시 중인 위치까지의 게임
  let mainline = [];             // [{san, uci, fenAfter}]  전체 수순
  let ply = 0;                   // 현재 보고 있는 수(0=시작국면)
  let orientation = "white";
  let evals = [];                // evals[i] = {score|null, mate|null} (i번째 ply 이후 국면, 백관점)
  let classifications = [];      // classifications[i] = 'best'|'good'|... (i번째 수에 대한)
  let reviewing = false;

  const CLASS_INFO = {
    best:       { ko: "최선",   color: "#2e9b53", icon: "★" },
    good:       { ko: "좋음",   color: "#6aa329", icon: "✓" },
    inaccuracy: { ko: "부정확", color: "#e0a526", icon: "?!" },
    mistake:    { ko: "실수",   color: "#e07b39", icon: "?" },
    blunder:    { ko: "대실수", color: "#c0392b", icon: "??" },
  };

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
      canMove: () => ply === mainline.length,  // 끝 국면에서만 자유 착수
      getMoverColor: () => game.turn(),
      doMove: (from, to) => { userMove(from, to); },
    });
  }

  function onDragStart(source, piece) {
    if (ply !== mainline.length) return false; // 과거 위치에서는 착수 불가
    if ((game.turn() === "w" && piece.search(/^b/) !== -1) ||
        (game.turn() === "b" && piece.search(/^w/) !== -1)) return false;
  }
  function onDrop(source, target) {
    const ok = userMove(source, target);
    return ok ? undefined : "snapback";
  }
  function onSnapEnd() { board.position(game.fen()); }

  function userMove(from, to) {
    if (ply !== mainline.length) return false;
    const mv = game.move({ from, to, promotion: "q" });
    if (!mv) { Sounds.play("illegal"); return false; }
    if (tapHandle) tapHandle.clear();
    mainline.push({ san: mv.san, uci: from + to + (mv.promotion || ""), fenAfter: game.fen() });
    ply = mainline.length;
    evals.length = 0; classifications.length = 0; // 새 수 → 기존 평가 무효
    reviewing = false;
    $("reviewSummary").classList.add("hidden");
    board.position(game.fen());
    Sounds.playForMove(mv, game.in_check());
    renderMoves();
    evalCurrent();
    return true;
  }

  // ---------- 위치 이동 ----------
  function fenAtPly(p) {
    if (p === 0) {
      const g = new Chess();
      // mainline이 커스텀 시작이면 start로 가정(표준 게임만 다룸)
      return startFen;
    }
    return mainline[p - 1].fenAfter;
  }

  let startFen = new Chess().fen();

  function gotoPly(p) {
    p = Math.max(0, Math.min(mainline.length, p));
    ply = p;
    const fen = fenAtPly(p);
    game = new Chess(fen);
    if (tapHandle) tapHandle.clear();
    board.position(fen);
    renderMoves();
    evalCurrent();
  }

  // ---------- 평가 표시 ----------
  function scoreToText(ev) {
    if (!ev) return "…";
    if (ev.mate != null) return (ev.mate > 0 ? "+M" : "-M") + Math.abs(ev.mate);
    if (ev.score == null) return "0.00";
    const v = ev.score / 100;
    return (v >= 0 ? "+" : "") + v.toFixed(2);
  }

  function renderEvalBar(ev) {
    // 백 우세 비율(0~100)
    let pct = 50;
    if (ev) {
      if (ev.mate != null) pct = ev.mate > 0 ? 100 : 0;
      else if (ev.score != null) {
        // 시그모이드로 부드럽게 매핑
        const cp = Math.max(-1000, Math.min(1000, ev.score));
        pct = 100 / (1 + Math.exp(-cp / 300));
      }
    }
    $("evalWhite").style.height = pct + "%";
  }

  async function evalCurrent() {
    const fen = game.fen();
    $("evalText").textContent = "분석 중…";
    const ev = await Engine.evaluate(fen, 12);
    // 표시
    $("evalText").textContent = "평가: " + scoreToText(ev) +
      (ev && ev.best ? "   최선수: " + ev.best : "");
    renderEvalBar(ev);
    if (ev && ev.best && ply === mainline.length) {
      $("bestLine").textContent = "엔진 추천: " + ev.best;
    }
  }

  // ---------- 기보 렌더 ----------
  function renderMoves() {
    const box = $("analysisMoves");
    if (!mainline.length) { box.innerHTML = '<p class="muted">아직 수가 없습니다.</p>'; return; }
    let html = "";
    for (let i = 0; i < mainline.length; i += 2) {
      const n = i / 2 + 1;
      html += `<span class="mv-num">${n}.</span>`;
      html += moveSpan(i);
      if (i + 1 < mainline.length) html += moveSpan(i + 1);
      html += " ";
    }
    box.innerHTML = html;
    const cur = box.querySelector(`[data-ply="${ply}"]`);
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function moveSpan(i) {
    const m = mainline[i];
    const cls = classifications[i];
    const info = cls ? CLASS_INFO[cls] : null;
    const active = (i + 1 === ply) ? " mv-active" : "";
    const badge = info ? `<sup style="color:${info.color}">${info.icon}</sup>` : "";
    return `<span class="mv${active}" data-ply="${i + 1}" onclick="window.kiwiGoto(${i + 1})">${m.san}${badge}</span> `;
  }
  window.kiwiGoto = (p) => gotoPly(p);

  // ---------- 게임 리뷰(전체 분석) ----------
  function classify(cpLoss) {
    if (cpLoss <= 15) return "best";
    if (cpLoss <= 50) return "good";
    if (cpLoss <= 120) return "inaccuracy";
    if (cpLoss <= 250) return "mistake";
    return "blunder";
  }

  function evalToCp(ev, whitePov) {
    // 백관점 cp로 환산(메이트는 ±10000 부근)
    let cp;
    if (!ev) cp = 0;
    else if (ev.mate != null) cp = ev.mate > 0 ? 10000 - ev.mate : -10000 - ev.mate;
    else cp = ev.score || 0;
    return whitePov ? cp : -cp;
  }

  async function fullReview() {
    if (!mainline.length || reviewing) return;
    reviewing = true;
    $("reviewLoading").classList.add("show");
    $("btnFullReview").disabled = true;

    // 0..N 까지 각 국면 평가 (백관점)
    evals = new Array(mainline.length + 1).fill(null);
    for (let i = 0; i <= mainline.length; i++) {
      $("reviewProgress").textContent = `분석 중… (${i}/${mainline.length})`;
      const fen = fenAtPly(i);
      evals[i] = await Engine.evaluate(fen, 12);
    }

    // 각 수 분류: i번째 수(0-indexed)를 둔 사람 관점의 손실
    classifications = new Array(mainline.length).fill(null);
    const counts = { white: {}, black: {} };
    for (let i = 0; i < mainline.length; i++) {
      const moverWhite = (i % 2 === 0); // 0=백의 1수
      const before = evalToCp(evals[i], moverWhite);   // 두기 전, 둘 사람 관점 최선값
      const after = evalToCp(evals[i + 1], moverWhite); // 둔 후(상대 차례) 같은 관점
      const loss = Math.max(0, before - after);
      const cls = classify(loss);
      classifications[i] = cls;
      const side = moverWhite ? "white" : "black";
      counts[side][cls] = (counts[side][cls] || 0) + 1;
    }

    $("reviewLoading").classList.remove("show");
    $("btnFullReview").disabled = false;
    renderSummary(counts);
    renderMoves();
  }

  function renderSummary(counts) {
    const order = ["best", "good", "inaccuracy", "mistake", "blunder"];
    function row(side, label) {
      let cells = order.map((k) => {
        const info = CLASS_INFO[k];
        const n = counts[side][k] || 0;
        return `<span style="color:${info.color};font-weight:700;">${info.icon} ${n}</span>`;
      }).join(" · ");
      return `<div class="sum-row"><b>${label}</b> ${cells}</div>`;
    }
    $("reviewSummary").innerHTML =
      `<div class="sum-title">📊 게임 리뷰 결과</div>` +
      row("white", "⚪ 백") + row("black", "⚫ 흑") +
      `<div class="muted" style="margin-top:6px;font-size:0.8rem;">수를 클릭하면 해당 국면으로 이동합니다.</div>`;
    $("reviewSummary").classList.remove("hidden");
  }

  // ---------- PGN / 최근 게임 로드 ----------
  function loadFromPgn(pgn) {
    const g = new Chess();
    if (!g.load_pgn(pgn)) {
      $("bestLine").textContent = "⚠️ PGN을 읽을 수 없습니다. 형식을 확인하세요.";
      return false;
    }
    const history = g.verbose ? g.history({ verbose: true }) : g.history({ verbose: true });
    // 처음부터 재생하며 mainline 구성
    const replay = new Chess();
    mainline = [];
    history.forEach((m) => {
      const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (mv) mainline.push({ san: mv.san, uci: m.from + m.to + (m.promotion || ""), fenAfter: replay.fen() });
    });
    startFen = new Chess().fen();
    evals = []; classifications = [];
    reviewing = false;
    $("reviewSummary").classList.add("hidden");
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
        row.innerHTML = `<span class="name">${window.kiwiEscapeHtml ? window.kiwiEscapeHtml(g.white) : g.white} vs ${g.black}</span>
                         <span class="rating">${res}</span>`;
        const btn = document.createElement("button");
        btn.className = "btn small"; btn.textContent = "리뷰";
        btn.onclick = async () => {
          const detail = await API.gameDetail(g.id);
          if (detail && detail.pgn) {
            if (loadFromPgn(detail.pgn)) fullReview();
          } else {
            $("bestLine").textContent = "이 게임에는 기보(PGN)가 없습니다.";
          }
        };
        row.appendChild(btn);
        box.appendChild(row);
      });
    } catch (e) { /* 비로그인 등 */ }
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
    evals = []; classifications = [];
    gotoPly(mainline.length);
  });
  $("btnReset").addEventListener("click", () => {
    mainline = []; evals = []; classifications = []; reviewing = false;
    startFen = new Chess().fen();
    $("reviewSummary").classList.add("hidden");
    gotoPly(0);
    $("bestLine").textContent = "기물을 움직이면 실시간으로 평가합니다.";
  });
  $("btnFullReview").addEventListener("click", fullReview);
  $("btnLoadPgn").addEventListener("click", () => {
    const pgn = $("pgnInput").value.trim();
    if (pgn) loadFromPgn(pgn);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft") gotoPly(ply - 1);
    if (e.key === "ArrowRight") gotoPly(ply + 1);
  });

  // ---------- 초기화 ----------
  (async function init() {
    buildBoard("start");
    renderMoves();
    const ok = await Engine.init();
    $("engineMode").textContent = "엔진: " + Engine.describe();
    $("evalText").textContent = "기물을 움직여 분석을 시작하세요.";
    evalCurrent();
    loadRecentGames();
  })();
})();
