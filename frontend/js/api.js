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
      request("/api/login", { method: "POST", body: JSON.stringify({ username, password: password || null }) }),
    me: () => request("/api/me"),
    bots: () => request("/api/bots"),
    botMove: (fen, level) =>
      request("/api/bot/move", { method: "POST", body: JSON.stringify({ fen, level }) }),
    leaderboard: () => request("/api/leaderboard"),
    online: () => request("/api/online"),
    randomPuzzle: (min = 0, max = 4000) => request(`/api/puzzles/random?min=${min}&max=${max}`),
    puzzleSolved: (puzzle_id, success) =>
      request("/api/puzzles/solved", { method: "POST", body: JSON.stringify({ puzzle_id, success }) }),
  };
})();
