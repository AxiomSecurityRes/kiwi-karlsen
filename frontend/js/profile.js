/* profile.html — 내 프로필 보기/편집 + 타 사용자 프로필 보기 (?u=username) */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const params = new URLSearchParams(location.search);
  const viewUser = params.get("u");
  let isSelf = false;
  let myProfile = null;

  function renderProfile(p, recent, self) {
    $("pfUsername").textContent = p.username + (p.isAdmin ? " 👑" : "");
    const real = [p.firstName, p.lastName].filter(Boolean).join(" ");
    $("pfRealname").textContent = real || "";
    const meta = [p.location, p.country].filter(Boolean).join(" · ");
    $("pfMeta").textContent = meta;
    $("pfRating").textContent = p.rating;
    $("pfGames").textContent = p.games;
    $("pfWins").textContent = p.wins;
    $("pfLosses").textContent = p.losses;
    $("pfDraws").textContent = p.draws;
    const decided = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
    const rate = decided ? Math.round(((p.wins + (p.draws || 0) * 0.5) / decided) * 100) : 0;
    $("pfWinRate").textContent = decided ? rate + "%" : "-";
    $("pfRecord").innerHTML = decided
      ? `<b class="rec-w">${p.wins}승</b> · <b class="rec-l">${p.losses}패</b> · <b class="rec-d">${p.draws}무</b>`
      : '<span class="muted">아직 대국 기록이 없습니다.</span>';
    $("pfStreak").textContent = p.streakCurrent || 0;
    $("pfOtb").textContent = p.otbRating || "-";
    $("pfPuzzle").textContent = p.puzzleRating != null ? p.puzzleRating : "-";
    const rushBest = Math.max(p.rushBest3m || 0, p.rushBest5m || 0, p.rushBestSurvival || 0);
    $("pfRush").textContent = rushBest || "-";
    $("pfBio").textContent = p.bio || "소개가 없습니다.";
    if (recent && recent.length) {
      $("pfRecent").innerHTML = recent.map((g) => {
        const res = g.result === "1-0" ? "백승" : g.result === "0-1" ? "흑승" : "무";
        return `<div class="player-row"><span class="name">${esc(g.white)} vs ${esc(g.black)}</span><span class="rating">${res}</span></div>`;
      }).join("");
    } else $("pfRecent").innerHTML = '<p class="muted">게임 기록이 없습니다.</p>';
    $("editBtn").style.display = self ? "" : "none";
    $("pfArchiveControls").style.display = self ? "flex" : "none";
  }

  async function loadSelf() {
    if (!API.getToken()) { $("viewCard").classList.add("hidden"); $("loginNote").style.display = "block"; return; }
    try {
      const { profile, canChangeName } = await API.profileMe();
      myProfile = profile; isSelf = true;
      const { recentGames } = await API.profileView(profile.username).catch(() => ({ recentGames: [] }));
      renderProfile(profile, recentGames, true);
      if (profile.isAdmin) $("adminNavLink").classList.remove("hidden");
      loadAchievements(profile.username, true);
      loadArchive();
      // 편집 폼 채우기
      $("edFirst").value = profile.firstName || "";
      $("edLast").value = profile.lastName || "";
      $("edLocation").value = profile.location || "";
      $("edCountry").value = profile.country || "";
      $("edOtb").value = profile.otbRating || "";
      $("edBio").value = profile.bio || "";
      $("edUsername").value = profile.username;
      $("nameNote").textContent = canChangeName
        ? "사용자명은 90일마다 변경 가능합니다. 지금 변경할 수 있습니다."
        : "사용자명은 90일마다 변경 가능합니다. 아직 변경할 수 없습니다.";
      $("nameBtn").disabled = !canChangeName;
    } catch (e) { $("loginNote").style.display = "block"; }
  }

  async function loadOther(username) {
    try {
      const { profile, recentGames } = await API.profileView(username);
      renderProfile(profile, recentGames, false);
      loadAchievements(username, false);
      if (API.getToken()) {
        try { const me = await API.profileMe(); if (me.profile.isAdmin) $("adminNavLink").classList.remove("hidden"); } catch (e) {}
      }
    } catch (e) {
      $("viewCard").innerHTML = '<p class="muted">사용자를 찾을 수 없습니다.</p>';
    }
  }

  $("editBtn").addEventListener("click", () => { $("viewCard").classList.add("hidden"); $("editCard").classList.remove("hidden"); });
  $("cancelBtn").addEventListener("click", () => { $("editCard").classList.add("hidden"); $("viewCard").classList.remove("hidden"); });
  $("saveBtn").addEventListener("click", async () => {
    $("editError").textContent = "";
    try {
      await API.profileUpdate({
        first_name: $("edFirst").value, last_name: $("edLast").value,
        location: $("edLocation").value, country: $("edCountry").value,
        bio: $("edBio").value, otb_rating: parseInt($("edOtb").value, 10) || 0,
      });
      await loadSelf();
      $("editCard").classList.add("hidden"); $("viewCard").classList.remove("hidden");
    } catch (e) { $("editError").textContent = e.message; }
  });
  $("nameBtn").addEventListener("click", async () => {
    $("editError").textContent = "";
    const nu = $("edUsername").value.trim();
    if (nu.length < 2) { $("editError").textContent = "사용자명은 2자 이상이어야 합니다."; return; }
    try {
      const res = await API.profileUsername(nu);
      if (res.token) { const u = API.getUser() || {}; u.username = nu; API.setSession(res.token, u); }
      alert("사용자명이 변경되었습니다.");
      location.reload();
    } catch (e) { $("editError").textContent = e.message; }
  });

  if (viewUser) loadOther(viewUser);
  else loadSelf();


  /* ---------- 업적 ---------- */
  async function loadAchievements(username, self) {
    const box = $("pfAchievements");
    try {
      const data = self ? await API.achievements() : await API.achievementsOf(username);
      const list = data.achievements || [];
      if (!list.length) { box.innerHTML = '<p class="muted">아직 획득한 업적이 없습니다.</p>'; return; }
      const earned = list.filter((a) => a.earned).length;
      $("pfAchCount").textContent = self ? `${earned} / ${list.length}` : `${list.length}개 획득`;
      box.innerHTML = list.map((a) => `
        <div class="ach ${a.earned ? "got" : "locked"}" title="${esc(a.desc)}">
          <div class="ach-icon">${esc(a.icon)}</div>
          <div class="ach-name">${esc(a.name)}</div>
        </div>`).join("");
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  /* ---------- 게임 아카이브 ---------- */
  async function loadArchive() {
    const box = $("pfRecent");
    try {
      const { games } = await API.gamesArchive($("pfArcResult").value, $("pfArcOpp").value.trim());
      if (!games.length) { box.innerHTML = '<p class="muted">조건에 맞는 게임이 없습니다.</p>'; return; }
      const KO = { win: "승", loss: "패", draw: "무" };
      box.innerHTML = games.map((g) => `
        <div class="player-row">
          <span class="arc-badge arc-${esc(g.outcome)}">${esc(KO[g.outcome])}</span>
          <span class="name">vs ${esc(g.opponent)}</span>
          <span class="rating">${esc((g.createdAt || "").slice(0, 10))}</span>
        </div>`).join("");
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }
  $("pfArcSearch").addEventListener("click", loadArchive);
  $("pfArcOpp").addEventListener("keydown", (e) => { if (e.key === "Enter") loadArchive(); });
  $("pfArcResult").addEventListener("change", loadArchive);

  // PGN 다운로드는 토큰이 필요하므로 fetch 로 처리
  $("pfArcDownload").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!API.getToken()) return;
    try {
      const res = await fetch("/api/games/archive/pgn", {
        headers: { Authorization: "Bearer " + API.getToken() },
      });
      if (!res.ok) throw new Error("내려받기에 실패했습니다.");
      const text = await res.text();
      const blob = new Blob([text], { type: "application/x-chess-pgn" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kiwi_games.pgn";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
  });

  window.kiwiLoadAchievements = loadAchievements;
  window.kiwiLoadArchive = loadArchive;

})();
