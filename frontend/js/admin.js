/* admin.html — 관리자 전권 패널 (대시보드/사용자/게임/보안/설정/감사로그) */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  const KIND_KO = {
    login_failed: "로그인 실패", login_locked: "계정 잠금", rate_limited: "레이트 리밋",
    bot_suspect: "봇 의심", banned_login: "정지 계정 접근",
  };
  const ACTION_KO = {
    set_streak: "스트릭 변경", set_stats: "전적 변경", reset_password: "비밀번호 재설정",
    add_friendship: "친구 추가", delete_friendship: "친구 삭제", delete_dm: "DM 삭제",
    delete_game: "게임 삭제", set_setting: "설정 변경", announce: "공지 방송",
  };

  async function safe(fn) {
    try { return await fn(); }
    catch (e) { alert("오류: " + e.message); return null; }
  }

  // ---------- 초기화 / 권한 확인 ----------
  async function init() {
    if (!API.getToken()) { $("denied").classList.remove("hidden"); return; }
    try {
      const stats = await API.adminStats();
      $("adminBody").classList.remove("hidden");
      renderStats(stats);
      loadUsers();
      loadSuspicious();
      loadSecurityLog();
      loadSettings();
      loadAudit();
      loadGames();
    } catch (e) {
      $("denied").classList.remove("hidden");
    }
  }

  // ---------- 탭 ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.getAttribute("data-tab")).classList.remove("hidden");
    });
  });

  // ---------- 대시보드 ----------
  function renderStats(s) {
    const items = [
      ["사용자", s.users], ["관리자", s.admins], ["정지", s.banned],
      ["게임", s.games], ["친구관계", s.friendships], ["메시지", s.messages],
      ["퍼즐", s.puzzles], ["온라인", s.online], ["버전", s.version],
    ];
    $("statGrid").innerHTML = items.map(([k, v]) =>
      `<div class="stat-box"><div class="stat-num">${esc(v)}</div><div class="stat-label">${esc(k)}</div></div>`).join("");
  }

  $("reloadPzBtn").addEventListener("click", async () => {
    $("reloadNote").textContent = "로드 중…";
    const r = await safe(() => API.adminReloadPuzzles());
    if (r) { $("reloadNote").textContent = `✅ ${r.puzzles}개 로드됨`; renderStats(await API.adminStats()); }
    else $("reloadNote").textContent = "";
  });

  $("announceBtn").addEventListener("click", async () => {
    const text = $("announceText").value.trim();
    if (!text) return;
    const r = await safe(() => API.adminAnnounce(text));
    if (r) { $("announceNote").textContent = `✅ ${r.sent}명에게 발송됨`; $("announceText").value = ""; loadAudit(); }
  });

  // ---------- 사용자 목록 ----------
  async function loadUsers(q) {
    try {
      const { users } = await API.adminUsers(q);
      if (!users.length) { $("userTable").innerHTML = '<p class="muted">사용자가 없습니다.</p>'; return; }
      $("userTable").innerHTML = users.map((u) => `
        <div class="admin-row" data-id="${u.id}">
          <div style="flex:1;min-width:180px;">
            <b>${esc(u.username)}</b>
            ${u.isAdmin ? '<span class="tag admin">관리자</span>' : ""}
            ${u.banned ? '<span class="tag banned">정지</span>' : ""}
            <div class="muted" style="font-size:0.8rem;">ID ${esc(u.id)} · 레이팅 ${esc(u.rating)} · ${esc(u.games)}게임</div>
          </div>
          <div class="admin-actions">
            <button class="btn small act-detail">상세/편집</button>
            <button class="btn small ${u.banned ? "secondary" : "danger"} act-ban">${u.banned ? "정지해제" : "정지"}</button>
            <button class="btn small secondary act-admin">${u.isAdmin ? "관리자해제" : "관리자지정"}</button>
            <button class="btn small danger act-del">삭제</button>
          </div>
        </div>`).join("");
      bindUserRows();
    } catch (e) { $("userTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  function bindUserRows() {
    document.querySelectorAll("#userTable .admin-row").forEach((row) => {
      const id = parseInt(row.getAttribute("data-id"), 10);
      const banBtn = row.querySelector(".act-ban");
      const adminBtn = row.querySelector(".act-admin");
      row.querySelector(".act-detail").onclick = () => openUserDetail(id);
      banBtn.onclick = async () => {
        const shouldBan = banBtn.textContent.trim() === "정지";
        if (await safe(() => API.adminUpdateUser(id, { banned: shouldBan }))) {
          loadUsers($("userSearch").value); loadAudit();
        }
      };
      adminBtn.onclick = async () => {
        const makeAdmin = adminBtn.textContent.trim() === "관리자지정";
        if (await safe(() => API.adminUpdateUser(id, { is_admin: makeAdmin }))) {
          loadUsers($("userSearch").value); loadAudit();
        }
      };
      row.querySelector(".act-del").onclick = async () => {
        if (!confirm("정말 이 사용자를 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
        if (await safe(() => API.adminDeleteUser(id))) { loadUsers($("userSearch").value); loadAudit(); }
      };
    });
  }

  // ---------- 사용자 상세 (스트릭/전적/친구/DM/비밀번호) ----------
  async function openUserDetail(id) {
    const d = await safe(() => API.adminUserFull(id));
    if (!d) return;
    const u = d.user;
    $("udName").textContent = "— " + u.username;
    $("userDetailCard").classList.remove("hidden");
    $("udBody").innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:12px;">
        <div class="stat-box"><div class="stat-num">${esc(u.rating)}</div><div class="stat-label">레이팅</div></div>
        <div class="stat-box"><div class="stat-num">${esc(u.games)}</div><div class="stat-label">게임</div></div>
        <div class="stat-box"><div class="stat-num">${esc(u.streakCurrent)}</div><div class="stat-label">🔥 스트릭</div></div>
        <div class="stat-box"><div class="stat-num">${esc(d.botScore)}</div><div class="stat-label">봇 점수</div></div>
        <div class="stat-box"><div class="stat-num">${esc(d.dmCount)}</div><div class="stat-label">DM 수</div></div>
      </div>

      <h3>🔥 스트릭 편집</h3>
      <div class="admin-actions" style="margin-bottom:12px;">
        <label style="flex-direction:row;align-items:center;gap:4px;">현재<input type="number" id="udStreakCur" value="${esc(u.streakCurrent)}" min="0" style="width:80px;margin:0;" /></label>
        <label style="flex-direction:row;align-items:center;gap:4px;">최고<input type="number" id="udStreakBest" value="${esc(u.streakBest)}" min="0" style="width:80px;margin:0;" /></label>
        <label style="flex-direction:row;align-items:center;gap:4px;">최종일<input type="text" id="udStreakLast" value="${esc(u.streakLast || "")}" placeholder="YYYY-MM-DD" style="width:120px;margin:0;" /></label>
        <button class="btn small" id="udStreakSave">저장</button>
      </div>

      <h3>📊 전적 · 레이팅 편집</h3>
      <div class="admin-actions" style="margin-bottom:12px;">
        <label style="flex-direction:row;align-items:center;gap:4px;">승<input type="number" id="udWins" value="${esc(u.wins)}" min="0" style="width:70px;margin:0;" /></label>
        <label style="flex-direction:row;align-items:center;gap:4px;">패<input type="number" id="udLosses" value="${esc(u.losses)}" min="0" style="width:70px;margin:0;" /></label>
        <label style="flex-direction:row;align-items:center;gap:4px;">무<input type="number" id="udDraws" value="${esc(u.draws)}" min="0" style="width:70px;margin:0;" /></label>
        <label style="flex-direction:row;align-items:center;gap:4px;">레이팅<input type="number" id="udRating" value="${esc(u.rating)}" style="width:80px;margin:0;" /></label>
        <button class="btn small" id="udStatsSave">저장</button>
      </div>

      <h3>🔑 비밀번호 재설정</h3>
      <div class="admin-actions" style="margin-bottom:12px;">
        <input type="text" id="udNewPw" placeholder="새 비밀번호(6자 이상)" style="width:200px;margin:0;" />
        <button class="btn small brown" id="udPwSave">재설정</button>
      </div>

      <h3>👥 친구 관계 (${esc(d.friends.length)}명, 대기 ${esc(d.pendingRequests)})</h3>
      <div id="udFriends" style="margin-bottom:12px;"></div>

      <h3>💬 DM 기록 (${esc(d.dmCount)}건)</h3>
      <button class="btn small secondary" id="udLoadDms">DM 열람</button>
      <div id="udDms" style="margin-top:8px;"></div>

      <h3 style="margin-top:12px;">♟ 최근 게임 (${esc(d.games.length)})</h3>
      <div id="udGames"></div>
    `;

    // 스트릭 저장
    $("udStreakSave").onclick = async () => {
      const r = await safe(() => API.adminSetStreak(id, {
        current: parseInt($("udStreakCur").value, 10),
        best: parseInt($("udStreakBest").value, 10),
        last: $("udStreakLast").value.trim(),
      }));
      if (r) { alert("스트릭이 변경되었습니다."); openUserDetail(id); loadAudit(); }
    };
    // 전적 저장
    $("udStatsSave").onclick = async () => {
      const r = await safe(() => API.adminSetStats(id, {
        wins: parseInt($("udWins").value, 10),
        losses: parseInt($("udLosses").value, 10),
        draws: parseInt($("udDraws").value, 10),
        rating: parseFloat($("udRating").value),
      }));
      if (r) { alert("전적이 변경되었습니다."); openUserDetail(id); loadUsers($("userSearch").value); loadAudit(); }
    };
    // 비밀번호
    $("udPwSave").onclick = async () => {
      const pw = $("udNewPw").value;
      if (pw.length < 6) { alert("비밀번호는 6자 이상이어야 합니다."); return; }
      if (!confirm(`${u.username} 님의 비밀번호를 재설정하시겠습니까?`)) return;
      const r = await safe(() => API.adminResetPassword(id, pw));
      if (r) { alert("비밀번호가 재설정되었습니다."); $("udNewPw").value = ""; loadAudit(); }
    };
    // 친구 목록
    renderFriendships(id);
    // DM
    $("udLoadDms").onclick = async () => {
      const r = await safe(() => API.adminUserDms(id));
      if (!r) return;
      if (!r.messages.length) { $("udDms").innerHTML = '<p class="muted">DM이 없습니다.</p>'; return; }
      $("udDms").innerHTML = r.messages.map((m) => `
        <div class="sec-row" data-dm="${m.id}">
          <span class="sec-user">${esc(m.fromName)} → ${esc(m.toName)}</span>
          <span style="grid-column:span 2;">${esc(m.text)}</span>
          <span class="muted">${esc((m.ts || "").replace("T", " ").slice(0, 16))}</span>
          <button class="btn small danger dm-del">삭제</button>
        </div>`).join("");
      $("udDms").querySelectorAll(".dm-del").forEach((b) => {
        b.onclick = async () => {
          const did = b.closest("[data-dm]").getAttribute("data-dm");
          if (await safe(() => API.adminDeleteDm(did))) { $("udLoadDms").click(); loadAudit(); }
        };
      });
    };
    // 게임
    $("udGames").innerHTML = d.games.length
      ? d.games.map((g) => `<div class="player-row"><span class="name">${esc(g.white)} vs ${esc(g.black)}</span><span class="rating">${esc(g.result)}</span></div>`).join("")
      : '<p class="muted">게임 기록이 없습니다.</p>';
  }

  async function renderFriendships(id) {
    const r = await safe(() => API.adminUserFriends(id));
    if (!r) return;
    const box = $("udFriends");
    if (!r.friendships.length) { box.innerHTML = '<p class="muted">친구 관계가 없습니다.</p>'; return; }
    box.innerHTML = r.friendships.map((f) => `
      <div class="admin-row" data-fid="${f.friendshipId}">
        <div style="flex:1;">
          <b>${esc(f.otherName)}</b>
          <span class="tag ${f.status === "accepted" ? "admin" : ""}">${esc(f.status === "accepted" ? "친구" : "대기")}</span>
          <span class="muted" style="font-size:0.8rem;">${esc(f.direction === "sent" ? "보낸 요청" : "받은 요청")}</span>
        </div>
        <button class="btn small danger fr-del">관계 삭제</button>
      </div>`).join("");
    box.querySelectorAll(".fr-del").forEach((b) => {
      b.onclick = async () => {
        const fid = b.closest("[data-fid]").getAttribute("data-fid");
        if (await safe(() => API.adminDeleteFriendship(fid))) { renderFriendships(id); loadAudit(); }
      };
    });
  }

  $("udClose").addEventListener("click", () => $("userDetailCard").classList.add("hidden"));
  $("searchBtn").addEventListener("click", () => loadUsers($("userSearch").value));
  $("userSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") loadUsers($("userSearch").value); });

  // ---------- 게임 관리 ----------
  async function loadGames(q) {
    try {
      const { games } = await API.adminGames(q);
      const box = $("gameTable");
      if (!games.length) { box.innerHTML = '<p class="muted">게임 기록이 없습니다.</p>'; return; }
      box.innerHTML = games.map((g) => `
        <div class="admin-row" data-gid="${g.id}">
          <div style="flex:1;">
            <b>${esc(g.white)} vs ${esc(g.black)}</b>
            <div class="muted" style="font-size:0.8rem;">${esc(g.result)} · ${esc(g.reason)} · ${esc((g.createdAt || "").slice(0, 10))}</div>
          </div>
          <button class="btn small danger game-del">삭제</button>
        </div>`).join("");
      box.querySelectorAll(".game-del").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("이 게임 기록을 삭제하시겠습니까?")) return;
          const gid = b.closest("[data-gid]").getAttribute("data-gid");
          if (await safe(() => API.adminDeleteGame(gid))) { loadGames($("gameSearch").value); loadAudit(); }
        };
      });
    } catch (e) { $("gameTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  $("gameSearchBtn").addEventListener("click", () => loadGames($("gameSearch").value));

  // ---------- 보안 ----------
  async function loadSuspicious() {
    try {
      const { suspicious } = await API.adminSuspicious();
      const box = $("suspTable");
      if (!suspicious.length) { box.innerHTML = '<p class="muted">의심스러운 활동이 없습니다. ✅</p>'; return; }
      box.innerHTML = suspicious.map((u) => `
        <div class="admin-row" data-sid="${u.id}">
          <div style="flex:1;">
            <b>${esc(u.username)}</b> ${u.banned ? '<span class="tag banned">정지</span>' : ""}
            <div class="muted" style="font-size:0.8rem;">봇 점수 ${esc(u.botScore)} · 누적 의심 ${esc(u.suspicion)}</div>
          </div>
          <div class="admin-actions">
            <button class="btn small danger sus-ban">정지</button>
            <button class="btn small secondary sus-clear">의심 해제</button>
          </div>
        </div>`).join("");
      box.querySelectorAll(".admin-row").forEach((row) => {
        const id = parseInt(row.getAttribute("data-sid"), 10);
        row.querySelector(".sus-ban").onclick = async () => {
          if (await safe(() => API.adminUpdateUser(id, { banned: true }))) { loadSuspicious(); loadUsers(); loadAudit(); }
        };
        row.querySelector(".sus-clear").onclick = async () => {
          if (await safe(() => API.adminClearSuspicion(id))) loadSuspicious();
        };
      });
    } catch (e) { $("suspTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  async function loadSecurityLog() {
    try {
      const { events } = await API.adminSecurity($("secKind").value);
      const box = $("secTable");
      if (!events.length) { box.innerHTML = '<p class="muted">기록된 이벤트가 없습니다.</p>'; return; }
      box.innerHTML = events.slice(0, 80).map((e) => `
        <div class="sec-row">
          <span class="sec-kind k-${esc(e.kind)}">${esc(KIND_KO[e.kind] || e.kind)}</span>
          <span class="sec-user">${esc(e.username || "-")}</span>
          <span class="muted sec-path">${esc(e.path)}</span>
          <span class="muted sec-detail">${esc(e.detail || "")}</span>
          <span class="muted sec-ts">${esc((e.ts || "").replace("T", " ").slice(0, 19))}</span>
        </div>`).join("");
    } catch (e) { $("secTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  $("secRefresh").addEventListener("click", loadSecurityLog);
  $("secKind").addEventListener("change", loadSecurityLog);

  // ---------- 사이트 설정 ----------
  async function loadSettings() {
    try {
      const { settings } = await API.adminSettings();
      $("settingsList").innerHTML = settings.map((s) => {
        let control;
        if (s.type === "bool") {
          control = `<input type="checkbox" class="set-input" data-key="${esc(s.key)}" data-type="bool" ${s.value ? "checked" : ""} style="width:auto;margin:0;" />`;
        } else if (s.type === "int") {
          control = `<input type="number" class="set-input" data-key="${esc(s.key)}" data-type="int" value="${esc(s.value)}" style="width:110px;margin:0;" />`;
        } else {
          control = `<input type="text" class="set-input" data-key="${esc(s.key)}" data-type="str" value="${esc(s.value)}" style="margin:0;" />`;
        }
        return `<div class="admin-row">
          <div style="flex:1;min-width:200px;">
            <b>${esc(s.desc)}</b>
            <div class="muted" style="font-size:0.78rem;">${esc(s.key)}</div>
          </div>
          <div class="admin-actions">${control}
            <button class="btn small set-save" data-key="${esc(s.key)}">저장</button>
          </div>
        </div>`;
      }).join("");
      $("settingsList").querySelectorAll(".set-save").forEach((b) => {
        b.onclick = async () => {
          const key = b.getAttribute("data-key");
          const input = $("settingsList").querySelector(`.set-input[data-key="${key}"]`);
          let value;
          const t = input.getAttribute("data-type");
          if (t === "bool") value = input.checked;
          else if (t === "int") value = parseInt(input.value, 10);
          else value = input.value;
          if (await safe(() => API.adminSetSetting(key, value))) {
            b.textContent = "✅"; setTimeout(() => { b.textContent = "저장"; }, 1200);
            loadAudit();
          }
        };
      });
    } catch (e) { $("settingsList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---------- 감사 로그 ----------
  async function loadAudit() {
    try {
      const { actions } = await API.adminActions();
      const box = $("auditTable");
      if (!actions.length) { box.innerHTML = '<p class="muted">기록된 관리자 행위가 없습니다.</p>'; return; }
      box.innerHTML = actions.slice(0, 100).map((a) => `
        <div class="sec-row">
          <span class="sec-kind">${esc(ACTION_KO[a.action] || a.action)}</span>
          <span class="sec-user">${esc(a.adminName)}</span>
          <span class="muted">${esc(a.targetName || a.targetType)}</span>
          <span class="muted sec-detail">${esc(a.detail || "")}</span>
          <span class="muted sec-ts">${esc((a.ts || "").replace("T", " ").slice(0, 19))}</span>
        </div>`).join("");
    } catch (e) { $("auditTable").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  $("auditRefresh").addEventListener("click", loadAudit);

  init();
})();
