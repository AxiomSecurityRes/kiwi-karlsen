/* puzzles.html 퍼즐 트레이너 로직 */
(function () {
  const $ = (id) => document.getElementById(id);

  let board = null;
  let game = null;
  let puzzle = null;        // {id, fen, moves[], rating, themes}
  let solverColor = "w";    // 풀이자 색 (첫 수 자동재생 후 둘 차례)
  let solutionIndex = 0;    // moves 배열에서 다음에 둬야 할 인덱스
  let solved = false;
  let failed = false;
  let shown = false;
  let solvedCount = 0;
  let failCount = 0;

  function setStatus(text, color) {
    const el = $("puzzleStatus");
    el.textContent = text;
    el.style.color = color || "var(--kiwi-green-dark)";
  }

  async function loadPuzzle() {
    setStatus("불러오는 중…");
    const [min, max] = $("diffSelect").value.split("-").map(Number);
    try {
      puzzle = await API.randomPuzzle(min, max);
    } catch (e) {
      setStatus("퍼즐을 불러오지 못했습니다.", "var(--danger)");
      return;
    }
    setupPuzzle();
  }

  function setupPuzzle() {
    solutionIndex = 0;
    solved = false;
    failed = false;
    shown = false;

    game = new Chess(puzzle.fen);

    // 첫 수(상대 수)를 둔 뒤 풀이자 차례가 됨 → 풀이자 색 결정
    const firstMove = puzzle.moves[0];
    const afterFirstTurn = (game.turn() === "w") ? "b" : "w";
    solverColor = afterFirstTurn;

    $("puzzleId").textContent = puzzle.id;
    $("puzzleRating").textContent = puzzle.rating;
    $("puzzleThemes").textContent = puzzle.themes || "-";
    $("puzzleTurn").textContent = solverColor === "w" ? "백 (White)" : "흑 (Black)";

    if (board) board.destroy();
    board = Chessboard("puzzle-board", {
      draggable: true,
      position: puzzle.fen,
      orientation: solverColor === "w" ? "white" : "black",
      pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
      onDragStart,
      onDrop,
      onSnapEnd,
    });

    setStatus("상대가 수를 두는 중…");
    // 첫 수 자동 재생
    setTimeout(() => {
      applyUci(firstMove);
      solutionIndex = 1;
      board.position(game.fen());
      setStatus("당신 차례! 최선의 수를 찾으세요.");
    }, 600);

    window.addEventListener("resize", () => { if (board) board.resize(); });
  }

  function applyUci(uci) {
    const move = game.move({
      from: uci.slice(0, 2), to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : "q",
    });
    if (move) Sounds.playForMove(move, game.in_check());
    return move;
  }

  function onDragStart(source, piece) {
    if (solved || shown) return false;
    if (game.turn() !== solverColor) return false;
    if ((solverColor === "w" && piece.search(/^b/) !== -1) ||
        (solverColor === "b" && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  function onDrop(source, target) {
    if (solved || shown) return "snapback";
    const expected = puzzle.moves[solutionIndex];
    const promotion = (expected && expected.length > 4) ? expected[4] : "q";

    const move = game.move({ from: source, to: target, promotion });
    if (move === null) { Sounds.play("illegal"); return "snapback"; }

    const playedUci = source + target + (move.promotion || "");
    const expectedNorm = expected.slice(0, 4) + (expected.length > 4 ? expected[4] : "");

    // 정답 비교 (외통이면 정답 처리: Lichess 식 관용)
    const isCorrect = (playedUci.slice(0, 4) === expectedNorm.slice(0, 4)) || game.in_checkmate();

    if (!isCorrect) {
      game.undo();
      Sounds.play("illegal");
      if (!failed) {           // 실패는 퍼즐당 1회만 집계
        failed = true;
        failCount++;
        $("failCount").textContent = failCount;
      }
      setStatus("❌ 그 수가 아니에요. 다시 시도하거나 힌트를 눌러보세요.", "var(--danger)");
      API.puzzleSolved(puzzle.id, false).catch(() => {});
      return "snapback";       // 잠그지 않고 계속 시도 가능
    }

    Sounds.playForMove(move, game.in_check());
    solutionIndex++;

    if (solutionIndex >= puzzle.moves.length) {
      finishSolved();
      return;
    }

    // 상대 응수 자동 재생
    setStatus("정답! 상대 응수 중…");
    setTimeout(() => {
      applyUci(puzzle.moves[solutionIndex]);
      solutionIndex++;
      board.position(game.fen());
      if (solutionIndex >= puzzle.moves.length) {
        finishSolved();
      } else {
        setStatus("좋아요! 계속 진행하세요.");
      }
    }, 450);
  }

  function onSnapEnd() { board.position(game.fen()); }

  function finishSolved() {
    solved = true;
    solvedCount++;
    $("solvedCount").textContent = solvedCount;
    setStatus("✅ 퍼즐 성공! 잘하셨어요. 🥝", "var(--kiwi-green-dark)");
    Sounds.play("win");
    API.puzzleSolved(puzzle.id, true).catch(() => {});
  }

  function showHint() {
    if (solved || failed || !puzzle) return;
    const expected = puzzle.moves[solutionIndex];
    if (!expected) return;
    const from = expected.slice(0, 2);
    setStatus(`💡 힌트: ${from} 에 있는 기물을 살펴보세요.`, "var(--gold)");
    // 해당 칸 강조
    const sq = document.querySelector(`#puzzle-board .square-${from}`);
    if (sq) {
      sq.classList.add("highlight-square");
      setTimeout(() => sq.classList.remove("highlight-square"), 1500);
    }
  }

  function showSolution() {
    if (solved || shown || !puzzle) return;
    shown = true;
    setStatus("👁️ 정답을 재생합니다…", "var(--gold)");
    function step() {
      if (solutionIndex >= puzzle.moves.length) {
        setStatus("정답 시퀀스 종료. '다음 퍼즐'로 진행하세요.", "var(--kiwi-green-dark)");
        return;
      }
      applyUci(puzzle.moves[solutionIndex]);
      solutionIndex++;
      board.position(game.fen());
      setTimeout(step, 650);
    }
    step();
  }

  // ---- 버튼 ----
  $("nextBtn").addEventListener("click", loadPuzzle);
  $("retryBtn").addEventListener("click", () => { if (puzzle) setupPuzzle(); });
  $("hintBtn").addEventListener("click", showHint);
  $("solutionBtn").addEventListener("click", showSolution);
  $("diffSelect").addEventListener("change", loadPuzzle);

  loadPuzzle();
})();
