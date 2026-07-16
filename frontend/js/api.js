/* 앱 버전 — 캐시된 옛 페이지로 이동하지 않도록 링크에 붙인다.
   (scripts/bump_version.py 가 자동 갱신) */
window.KIWI_VERSION = "30";
window.kiwiPageUrl = function (page) {
  const p = String(page).replace(/^\/*/, "/");
  return p + (p.indexOf("?") === -1 ? "?v=" : "&v=") + window.KIWI_VERSION;
};

/* 전역 XSS 방어 유틸 — 모든 페이지에서 사용 (api.js 는 전 페이지에 로드됨) */
window.kiwiEscapeHtml = function (value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`=\/]/g, function (c) {
    return {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
      "'": "&#39;", "`": "&#96;", "=": "&#61;", "/": "&#47;",
    }[c];
  });
};
// 안전한 텍스트 설정 헬퍼 (innerHTML 대신 사용 권장)
window.kiwiSetText = function (el, text) {
  if (el) el.textContent = text === null || text === undefined ? "" : String(text);
};

/* REST API 호출 및 세션 관리 */
const API = (() => {
  const TOKEN_KEY = "kiwi_token";
  const USER_KEY = "kiwi_user";

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
    catch (e) { return null; }
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function request(path, options = {}) {
    const headers = options.headers || {};
    headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, { ...options, headers });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || ("요청 실패 (" + res.status + ")");
      throw new Error(msg);
    }
    return data;
  }

  return {
    getToken, getUser, setSession, clearSession,
    login: (username, password, code) =>
      request("/api/login", { method: "POST",
        body: JSON.stringify({ username, password, code: code || null }) }),
    register: (username, password, extra) =>
      request("/api/register", { method: "POST",
        body: JSON.stringify({ username, password,
                               acceptTerms: !!(extra && extra.acceptTerms),
                               website: (extra && extra.website) || "" }) }),
    // 계정 보안
    accountSecurity: () => request("/api/account/security"),
    accountPassword: (current_password, new_password) =>
      request("/api/account/password", { method: "POST",
        body: JSON.stringify({ current_password, new_password }) }),
    accountLogoutAll: () => request("/api/account/logout-all", { method: "POST" }),
    twoFactorSetup: () => request("/api/account/2fa/setup", { method: "POST" }),
    twoFactorEnable: (code) =>
      request("/api/account/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }),
    twoFactorDisable: (password) =>
      request("/api/account/2fa/disable", { method: "POST", body: JSON.stringify({ password }) }),
    accountDelete: (password, confirm) =>
      request("/api/account/delete", { method: "POST",
        body: JSON.stringify({ password, confirm }) }),
    me: () => request("/api/me"),
    streakPing: () => request("/api/streak/ping", { method: "POST" }),
    bots: () => request("/api/bots"),
    botMove: (fen, level, elo) =>
      request("/api/bot/move", { method: "POST", body: JSON.stringify({ fen, level: level || null, elo: elo || null }) }),
    leaderboard: () => request("/api/leaderboard"),
    online: () => request("/api/online"),
    randomPuzzle: (min = 0, max = 4000, theme = "") =>
      request(`/api/puzzles/random?min=${min}&max=${max}${theme ? "&theme=" + encodeURIComponent(theme) : ""}`),
    puzzleSolved: (puzzle_id, success, rated = true) =>
      request("/api/puzzles/solved", { method: "POST", body: JSON.stringify({ puzzle_id, success, rated }) }),
    puzzleThemes: () => request("/api/puzzles/themes"),
    // 친구
    userSearch: (q) => request("/api/users/search?q=" + encodeURIComponent(q)),
    friendRequest: (username) =>
      request("/api/friends/request", { method: "POST", body: JSON.stringify({ username }) }),
    friendRespond: (request_id, accept) =>
      request("/api/friends/respond", { method: "POST", body: JSON.stringify({ request_id, accept }) }),
    friends: () => request("/api/friends"),
    friendRequests: () => request("/api/friends/requests"),
    dmHistory: (friendId) => request("/api/friends/dm/" + friendId),
    dmSend: (to_id, text) =>
      request("/api/friends/dm", { method: "POST", body: JSON.stringify({ to_id, text }) }),
    // 프로필
    profileMe: () => request("/api/profile/me"),
    profileUpdate: (data) => request("/api/profile", { method: "POST", body: JSON.stringify(data) }),
    profileUsername: (new_username) => request("/api/profile/username", { method: "POST", body: JSON.stringify({ new_username }) }),
    profileView: (username) => request("/api/profile/" + encodeURIComponent(username)),
    players: (q, sort) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (sort) p.set("sort", sort);
      const qs = p.toString();
      return request("/api/players" + (qs ? "?" + qs : ""));
    },
    // 관리자
    adminStats: () => request("/api/admin/stats"),
    adminUsers: (q) => request("/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : "")),
    adminUpdateUser: (id, data) => request("/api/admin/user/" + id, { method: "POST", body: JSON.stringify(data) }),
    adminDeleteUser: (id) => request("/api/admin/user/" + id, { method: "DELETE" }),
    adminReloadPuzzles: () => request("/api/admin/reload_puzzles", { method: "POST" }),
    adminSecurity: (kind) => request("/api/admin/security" + (kind ? "?kind=" + encodeURIComponent(kind) : "")),
    adminSuspicious: () => request("/api/admin/suspicious"),
    adminClearSuspicion: (id) => request("/api/admin/clear_suspicion/" + id, { method: "POST" }),
    // 관리자 전권 (Step 2)
    adminUserFull: (id) => request("/api/admin/user/" + id + "/full"),
    adminSetStreak: (id, data) => request("/api/admin/user/" + id + "/streak", { method: "POST", body: JSON.stringify(data) }),
    adminSetStats: (id, data) => request("/api/admin/user/" + id + "/stats", { method: "POST", body: JSON.stringify(data) }),
    adminResetPassword: (id, new_password) => request("/api/admin/user/" + id + "/password", { method: "POST", body: JSON.stringify({ new_password }) }),
    adminUserFriends: (id) => request("/api/admin/user/" + id + "/friends"),
    adminDeleteFriendship: (fid) => request("/api/admin/friendship/" + fid, { method: "DELETE" }),
    adminAddFriendship: (user_a, user_b) => request("/api/admin/friendship", { method: "POST", body: JSON.stringify({ user_a, user_b }) }),
    adminUserDms: (id) => request("/api/admin/user/" + id + "/dms"),
    adminDeleteDm: (id) => request("/api/admin/dm/" + id, { method: "DELETE" }),
    adminGames: (q) => request("/api/admin/games" + (q ? "?q=" + encodeURIComponent(q) : "")),
    adminDeleteGame: (id) => request("/api/admin/game/" + id, { method: "DELETE" }),
    adminSettings: () => request("/api/admin/settings"),
    adminSetSetting: (key, value) => request("/api/admin/settings", { method: "POST", body: JSON.stringify({ key, value }) }),
    adminAnnounce: (text) => request("/api/admin/announce", { method: "POST", body: JSON.stringify({ text }) }),
    adminActions: () => request("/api/admin/actions"),
    // 공개 사이트 정보
    site: () => request("/api/site"),
    // --- Step 4: 훈련 · 오프닝 · 업적 · 알림 · 아카이브 ---
    dailyPuzzle: () => request("/api/puzzles/daily"),
    dailyStatus: () => request("/api/puzzles/daily/status"),
    dailySolved: (success, seconds) =>
      request("/api/puzzles/daily/solved", { method: "POST", body: JSON.stringify({ success, seconds }) }),
    rushModes: () => request("/api/rush/modes"),
    rushPuzzles: (count = 60) => request("/api/rush/puzzles?count=" + count),
    rushResult: (mode, score, misses) =>
      request("/api/rush/result", { method: "POST", body: JSON.stringify({ mode, score, misses }) }),
    rushLeaderboard: (mode = "3m") => request("/api/rush/leaderboard?mode=" + encodeURIComponent(mode)),
    rushHistory: () => request("/api/rush/history"),
    puzzleLeaderboard: () => request("/api/puzzles/leaderboard"),
    // 시각(Vision) 훈련
    visionModes: () => request("/api/vision/modes"),
    visionQuestions: (mode, count = 120) =>
      request("/api/vision/questions?mode=" + encodeURIComponent(mode) + "&count=" + count),
    visionResult: (mode, score, misses) =>
      request("/api/vision/result", { method: "POST", body: JSON.stringify({ mode, score, misses }) }),
    visionLeaderboard: (mode) => request("/api/vision/leaderboard?mode=" + encodeURIComponent(mode)),
    visionHistory: () => request("/api/vision/history"),
    // 통찰 (Insights)
    insights: (days = 0) => request("/api/insights" + (days ? "?days=" + days : "")),
    insightsOf: (username) => request("/api/insights/" + encodeURIComponent(username)),
    insightsSaveReview: (data) =>
      request("/api/insights/review", { method: "POST", body: JSON.stringify(data) }),
    // 체스 클럽
    clubs: (q, mine) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (mine) p.set("mine", "true");
      const qs = p.toString();
      return request("/api/clubs" + (qs ? "?" + qs : ""));
    },
    clubCreate: (data) => request("/api/clubs", { method: "POST", body: JSON.stringify(data) }),
    clubDetail: (slug) => request("/api/clubs/" + encodeURIComponent(slug)),
    clubDelete: (slug) => request("/api/clubs/" + encodeURIComponent(slug), { method: "DELETE" }),
    clubJoin: (slug) => request("/api/clubs/" + encodeURIComponent(slug) + "/join", { method: "POST" }),
    clubLeave: (slug) => request("/api/clubs/" + encodeURIComponent(slug) + "/leave", { method: "POST" }),
    clubRole: (slug, userId, role) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/role",
              { method: "POST", body: JSON.stringify({ userId, role }) }),
    clubKick: (slug, userId) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/kick",
              { method: "POST", body: JSON.stringify({ userId }) }),
    clubPostCreate: (slug, data) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/posts",
              { method: "POST", body: JSON.stringify(data) }),
    clubPostDelete: (slug, id) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/posts/" + id, { method: "DELETE" }),
    clubPostPin: (slug, id, pinned) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/posts/" + id + "/pin",
              { method: "POST", body: JSON.stringify({ pinned }) }),
    clubMessages: (slug, after = 0) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/messages?after=" + after),
    clubMessageSend: (slug, text) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/messages",
              { method: "POST", body: JSON.stringify({ text }) }),
    clubMessageDelete: (slug, id) =>
      request("/api/clubs/" + encodeURIComponent(slug) + "/messages/" + id, { method: "DELETE" }),
    // 퍼즐 전투
    battleLeaderboard: () => request("/api/battle/leaderboard"),
    battleHistory: () => request("/api/battle/history"),
    openings: (moves) => request("/api/openings" + (moves && moves.length ? "?moves=" + encodeURIComponent(moves.join(",")) : "")),
    openingsSearch: (q) => request("/api/openings/search?q=" + encodeURIComponent(q)),
    openingsBook: (moves) =>
      request("/api/openings/book", { method: "POST", body: JSON.stringify({ moves }) }),
    explorer: (moves, ratings, speeds, source) => {
      const p = new URLSearchParams();
      if (moves && moves.length) p.set("moves", moves.join(","));
      if (ratings && ratings.length) p.set("ratings", ratings.join(","));
      if (speeds && speeds.length) p.set("speeds", speeds.join(","));
      if (source) p.set("source", source);
      const qs = p.toString();
      return request("/api/explorer" + (qs ? "?" + qs : ""));
    },
    learnCurriculum: () => request("/api/learn/curriculum"),
    learnResult: (openingKey, score) =>
      request("/api/learn/result", { method: "POST", body: JSON.stringify({ openingKey, score }) }),
    achievements: () => request("/api/achievements"),
    achievementsOf: (username) => request("/api/achievements/" + encodeURIComponent(username)),
    notifications: () => request("/api/notifications"),
    notificationsRead: () => request("/api/notifications/read", { method: "POST" }),
    notificationsClear: () => request("/api/notifications", { method: "DELETE" }),
    gamesArchive: (result, opponent) => {
      const p = new URLSearchParams();
      if (result) p.set("result", result);
      if (opponent) p.set("opponent", opponent);
      const q = p.toString();
      return request("/api/games/archive" + (q ? "?" + q : ""));
    },
    // 게임 기록 / 리뷰
    recentGames: () => request("/api/games/recent"),
    gameDetail: (id) => request("/api/games/" + id),
  };
})();

/* 체스 기물을 외부 이미지 없이 SVG(유니코드)로 그린다. chessboard.js pieceTheme 함수. */
window.kiwiPieceTheme = function (piece) {
  const glyphs = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };
  const color = piece[0], type = piece[1];
  const fill = color === "w" ? "#fbfaf3" : "#33332a";
  const stroke = color === "w" ? "#1a1a12" : "#000000";
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 45 45'>" +
    "<text x='22.5' y='37' font-size='38' text-anchor='middle' " +
    "fill='" + fill + "' stroke='" + stroke + "' stroke-width='1.1' " +
    "font-family='Arial,Segoe UI Symbol,sans-serif'>" + glyphs[type] + "</text></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
};

// 다른 스크립트에서 window.API 로도 접근할 수 있게 노출
// (const 선언은 window 프로퍼티가 되지 않으므로 명시적으로 붙인다)
window.API = API;
