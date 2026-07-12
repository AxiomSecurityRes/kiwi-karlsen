/* players.html — 사용자 검색 / 목록 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  function profileUrl(username) {
    const base = window.kiwiPageUrl ? window.kiwiPageUrl("/profile.html") : "/profile.html?";
    const sep = base.indexOf("?") === -1 ? "?" : "&";
    return base + sep + "u=" + encodeURIComponent(username);
  }

  async function load() {
    const box = $("plList");
    box.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      const q = $("plSearch").value.trim();
      const sort = $("plSort").value;
      const { players } = await API.players(q, sort);
      if (!players.length) {
        box.innerHTML = '<p class="muted">해당하는 사용자가 없습니다.</p>';
        return;
      }
      box.innerHTML = players.map((p) => {
        const decided = p.games || 0;
        const rate = decided ? Math.round((p.wins / decided) * 100) : 0;
        return `
        <a class="player-card" href="${profileUrl(p.username)}">
          <span class="pc-dot ${p.online ? "on" : ""}" title="${p.online ? "온라인" : "오프라인"}"></span>
          <span class="pc-name">
            ${esc(p.username)}${p.isAdmin ? ' <span class="tag admin">관리자</span>' : ""}
            <span class="pc-record">${p.wins}승 ${p.losses}패 ${p.draws}무${decided ? ` · 승률 ${rate}%` : ""}</span>
          </span>
          <span class="pc-stats">
            <span title="레이팅"><b>${p.rating}</b><small>레이팅</small></span>
            <span title="퍼즐 레이팅"><b>${p.puzzleRating}</b><small>퍼즐</small></span>
            <span title="최고 스트릭"><b>${p.streakBest}</b><small>🔥</small></span>
          </span>
        </a>`;
      }).join("");
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  $("plSearchBtn").addEventListener("click", load);
  $("plSort").addEventListener("change", load);
  $("plSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });

  load();
})();
