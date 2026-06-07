/* 모바일/데스크톱 공용 탭(클릭) 이동 도우미.
   기물을 탭하면 갈 수 있는 칸을 점으로 표시하고, 목적지를 탭하면 이동한다.
   chessboard.js 의 사각형 DOM([data-square])에 클릭 핸들러를 붙인다. */
const TapMove = (() => {
  function attach(opts) {
    // opts: { boardId, getGame, canMove, getMoverColor, doMove }
    const boardEl = document.getElementById(opts.boardId);
    if (!boardEl) return { clear() {} };
    let selected = null;

    function squareEl(sq) { return boardEl.querySelector(`[data-square="${sq}"]`); }

    function clear() {
      boardEl.querySelectorAll(".tm-selected,.tm-target,.tm-capture")
        .forEach((el) => el.classList.remove("tm-selected", "tm-target", "tm-capture"));
      selected = null;
    }

    function highlight(from) {
      clear();
      const g = opts.getGame();
      if (!g) return;
      const moves = g.moves({ square: from, verbose: true });
      if (!moves.length) return;
      const se = squareEl(from);
      if (se) se.classList.add("tm-selected");
      moves.forEach((m) => {
        const el = squareEl(m.to);
        if (!el) return;
        const isCap = m.captured || (m.flags && m.flags.indexOf("e") !== -1);
        el.classList.add(isCap ? "tm-capture" : "tm-target");
      });
      selected = from;
    }

    function handleTapAt(target) {
      if (!opts.canMove()) { clear(); return; }
      const cell = target && target.closest ? target.closest("[data-square]") : null;
      if (!cell) return;
      const sq = cell.getAttribute("data-square");
      const g = opts.getGame();
      if (!g) return;

      // 이미 기물을 고른 상태에서 목적지(하이라이트 칸)를 탭하면 이동
      if (selected && (cell.classList.contains("tm-target") || cell.classList.contains("tm-capture"))) {
        const from = selected;
        clear();
        opts.doMove(from, sq);
        return;
      }

      // 내 차례의 내 기물을 탭하면 선택
      const piece = g.get(sq);
      const mover = opts.getMoverColor();
      if (piece && piece.color === g.turn() && piece.color === mover) {
        highlight(sq);
      } else {
        clear();
      }
    }

    const touch = isTouch();
    if (touch) {
      // 터치 기기: touchend 로 직접 처리(스크롤/합성클릭 의존 제거)
      boardEl.addEventListener("touchend", (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && el.closest && el.closest("#" + opts.boardId)) {
          e.preventDefault();
          handleTapAt(el);
        }
      }, { passive: false });
    } else {
      boardEl.addEventListener("click", (e) => handleTapAt(e.target));
    }
    return { clear };
  }

  function isTouch() {
    return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  }

  return { attach, isTouch };
})();