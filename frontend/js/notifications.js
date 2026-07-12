/* notifications.js — 상단바 알림 벨 (모든 페이지 공통).
   읽지 않은 알림 수를 표시하고, 클릭하면 목록 패널을 연다. */
(function () {
  const esc = (s) => window.kiwiEscapeHtml(s);
  let panel = null;
  let bell = null;
  let badge = null;
  let pollTimer = null;

  const KIND_ICON = {
    friend: "👥", dm: "💬", achievement: "🏅", announce: "📢", game: "♟️",
  };

  function inject() {
    const nav = document.querySelector(".topbar nav");
    if (!nav || document.getElementById("notifBell")) return;

    bell = document.createElement("a");
    bell.href = "#";
    bell.id = "notifBell";
    bell.className = "notif-bell";
    bell.setAttribute("aria-label", "알림");
    bell.title = "알림";
    bell.innerHTML = '🔔<span class="notif-badge hidden" id="notifBadge">0</span>';
    nav.appendChild(bell);
    badge = document.getElementById("notifBadge");

    panel = document.createElement("div");
    panel.className = "notif-panel";
    panel.id = "notifPanel";
    panel.innerHTML = `
      <div class="notif-head">
        <b>알림</b>
        <button class="btn small secondary" id="notifReadAll">모두 읽음</button>
        <button class="btn small secondary" id="notifClear">지우기</button>
      </div>
      <div class="notif-body" id="notifBody"></div>`;
    document.body.appendChild(panel);

    bell.addEventListener("click", (e) => {
      e.preventDefault();
      const open = panel.classList.toggle("show");
      if (open) load(true);
    });
    document.addEventListener("click", (e) => {
      if (!panel.classList.contains("show")) return;
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      panel.classList.remove("show");
    });
    document.getElementById("notifReadAll").addEventListener("click", async () => {
      try { await API.notificationsRead(); setBadge(0); load(false); } catch (e) {}
    });
    document.getElementById("notifClear").addEventListener("click", async () => {
      try { await API.notificationsClear(); setBadge(0); load(false); } catch (e) {}
    });
  }

  function setBadge(n) {
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  async function load(markRead) {
    if (!API.getToken()) return;
    try {
      const { notifications, unread } = await API.notifications();
      setBadge(unread);
      const body = document.getElementById("notifBody");
      if (!body) return;
      if (!notifications.length) {
        body.innerHTML = '<p class="muted" style="padding:12px;">알림이 없습니다.</p>';
      } else {
        body.innerHTML = notifications.map((n) => `
          <a class="notif-item ${n.read ? "" : "unread"}" href="${esc(n.link || "#")}">
            <span class="notif-icon">${esc(KIND_ICON[n.kind] || "🔔")}</span>
            <span class="notif-text">${esc(n.text)}</span>
            <span class="notif-ts muted">${esc((n.ts || "").replace("T", " ").slice(5, 16))}</span>
          </a>`).join("");
      }
      if (markRead && unread > 0) {
        await API.notificationsRead();
        setBadge(0);
      }
    } catch (e) { /* 비로그인 등 */ }
  }

  async function poll() {
    if (!API.getToken()) return;
    try {
      const { unread } = await API.notifications();
      setBadge(unread);
    } catch (e) {}
  }

  function start() {
    inject();
    if (!API.getToken()) return;
    poll();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 30000);
  }

  // 실시간 이벤트가 오면 즉시 갱신
  if (typeof Socket !== "undefined") {
    ["dm", "friend_event", "announce"].forEach((evt) => {
      try { Socket.on(evt, () => poll()); } catch (e) {}
    });
  }

  window.kiwiNotifyRefresh = poll;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
