/* review.js — 게임 리뷰 핵심 로직 (순수 함수).
 *
 * Chess.com / Lichess 수준의 산출을 목표로 한다.
 *
 * 1) 승률(Win%) — Lichess 표준 시그모이드
 * 2) 수 정확도 — Lichess 정확도 공식 (승률 손실 → 0~100)
 * 3) 게임 정확도 — 변동성 가중 평균과 조화 평균의 평균 (Lichess 방식)
 * 4) 수 분류 11단계 — 승률 손실 + MultiPV(유일한 수) + 희생 감지 + 이론 DB
 * 5) 전술 판별 — 결정적 국면에서 최선을 찾았는지/놓쳤는지
 * 6) 게임 단계 — 오프닝/미들게임/엔드게임 (기물 수 기반)
 *
 * 브라우저(window.KiwiReview)와 Node(module.exports) 양쪽에서 쓴다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KiwiReview = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MATE = 100000;
  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  /* ---------------------------------------------------------------
   * 1. 승률
   * ------------------------------------------------------------- */
  function winPercent(cp) {
    if (cp >= MATE - 5000) return 100;
    if (cp <= -MATE + 5000) return 0;
    const c = Math.max(-2000, Math.min(2000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  /** 메이트 점수를 cp 로 인코딩 (백 관점) */
  function mateToCp(mate) {
    return mate > 0 ? MATE - mate * 100 : -MATE - mate * 100;
  }

  /* ---------------------------------------------------------------
   * 2. 수 정확도 (Lichess 공식)
   * ------------------------------------------------------------- */
  function moveAccuracy(winBefore, winAfter) {
    const loss = Math.max(0, winBefore - winAfter);
    const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
    return Math.max(0, Math.min(100, acc));
  }

  /* ---------------------------------------------------------------
   * 3. 게임 정확도 (변동성 가중 + 조화 평균)
   * ------------------------------------------------------------- */
  function stdev(arr) {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  }

  function harmonicMean(arr) {
    if (!arr.length) return 0;
    const s = arr.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
    return arr.length / s;
  }

  /**
   * accuracies : 이 색의 수별 정확도
   * winPcts    : 이 색 관점의 국면별 승률(수를 두기 전 시점들)
   * 변동성이 큰 구간(승부처)의 수에 더 큰 가중치를 준다.
   */
  function gameAccuracy(accuracies, winPcts) {
    if (!accuracies.length) return 0;

    // 변동성 가중 평균
    const windowSize = Math.max(2, Math.min(8, Math.ceil(winPcts.length / 10)));
    const weights = accuracies.map((_, i) => {
      const from = Math.max(0, i - windowSize);
      const to = Math.min(winPcts.length - 1, i + windowSize);
      const seg = winPcts.slice(from, to + 1);
      return Math.max(0.5, Math.min(12, stdev(seg)));
    });
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const weighted = accuracies.reduce((a, x, i) => a + x * weights[i], 0) / wSum;

    const harmonic = harmonicMean(accuracies);
    return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
  }

  /* ---------------------------------------------------------------
   * 4. 게임 단계 (오프닝 / 미들게임 / 엔드게임)
   * ------------------------------------------------------------- */
  /** 폰·킹을 제외한 양쪽 기물 점수 합 (시작 62) */
  function nonPawnMaterial(chessGame) {
    let total = 0;
    const b = chessGame.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = b[r][c];
        if (!sq || sq.type === "p" || sq.type === "k") continue;
        total += PIECE_VALUE[sq.type] || 0;
      }
    }
    return total;
  }

  /**
   * ply     : 0-based 수 번호
   * material: nonPawnMaterial
   * inBook  : 아직 정석 안인지
   */
  function phaseOf(ply, material, inBook) {
    if (inBook || (ply < 20 && material >= 52)) return "opening";
    if (material <= 20) return "endgame";
    return "middlegame";
  }

  /* ---------------------------------------------------------------
   * 5. 희생 감지 (탁월한 수 판별용)
   * ------------------------------------------------------------- */
  /**
   * 이 수가 '진짜 희생'인가?
   * - 기물을 내주는데(즉시 잡히는 자리에 두거나, 잡히는 걸 감수)
   * - 그럼에도 최선이고 유리함이 유지된다
   *
   * before/after 는 chess.js 인스턴스, move 는 verbose move 객체.
   */
  function isSacrifice(ChessCtor, fenBefore, move) {
    try {
      const g = new ChessCtor(fenBefore);
      const m = g.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      if (!m) return false;

      const movedValue = PIECE_VALUE[m.piece] || 0;
      const capturedValue = m.captured ? (PIECE_VALUE[m.captured] || 0) : 0;

      // 폰 희생은 '탁월'로 치지 않는다 (기물 이상만)
      if (movedValue < 3) return false;

      // 상대가 이 기물을 잡을 수 있는가? (즉시 회수 가능한 최대 이득)
      const replies = g.moves({ verbose: true });
      let bestCapture = 0;
      for (const r of replies) {
        if (r.to === m.to && r.captured) {
          bestCapture = Math.max(bestCapture, PIECE_VALUE[r.captured] || 0);
        }
      }
      if (bestCapture === 0) return false;   // 잡히지 않으면 희생이 아니다

      // 순 손실이 있어야 희생 (잡은 것보다 더 큰 걸 내줌)
      return (bestCapture - capturedValue) >= 2;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------
   * 6. 수 분류 (11단계)
   * ------------------------------------------------------------- */
  const CLASSES = [
    "brilliant", "great", "best", "excellent", "good", "book",
    "forced", "inaccuracy", "mistake", "missed", "blunder",
  ];

  const CLASS_KO = {
    brilliant: "탁월한 수", great: "훌륭한 수", best: "최선의 수",
    excellent: "뛰어난 수", good: "좋은 수", book: "이론", forced: "강제",
    inaccuracy: "부정확한 수", mistake: "실수", missed: "놓친 수", blunder: "블런더",
  };

  const CLASS_ICON = {
    brilliant: "!!", great: "!", best: "★", excellent: "◎", good: "○",
    book: "📖", forced: "→", inaccuracy: "?!", mistake: "?", missed: "✗", blunder: "??",
  };

  /**
   * ctx:
   *   winBefore, winAfter  : mover 관점 승률 (0~100)
   *   isBest               : 엔진 1순위와 동일한 수인가
   *   bestWin, secondWin   : mover 관점, 1순위/2순위 수의 승률 (MultiPV)
   *   isBook               : 오프닝 DB 국면인가
   *   legalCount           : 합법수 개수
   *   hadMate, gaveMate, stillMate
   *   sacrifice            : 희생 수인가
   */
  function classify(ctx) {
    const loss = Math.max(0, ctx.winBefore - ctx.winAfter);

    // 1) 강제 — 선택지가 없으면 실력과 무관
    if (ctx.legalCount === 1) return "forced";

    // 2) 이론 — 오프닝 DB 에 있는 국면이면 무조건 이론
    if (ctx.isBook) return "book";

    // 3) 외통을 놓았다
    if (ctx.gaveMate) return ctx.isBest ? "best" : "excellent";

    // 4) 탁월한 수 — 최선이면서 진짜 희생이고, 그 결과 여전히 좋다
    //    (이미 압도적으로 이기고 있으면 '탁월'로 치지 않는다: 아무 수나 이기므로)
    if (ctx.isBest && ctx.sacrifice && loss <= 2 &&
        ctx.winAfter >= 50 && ctx.winBefore <= 97) {
      return "brilliant";
    }

    // 5) 훌륭한 수 — 최선이며 '유일한 수'다 (2순위와 격차가 크다)
    if (ctx.isBest && ctx.secondWin != null &&
        (ctx.bestWin - ctx.secondWin) >= 12 && loss <= 2) {
      return "great";
    }

    // 6) 놓친 수 — 이기고 있었는데(또는 강제 메이트) 그 기회를 날렸다. 단, 아직 안 짐.
    if (ctx.hadMate && !ctx.gaveMate && !ctx.stillMate && ctx.winAfter >= 45) return "missed";
    if (ctx.winBefore >= 90 && ctx.winAfter < 75 && ctx.winAfter >= 45 && !ctx.stillMate) {
      return "missed";
    }

    // 7) 최선
    if (ctx.isBest) return "best";

    // 8) 승률 손실 기준
    if (loss <= 2) return "excellent";
    if (loss <= 5) return "good";
    if (loss <= 10) return "inaccuracy";
    if (loss <= 20) return "mistake";
    return "blunder";
  }

  /* ---------------------------------------------------------------
   * 7. 전술 판별
   * ------------------------------------------------------------- */
  /**
   * '결정적 국면'인가 — 최선수와 2순위의 승률 격차가 크면
   * 그 국면에는 반드시 찾아야 할 전술적 수가 있다는 뜻이다.
   */
  function isTacticalPosition(bestWin, secondWin) {
    if (secondWin == null) return false;
    return (bestWin - secondWin) >= 12;
  }

  /* ---------------------------------------------------------------
   * 8. 예상 레이팅 (정확도 → ELO 근사)
   * ------------------------------------------------------------- */
  function estimateElo(accuracy, avgLoss) {
    // 정확도 기반 1차 추정 + 평균 손실로 보정
    let elo = (accuracy - 30) * 42;             // 정확도 60% ≈ 1260, 90% ≈ 2520
    elo -= Math.max(0, avgLoss - 2) * 55;       // 평균 손실이 크면 감점
    return Math.max(400, Math.min(2900, Math.round(elo)));
  }

  return {
    MATE, CLASSES, CLASS_KO, CLASS_ICON, PIECE_VALUE,
    winPercent, mateToCp, moveAccuracy, gameAccuracy,
    nonPawnMaterial, phaseOf, isSacrifice, classify,
    isTacticalPosition, estimateElo,
    _stdev: stdev, _harmonicMean: harmonicMean,
  };
});
