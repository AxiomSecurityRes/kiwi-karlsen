/* admin.html — 관리자 전용 패널 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function init() {
    if (!API.getToken()) { showDenied(); return; }
    try {
      const stats = await API.adminStats();  // 실패 시 403 → 관리자 아님
      $("adminBody").classList.remove("hidden");
      renderStats(stats);
      loadUsers();
    } catch (e) { showDenied(); }
  }
  function showDenied() { $("denied").classList.remove("hidden"); }

  function renderStats(s) {
    const items = [
      ["사용자", s.users], ["관리자", s.admins], ["정지", s.banned],
      ["게임", s.games], ["친구관계", s.friendships], ["메시지", s.messages],
      ["퍼즐", s.puzzles], ["온라인", s.online], ["버전", s.version],
    ];
    $("statGrid").innerHTML = items.map(([k, v]) =>
      `<div class="stat-box"><div class="stat-num">${v}</div><div class="stat-label">${k}</div></div>`).join("");
  }

  async function loadUsers(q) {
    try {
      const { users } = await API.adminUsers(q);
      if (!users.length) { $("userTable").innerHTML = '<p class="muted">사용자가 없습니다.</p>'; return; }
      $("userTable").innerHTML = users.map((u) => `
        <div class="admin-row" data-id="${u.id}">
          <div style="flex:1;">
            <b><a href="/profile.html?u=${encodeURIComponent(u.username)}">${esc(u.username)}</a></b>
            ${u.isAdmin ? '<span class="tag admin">관리자</span>' : ""}
            ${u.banned ? '<span class="tag banned">정지</span>' : ""}
            <div class="muted" style="font-size:0.8rem;">ID ${u.id} · 레이팅 ${u.rating} · ${u.games}게임</div>
          </div>
          <div class="admin-actions">
            <input type="number" class="rt" value="${u.rating}" style="width:80px;margin:0;" title="레이팅" />
            <button class="btn small secondary act-rate">저장</button>
            <button class="btn small ${u.banned ? "" : "danger"} act-ban">${u.banned ? "정지해제" : "정지"}</button>
            <button class="btn small secondary act-admin">${u.isAdmin ? "관리자해제" : "관리자지정"}</button>
            <button class="btn small danger act-del">삭제</button>
          </div>
        </div>`).join("");
      bindRows();
    } catch (e) { $("userTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  function bindRows() {
    document.querySelectorAll(".admin-row").forEach((row) => {
      const id = parseInt(row.getAttribute("data-id"), 10);
      const banBtn = row.querySelector(".act-ban");
      const adminBtn = row.querySelector(".act-admin");
      row.querySelector(".act-rate").onclick = async () => {
        const rating = parseFloat(row.querySelector(".rt").value);
        await safe(() => API.adminUpdateUser(id, { rating }));
        loadUsers($("userSearch").value);
      };
      banBtn.onclick = async () => {
        const shouldBan = banBtn.textContent.trim() === "정지";
        await safe(() => API.adminUpdateUser(id, { banned: shouldBan }));
        loadUsers($("userSearch").value);
      };
      adminBtn.onclick = async () => {
        const makeAdmin = adminBtn.textContent.trim() === "관리자지정";
        await safe(() => API.adminUpdateUser(id, { is_admin: makeAdmin }));
        loadUsers($("userSearch").value);
      };
      row.querySelector(".act-del").onclick = async () => {
        if (!confirm("정말 이 사용자를 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
        await safe(() => API.adminDeleteUser(id));
        loadUsers($("userSearch").value);
      };
    });
  }
  async function safe(fn) { try { await fn(); } catch (e) { alert("오류: " + e.message); } }

  $("searchBtn").addEventListener("click", () => loadUsers($("userSearch").value));
  $("userSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") loadUsers($("userSearch").value); });
  $("reloadPzBtn").addEventListener("click", async () => {
    $("reloadNote").textContent = "로드 중…";
    try { const r = await API.adminReloadPuzzles(); $("reloadNote").textContent = `✅ ${r.puzzles}개 로드됨`; init(); }
    catch (e) { $("reloadNote").textContent = e.message; }
  });

  init();
})();
