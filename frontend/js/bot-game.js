/* play.html 봇 대국 — 봇 선택 또는 ELO 슬라이더(100~3200) + 힌트/무르기 */
(function () {
  const $ = (id) => document.getElementById(id);

  let bots = [];
  let selectedBot = null;   // 봇 카드 선택 시
  let useSlider = false;    // ELO 슬라이더 모드
  let board = null;
  let game = null;
  let myColor = "white";
  let gameOver = true;
  let playElo = 1200;       // 실제 대국 상대 ELO

  let timeLimit = 0;
  let clocks = { me: 0, bot: 0 };
  let clockTimer = null;
  let tapHandle = null;

  // namu.wiki Chess.com 레이팅별 특징 요약
  const ELO_DESC = [
    [100,  "규칙을 막 배운 단계. 공짜 기물이 자주 오갑니다."],
    [300,  "뉴비 구간. 실수와 블런더가 매우 잦습니다."],
    [500,  "가장 많은 유저가 분포하는 구간. 오프닝 트랩에 자주 걸립니다."],
    [700,  "기초 전술을 익히는 중. 백랭크 메이트를 종종 허용합니다."],
    [900,  "2수 계산이 가능해지는 구간. 기물 헌납이 여전히 있습니다."],
    [1100, "포크·핀 등 전술과 수읽기 싸움이 시작됩니다."],
    [1300, "상위 3~6%. 오프닝·엔드게임·수읽기가 빡세집니다."],
    [1500, "국내 대회에 명함을 내밀 수준. 커뮤니티에서 중수 이상."],
    [1800, "상위 1%. 매우 높은 수준의 전술과 정확도."],
    [2000, "아마추어의 목표점. 어느 모임에서든 고수로 인정."],
    [2300, "마스터 후보(FM급). 취미로 도달하기 매우 어렵습니다."],
    [2500, "마스터 레벨. GM 타이틀 조건에 준하는 실력."],
    [2600, "그랜드마스터(GM)급. 대부분의 GM이 분포합니다."],
    [3000, "세계 정상급. 칼센·나카무라 수준의 영역."],
  ];
  function eloDesc(elo) {
    let d = ELO_DESC[0][1];
    for (const [th, txt] of ELO_DESC) { if (elo >= th) d = txt; }
    return d;
  }

  function fmtClock(sec) {
    if (timeLimit === 0) return "∞";
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  }
  function renderBotClocks() {
    $("myBotClock").textContent = fmtClock(clocks.me);
    $("botClock").textContent = fmtClock(clocks.bot);
    const myTurnNow = !gameOver && game && game.turn() === myColor[0];
    $("myBotClock").classList.toggle("active", myTurnNow);
    $("botClock").classList.toggle("active", !gameOver && !myTurnNow);
  }
  function startBotClock() {
    stopBotClock();
    if (timeLimit === 0) return;
    clockTimer = setInterval(() => {
      if (gameOver || !game) return;
      const side = game.turn() === myColor[0] ? "me" : "bot";
      clocks[side] -= 1;
      if (clocks[side] <= 0) {
        clocks[side] = 0; renderBotClocks(); gameOver = true; stopBotClock();
        showResult(side === "me" ? "loss" : "win", "시간 초과");
        return;
      }
      renderBotClocks();
    }, 1000);
  }
  function stopBotClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }

  // ---------- 봇 목록/슬라이더 ----------
  async function loadBots() {
    try { bots = (await API.bots()).bots; }
    catch (e) {
      bots = [{ level: 1, name: "Kiwi Baby", title: "입문", approx_rating: 350, blurb: "아기 키위", avatar: "🥝" }];
    }
    renderBotGrid();
    initEngine();
    updateSliderDesc();
  }
  async function initEngine() {
    const ok = await Engine.init();
    $("engineNote").textContent = ok
      ? "✅ " + Engine.describe() + " 사용 중 — 가장 강력합니다."
      : "ℹ️ 브라우저 Stockfish 로드 실패 — 백엔드/내장 엔진으로 동작합니다. 새로고침해 보세요.";
  }
  function renderBotGrid() {
    const grid = $("botGrid");
    grid.innerHTML = "";
    bots.forEach((b) => {
      const card = document.createElement("div");
      card.className = "bot-card";
      card.innerHTML = `
        <div class="avatar">${b.avatar}</div>
        <div class="bname">${b.level}. ${escapeHtml(b.name)}</div>
        <div class="brating">≈${b.approx_rating} · ${escapeHtml(b.title)}</div>
        <div class="bblurb">${escapeHtml(b.blurb)}</div>`;
      card.onclick = () => {
        document.querySelectorAll(".bot-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectedBot = b;
        useSlider = false;
        $("startBotBtn").disabled = false;
        $("sliderPick").textContent = "";
      };
      grid.appendChild(card);
    });
  }

  function updateSliderDesc() {
    const elo = parseInt($("eloSlider").value, 10);
    $("eloValue").textContent = elo;
    $("eloDesc").textContent = eloDesc(elo);
  }
  $("eloSlider").addEventListener("input", () => {
    updateSliderDesc();
    // 슬라이더를 만지면 슬라이더 모드 선택
    useSlider = true;
    selectedBot = null;
    document.querySelectorAll(".bot-card").forEach((c) => c.classList.remove("selected"));
    $("sliderPick").textContent = "✓ 이 ELO로 대국합니다";
    $("startBotBtn").disabled = false;
  });

  // ---------- 대국 시작 ----------
  function startGame() {
    if (!selectedBot && !useSlider) return;
    playElo = useSlider ? parseInt($("eloSlider").value, 10) : selectedBot.approx_rating;

    let color = $("colorSelect").value;
    if (color === "random") color = Math.random() < 0.5 ? "white" : "black";
    myColor = color;

    game = new Chess();
    gameOver = false;
    timeLimit = parseInt($("botTimeSelect").value, 10) || 0;
    clocks = { me: timeLimit * 60, bot: timeLimit * 60 };

    $("selectView").classList.add("hidden");
    $("botGameView").classList.remove("hidden");
    const label = useSlider ? `🎯 ELO ${playElo} 봇` :
      `${selectedBot.avatar} ${selectedBot.name} (≈${selectedBot.approx_rating})`;
    $("botLabel").textContent = label;

    if (board) board.destroy();
    board = Chessboard("bot-board", {
      draggable: !TapMove.isTouch(),
      position: "start",
      orientation: myColor,
      pieceTheme: window.kiwiPieceTheme,
      onDragStart, onDrop, onSnapEnd,
    });
    tapHandle = TapMove.attach({
      boardId: "bot-board",
      getGame: () => game,
      canMove: () => !gameOver && game && game.turn() === myColor[0],
      getMoverColor: () => myColor[0],
      doMove: (from, to) => { attemptUserMove(from, to); },
    });

    Sounds.play("gameStart");
    renderMoves();
    updateStatus();
    renderBotClocks();
    startBotClock();
    if (myColor === "black") setTimeout(botMove, 400);
    window.addEventListener("resize", () => { if (board) board.resize(); });
  }

  function onDragStart(source, piece) {
    if (gameOver) return false;
    if (game.turn() !== myColor[0]) return false;
    if ((myColor === "white" && piece.search(/^b/) !== -1) ||
        (myColor === "black" && piece.search(/^w/) !== -1)) return false;
  }
  function onDrop(source, target) { return attemptUserMove(source, target) ? undefined : "snapback"; }
  function onSnapEnd() { board.position(game.fen()); }

  function attemptUserMove(source, target) {
    if (gameOver) return false;
    const move = game.move({ from: source, to: target, promotion: "q" });
    if (move === null) { Sounds.play("illegal"); return false; }
    if (tapHandle) tapHandle.clear();
    board.position(game.fen());
    Sounds.playForMove(move, game.in_check());
    renderMoves(); updateStatus(); renderBotClocks();
    if (checkGameOver()) return true;
    setTimeout(botMove, 350);
    return true;
  }

  function randomLegalMove() {
    const moves = game.moves({ verbose: true });
    if (!moves.length) return null;
    const m = moves[Math.floor(Math.random() * moves.length)];
    return m.from + m.to + (m.promotion || "");
  }

  async function botMove() {
    if (gameOver) return;
    $("botThinking").classList.add("show");
    const uci = await Engine.getMoveForElo(game.fen(), playElo, randomLegalMove);
    $("botThinking").classList.remove("show");
    if (!uci || gameOver) return;
    let move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : "q" });
    if (move === null) {
      const rnd = randomLegalMove();
      if (!rnd) return;
      move = game.move({ from: rnd.slice(0, 2), to: rnd.slice(2, 4), promotion: "q" });
    }
    board.position(game.fen());
    Sounds.playForMove(move, game.in_check());
    renderMoves(); updateStatus(); renderBotClocks();
    checkGameOver();
  }

  // ---------- 힌트 / 무르기 ----------
  async function showHint() {
    if (gameOver || game.turn() !== myColor[0]) return;
    $("hintBtn").disabled = true;
    const ev = await Engine.evaluate(game.fen());
    $("hintBtn").disabled = false;
    if (ev && ev.best) {
      const from = ev.best.slice(0, 2), to = ev.best.slice(2, 4);
      $("botStatus").textContent = `💡 힌트: ${from} → ${to}`;
      const boardEl = document.getElementById("bot-board");
      [from, to].forEach((sq) => {
        const el = boardEl.querySelector(`[data-square="${sq}"]`);
        if (el) { el.classList.add("tm-selected"); setTimeout(() => el.classList.remove("tm-selected"), 1800); }
      });
    }
  }
  function undoMove() {
    if (gameOver || !game.history().length) return;
    // 내 차례일 때: 봇 수 + 내 수 두 개를 되돌림
    game.undo();
    if (game.history().length && game.turn() !== myColor[0]) game.undo();
    if (tapHandle) tapHandle.clear();
    board.position(game.fen());
    renderMoves(); updateStatus();
  }

  // ---------- 상태/기보 ----------
  function updateStatus() {
    if (gameOver) return;
    let s = "";
    if (game.in_check()) s = "체크! ";
    s += game.turn() === myColor[0] ? "당신의 차례입니다." : "키위가 생각 중…";
    $("botStatus").textContent = s;
  }
  function renderMoves() {
    const hist = game.history();
    let html = "";
    for (let i = 0; i < hist.length; i += 2) {
      html += `${i / 2 + 1}. ${hist[i] || ""} ${hist[i + 1] || ""}<br>`;
    }
    const box = $("botMoveList");
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }
  function checkGameOver() {
    if (!game.game_over()) return false;
    gameOver = true;
    let outcome, reason;
    if (game.in_checkmate()) {
      outcome = game.turn() === myColor[0] ? "loss" : "win";
      reason = "체크메이트";
    } else if (game.in_stalemate()) { outcome = "draw"; reason = "스테일메이트"; }
    else if (game.in_threefold_repetition()) { outcome = "draw"; reason = "3회 동형반복"; }
    else if (game.insufficient_material()) { outcome = "draw"; reason = "기물 부족"; }
    else { outcome = "draw"; reason = "무승부"; }
    showResult(outcome, reason);
    return true;
  }
  function showResult(outcome, reason) {
    stopBotClock();
    const emoji = { win: "🏆", loss: "😢", draw: "🤝" }[outcome];
    const title = { win: "승리!", loss: "패배", draw: "무승부" }[outcome];
    $("botResultEmoji").textContent = emoji;
    $("botResultTitle").textContent = title;
    $("botResultText").textContent = `(${reason}) — 상대 ELO ${playElo}`;
    $("botResultModal").classList.add("show");
    Sounds.play(outcome === "win" ? "win" : outcome === "loss" ? "lose" : "draw");
    saveBotGame(outcome, reason);
  }

  /** 봇 대국을 서버에 저장 — 통찰의 '봇 대국 포함' 옵션에서 볼 수 있다.
   *  사람 상대 레이팅에는 영향을 주지 않는다. */
  async function saveBotGame(outcome, reason) {
    if (!API.getToken() || !game) return;
    try {
      await API.saveBotGame({
        color: myColor === "w" ? "white" : "black",
        result: outcome,
        reason: reason || "",
        pgn: game.pgn(),
        botName: (selectedBot && selectedBot.name) || ("Stockfish " + (playElo || "")),
        botElo: playElo || 0,
        minutes: Math.round((timeLimit || 0) / 60),
        increment: 0,
        plyCount: game.history().length,
      });
    } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }

  // ---------- 버튼 ----------
  $("startBotBtn").addEventListener("click", startGame);
  $("botResignBtn").addEventListener("click", () => {
    if (!gameOver && confirm("기권하시겠습니까?")) { gameOver = true; stopBotClock(); showResult("loss", "기권"); }
  });
  $("hintBtn").addEventListener("click", showHint);
  $("undoBtn").addEventListener("click", undoMove);
  function newGame() {
    $("botResultModal").classList.remove("show");
    stopBotClock();
    if (board) { board.destroy(); board = null; }
    gameOver = true;
    $("botGameView").classList.add("hidden");
    $("selectView").classList.remove("hidden");
  }
  $("botNewBtn").addEventListener("click", newGame);
  $("botResultOk").addEventListener("click", newGame);
  $("botResultReview").addEventListener("click", () => {
    try { if (game) localStorage.setItem("kiwi_review_pgn", game.pgn()); } catch (e) {}
    location.href = window.kiwiPageUrl ? window.kiwiPageUrl("/analysis.html") : "/analysis.html";
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  loadBots();
})();
