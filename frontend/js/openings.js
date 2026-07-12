/* openings.html — 오프닝 탐색기 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  let game = new Chess();
  let board = null;
  let tapHandle = null;
  let orientation = "white";
  let history = [];   // SAN 수순

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

  function renderMoves() {
    if (!history.length) {
      $("opMoves").textContent = "아직 수가 없습니다. 오른쪽에서 정석 수를 고르거나 기물을 직접 움직이세요.";
      return;
    }
    let out = "";
    for (let i = 0; i < history.length; i += 2) {
      out += `${i / 2 + 1}. ${history[i]} ${history[i + 1] || ""} `;
    }
    $("opMoves").textContent = out.trim();
  }

  async function refresh() {
    renderMoves();
    try {
      const data = await API.openings(history);
      const op = data.opening;
      if (op) {
        $("opName").textContent = op.name;
        $("opEco").textContent = `${op.eco} · ${op.moves.join(" ")}`;
      } else {
        $("opName").textContent = history.length ? "정석에서 벗어남" : "시작 국면";
        $("opEco").textContent = history.length
          ? "이 수순은 등록된 오프닝에 없습니다."
          : `오프닝 ${data.total.toLocaleString()}종 · 정석 국면 ${(data.positions || 0).toLocaleString()}개 수록`;
      }

      const box = $("opNext");
      if (!data.continuations.length) {
        box.innerHTML = '<p class="muted">더 이어지는 정석 수가 없습니다. 자유롭게 두어 보세요.</p>';
        return;
      }
      box.innerHTML = data.continuations.map((c) => `
        <button class="op-move" data-san="${esc(c.san)}">
          <b>${esc(c.san)}</b>
          <span class="muted">${esc(c.name || "")}</span>
          <span class="op-eco">${esc(c.eco || "")}</span>
        </button>`).join("");
      box.querySelectorAll(".op-move").forEach((b) => {
        b.addEventListener("click", () => playSan(b.getAttribute("data-san")));
      });
    } catch (e) {
      $("opNext").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  // 버튼
  $("opBack").addEventListener("click", () => {
    if (!history.length) return;
    game.undo();
    history.pop();
    if (tapHandle) tapHandle.clear();
    board.position(game.fen());
    refresh();
  });
  $("opFlip").addEventListener("click", () => {
    orientation = orientation === "white" ? "black" : "white";
    board.orientation(orientation);
  });
  $("opReset").addEventListener("click", () => {
    game = new Chess();
    history = [];
    if (tapHandle) tapHandle.clear();
    board.position("start");
    refresh();
  });

  async function doSearch() {
    const q = $("opSearch").value.trim();
    if (!q) return;
    try {
      const { results } = await API.openingsSearch(q);
      const box = $("opResults");
      if (!results.length) { box.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>'; return; }
      box.innerHTML = results.map((r, i) => `
        <div class="player-row op-result" data-idx="${i}">
          <span class="name">${esc(r.name)}</span>
          <span class="rating">${esc(r.eco)}</span>
        </div>`).join("");
      box.querySelectorAll(".op-result").forEach((row) => {
        row.addEventListener("click", () => {
          const r = results[parseInt(row.getAttribute("data-idx"), 10)];
          game = new Chess();
          history = [];
          r.moves.forEach((san) => {
            const m = game.move(san);
            if (m) history.push(m.san);
          });
          if (tapHandle) tapHandle.clear();
          board.position(game.fen());
          refresh();
        });
      });
    } catch (e) {
      $("opResults").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }
  $("opSearchBtn").addEventListener("click", doSearch);
  $("opSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  buildBoard();
  refresh();
})();
