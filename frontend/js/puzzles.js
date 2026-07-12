/* puzzles.html 퍼즐 트레이너 로직 */
(function () {
  const $ = (id) => document.getElementById(id);

  let board = null;
  let tapHandle = null;
  let game = null;
  let puzzle = null;        // {id, fen, moves[], rating, themes}
  let solverColor = "w";    // 풀이자 색 (첫 수 자동재생 후 둘 차례)
  let solutionIndex = 0;    // moves 배열에서 다음에 둬야 할 인덱스
  let solved = false;
  let failed = false;
  let shown = false;
  let solvedCount = 0;
  let failCount = 0;

  let themesRevealed = false;
  function revealThemes() {
    if (themesRevealed || !puzzle) return;
    themesRevealed = true;
    const raw = (puzzle.themes || "").trim();
    $("puzzleThemes").textContent = raw ? raw : "-";
  }

  function setStatus(text, color) {
    const el = $("puzzleStatus");
    el.textContent = text;
    el.style.color = color || "var(--kiwi-green-dark)";
  }

  function ratingRange() {
    let min = parseInt($("pzMin").value, 10) || 100;
    let max = parseInt($("pzMax").value, 10) || 3500;
    if (min > max) { const t = min; min = max; max = t; }
    return [min, max];
  }

  async function loadPuzzle() {
    setStatus("불러오는 중…");
    const [min, max] = ratingRange();
    const theme = $("themeSelect").value;
    try {
      puzzle = await API.randomPuzzle(min, max, theme);
    } catch (e) {
      showEmptyState();
      return;
    }
    if (!puzzle || !puzzle.fen || !puzzle.moves || puzzle.moves.length < 2) {
      showEmptyState();
      return;
    }
    setupPuzzle();
  }

  function showEmptyState() {
    setStatus("퍼즐 데이터가 없습니다.", "var(--danger)");
    $("puzzleId").textContent = "-";
    const boardEl = document.getElementById("puzzle-board");
    boardEl.innerHTML = `<div style="padding:24px;background:var(--kiwi-cream);border-radius:12px;line-height:1.7;">
      <b>🧩 Lichess 퍼즐 DB를 업로드하세요</b><br>
      1. <a href="https://database.lichess.org/lichess_db_puzzle.csv.zst" target="_blank">lichess_db_puzzle.csv.zst</a> 다운로드<br>
      2. 압축 해제 후 <b>일부만(2~4만 개)</b> 샘플링 — 전체 파일은 GitHub 100MB 제한에 걸립니다<br>
      3. 프로젝트의 <code>data/puzzles.csv</code> 로 저장 → git push<br>
      자세한 방법: 저장소의 <code>scripts/download_puzzles.md</code></div>`;
  }

  async function loadThemes() {
    try {
      const { themes, total } = await API.puzzleThemes();
      const sel = $("themeSelect");
      themes.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.code;
        opt.textContent = `${t.label} (${t.count})`;
        sel.appendChild(opt);
      });
      if (total) setStatus(`총 ${total.toLocaleString()}개 퍼즐 로드됨.`);
    } catch (e) { /* noop */ }
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
    // 테마는 힌트/정답/해결 전까지 숨긴다 (미리 보면 스포일러)
    themesRevealed = false;
    $("puzzleThemes").textContent = "❓ (힌트·정답·해결 시 공개)";
    $("puzzleTurn").textContent = solverColor === "w" ? "백 (White)" : "흑 (Black)";

    if (board) board.destroy();
    board = Chessboard("puzzle-board", {
      draggable: !TapMove.isTouch(),
      position: puzzle.fen,
      orientation: solverColor === "w" ? "white" : "black",
      pieceTheme: window.kiwiPieceTheme,
      onDragStart,
      onDrop,
      onSnapEnd,
    });
    if (tapHandle) tapHandle.clear();
    tapHandle = TapMove.attach({
      boardId: "puzzle-board",
      getGame: () => game,
      canMove: () => !solved && !shown && game && game.turn() === solverColor,
      getMoverColor: () => solverColor,
      doMove: (from, to) => { onDrop(from, to); board.position(game.fen()); },
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

      // 러시: 한 번 틀리면 즉시 다음 문제(실수 카운트)
      if (mode === "rush") {
        setStatus("❌ 실수! 다음 문제로 넘어갑니다.", "var(--danger)");
        if (window.kiwiRushMiss) window.kiwiRushMiss();
        return "snapback";
      }
      // 일일: 한 번 틀리면 실패로 확정(하루 한 번)
      if (mode === "daily" && dailyActive) {
        dailyActive = false;
        revealThemes();
        finishDaily(false);
        return "snapback";
      }

      const rated = isRated();
      API.puzzleSolved(puzzle.id, false, rated)
        .then((r) => {
          if (r && r.counted && r.puzzleRatingChange) {
            setStatus(`❌ 실패 — 퍼즐 레이팅 ${r.puzzleRatingAfter} (${r.puzzleRatingChange})  · 계속 시도해도 점수는 변하지 않습니다.`,
                      "var(--danger)");
          } else {
            setStatus(rated
              ? "❌ 그 수가 아니에요. (이미 채점된 퍼즐이라 점수는 그대로입니다)"
              : "❌ 그 수가 아니에요. 연습 모드라 점수에 반영되지 않습니다.", "var(--danger)");
          }
          if (window.kiwiRefreshPuzzleRating) window.kiwiRefreshPuzzleRating();
        })
        .catch(() => {
          setStatus("❌ 그 수가 아니에요. 다시 시도하거나 힌트를 눌러보세요.", "var(--danger)");
        });
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
      if (tapHandle) tapHandle.clear();
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
    revealThemes();

    // 러시: 점수 +1 후 다음 문제
    if (mode === "rush") {
      setStatus("✅ 정답! 다음 문제…", "var(--accent-strong)");
      if (window.kiwiRushMiss) { /* 러시 모드에서는 rushCorrect 가 처리 */ }
      rushCorrect();
      return;
    }
    // 일일: 하루 한 번 기록
    if (mode === "daily" && dailyActive) {
      dailyActive = false;
      finishDaily(true);
      return;
    }

    Sounds.play("win");
    const rated = isRated();
    // 이 퍼즐에서 이미 틀렸다면 '성공'으로 집계하지 않는다(중복 집계 방지)
    if (!failed) {
      solvedCount++;
      $("solvedCount").textContent = solvedCount;
    }
    setStatus("✅ 퍼즐 성공!", "var(--accent-strong)");

    API.puzzleSolved(puzzle.id, true, rated)
      .then((r) => {
        if (!r) return;
        if (!r.rated) {
          setStatus("✅ 퍼즐 성공! (연습 모드 — 레이팅에 반영되지 않습니다)", "var(--accent-strong)");
        } else if (r.counted) {
          const sign = r.puzzleRatingChange >= 0 ? "+" : "";
          setStatus(`✅ 퍼즐 성공! 퍼즐 레이팅 ${r.puzzleRatingAfter} (${sign}${r.puzzleRatingChange})`,
                    "var(--accent-strong)");
        } else if (r.alreadyAttempted) {
          setStatus(r.firstResult
            ? "✅ 정답입니다. (이미 푼 퍼즐이라 점수는 그대로입니다)"
            : "✅ 정답입니다. (앞서 틀린 퍼즐이라 점수에 반영되지 않습니다)",
            "var(--accent-strong)");
        }
        if (r.newAchievements) showAchievements(r.newAchievements);
        if (window.kiwiRefreshPuzzleRating) window.kiwiRefreshPuzzleRating();
        if (window.kiwiNotifyRefresh) window.kiwiNotifyRefresh();
      })
      .catch(() => {});
  }

  function showHint() {
    if (solved || failed || !puzzle) return;
    revealThemes();
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
    revealThemes();
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
  $("pzApply").addEventListener("click", loadPuzzle);
  $("themeSelect").addEventListener("change", loadPuzzle);

  loadThemes();
  loadPuzzle();


  /* ==================== 모드: 훈련 / 일일 / 러시 ==================== */
  let mode = "train";
  let dailySeconds = 0;
  let dailyTimer = null;

  function setMode(next) {
    mode = next;
    document.querySelectorAll("#pzTabs .tab-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-mode") === next);
    });
    $("dailyCard").classList.toggle("hidden", next !== "daily");
    $("rushCard").classList.toggle("hidden", next !== "rush");
    $("trainView").classList.toggle("hidden", next === "daily" && !dailyActive);
    stopRush(false);
    if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
    updateModeBadge();
    if (next === "daily") { dailyActive = false; loadDailyStatus(); $("trainView").classList.add("hidden"); }
    else if (next === "rush") { loadRushBoard(); $("trainView").classList.add("hidden"); }
    else { $("trainView").classList.remove("hidden"); loadPuzzle(); }
  }

  document.querySelectorAll("#pzTabs .tab-btn").forEach((b) => {
    b.addEventListener("click", () => setMode(b.getAttribute("data-mode")));
  });
  if ($("pzRated")) $("pzRated").addEventListener("change", updateModeBadge);

  /* ---------- 일일 퍼즐 ---------- */
  let dailyActive = false;

  async function loadDailyStatus() {
    const box = $("dailyStatus");
    if (!API.getToken()) {
      box.innerHTML = '<p class="muted">로그인하면 기록이 저장됩니다.</p>';
      return;
    }
    try {
      const st = await API.dailyStatus();
      $("dailyDate").textContent = st.day;
      if (st.attempted) {
        box.innerHTML = st.success
          ? `<div class="status">✅ 오늘의 퍼즐을 풀었습니다! (${st.seconds}초)</div>`
          : '<div class="status">❌ 오늘은 아쉽게 실패했습니다. 내일 다시 도전하세요.</div>';
        $("dailyStart").textContent = "다시 보기 (기록 없음)";
      } else {
        box.innerHTML = '<div class="status">아직 오늘의 퍼즐을 풀지 않았습니다.</div>';
        $("dailyStart").textContent = "오늘의 퍼즐 풀기";
      }
    } catch (e) {
      box.innerHTML = `<p class="muted">${window.kiwiEscapeHtml(e.message)}</p>`;
    }
  }

  $("dailyStart").addEventListener("click", async () => {
    try {
      const { puzzle: p, day } = await API.dailyPuzzle();
      puzzle = p;
      dailyActive = true;
      dailySeconds = 0;
      $("trainView").classList.remove("hidden");
      $("dailyDate").textContent = day;
      setupPuzzle();
      setStatus("📅 오늘의 퍼즐 — 최선의 수를 찾으세요.");
      if (dailyTimer) clearInterval(dailyTimer);
      dailyTimer = setInterval(() => { dailySeconds++; }, 1000);
    } catch (e) {
      $("dailyStatus").innerHTML = `<p class="muted">${window.kiwiEscapeHtml(e.message)}</p>`;
    }
  });

  async function finishDaily(success) {
    if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; }
    solvedCount++;
    $("solvedCount").textContent = solvedCount;
    setStatus(success ? "✅ 오늘의 퍼즐 성공! 🥝" : "❌ 오늘의 퍼즐 실패", success ? "var(--accent-strong)" : "var(--danger)");
    Sounds.play(success ? "win" : "lose");
    if (!API.getToken()) return;
    try {
      const r = await API.dailySolved(success, dailySeconds);
      showAchievements(r.newAchievements);
      loadDailyStatus();
      if (window.kiwiNotifyRefresh) window.kiwiNotifyRefresh();
    } catch (e) { /* noop */ }
  }

  /* ---------- 퍼즐 러시 ---------- */
  let rushSet = [];
  let rushIndex = 0;
  let rushScore = 0;
  let rushMisses = 0;
  let rushTimer = null;
  let rushLeft = 0;
  let rushRunning = false;

  const RUSH_SECONDS = { "3m": 180, "5m": 300, "survival": 0 };

  function fmt(sec) {
    if (sec < 0) sec = 0;
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  $("rushStart").addEventListener("click", async () => {
    const m = $("rushMode").value;
    $("rushResult").innerHTML = "";
    try {
      const { puzzles: ps } = await API.rushPuzzles(80);
      if (!ps.length) { $("rushResult").innerHTML = '<p class="muted">퍼즐 데이터가 없습니다.</p>'; return; }
      rushSet = ps;
      rushIndex = 0; rushScore = 0; rushMisses = 0;
      rushRunning = true;
      rushLeft = RUSH_SECONDS[m] || 0;
      $("rushLive").classList.remove("hidden");
      $("trainView").classList.remove("hidden");
      updateRushHud();
      if (rushTimer) clearInterval(rushTimer);
      if (rushLeft > 0) {
        rushTimer = setInterval(() => {
          rushLeft--;
          updateRushHud();
          if (rushLeft <= 0) stopRush(true);
        }, 1000);
      } else {
        $("rushTime").textContent = "∞";
      }
      nextRushPuzzle();
    } catch (e) {
      $("rushResult").innerHTML = `<p class="muted">${window.kiwiEscapeHtml(e.message)}</p>`;
    }
  });

  function updateRushHud() {
    if (rushLeft > 0) $("rushTime").textContent = fmt(rushLeft);
    $("rushScore").textContent = rushScore;
    $("rushMiss").textContent = rushMisses;
  }

  function nextRushPuzzle() {
    if (!rushRunning) return;
    if (rushIndex >= rushSet.length) { stopRush(true); return; }
    puzzle = rushSet[rushIndex++];
    setupPuzzle();
    setStatus(`⚡ 러시 진행 중 — ${rushScore}점`);
  }

  function rushCorrect() {
    if (!rushRunning) return;
    rushScore++;
    updateRushHud();
    Sounds.play("win");
    setTimeout(nextRushPuzzle, 350);
  }

  function rushMiss() {
    if (!rushRunning) return;
    rushMisses++;
    updateRushHud();
    Sounds.play("lose");
    if (rushMisses >= 3) { stopRush(true); return; }
    setTimeout(nextRushPuzzle, 500);
  }
  window.kiwiRushMiss = rushMiss;

  async function stopRush(finished) {
    if (!rushRunning) return;
    rushRunning = false;
    if (rushTimer) { clearInterval(rushTimer); rushTimer = null; }
    $("rushLive").classList.add("hidden");
    if (!finished) return;

    $("rushResult").innerHTML = `<div class="status">⚡ 러시 종료 — <b>${rushScore}점</b> (실수 ${rushMisses})</div>`;
    if (!API.getToken()) return;
    try {
      const r = await API.rushResult($("rushMode").value, rushScore, rushMisses);
      const best = r.isBest ? " 🎉 신기록!" : ` (최고 ${r.best}점)`;
      $("rushResult").innerHTML =
        `<div class="status">⚡ 러시 종료 — <b>${rushScore}점</b> (실수 ${rushMisses})${best}</div>`;
      showAchievements(r.newAchievements);
      loadRushBoard();
      if (window.kiwiNotifyRefresh) window.kiwiNotifyRefresh();
    } catch (e) { /* noop */ }
  }

  async function loadRushBoard() {
    try {
      const { leaderboard } = await API.rushLeaderboard($("rushMode").value);
      const box = $("rushBoard");
      if (!leaderboard.length) { box.innerHTML = '<p class="muted">아직 기록이 없습니다. 첫 주자가 되어보세요.</p>'; return; }
      box.innerHTML = leaderboard.map((u, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="name">${window.kiwiEscapeHtml(u.username)}</span>
          <span class="rating">${u.score}점</span>
        </div>`).join("");
    } catch (e) { /* noop */ }
  }
  $("rushMode").addEventListener("change", loadRushBoard);

  /* ---------- 업적 토스트 ---------- */
  function showAchievements(list) {
    if (!list || !list.length) return;
    list.forEach((a, i) => {
      setTimeout(() => {
        const fx = document.createElement("div");
        fx.className = "celebrate";
        fx.style.color = "var(--gold)";
        fx.innerHTML = `<span>${a.icon}</span><b>${window.kiwiEscapeHtml(a.name)}</b>`;
        document.body.appendChild(fx);
        setTimeout(() => fx.remove(), 1500);
      }, i * 600);
    });
  }

  /* ---------- 퍼즐 레이팅 표시 ---------- */
  async function showPuzzleRating() {
    if (!API.getToken()) return;
    try {
      const { profile } = await API.profileMe();
      $("pzRatingLine").textContent =
        `퍼즐 레이팅 ${profile.puzzleRating} · 푼 문제 ${profile.puzzlesSolved}`;
    } catch (e) { /* noop */ }
  }
  showPuzzleRating();
  updateModeBadge();
  window.kiwiRefreshPuzzleRating = showPuzzleRating;


  /* ---------- 레이팅 반영 여부 ---------- */
  function isRated() {
    // 러시/일일은 자체 규칙(항상 반영), 훈련만 토글을 따른다
    if (mode === "rush" || mode === "daily") return true;
    const el = $("pzRated");
    return el ? el.checked : true;
  }
  function updateModeBadge() {
    const badge = $("pzModeBadge");
    if (!badge) return;
    if (mode === "rush") { badge.textContent = "⚡ 러시"; badge.className = "rated-badge rush"; return; }
    if (mode === "daily") { badge.textContent = "📅 일일 (레이팅 반영)"; badge.className = "rated-badge"; return; }
    if (isRated()) { badge.textContent = "레이팅 반영"; badge.className = "rated-badge"; }
    else { badge.textContent = "연습 (레이팅 미반영)"; badge.className = "rated-badge unrated"; }
  }

})();
