/* index.html 온라인 대국 로직 (WebSocket 실시간 대국 + 서버 클럭 + 채팅 + 무승부) */
(function () {
  let lastOpponent = null;   // 재대국 상대 { id, username }
  let lastTC = { minutes: 10, increment: 0 };
  let lastOpeningKey = "";
  const $ = (id) => document.getElementById(id);

  let board = null;
  let tapHandle = null;
  let game = null;
  let myColor = "white";
  let gameId = null;
  let myTurn = false;
  let gameOver = true;

  // 서버 권위 클럭(ms). 서버가 'clock'/'opponent_move'/'move_ack'로 동기화.
  let clocks = { white: 600000, black: 600000 };
  let lastSyncTs = 0;
  let displayTimer = null;

  function fmt(ms) {
    ms = Math.max(0, ms);
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function setClocks(serverClocks) {
    clocks = { ...serverClocks };
    lastSyncTs = Date.now();
    renderClocks();
  }

  function renderClocks() {
    const oppColor = myColor === "white" ? "black" : "white";
    // 둘 차례인 쪽은 마지막 동기화 이후 흐른 시간을 보간해서 표시
    let dispWhite = clocks.white, dispBlack = clocks.black;
    if (!gameOver && game) {
      const elapsed = Date.now() - lastSyncTs;
      if (game.turn() === "w") dispWhite = Math.max(0, clocks.white - elapsed);
      else dispBlack = Math.max(0, clocks.black - elapsed);
    }
    $("myClock").textContent = fmt(myColor === "white" ? dispWhite : dispBlack);
    $("oppClock").textContent = fmt(oppColor === "white" ? dispWhite : dispBlack);
    const turnColor = game ? (game.turn() === "w" ? "white" : "black") : "white";
    $("myClock").classList.toggle("active", turnColor === myColor && !gameOver);
    $("oppClock").classList.toggle("active", turnColor === oppColor && !gameOver);
  }

  function startDisplayLoop() {
    stopDisplayLoop();
    displayTimer = setInterval(renderClocks, 250);
  }
  function stopDisplayLoop() { if (displayTimer) clearInterval(displayTimer); displayTimer = null; }

  function updateStatus() {
    if (gameOver) return;
    let s = "";
    if (game.in_check()) s = "체크! ";
    s += myTurn ? "당신 차례입니다." : "상대 차례입니다.";
    $("gameStatus").textContent = s.trim();
  }

  function renderMoves() {
    updateOpeningName();
    const hist = game.history();
    let html = "";
    for (let i = 0; i < hist.length; i += 2) {
      html += `${i / 2 + 1}. ${hist[i] || ""} ${hist[i + 1] || ""}<br>`;
    }
    const box = $("moveList");
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  function addChat(who, text, isMe, isSys) {
    const box = $("chatBox");
    const div = document.createElement("div");
    if (isSys) {
      div.className = "msg sys";
      div.textContent = text;
    } else {
      div.className = "msg" + (isMe ? " me" : "");
      div.innerHTML = `<span class="who">${window.kiwiEscapeHtml(who)}:</span> ${window.kiwiEscapeHtml(text)}`;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // ---- chessboard.js 콜백 ----
  function onDragStart(source, piece) {
    if (gameOver || !myTurn) return false;
    if ((myColor === "white" && piece.search(/^b/) !== -1) ||
        (myColor === "black" && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  function onDrop(source, target) {
    const ok = attemptUserMove(source, target);
    return ok ? undefined : "snapback";
  }

  function attemptUserMove(source, target) {
    if (gameOver || !myTurn) return false;
    const move = game.move({ from: source, to: target, promotion: "q" });
    if (move === null) { Sounds.play("illegal"); return false; }
    if (tapHandle) tapHandle.clear();
    const uci = source + target + (move.promotion ? move.promotion : "");
    Socket.send({ type: "move", gameId, uci });
    board.position(game.fen());
    Sounds.playForMove(move, game.in_check());
    afterAnyMove();
    return true;
  }

  function onSnapEnd() { board.position(game.fen()); }

  function afterAnyMove() {
    myTurn = game.turn() === myColor[0];
    renderMoves();
    renderClocks();
    updateStatus();
  }

  // ---- 대국 시작 ----
  function startGame(msg) {
    if (window.kiwiHideLoading) window.kiwiHideLoading();
    gameId = msg.gameId;
    myColor = msg.color;
    gameOver = false;
    game = new Chess(msg.fen);
    setClocks(msg.clocks || { white: 600000, black: 600000 });
    $("chatBox").innerHTML = "";
    addChat(null, `대국 시작! ${(msg.clocks.white / 60000)}분 게임입니다. 행운을 빌어요 🥝`, false, true);

    const me = API.getUser();
    $("meLabel").textContent = `🥝 ${me ? me.username : "나"} (${me ? me.rating : ""})`;
    $("opponentLabel").textContent = `🥝 ${msg.opponent.name} (${msg.opponent.rating})`;

    // 재대국을 위해 상대와 시간제어 기억
    if (msg.opponent && msg.opponent.id) {
      lastOpponent = { id: msg.opponent.id, username: msg.opponent.name };
    }
    lastTC = {
      minutes: Math.round((msg.clocks && msg.clocks.white ? msg.clocks.white : 600000) / 60000),
      increment: msg.increment || 0,
    };
    lastOpeningKey = "";
    const opEl = document.getElementById("openingLive");
    if (opEl) opEl.textContent = "";

    if (window.kiwiShowGame) window.kiwiShowGame();

    if (board) board.destroy();
    board = Chessboard("board", {
      draggable: !TapMove.isTouch(), position: msg.fen, orientation: myColor,
      pieceTheme: window.kiwiPieceTheme,
      onDragStart, onDrop, onSnapEnd,
    });
    tapHandle = TapMove.attach({
      boardId: "board",
      getGame: () => game,
      canMove: () => !gameOver && myTurn,
      getMoverColor: () => myColor[0],
      doMove: (from, to) => { attemptUserMove(from, to); },
    });

    myTurn = game.turn() === myColor[0];
    $("resignBtn").classList.remove("hidden");
    $("drawBtn").classList.remove("hidden");
    $("drawBtn").disabled = false;
    $("backToLobbyBtn").classList.add("hidden");

    Sounds.play("gameStart");
    renderMoves();
    renderClocks();
    updateStatus();
    startDisplayLoop();
    window.addEventListener("resize", resizeBoard);
  }

  function resizeBoard() { if (board) board.resize(); }

  // ---- 상대 수 / 확인 ----
  Socket.on("opponent_move", (msg) => {
    if (tapHandle) tapHandle.clear();
    const move = game.move({
      from: msg.uci.slice(0, 2), to: msg.uci.slice(2, 4),
      promotion: msg.uci.length > 4 ? msg.uci[4] : "q",
    });
    board.position(game.fen());
    if (msg.clocks) setClocks(msg.clocks);
    Sounds.playForMove(move, game.in_check());
    afterAnyMove();
  });

  Socket.on("move_ack", (msg) => {
    if (msg.clocks) setClocks(msg.clocks);
    if (game.fen() !== msg.fen) {
      game.load(msg.fen);
      board.position(msg.fen);
      afterAnyMove();
    }
  });

  Socket.on("invalid_move", (msg) => {
    game.load(msg.fen);
    board.position(msg.fen);
    Sounds.play("illegal");
    afterAnyMove();
  });

  Socket.on("clock", (msg) => { if (!gameOver && msg.clocks) setClocks(msg.clocks); });

  // ---- 채팅 ----
  Socket.on("chat", (msg) => addChat(msg.from, msg.text, !!msg.self, false));

  function sendChat() {
    const input = $("chatInput");
    const text = input.value.trim();
    if (!text || !gameId || gameOver) return;
    Socket.send({ type: "chat", text });
    input.value = "";
  }
  $("chatSend").addEventListener("click", sendChat);
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  // ---- 무승부 제안 ----
  $("drawBtn").addEventListener("click", () => {
    if (gameOver) return;
    Socket.send({ type: "draw_offer" });
    $("drawBtn").disabled = true;
    addChat(null, "무승부를 제안했습니다.", false, true);
  });

  Socket.on("draw_sent", () => { /* 이미 UI 처리됨 */ });

  Socket.on("draw_offered", (msg) => {
    const el = window.kiwiToast(
      `🤝 <b>${window.kiwiEscapeHtml(msg.fromName)}</b> 님이 무승부를 제안했습니다.
       <div class="t-actions">
         <button class="btn small" data-accept>수락</button>
         <button class="btn small secondary" data-decline>거절</button>
       </div>`,
      { challenge: true, persist: true }
    );
    el.querySelector("[data-accept]").onclick = () => {
      Socket.send({ type: "draw_response", accept: true });
      el.remove();
    };
    el.querySelector("[data-decline]").onclick = () => {
      Socket.send({ type: "draw_response", accept: false });
      el.remove();
    };
  });

  Socket.on("draw_declined", (msg) => {
    $("drawBtn").disabled = false;
    addChat(null, `${msg.byName} 님이 무승부 제안을 거절했습니다.`, false, true);
  });

  // ---- 대국 종료 ----
  Socket.on("game_over", (msg) => {
    gameOver = true;
    stopDisplayLoop();
    renderClocks();
    $("resignBtn").classList.add("hidden");
    $("drawBtn").classList.add("hidden");
    $("backToLobbyBtn").classList.remove("hidden");

    const emoji = { win: "🏆", loss: "😢", draw: "🤝" }[msg.outcome];
    const title = { win: "승리!", loss: "패배", draw: "무승부" }[msg.outcome];
    const reasonKo = {
      checkmate: "체크메이트", resign: "기권", abandon: "상대 이탈",
      stalemate: "스테일메이트", draw: "무승부", timeout: "시간 초과",
      agreement: "합의 무승부",
    }[msg.reason] || msg.reason;

    $("resultEmoji").textContent = emoji;
    $("resultTitle").textContent = title;
    $("resultText").textContent = `(${reasonKo})`;
    const delta = msg.ratingDelta >= 0 ? `+${msg.ratingDelta}` : `${msg.ratingDelta}`;
    $("resultRating").textContent = msg.newRating != null ? `레이팅: ${msg.newRating} (${delta})` : "";
    $("resultModal").classList.add("show");

    Sounds.play(msg.outcome === "win" ? "win" : msg.outcome === "loss" ? "lose" : "draw");

    const me = API.getUser();
    if (me && msg.newRating != null) {
      me.rating = msg.newRating;
      API.setSession(API.getToken(), me);
      $("userChip").textContent = `${me.username} (${me.rating})`;
    }
  });

  // ---- 버튼 ----
  $("resignBtn").addEventListener("click", () => {
    if (!gameOver && confirm("정말 기권하시겠습니까?")) {
      Socket.send({ type: "resign", gameId });
    }
  });

  function backToLobby() {
    $("resultModal").classList.remove("show");
    if (board) { board.destroy(); board = null; }
    gameId = null;
    if (window.kiwiShowLobby) window.kiwiShowLobby();
  }
  $("resultOk").addEventListener("click", backToLobby);
  $("backToLobbyBtn").addEventListener("click", backToLobby);
  // ---- 오프닝 이름 실시간 표시 ----
  async function updateOpeningName() {
    const el = document.getElementById("openingLive");
    if (!el || !game) return;
    const hist = game.history();
    if (!hist.length || hist.length > 24) { return; }
    const key = hist.join(",");
    if (key === lastOpeningKey) return;
    lastOpeningKey = key;
    try {
      const data = await API.openings(hist);
      if (data && data.opening) el.textContent = `📖 ${data.opening.name} (${data.opening.eco})`;
    } catch (e) { /* noop */ }
  }

  // ---- 재대국 ----
  $("resultRematch").addEventListener("click", () => {
    if (!lastOpponent) {
      if (window.kiwiToast) window.kiwiToast("⚠️ 재대국 상대를 찾을 수 없습니다.");
      return;
    }
    Socket.send({ type: "rematch", toId: lastOpponent.id,
                  minutes: lastTC.minutes || 10, increment: lastTC.increment || 0 });
    $("resultModal").classList.remove("show");
    if (window.kiwiShowLoading) {
      window.kiwiShowLoading("재대국 신청", `${lastOpponent.username} 님의 응답을 기다리는 중…`);
    }
  });

  $("resultReview").addEventListener("click", () => {
    try { if (game) localStorage.setItem("kiwi_review_pgn", game.pgn()); } catch (e) {}
    location.href = window.kiwiPageUrl ? window.kiwiPageUrl("/analysis.html") : "/analysis.html";
  });

  // ---- 소켓 이벤트 ----
  Socket.on("game_start", startGame);
  Socket.on("error", (msg) => {
    if (window.kiwiHideLoading) window.kiwiHideLoading();
    if (window.kiwiToast) window.kiwiToast(`⚠️ ${window.kiwiEscapeHtml(msg.message)}`);
  });
})();
