/* friends-ui.js — 친구 목록/요청/추가 + DM 채팅 패널 (index.html) */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml ? window.kiwiEscapeHtml(s) : String(s);

  let dmFriend = null;          // 현재 열린 DM 상대 {id, username}
  let loggedIn = false;

  // ---------- 친구 목록 ----------
  async function refreshFriends() {
    if (!API.getToken()) return;
    try {
      const { friends } = await API.friends();
      const box = $("friendList");
      if (!friends.length) { box.innerHTML = '<p class="muted">아직 친구가 없습니다. 위에서 추가하세요.</p>'; return; }
      box.innerHTML = "";
      friends.forEach((f) => {
        const row = document.createElement("div");
        row.className = "friend-row";
        row.innerHTML = `<span class="dot ${f.online ? "on" : ""}"></span>
          <span class="name">${esc(f.username)}</span>
          <span class="rating">${f.rating}${f.inGame ? " · 대국중" : f.online ? " · 온라인" : ""}</span>`;
        const chat = document.createElement("button");
        chat.className = "btn small secondary"; chat.textContent = "채팅";
        chat.onclick = () => openDM(f);
        row.appendChild(chat);
        box.appendChild(row);
      });
    } catch (e) { /* noop */ }
  }

  async function refreshRequests() {
    if (!API.getToken()) return;
    try {
      const { requests } = await API.friendRequests();
      const box = $("friendReqs");
      if (!requests.length) { box.innerHTML = ""; return; }
      box.innerHTML = "";
      requests.forEach((r) => {
        const row = document.createElement("div");
        row.className = "friend-row";
        row.innerHTML = `<span class="name">📨 ${esc(r.fromName)}</span><span class="rating">${r.rating}</span>`;
        const ok = document.createElement("button");
        ok.className = "btn small"; ok.textContent = "수락";
        ok.onclick = async () => { await API.friendRespond(r.requestId, true); refreshRequests(); refreshFriends(); };
        const no = document.createElement("button");
        no.className = "btn small secondary"; no.textContent = "거절";
        no.onclick = async () => { await API.friendRespond(r.requestId, false); refreshRequests(); };
        row.appendChild(ok); row.appendChild(no);
        box.appendChild(row);
      });
    } catch (e) { /* noop */ }
  }

  $("friendAddBtn").addEventListener("click", addFriend);
  $("friendSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });
  async function addFriend() {
    const name = $("friendSearch").value.trim();
    if (name.length < 2) return;
    try {
      await API.friendRequest(name);
      $("friendSearch").value = "";
      window.kiwiToast(`✅ <b>${esc(name)}</b> 님에게 친구 요청을 보냈습니다.`);
      refreshFriends();
    } catch (e) {
      window.kiwiToast(`⚠️ ${esc(e.message)}`);
    }
  }

  // ---------- DM 패널 ----------
  async function openDM(friend) {
    dmFriend = friend;
    $("dmTitle").textContent = "💬 " + friend.username;
    $("dmBody").innerHTML = '<p class="muted">불러오는 중…</p>';
    $("dmPanel").classList.add("show");
    try {
      const { messages } = await API.dmHistory(friend.id);
      renderDM(messages);
    } catch (e) {
      $("dmBody").innerHTML = '<p class="muted">메시지를 불러오지 못했습니다.</p>';
    }
  }

  function renderDM(messages) {
    const me = API.getUser();
    const body = $("dmBody");
    body.innerHTML = "";
    messages.forEach((m) => appendDM(m, me));
    body.scrollTop = body.scrollHeight;
  }

  function appendDM(m, me) {
    const body = $("dmBody");
    const isMe = me && m.fromId === me.id;
    const div = document.createElement("div");
    div.className = "m" + (isMe ? " me" : "");
    div.innerHTML = `<span class="bubble">${esc(m.text)}</span>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  $("dmClose").addEventListener("click", () => { $("dmPanel").classList.remove("show"); dmFriend = null; });
  $("dmSend").addEventListener("click", sendDM);
  $("dmInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendDM(); });
  async function sendDM() {
    if (!dmFriend) return;
    const text = $("dmInput").value.trim();
    if (!text) return;
    $("dmInput").value = "";
    try {
      const { message } = await API.dmSend(dmFriend.id, text);
      appendDM(message, API.getUser());
    } catch (e) {
      window.kiwiToast(`⚠️ ${esc(e.message)}`);
    }
  }

  // ---------- 실시간 수신 (WebSocket) ----------
  if (typeof Socket !== "undefined") {
    Socket.on("dm", (msg) => {
      const me = API.getUser();
      // 현재 열린 상대의 메시지면 패널에 추가, 아니면 토스트 알림
      if (dmFriend && msg.fromId === dmFriend.id) {
        appendDM({ fromId: msg.fromId, text: msg.text }, me);
      } else {
        window.kiwiToast(`💬 <b>${esc(msg.fromName)}</b>: ${esc(msg.text)}`);
      }
    });
    Socket.on("friend_event", (msg) => {
      if (msg.event === "request") {
        window.kiwiToast(`👥 <b>${esc(msg.fromName)}</b> 님이 친구 요청을 보냈습니다.`);
        refreshRequests();
      }
    });
  }

  // ---------- 진입점: 로비 진입 시 주기 갱신 ----------
  function start() {
    if (loggedIn) return;
    loggedIn = true;
    refreshFriends();
    refreshRequests();
    setInterval(() => {
      if (!$("lobbyView").classList.contains("hidden")) { refreshFriends(); refreshRequests(); }
    }, 12000);
  }
  window.kiwiStartFriends = start;

  // 토큰이 이미 있으면(자동 로그인) 잠시 후 시작
  if (API.getToken()) setTimeout(start, 800);
})();
