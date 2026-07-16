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
      loadSecurity();
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
      // 모바일에는 title 툴팁이 뜨지 않으므로 탭하면 조건이 펼쳐지도록 한다
      box.innerHTML = list.map((a) => `
        <button class="ach ${a.earned ? "got" : "locked"}" data-code="${esc(a.code)}"
                aria-expanded="false">
          <span class="ach-icon">${esc(a.icon)}</span>
          <span class="ach-name">${esc(a.name)}</span>
          <span class="ach-desc">${esc(a.desc)}</span>
          <span class="ach-state">${a.earned ? "✅ 달성" : "🔒 미달성"}</span>
        </button>`).join("");

      box.querySelectorAll(".ach").forEach((el) => {
        el.addEventListener("click", () => {
          const open = el.classList.toggle("show-desc");
          el.setAttribute("aria-expanded", open ? "true" : "false");
        });
      });
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



  /* ==================== 🔐 계정 보안 ==================== */
  async function loadSecurity() {
    if (!API.getToken()) return;
    $("securityCard").classList.remove("hidden");
    try {
      const s = await API.accountSecurity();
      const fmt = (t) => t ? t.replace("T", " ").slice(0, 16) : "-";
      $("secStatus").innerHTML = `
        <div class="stat-box"><div class="stat-num">${s.twoFactor ? "✅" : "❌"}</div><div class="stat-label">2단계 인증</div></div>
        <div class="stat-box"><div class="stat-num" style="font-size:0.8rem;">${esc(fmt(s.lastLoginAt))}</div><div class="stat-label">마지막 로그인</div></div>
        <div class="stat-box"><div class="stat-num" style="font-size:0.8rem;">${esc(fmt(s.passwordChangedAt))}</div><div class="stat-label">비밀번호 변경</div></div>`;

      $("twoFaOff").classList.toggle("hidden", s.twoFactor);
      $("twoFaOn").classList.toggle("hidden", !s.twoFactor);
      $("twoFaSetup").classList.add("hidden");
      $("tfBackupLeft").textContent = s.twoFactor ? `(백업 코드 ${s.backupCodesLeft}개 남음)` : "";
    } catch (e) { /* noop */ }
  }

  $("tfSetupBtn").addEventListener("click", async () => {
    try {
      const r = await API.twoFactorSetup();
      $("tfSecret").textContent = r.secret;
      $("twoFaOff").classList.add("hidden");
      $("twoFaSetup").classList.remove("hidden");
      $("tfError").textContent = "";
    } catch (e) { alert(e.message); }
  });

  $("tfCancelBtn").addEventListener("click", () => {
    $("twoFaSetup").classList.add("hidden");
    $("twoFaOff").classList.remove("hidden");
  });

  $("tfEnableBtn").addEventListener("click", async () => {
    $("tfError").textContent = "";
    try {
      const r = await API.twoFactorEnable($("tfCode").value.trim());
      $("tfBackupCodes").classList.remove("hidden");
      $("tfBackupCodes").innerHTML =
        "<b>⚠️ 백업 코드 — 지금 딱 한 번만 보여집니다. 안전한 곳에 저장하세요.</b>" +
        "<div class='bc-grid'>" + r.backupCodes.map((c) => `<code>${esc(c)}</code>`).join("") + "</div>" +
        "<p class='muted'>인증 앱을 잃어버렸을 때 이 코드로 로그인할 수 있습니다. 각 코드는 1회만 사용됩니다.</p>";
      $("tfCode").value = "";
      loadSecurity();
    } catch (e) { $("tfError").textContent = e.message; }
  });

  $("tfDisableBtn").addEventListener("click", async () => {
    if (!confirm("2단계 인증을 끄면 계정 보안이 약해집니다. 계속할까요?")) return;
    try {
      await API.twoFactorDisable($("tfDisablePw").value);
      $("tfDisablePw").value = "";
      $("tfBackupCodes").classList.add("hidden");
      loadSecurity();
    } catch (e) { alert(e.message); }
  });

  $("pwChangeBtn").addEventListener("click", async () => {
    $("pwMsg").textContent = "";
    try {
      const r = await API.accountPassword($("pwCurrent").value, $("pwNew").value);
      // 새 토큰으로 세션 갱신 (현재 기기는 유지)
      const u = API.getUser();
      API.setSession(r.token, u);
      $("pwCurrent").value = ""; $("pwNew").value = "";
      $("pwMsg").style.color = "var(--accent-strong)";
      $("pwMsg").textContent = r.message;
      loadSecurity();
    } catch (e) {
      $("pwMsg").style.color = "var(--danger)";
      $("pwMsg").textContent = e.message;
    }
  });

  $("logoutAllBtn").addEventListener("click", async () => {
    if (!confirm("모든 기기에서 로그아웃하시겠습니까? (현재 기기는 유지됩니다)")) return;
    try {
      const r = await API.accountLogoutAll();
      API.setSession(r.token, API.getUser());
      alert("모든 기기에서 로그아웃되었습니다.");
    } catch (e) { alert(e.message); }
  });

  $("exportBtn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/account/export", {
        headers: { Authorization: "Bearer " + API.getToken() },
      });
      if (!res.ok) throw new Error("내보내기에 실패했습니다.");
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "kiwi_my_data.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  });

  $("deleteBtn").addEventListener("click", async () => {
    $("delMsg").textContent = "";
    if (!confirm("정말 계정을 영구 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    try {
      await API.accountDelete($("delPw").value, $("delConfirm").value.trim());
      API.clearSession();
      alert("계정이 삭제되었습니다. 그동안 이용해주셔서 감사합니다.");
      location.href = "/index.html";
    } catch (e) { $("delMsg").textContent = e.message; }
  });

})();
