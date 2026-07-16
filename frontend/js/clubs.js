/* clubs.html — 체스 클럽: 목록/생성/가입/공지물/채팅/클럽 보드 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  let curSlug = null;
  let curClub = null;
  let myRole = null;
  let chatTimer = null;
  let lastMsgId = 0;
  let showMine = false;

  /* ==================== 목록 ==================== */
  async function loadList() {
    const box = $("clubList");
    box.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      const data = await API.clubs($("clubSearch").value.trim(), showMine);
      if (data.stats) {
        $("clubStats").innerHTML = `
          <div class="stat-box"><div class="stat-num">${data.stats.joined}</div><div class="stat-label">가입한 클럽</div></div>
          <div class="stat-box"><div class="stat-num">${data.stats.owned}</div><div class="stat-label">내가 만든 클럽</div></div>`;
      } else {
        $("clubStats").innerHTML = '<p class="muted">로그인하면 클럽을 만들고 가입할 수 있습니다.</p>';
      }

      if (!data.clubs.length) {
        box.innerHTML = showMine
          ? '<p class="muted">가입한 클럽이 없습니다.</p>'
          : '<p class="muted">클럽이 없습니다. 첫 클럽을 만들어보세요!</p>';
        return;
      }
      box.innerHTML = data.clubs.map((cl) => `
        <button class="club-card" data-slug="${esc(cl.slug)}">
          <span class="club-emoji">${esc(cl.emoji)}</span>
          <span class="cc-body">
            <b>${esc(cl.name)}</b>
            <small>${esc(cl.description || "소개가 없습니다.")}</small>
          </span>
          <span class="cc-meta">
            <b>${cl.members}</b><small>명</small>
            ${cl.myRole ? `<span class="tag admin">${esc(roleKo(cl.myRole))}</span>` : ""}
            ${cl.isPublic ? "" : '<span class="tag">비공개</span>'}
          </span>
        </button>`).join("");
      box.querySelectorAll(".club-card").forEach((b) => {
        b.addEventListener("click", () => openClub(b.getAttribute("data-slug")));
      });
    } catch (e) {
      box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  function roleKo(r) {
    return { owner: "개설자", admin: "운영진", member: "구성원" }[r] || r;
  }

  $("clubSearchBtn").addEventListener("click", () => { showMine = false; loadList(); });
  $("clubSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { showMine = false; loadList(); } });
  $("clubMineBtn").addEventListener("click", () => { showMine = !showMine; $("clubMineBtn").classList.toggle("active", showMine); loadList(); });
  $("clubNewBtn").addEventListener("click", () => $("clubCreate").classList.toggle("hidden"));
  $("ccCancel").addEventListener("click", () => $("clubCreate").classList.add("hidden"));

  $("ccSubmit").addEventListener("click", async () => {
    $("ccError").textContent = "";
    try {
      const r = await API.clubCreate({
        name: $("ccName").value.trim(),
        description: $("ccDesc").value.trim(),
        emoji: $("ccEmoji").value.trim() || "🏰",
        isPublic: $("ccPublic").checked,
      });
      $("clubCreate").classList.add("hidden");
      $("ccName").value = ""; $("ccDesc").value = "";
      openClub(r.club.slug);
    } catch (e) {
      $("ccError").textContent = e.message;
    }
  });

  /* ==================== 상세 ==================== */
  async function openClub(slug) {
    curSlug = slug;
    stopChat();
    $("clubListView").classList.add("hidden");
    $("clubDetailView").classList.remove("hidden");
    try {
      const d = await API.clubDetail(slug);
      curClub = d;
      myRole = d.myRole;

      $("cdEmoji").textContent = d.emoji;
      $("cdName").textContent = d.name;
      $("cdMeta").textContent =
        `구성원 ${d.members}명 · 개설자 ${d.ownerName}${d.isPublic ? "" : " · 비공개"}`;
      $("cdDesc").textContent = d.description || "소개가 없습니다.";

      const isMember = !!myRole;
      $("cdJoin").classList.toggle("hidden", isMember || !API.getToken());
      $("cdLeave").classList.toggle("hidden", !isMember || myRole === "owner");
      $("cdDelete").classList.toggle("hidden", myRole !== "owner");
      $("cdPostForm").classList.toggle("hidden", !isMember);
      $("cdChatForm").classList.toggle("hidden", !isMember);
      $("cpPinWrap").classList.toggle("hidden", !(myRole === "owner" || myRole === "admin"));

      renderPosts(d.posts);
      renderMembers(d.memberList);

      if (isMember) startChat();
      else $("cdChat").innerHTML = '<p class="muted">구성원만 채팅을 볼 수 있습니다.</p>';
    } catch (e) {
      $("cdName").textContent = "오류";
      $("cdDesc").textContent = e.message;
    }
  }

  $("cdBack").addEventListener("click", () => {
    stopChat();
    $("clubDetailView").classList.add("hidden");
    $("clubListView").classList.remove("hidden");
    loadList();
  });

  $("cdJoin").addEventListener("click", async () => {
    try { await API.clubJoin(curSlug); openClub(curSlug); }
    catch (e) { alert(e.message); }
  });
  $("cdLeave").addEventListener("click", async () => {
    if (!confirm("이 클럽에서 탈퇴하시겠습니까?")) return;
    try { await API.clubLeave(curSlug); openClub(curSlug); }
    catch (e) { alert(e.message); }
  });
  $("cdDelete").addEventListener("click", async () => {
    if (!confirm("클럽을 삭제하면 모든 글과 채팅이 사라집니다. 계속할까요?")) return;
    try {
      await API.clubDelete(curSlug);
      $("clubDetailView").classList.add("hidden");
      $("clubListView").classList.remove("hidden");
      loadList();
    } catch (e) { alert(e.message); }
  });

  /* ---- 구성원 ---- */
  function renderMembers(list) {
    $("cdMemberCount").textContent = `(${list.length})`;
    const canMod = myRole === "owner" || myRole === "admin";
    const me = API.getUser();
    $("cdMembers").innerHTML = list.map((m) => `
      <div class="player-row" data-uid="${m.id}">
        <span class="name">${esc(m.username)}</span>
        <span class="tag ${m.role === "owner" ? "admin" : ""}">${esc(roleKo(m.role))}</span>
        <span class="rating">${m.rating}</span>
        ${canMod && m.role !== "owner" && (!me || m.id !== me.id) ? `
          <span class="cm-actions">
            ${myRole === "owner" ? `<button class="btn small secondary cm-role">${m.role === "admin" ? "운영진 해제" : "운영진 임명"}</button>` : ""}
            <button class="btn small danger cm-kick">추방</button>
          </span>` : ""}
      </div>`).join("");

    $("cdMembers").querySelectorAll(".cm-role").forEach((b) => {
      b.addEventListener("click", async () => {
        const row = b.closest("[data-uid]");
        const uid = parseInt(row.getAttribute("data-uid"), 10);
        const cur = row.querySelector(".tag").textContent;
        try {
          await API.clubRole(curSlug, uid, cur === "운영진" ? "member" : "admin");
          openClub(curSlug);
        } catch (e) { alert(e.message); }
      });
    });
    $("cdMembers").querySelectorAll(".cm-kick").forEach((b) => {
      b.addEventListener("click", async () => {
        const uid = parseInt(b.closest("[data-uid]").getAttribute("data-uid"), 10);
        if (!confirm("이 구성원을 추방하시겠습니까?")) return;
        try { await API.clubKick(curSlug, uid); openClub(curSlug); }
        catch (e) { alert(e.message); }
      });
    });
  }

  /* ---- 공지물 / 게시글 ---- */
  function renderPosts(posts) {
    const box = $("cdPosts");
    if (!posts.length) { box.innerHTML = '<p class="muted">아직 글이 없습니다.</p>'; return; }
    const me = API.getUser();
    const canMod = myRole === "owner" || myRole === "admin";

    box.innerHTML = posts.map((p) => {
      const mine = me && p.authorId === me.id;
      const hasBoard = !!(p.fen || p.pgn);
      return `
      <div class="club-post ${p.pinned ? "pinned" : ""}" data-id="${p.id}">
        <div class="cp-head">
          ${p.pinned ? '<span class="cp-pin">📌</span>' : ""}
          <b>${esc(p.title)}</b>
          <span class="cp-meta">${esc(p.authorName)} · ${esc((p.ts || "").replace("T", " ").slice(5, 16))}</span>
        </div>
        ${p.body ? `<div class="cp-body">${esc(p.body).replace(/\n/g, "<br>")}</div>` : ""}
        ${hasBoard ? `
          <button class="btn small brown cp-board"
                  data-fen="${esc(p.fen)}" data-pgn="${esc(p.pgn)}" data-title="${esc(p.title)}">
            ♟ 클럽 보드 열기${p.pgn ? " (기보)" : " (국면)"}
          </button>` : ""}
        ${(mine || canMod) ? `
          <div class="cp-actions">
            ${canMod ? `<button class="btn small secondary cp-pinbtn">${p.pinned ? "고정 해제" : "고정"}</button>` : ""}
            <button class="btn small danger cp-del">삭제</button>
          </div>` : ""}
      </div>`;
    }).join("");

    box.querySelectorAll(".cp-board").forEach((b) => {
      b.addEventListener("click", () => openBoard(
        b.getAttribute("data-fen"), b.getAttribute("data-pgn"), b.getAttribute("data-title")));
    });
    box.querySelectorAll(".cp-del").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.closest("[data-id]").getAttribute("data-id");
        if (!confirm("이 글을 삭제하시겠습니까?")) return;
        try { await API.clubPostDelete(curSlug, id); openClub(curSlug); }
        catch (e) { alert(e.message); }
      });
    });
    box.querySelectorAll(".cp-pinbtn").forEach((b) => {
      b.addEventListener("click", async () => {
        const el = b.closest("[data-id]");
        const id = el.getAttribute("data-id");
        const pin = !el.classList.contains("pinned");
        try { await API.clubPostPin(curSlug, id, pin); openClub(curSlug); }
        catch (e) { alert(e.message); }
      });
    });
  }

  $("cpSubmit").addEventListener("click", async () => {
    $("cpError").textContent = "";
    const title = $("cpTitle").value.trim();
    if (title.length < 2) { $("cpError").textContent = "제목을 입력해주세요."; return; }
    try {
      await API.clubPostCreate(curSlug, {
        title,
        body: $("cpBody").value.trim(),
        pgn: $("cpPgn").value.trim(),
        fen: $("cpFen").value.trim(),
        pinned: $("cpPin") ? $("cpPin").checked : false,
      });
      $("cpTitle").value = ""; $("cpBody").value = "";
      $("cpPgn").value = ""; $("cpFen").value = "";
      if ($("cpPin")) $("cpPin").checked = false;
      openClub(curSlug);
    } catch (e) { $("cpError").textContent = e.message; }
  });

  /* ---- 채팅 (폴링) ---- */
  function startChat() {
    lastMsgId = 0;
    $("cdChat").innerHTML = "";
    pollChat(true);
    stopChat();
    chatTimer = setInterval(() => pollChat(false), 4000);
  }
  function stopChat() {
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  }

  async function pollChat(first) {
    if (!curSlug || !myRole) return;
    try {
      const { messages } = await API.clubMessages(curSlug, lastMsgId);
      if (!messages.length) {
        if (first) $("cdChat").innerHTML = '<p class="muted">아직 대화가 없습니다.</p>';
        return;
      }
      if (first) $("cdChat").innerHTML = "";
      const me = API.getUser();
      const canMod = myRole === "owner" || myRole === "admin";
      messages.forEach((m) => {
        lastMsgId = Math.max(lastMsgId, m.id);
        const mine = me && m.authorId === me.id;
        const div = document.createElement("div");
        div.className = "club-msg" + (mine ? " me" : "");
        div.setAttribute("data-mid", m.id);
        div.innerHTML =
          `<span class="cmsg-who">${esc(m.authorName)}</span>` +
          `<span class="cmsg-text">${esc(m.text)}</span>` +
          ((mine || canMod) ? '<button class="cmsg-del" title="삭제">✕</button>' : "");
        $("cdChat").appendChild(div);
      });
      $("cdChat").querySelectorAll(".cmsg-del").forEach((b) => {
        if (b._bound) return;
        b._bound = true;
        b.addEventListener("click", async () => {
          const id = b.closest("[data-mid]").getAttribute("data-mid");
          try { await API.clubMessageDelete(curSlug, id); b.closest("[data-mid]").remove(); }
          catch (e) { alert(e.message); }
        });
      });
      $("cdChat").scrollTop = $("cdChat").scrollHeight;
    } catch (e) { /* 권한 없음 등 */ }
  }

  async function sendMsg() {
    const text = $("cmText").value.trim();
    if (!text) return;
    $("cmText").value = "";
    try { await API.clubMessageSend(curSlug, text); pollChat(false); }
    catch (e) { alert(e.message); }
  }
  $("cmSend").addEventListener("click", sendMsg);
  $("cmText").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMsg(); });

  /* ==================== 클럽 보드 ==================== */
  let bBoard = null;
  let bGame = null;
  let bMoves = [];
  let bPly = 0;
  let bStartFen = "";

  function openBoard(fen, pgn, title) {
    $("bmTitle").textContent = title || "국면";
    $("boardModal").classList.add("show");

    bMoves = [];
    bPly = 0;
    bStartFen = "";

    if (pgn) {
      bGame = new Chess();
      pgn.split(/\s+/).forEach((san) => {
        const m = bGame.move(san);
        if (m) bMoves.push(m.san);
      });
      bGame = new Chess();          // 처음부터 보여준다
      bStartFen = bGame.fen();
    } else if (fen) {
      try { bGame = new Chess(fen); bStartFen = fen; }
      catch (e) { bGame = new Chess(); }
    } else {
      bGame = new Chess();
    }

    if (bBoard) bBoard.destroy();
    bBoard = Chessboard("club-board", {
      draggable: false,
      position: bGame.fen(),
      pieceTheme: window.kiwiPieceTheme,
    });
    renderBoardMoves();
    $("bmPrev").style.display = bMoves.length ? "" : "none";
    $("bmNext").style.display = bMoves.length ? "" : "none";
  }

  function renderBoardMoves() {
    if (!bMoves.length) { $("bmMoves").innerHTML = '<span class="muted">국면 하나만 공유된 글입니다.</span>'; return; }
    let html = "";
    for (let i = 0; i < bMoves.length; i += 2) {
      html += `<span class="mv-num">${i / 2 + 1}.</span>`;
      html += `<span class="mv${i + 1 === bPly ? " mv-active" : ""}">${esc(bMoves[i])}</span> `;
      if (i + 1 < bMoves.length) {
        html += `<span class="mv${i + 2 === bPly ? " mv-active" : ""}">${esc(bMoves[i + 1])}</span> `;
      }
    }
    $("bmMoves").innerHTML = html;
  }

  function goPly(p) {
    p = Math.max(0, Math.min(bMoves.length, p));
    bPly = p;
    bGame = new Chess(bStartFen || undefined);
    for (let i = 0; i < p; i++) bGame.move(bMoves[i]);
    bBoard.position(bGame.fen());
    renderBoardMoves();
  }
  $("bmPrev").addEventListener("click", () => goPly(bPly - 1));
  $("bmNext").addEventListener("click", () => goPly(bPly + 1));
  $("bmClose").addEventListener("click", () => $("boardModal").classList.remove("show"));
  $("boardModal").addEventListener("click", (e) => {
    if (e.target === $("boardModal")) $("boardModal").classList.remove("show");
  });
  $("bmAnalyze").addEventListener("click", () => {
    try {
      if (bMoves.length) {
        const g = new Chess();
        bMoves.forEach((s) => g.move(s));
        localStorage.setItem("kiwi_review_pgn", g.pgn());
      } else if (bStartFen) {
        localStorage.setItem("kiwi_review_fen", bStartFen);
      }
    } catch (e) {}
    location.href = window.kiwiPageUrl ? window.kiwiPageUrl("/analysis.html") : "/analysis.html";
  });

  loadList();
})();
