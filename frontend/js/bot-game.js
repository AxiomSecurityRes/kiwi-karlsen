/* play.html 봇 대국 로직 */
(function () {
  const $ = (id) => document.getElementById(id);

  let bots = [];
  let selectedBot = null;
  let board = null;
  let game = null;
  let myColor = "white";
  let gameOver = true;

  // 클럭 (초). 0 = 제한 없음
  let timeLimit = 0;
  let clocks = { me: 0, bot: 0 };
  let clockTimer = null;

  function fmtClock(sec) {
    if (timeLimit === 0) return "∞";
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
        clocks[side] = 0;
        renderBotClocks();
        gameOver = true;
        stopBotClock();
        showResult(side === "me" ? "loss" : "win", "시간 초과");
        return;
      }
      renderBotClocks();
    }, 1000);
  }
  function stopBotClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }

  // ---- 봇 목록 로드 ----
  async function loadBots() {
    try {
      const res = await API.bots();
      bots = res.bots;
    } catch (e) {
      // API 실패 시 최소 동작용 기본값
      bots = [{ level: 1, name: "Kiwi Baby", title: "입문", approx_rating: 250,
                skill: 0, elo: null, depth: 1, movetime: 50, randomness: 0.7,
                blurb: "아기 키위", avatar: "🥝" }];
    }
    renderBotGrid();
    initEngine();
  }

  async function initEngine() {
    const ok = await Engine.init();
    $("engineNote").textContent = ok
      ? "✅ 브라우저 Stockfish 엔진(WASM) 사용 중 — 가장 강력합니다."
      : "ℹ️ 현재 백엔드/내장 엔진으로 동작합니다. (assets/engine/stockfish.js 추가 시 더 강해집니다)";
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
        <div class="brating">~${b.approx_rating} · ${escapeHtml(b.title)}</div>
        <div class="bblurb">${escapeHtml(b.blurb)}</div>`;
      card.onclick = () => {
        document.querySelectorAll(".bot-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectedBot = b;
        $("startBotBtn").disabled = false;
      };
      grid.appendChild(card);
    });
  }

  // ---- 대국 시작 ----
  function startGame() {
    if (!selectedBot) return;
    let color = $("colorSelect").value;
    if (color === "random") color = Math.random() < 0.5 ? "white" : "black";
    myColor = color;

    game = new Chess();
    gameOver = false;

    timeLimit = parseInt($("botTimeSelect").value, 10) || 0;
    clocks = { me: timeLimit * 60, bot: timeLimit * 60 };

    $("selectView").classList.add("hidden");
    $("botGameView").classList.remove("hidden");
    $("botLabel").textContent = `${selectedBot.avatar} ${selectedBot.name} (~${selectedBot.approx_rating})`;

    if (board) board.destroy();
    board = Chessboard("bot-board", {
      draggable: true,
      position: "start",
      orientation: myColor,
      pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
      onDragStart,
      onDrop,
      onSnapEnd,
    });

    Sounds.play("gameStart");
    renderMoves();
    updateStatus();
    renderBotClocks();
    startBotClock();

    // 흑 선택 시 봇(백)이 먼저 둠
    if (myColor === "black") setTimeout(botMove, 400);
    window.addEventListener("resize", () => { if (board) board.resize(); });
  }

  function onDragStart(source, piece) {
    if (gameOver) return false;
    if (game.turn() !== myColor[0]) return false;
    if ((myColor === "white" && piece.search(/^b/) !== -1) ||
        (myColor === "black" && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: "q" });
    if (move === null) { Sounds.play("illegal"); return "snapback"; }
    Sounds.playForMove(move, game.in_check());
    renderMoves();
    updateStatus();
    if (checkGameOver()) return;
    setTimeout(botMove, 350);
  }

  function onSnapEnd() { board.position(game.fen()); }

  // ---- 봇 한 수 ----
  function randomLegalMove() {
    const moves = game.moves({ verbose: true });
    if (!moves.length) return null;
    const m = moves[Math.floor(Math.random() * moves.length)];
    return m.from + m.to + (m.promotion || "");
  }

  async function botMove() {
    if (gameOver) return;
    $("botThinking").classList.add("show");
    const uci = await Engine.getBestMove(game.fen(), selectedBot, randomLegalMove);
    $("botThinking").classList.remove("show");
    if (!uci || gameOver) return;

    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : "q",
    });
    if (move === null) {
      // 비정상 응답 방어: 무작위 합법수
      const rnd = randomLegalMove();
      if (rnd) {
        const rmove = game.move({ from: rnd.slice(0, 2), to: rnd.slice(2, 4), promotion: "q" });
        board.position(game.fen());
        Sounds.playForMove(rmove, game.in_check());
        renderMoves();
        updateStatus();
        checkGameOver();
      }
      return;
    }
    board.position(game.fen());
    Sounds.playForMove(move, game.in_check());
    renderMoves();
    updateStatus();
    checkGameOver();
  }

  // ---- 상태/기보 ----
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
      const loserIsMe = game.turn() === myColor[0];
      outcome = loserIsMe ? "loss" : "win";
      reason = "체크메이트";
    } else if (game.in_stalemate()) {
      outcome = "draw"; reason = "스테일메이트";
    } else if (game.in_threefold_repetition()) {
      outcome = "draw"; reason = "3회 동형반복";
    } else if (game.insufficient_material()) {
      outcome = "draw"; reason = "기물 부족 무승부";
    } else {
      outcome = "draw"; reason = "50수 규칙 등 무승부";
    }
    showResult(outcome, reason);
    return true;
  }

  function showResult(outcome, reason) {
    stopBotClock();
    const emoji = { win: "🏆", loss: "😢", draw: "🤝" }[outcome];
    const title = { win: "승리!", loss: "패배", draw: "무승부" }[outcome];
    $("botResultEmoji").textContent = emoji;
    $("botResultTitle").textContent = title;
    $("botResultText").textContent = `(${reason})`;
    $("botResultModal").classList.add("show");
    Sounds.play(outcome === "win" ? "win" : outcome === "loss" ? "lose" : "draw");
  }

  // ---- 버튼 ----
  $("startBotBtn").addEventListener("click", startGame);
  $("botResignBtn").addEventListener("click", () => {
    if (!gameOver && confirm("기권하시겠습니까?")) { gameOver = true; stopBotClock(); showResult("loss", "기권"); }
  });
  function newGame() {
    $("botResultModal").classList.remove("show");
    if (board) { board.destroy(); board = null; }
    $("botGameView").classList.add("hidden");
    $("selectView").classList.remove("hidden");
  }
  $("botNewBtn").addEventListener("click", newGame);
  $("botResultOk").addEventListener("click", newGame);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  loadBots();
})();
