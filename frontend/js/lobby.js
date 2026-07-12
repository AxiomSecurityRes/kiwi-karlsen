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

  // ---- 로그인 / 회원가입 ----
  let authMode = "login"; // "login" | "register"

  function setAuthMode(mode) {
    authMode = mode;
    $("loginError").textContent = "";
    if (mode === "login") {
      $("authTitle").textContent = "🥝 로그인";
      $("authSubtitle").textContent = "키위 카를센에 오신 것을 환영합니다.";
      $("loginBtn").textContent = "로그인";
      $("loginPassword").setAttribute("autocomplete", "current-password");
      $("authSwitchText").textContent = "계정이 없으신가요?";
      $("authSwitch").textContent = "회원가입";
    } else {
      $("authTitle").textContent = "🥝 회원가입";
      $("authSubtitle").textContent = "새 계정을 만들어 레이팅과 스트릭을 기록하세요.";
      $("loginBtn").textContent = "회원가입";
      $("loginPassword").setAttribute("autocomplete", "new-password");
      $("authSwitchText").textContent = "이미 계정이 있으신가요?";
      $("authSwitch").textContent = "로그인";
    }
  }

  async function doAuth() {
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    $("loginError").textContent = "";
    if (username.length < 2) {
      $("loginError").textContent = "사용자 이름은 2자 이상이어야 합니다.";
      return;
    }
    if (password.length < 6) {
      $("loginError").textContent = "비밀번호는 6자 이상이어야 합니다.";
      return;
    }
    $("loginBtn").disabled = true;
    try {
      const fn = authMode === "register" ? API.register : API.login;
      const { token, user } = await fn(username, password);
      API.setSession(token, user);
      enterApp(user, token);
    } catch (e) {
      $("loginError").textContent = e.message;
    } finally {
      $("loginBtn").disabled = false;
    }
  }

  function renderStreak(user) {
    if (!user) return;
    $("streakCurrent").textContent = user.streakCurrent != null ? user.streakCurrent : 0;
    $("streakBest").textContent = user.streakBest != null ? user.streakBest : 0;
  }

  function enterApp(user, token) {
    const streakTxt = user.streakCurrent ? ` 🔥${user.streakCurrent}` : "";
    $("userChip").textContent = `${user.username} (${user.rating})${streakTxt}`;
    $("userChip").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    renderStreak(user);
    showLobby();
    Socket.connect(token);
    if (window.kiwiStartFriends) window.kiwiStartFriends();
    // 접속 활동으로 스트릭 갱신 후 최신값 반영
    API.streakPing().then((res) => {
      if (res && res.streak) {
        user.streakCurrent = res.streak.current;
        user.streakBest = res.streak.best;
        API.setSession(API.getToken(), user);
        renderStreak(user);
        const t = user.streakCurrent ? ` 🔥${user.streakCurrent}` : "";
        $("userChip").textContent = `${user.username} (${user.rating})${t}`;
      }
    }).catch(() => {});
  }

  $("loginBtn").addEventListener("click", doAuth);
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); });
  $("loginUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth(); });
  $("authSwitch").addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(authMode === "login" ? "register" : "login");
  });

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

  // 내가 보낸 도전(취소 가능)
  let outgoingChallenge = null;   // { id, username }
  // 받은 도전 토스트: fromId -> element (취소되면 제거)
  const incomingToasts = {};

  function challenge(player) {
    const minutes = parseInt($("tcMinutes").value, 10) || 10;
    const increment = parseInt($("tcIncrement").value, 10) || 0;
    outgoingChallenge = { id: player.id, username: player.username };
    Socket.send({ type: "challenge", toId: player.id, minutes, increment });
    showChallengeWaiting(player.username);
  }

  /** 도전 대기 화면 — 취소 버튼 포함 */
  function showChallengeWaiting(name) {
    showLoading("도전 전송", `${name} 님의 응답을 기다리는 중…`);
    const modal = document.querySelector("#loadingModal .modal");
    if (!modal || modal.querySelector("#cancelChallengeBtn")) return;
    const btn = document.createElement("button");
    btn.className = "btn danger";
    btn.id = "cancelChallengeBtn";
    btn.textContent = "도전 취소";
    btn.style.marginTop = "12px";
    btn.addEventListener("click", cancelChallenge);
    modal.appendChild(btn);
  }

  function cancelChallenge() {
    if (!outgoingChallenge) { hideLoading(); return; }
    Socket.send({ type: "challenge_cancel", toId: outgoingChallenge.id });
    const name = outgoingChallenge.username;
    outgoingChallenge = null;
    hideLoading();
    toast(`🚫 <b>${escapeHtml(name)}</b> 님에게 보낸 도전을 취소했습니다.`);
  }

  Socket.on("challenge_sent", (msg) => {
    outgoingChallenge = { id: msg.toId, username: msg.toName };
    showChallengeWaiting(msg.toName);
  });

  Socket.on("challenge_declined", (msg) => {
    outgoingChallenge = null;
    hideLoading();
    toast(`😢 <b>${escapeHtml(msg.byName)}</b> 님이 도전을 거절했습니다.`);
  });

  // 도전 취소 알림 (내가 취소했거나, 상대가 취소함)
  Socket.on("challenge_cancelled", (msg) => {
    if (msg.byMe) {
      outgoingChallenge = null;
      hideLoading();
      return;
    }
    // 상대가 보낸 도전이 취소됨 → 받은 도전 토스트 제거
    const el = incomingToasts[msg.fromId];
    if (el) { el.remove(); delete incomingToasts[msg.fromId]; }
    const extra = msg.message ? ` (${escapeHtml(msg.message)})` : "";
    toast(`🚫 <b>${escapeHtml(msg.fromName || "상대")}</b> 님이 도전을 취소했습니다.${extra}`);
  });

  // 이미 사라진 도전에 응답한 경우
  Socket.on("challenge_gone", (msg) => {
    hideLoading();
    toast(`⚠️ ${escapeHtml(msg.message || "이 도전은 더 이상 유효하지 않습니다.")}`);
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
    incomingToasts[msg.fromId] = el;
    el.querySelector("[data-accept]").onclick = () => {
      Socket.send({ type: "challenge_response", fromId: msg.fromId, accept: true,
                    minutes: msg.minutes || 10, increment: msg.increment || 0 });
      el.remove();
      delete incomingToasts[msg.fromId];
      showLoading("대국 준비 중", "체스판을 차리는 중…");
    };
    el.querySelector("[data-decline]").onclick = () => {
      Socket.send({ type: "challenge_response", fromId: msg.fromId, accept: false });
      el.remove();
      delete incomingToasts[msg.fromId];
    };
  });

  // 대국이 시작되면 대기 상태 정리
  Socket.on("game_start", () => { outgoingChallenge = null; });

  // ---- 로딩 모달 ----
  function showLoading(title, text) {
    $("loadingTitle").textContent = title;
    $("loadingText").textContent = text;
    // 도전 취소 버튼은 도전 대기 상황에서만 보인다
    const old = document.getElementById("cancelChallengeBtn");
    if (old) old.remove();
    $("loadingModal").classList.add("show");
  }
  function hideLoading() {
    $("loadingModal").classList.remove("show");
    const old = document.getElementById("cancelChallengeBtn");
    if (old) old.remove();
  }
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
  // 전역 이스케이프는 api.js 에서 정의됨(중복 정의 제거)


  // ---- 사이트 공지(MOTD) + 관리자 방송 ----
  async function loadMotd() {
    try {
      const site = await API.site();
      if (site.motd) {
        const b = $("motdBanner");
        b.textContent = "📢 " + site.motd;
        b.classList.remove("hidden");
      }
    } catch (e) { /* noop */ }
  }
  loadMotd();

  if (typeof Socket !== "undefined") {
    Socket.on("announce", (msg) => {
      if (window.kiwiToast) {
        window.kiwiToast(`📢 <b>공지</b>: ${window.kiwiEscapeHtml(msg.text)}`);
      }
      const b = $("motdBanner");
      if (b) { b.textContent = "📢 " + msg.text; b.classList.remove("hidden"); }
    });
  }

  // ---- 자동 로그인 (세션 복원) ----
  setAuthMode("login");
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
