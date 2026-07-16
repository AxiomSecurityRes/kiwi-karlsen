/* vision.html — 시각(Vision) 훈련: 30초 좌표/수순 스피드런 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  let board = null;
  let questions = [];
  let idx = 0;
  let score = 0;
  let misses = 0;
  let running = false;
  let timeLeft = 30;
  let timer = null;
  let orientation = "white";

  function buildBoard(fen) {
    if (board) board.destroy();
    board = Chessboard("vision-board", {
      draggable: false,
      position: fen || "start",
      orientation,
      // 좌표 모드에서는 기물도, 좌표 표시도 없어야 진짜 훈련이 된다
      pieceTheme: window.kiwiPieceTheme,
      showNotation: false,
    });
    attachClicks();
  }

  function attachClicks() {
    const el = document.getElementById("vision-board");
    if (!el) return;
    // 이벤트 위임 — 보드가 다시 그려져도 동작
    if (el._visionBound) return;
    el._visionBound = true;
    const handler = (e) => {
      if (!running) return;
      const t = e.type === "touchend"
        ? (e.changedTouches && e.changedTouches[0]
            ? document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
            : null)
        : e.target;
      const cell = t && t.closest ? t.closest("[data-square]") : null;
      if (!cell) return;
      e.preventDefault();
      answer(cell.getAttribute("data-square"), cell);
    };
    el.addEventListener("click", handler);
    el.addEventListener("touchend", handler, { passive: false });
  }

  function flash(cell, ok) {
    if (!cell) return;
    cell.classList.add(ok ? "v-ok" : "v-bad");
    setTimeout(() => cell.classList.remove(ok ? "v-ok" : "v-bad"), 280);
  }

  function answer(square, cell) {
    const q = questions[idx];
    if (!q) return;
    if (square === q.answer) {
      score++;
      flash(cell, true);
      Sounds.play("move");
      idx++;
      nextQuestion();
    } else {
      misses++;
      flash(cell, false);
      Sounds.play("illegal");
    }
    updateHud();
  }

  function nextQuestion() {
    const q = questions[idx];
    if (!q) { finish(); return; }
    $("vPrompt").textContent = q.prompt;
    if (q.fen) {
      board.position(q.fen, false);
      $("vPrompt").classList.add("with-board");
    } else {
      board.position({}, false);   // 좌표 모드: 빈 보드
      $("vPrompt").classList.remove("with-board");
    }
  }

  function updateHud() {
    $("vTime").textContent = timeLeft;
    $("vScore").textContent = score;
    $("vMiss").textContent = misses;
  }

  async function start() {
    const mode = $("vMode").value;
    orientation = $("vFlip").checked ? "black" : "white";
    $("vResult").innerHTML = "";
    $("vStart").classList.add("hidden");
    $("vStop").classList.remove("hidden");

    try {
      const data = await API.visionQuestions(mode, 120);
      questions = data.questions;
      timeLeft = data.seconds || 30;
    } catch (e) {
      $("vResult").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
      stop(false);
      return;
    }

    idx = 0; score = 0; misses = 0;
    running = true;
    buildBoard(questions[0] && questions[0].fen);
    nextQuestion();
    updateHud();

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      timeLeft--;
      updateHud();
      if (timeLeft <= 0) finish();
    }, 1000);
  }

  function stop(showResult) {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    $("vStart").classList.remove("hidden");
    $("vStop").classList.add("hidden");
    $("vPrompt").textContent = "준비";
    if (!showResult) $("vResult").innerHTML = "";
  }

  async function finish() {
    if (!running) return;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    $("vStart").classList.remove("hidden");
    $("vStop").classList.add("hidden");

    const total = score + misses;
    const acc = total ? Math.round((score / total) * 100) : 0;
    $("vPrompt").textContent = "완료!";
    Sounds.play("win");
    $("vResult").innerHTML =
      `<div class="status">⏱ 30초 종료 — <b>${score}점</b> (오답 ${misses}, 정확도 ${acc}%)</div>`;

    if (!API.getToken()) return;
    try {
      const r = await API.visionResult($("vMode").value, score, misses);
      const best = r.isBest ? " 🎉 신기록!" : ` (최고 ${r.best}점)`;
      $("vResult").innerHTML =
        `<div class="status">⏱ 30초 종료 — <b>${score}점</b> (오답 ${misses}, 정확도 ${acc}%)${best}</div>`;
      if (r.newAchievements && r.newAchievements.length && window.kiwiNotifyRefresh) {
        window.kiwiNotifyRefresh();
      }
      loadBoard();
      loadHistory();
      loadBest();
    } catch (e) { /* noop */ }
  }

  async function loadBoard() {
    try {
      const { leaderboard } = await API.visionLeaderboard($("vMode").value);
      const box = $("vBoard");
      if (!leaderboard.length) { box.innerHTML = '<p class="muted">아직 기록이 없습니다.</p>'; return; }
      box.innerHTML = leaderboard.map((u, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="name">${esc(u.username)}</span>
          <span class="rating">${u.score}점</span>
        </div>`).join("");
    } catch (e) { /* noop */ }
  }

  async function loadHistory() {
    if (!API.getToken()) return;
    try {
      const { sessions } = await API.visionHistory();
      const box = $("vHistory");
      if (!sessions.length) { box.innerHTML = '<p class="muted">아직 기록이 없습니다.</p>'; return; }
      const KO = { coords: "좌표", moves: "수순" };
      box.innerHTML = sessions.slice(0, 8).map((s) => `
        <div class="player-row">
          <span class="name">${esc(KO[s.mode] || s.mode)}</span>
          <span class="rating">${s.score}점 · 정확도 ${s.accuracy}%</span>
        </div>`).join("");
    } catch (e) { /* noop */ }
  }

  async function loadBest() {
    if (!API.getToken()) { $("vBest").innerHTML = ""; return; }
    try {
      const { profile } = await API.profileMe();
      $("vBest").innerHTML = `
        <div class="stat-box"><div class="stat-num">${profile.visionBestCoords || 0}</div><div class="stat-label">좌표 최고</div></div>
        <div class="stat-box"><div class="stat-num">${profile.visionBestMoves || 0}</div><div class="stat-label">수순 최고</div></div>`;
    } catch (e) { /* noop */ }
  }

  $("vStart").addEventListener("click", start);
  $("vStop").addEventListener("click", () => stop(false));
  $("vMode").addEventListener("change", () => {
    const moves = $("vMode").value === "moves";
    $("vDesc").textContent = moves
      ? "국면과 수(예: Nf3)가 표시됩니다. 그 수가 도착하는 칸을 클릭하세요."
      : "체스 좌표 감각은 기보를 읽고 머릿속으로 계산하는 데 필수적인 기초 능력입니다.";
    loadBoard();
  });

  buildBoard();
  loadBoard();
  loadHistory();
  loadBest();
})();
