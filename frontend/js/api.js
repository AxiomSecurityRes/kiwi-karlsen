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
    login: (username, password) =>
      request("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    register: (username, password) =>
      request("/api/register", { method: "POST", body: JSON.stringify({ username, password }) }),
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
    openings: (moves) => request("/api/openings" + (moves && moves.length ? "?moves=" + encodeURIComponent(moves.join(",")) : "")),
    openingsSearch: (q) => request("/api/openings/search?q=" + encodeURIComponent(q)),
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
