/* index.html 로비 로직: 로그인, 온라인 목록, 도전, 리더보드 */
(function () {
  const $ = (id) => document.getElementById(id);

  const loginView = $("loginView");
  const lobbyView = $("lobbyView");
  const gameView = $("gameView");

  // ---- 토스트 ----
  function toast(html, opts = {}) {
    const wrap = $("toastWrap");
    const el = document.createElement("div");
    el.className = "toast" + (opts.challenge ? " challenge" : "");
    el.innerHTML = html;
    wrap.appendChild(el);
    if (!opts.persist) setTimeout(() => el.remove(), opts.duration || 4000);
    return el;
  }
  window.kiwiToast = toast;

  // ---- 화면 전환 ----
  function showLobby() {
    loginView.classList.add("hidden");
    gameView.classList.add("hidden");
    lobbyView.classList.remove("hidden");
    refreshLeaderboard();
  }
  window.kiwiShowLobby = showLobby;

  function showGame() {
    loginView.classList.add("hidden");
    lobbyView.classList.add("hidden");
    gameView.classList.remove("hidden");
  }
  window.kiwiShowGame = showGame;

  // ---- 로그인 ----
  async function doLogin() {
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    $("loginError").textContent = "";
    if (username.length < 2) {
      $("loginError").textContent = "이름은 2자 이상이어야 합니다.";
      return;
    }
    try {
      const { token, user } = await API.login(username, password);
      API.setSession(token, user);
      enterApp(user, token);
    } catch (e) {
      $("loginError").textContent = e.message;
    }
  }

  function enterApp(user, token) {
    $("userChip").textContent = `${user.username} (${user.rating})`;
    $("userChip").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    showLobby();
    Socket.connect(token);
  }

  $("loginBtn").addEventListener("click", doLogin);
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("loginUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

  $("logoutBtn").addEventListener("click", (e) => {
    e.preventDefault();
    Socket.close();
    API.clearSession();
    location.reload();
  });

  // ---- 온라인 플레이어 목록 ----
  function renderPlayers(players) {
    const me = API.getUser();
    const list = $("playerList");
    const others = (players || []).filter((p) => !me || p.id !== me.id);
    if (others.length === 0) {
      list.innerHTML = '<p class="muted">현재 다른 온라인 플레이어가 없습니다. 다른 창/기기에서 로그인하면 여기에 표시됩니다.</p>';
      return;
    }
    list.innerHTML = "";
    others.forEach((p) => {
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = `
        <span class="name">🥝 ${escapeHtml(p.username)}</span>
        <span class="rating">${p.rating}</span>`;
      if (p.inGame) {
        const tag = document.createElement("span");
        tag.className = "ingame";
        tag.textContent = "대국 중";
        row.appendChild(tag);
      } else {
        const btn = document.createElement("button");
        btn.className = "btn small";
        btn.textContent = "도전";
        btn.onclick = () => challenge(p);
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
  }

  // WebSocket 푸시
  Socket.on("players", (msg) => renderPlayers(msg.players));

  // 연결되면 즉시 목록 요청 (초기 이벤트 누락 방지)
  Socket.on("_open", () => Socket.send({ type: "list_players" }));

  // REST 폴백: WS 메시지를 놓치거나 연결 직전이어도 목록을 채운다.
  async function pollOnline() {
    if ($("lobbyView").classList.contains("hidden")) return;
    try {
      const { players } = await API.online();
      // WS가 비어있을 때만 REST 결과로 채움(깜빡임 방지)
      const list = $("playerList");
      if (list.children.length === 0 || list.querySelector("p")) {
        renderPlayers(players);
      }
    } catch (e) { /* noop */ }
  }
  setInterval(pollOnline, 5000);

  function challenge(player) {
    const minutes = parseInt($("tcMinutes").value, 10) || 10;
    const increment = parseInt($("tcIncrement").value, 10) || 0;
    Socket.send({ type: "challenge", toId: player.id, minutes, increment });
    showLoading("도전 전송", `${player.username} 님의 응답을 기다리는 중…`);
  }

  Socket.on("challenge_sent", (msg) => {
    showLoading("도전 전송", `${msg.toName} 님의 응답을 기다리는 중…`);
  });

  Socket.on("challenge_declined", (msg) => {
    hideLoading();
    toast(`😢 <b>${escapeHtml(msg.byName)}</b> 님이 도전을 거절했습니다.`);
  });

  // ---- 도전 수신 ----
  Socket.on("incoming_challenge", (msg) => {
    Sounds.play("matchFound");
    const tc = `${msg.minutes || 10}분${msg.increment ? " +" + msg.increment + "초" : ""}`;
    const el = toast(
      `⚔️ <b>${escapeHtml(msg.fromName)}</b> (${msg.fromRating}) 님이 도전했습니다! <small>(${tc})</small>
       <div class="t-actions">
         <button class="btn small" data-accept>수락</button>
         <button class="btn small secondary" data-decline>거절</button>
       </div>`,
      { challenge: true, persist: true }
    );
    el.querySelector("[data-accept]").onclick = () => {
      Socket.send({ type: "challenge_response", fromId: msg.fromId, accept: true,
                    minutes: msg.minutes || 10, increment: msg.increment || 0 });
      el.remove();
      showLoading("대국 준비 중", "체스판을 차리는 중…");
    };
    el.querySelector("[data-decline]").onclick = () => {
      Socket.send({ type: "challenge_response", fromId: msg.fromId, accept: false });
      el.remove();
    };
  });

  // ---- 로딩 모달 ----
  function showLoading(title, text) {
    $("loadingTitle").textContent = title;
    $("loadingText").textContent = text;
    $("loadingModal").classList.add("show");
  }
  function hideLoading() { $("loadingModal").classList.remove("show"); }
  window.kiwiShowLoading = showLoading;
  window.kiwiHideLoading = hideLoading;

  // ---- 리더보드 ----
  async function refreshLeaderboard() {
    try {
      const { leaderboard } = await API.leaderboard();
      const box = $("leaderboard");
      if (!leaderboard || leaderboard.length === 0) {
        box.innerHTML = '<p class="muted">아직 기록이 없습니다.</p>';
        return;
      }
      box.innerHTML = "";
      leaderboard.forEach((u, i) => {
        const row = document.createElement("div");
        row.className = "lb-row";
        row.innerHTML = `
          <span class="lb-rank">${i + 1}</span>
          <span class="name">${escapeHtml(u.username)}</span>
          <span class="rating">${u.rating} · ${u.wins}승 ${u.losses}패 ${u.draws}무</span>`;
        box.appendChild(row);
      });
    } catch (e) { /* noop */ }
  }
  window.kiwiRefreshLeaderboard = refreshLeaderboard;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  window.kiwiEscapeHtml = escapeHtml;

  // ---- 자동 로그인 (세션 복원) ----
  (async function init() {
    const token = API.getToken();
    if (token) {
      try {
        const { user } = await API.me();
        API.setSession(token, user);
        enterApp(user, token);
        return;
      } catch (e) {
        API.clearSession();
      }
    }
    // 로그인 화면 유지
  })();
})();
