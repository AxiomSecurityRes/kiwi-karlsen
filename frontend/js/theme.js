/* theme.js — 화면 테마(낮/야행/자동) + 보드 테마 관리.
   FOUC 방지를 위해 다른 스크립트보다 먼저, 즉시 적용된다. */
const KiwiTheme = (() => {
  const KEY_MODE = "kiwi_theme";        // "light" | "dark" | "auto"
  const KEY_BOARD = "kiwi_board";       // kiwi | classic | wood | ocean | night | contrast

  const BOARDS = [
    { id: "kiwi", label: "키위 (기본)" },
    { id: "classic", label: "클래식 그린" },
    { id: "wood", label: "우드" },
    { id: "ocean", label: "오션" },
    { id: "night", label: "야행" },
    { id: "contrast", label: "고대비 (접근성)" },
  ];

  function read(key, dflt) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? dflt : v;
    } catch (e) { return dflt; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function prefersDark() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) { return false; }
  }

  function resolved(mode) {
    if (mode === "auto") return prefersDark() ? "dark" : "light";
    return mode === "dark" ? "dark" : "light";
  }

  function applyTheme() {
    const mode = read(KEY_MODE, "auto");
    document.documentElement.setAttribute("data-theme", resolved(mode));
    updateToggleIcon();
  }

  function applyBoard() {
    const board = read(KEY_BOARD, "kiwi");
    // body 가 아직 없을 수 있으므로(head 에서 실행) documentElement 에도 건다
    document.documentElement.setAttribute("data-board", board);
    if (document.body) document.body.setAttribute("data-board", board);
  }

  function getMode() { return read(KEY_MODE, "auto"); }
  function getBoard() { return read(KEY_BOARD, "kiwi"); }

  function setMode(mode) {
    write(KEY_MODE, mode);
    applyTheme();
  }
  function setBoard(board) {
    write(KEY_BOARD, board);
    applyBoard();
  }

  /** 낮 ↔ 야행 즉시 전환 (auto 였다면 현재 보이는 것의 반대로) */
  function toggle() {
    const now = resolved(getMode());
    setMode(now === "dark" ? "light" : "dark");
  }

  function updateToggleIcon() {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const dark = resolved(getMode()) === "dark";
    btn.textContent = dark ? "☀️" : "🌙";
    btn.setAttribute("aria-label", dark ? "낮 모드로 전환" : "야행 모드로 전환");
    btn.title = dark ? "낮 모드로 전환" : "야행 모드로 전환";
  }

  /** 상단바에 테마 토글 버튼 주입 */
  function injectToggle() {
    const nav = document.querySelector(".topbar nav");
    if (!nav || document.getElementById("themeToggle")) return;
    const btn = document.createElement("a");
    btn.href = "#";
    btn.id = "themeToggle";
    btn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    nav.appendChild(btn);
    updateToggleIcon();
  }

  // 즉시 적용 (FOUC 방지)
  applyTheme();
  applyBoard();

  // 시스템 테마 변화 추적 (auto 일 때만)
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (getMode() === "auto") applyTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {}

  function onReady() { applyBoard(); injectToggle(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();

  return { getMode, setMode, getBoard, setBoard, toggle, BOARDS };
})();
window.KiwiTheme = KiwiTheme;
