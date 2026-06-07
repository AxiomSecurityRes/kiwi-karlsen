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
    botMove: (fen, level) =>
      request("/api/bot/move", { method: "POST", body: JSON.stringify({ fen, level }) }),
    leaderboard: () => request("/api/leaderboard"),
    online: () => request("/api/online"),
    randomPuzzle: (min = 0, max = 4000, theme = "") =>
      request(`/api/puzzles/random?min=${min}&max=${max}${theme ? "&theme=" + encodeURIComponent(theme) : ""}`),
    puzzleSolved: (puzzle_id, success) =>
      request("/api/puzzles/solved", { method: "POST", body: JSON.stringify({ puzzle_id, success }) }),
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
