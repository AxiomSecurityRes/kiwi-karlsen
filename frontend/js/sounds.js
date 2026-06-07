/* 효과음 매니저 — 브라우저 자동재생 정책 대응 (첫 사용자 제스처에서 unlock) */
const Sounds = (() => {
  const BASE = "/assets/sounds/";
  const FILES = {
    move: "move.mp3",
    capture: "capture.mp3",
    check: "check.mp3",
    castle: "castle.mp3",
    promote: "promote.mp3",
    gameStart: "game-start.mp3",
    win: "game-win.mp3",
    lose: "game-lose.mp3",
    draw: "game-draw.mp3",
    matchFound: "match-found.mp3",
    illegal: "illegal.mp3",
  };

  const cache = {};
  let unlocked = false;
  let enabled = true;

  function preload() {
    for (const key in FILES) {
      const a = new Audio(BASE + FILES[key]);
      a.preload = "auto";
      a.volume = 0.6;
      cache[key] = a;
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    // 무음 재생으로 오디오 컨텍스트 잠금 해제
    for (const key in cache) {
      const a = cache[key];
      a.muted = true;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
         .catch(() => { a.muted = false; });
      } else {
        a.muted = false;
      }
    }
  }

  function play(name) {
    if (!enabled || !cache[name]) return;
    try {
      const a = cache[name].cloneNode();
      a.volume = 0.6;
      const p = a.play();
      if (p && p.catch) p.catch(() => { /* 자동재생 차단 무시 */ });
    } catch (e) { /* noop */ }
  }

  /** chess.js move 객체로부터 적절한 효과음 선택 */
  function playForMove(move, inCheck) {
    if (!move) return;
    if (inCheck) { play("check"); return; }
    if (move.flags && (move.flags.includes("k") || move.flags.includes("q"))) { play("castle"); return; }
    if (move.flags && move.flags.includes("p")) { play("promote"); return; }
    if (move.captured) { play("capture"); return; }
    play("move");
  }

  function setEnabled(v) { enabled = v; }

  // 첫 클릭/키 입력에서 unlock
  ["click", "keydown", "touchstart"].forEach((evt) =>
    window.addEventListener(evt, unlock, { once: true })
  );

  preload();
  return { play, playForMove, setEnabled, unlock };
})();
