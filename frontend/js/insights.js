/* insights.html — 내 체스 데이터 분석 대시보드 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.kiwiEscapeHtml(s);

  const CLASS_COLORS = {
    brilliant: "#1bb7a6", great: "#3aa0ff", best: "#2e9b53", excellent: "#5aa832",
    good: "#9bbf5a", book: "#a98b6a", forced: "#8a97a6", inaccuracy: "#e0a526",
    mistake: "#e07b39", missed: "#d96b8a", blunder: "#c0392b",
  };
  const CLASS_KO = {
    brilliant: "탁월한 수", great: "훌륭한 수", best: "최선의 수", excellent: "뛰어난 수",
    good: "좋은 수", book: "이론", forced: "강제", inaccuracy: "부정확한 수",
    mistake: "실수", missed: "놓친 수", blunder: "블런더",
  };
  const OUT_COLOR = { win: "#2e9b53", loss: "#c0392b", draw: "#9aa88c" };

  function kpi(num, label) {
    return `<div class="stat-box"><div class="stat-num">${esc(num)}</div><div class="stat-label">${esc(label)}</div></div>`;
  }

  async function load() {
    if (!API.getToken()) {
      $("insLogin").classList.remove("hidden");
      $("insBody").classList.add("hidden");
      return;
    }
    $("insLogin").classList.add("hidden");
    $("insBody").classList.remove("hidden");

    let d;
    try {
      d = await API.insights(parseInt($("insRange").value, 10) || 0);
    } catch (e) {
      $("insSummary").textContent = e.message;
      return;
    }

    if (!d.games) {
      $("insSummary").textContent = "아직 온라인 대국 기록이 없습니다. 로비에서 한 판 두어 보세요!";
    } else {
      $("insSummary").textContent =
        `${d.games}판을 분석했습니다. 전체 스코어 ${d.overall.score}% (${d.overall.win}승 ${d.overall.loss}패 ${d.overall.draw}무)`;
    }

    // ---- KPI ----
    $("insKpi").innerHTML =
      kpi(d.rating.current, "현재 레이팅") +
      kpi(d.rating.peak, "최고 레이팅") +
      kpi(d.games, "대국 수") +
      kpi(d.overall.score + "%", "스코어") +
      kpi(d.accuracy.average ? d.accuracy.average + "%" : "-", "평균 정확도") +
      kpi(d.streaks.bestWin, "최다 연승");

    // ---- 레이팅 추이 ----
    KiwiChart.line($("insRating"), d.rating.points.map((p, i) => ({
      y: p.rating,
      color: OUT_COLOR[p.outcome],
      label: `${p.rating} (${p.change >= 0 ? "+" : ""}${p.change})`,
    })), { height: 190 });
    $("insRatingNote").textContent = d.rating.points.length
      ? `최고 ${d.rating.peak} · 최저 ${d.rating.low} · 점 색: 초록=승, 빨강=패, 회색=무`
      : "";

    // ---- 색깔별 ----
    $("insColor").innerHTML = ["white", "black"].map((c) => {
      const b = d.byColor[c];
      return `<div class="ins-row">
        <div class="ins-row-head">
          <b>${c === "white" ? "⚪ 백" : "⚫ 흑"}</b>
          <span class="ins-score">${b.score}%</span>
        </div>
        ${KiwiChart.wdl(b.win, b.draw, b.loss)}
      </div>`;
    }).join("");

    // ---- 상대 실력대별 ----
    const OPP_KO = { stronger: "나보다 강한 상대", similar: "비슷한 상대", weaker: "나보다 약한 상대" };
    const oppRows = Object.keys(OPP_KO)
      .filter((k) => d.byOpponent[k].games)
      .map((k) => `<div class="ins-row">
        <div class="ins-row-head">
          <b>${OPP_KO[k]}</b>
          <span class="ins-score">${d.byOpponent[k].score}% <small>(${d.byOpponent[k].games}판)</small></span>
        </div>
        ${KiwiChart.wdl(d.byOpponent[k].win, d.byOpponent[k].draw, d.byOpponent[k].loss)}
      </div>`).join("");
    $("insOpponent").innerHTML = oppRows || '<p class="muted">데이터가 없습니다.</p>';

    // ---- 시간 제어별 ----
    KiwiChart.bars($("insTC"), d.byTimeControl.map((t) => ({
      label: t.label,
      pct: t.score,
      value: `${t.score}% (${t.games}판)`,
    })));

    // ---- 종료 유형 ----
    const termTotal = d.terminations.reduce((a, x) => a + x.count, 0);
    KiwiChart.bars($("insTerm"), d.terminations.map((t) => ({
      label: t.reason,
      pct: termTotal ? (t.count / termTotal) * 100 : 0,
      value: `${t.count}회`,
      color: "var(--k-rind)",
    })));

    // ---- 오프닝 ----
    if (d.bestOpening || d.worstOpening) {
      $("insOpBest").innerHTML =
        (d.bestOpening ? `<span class="ins-good">🏆 잘 두는 오프닝: <b>${esc(d.bestOpening.opening)}</b>
           (${d.bestOpening.color === "white" ? "백" : "흑"}, ${d.bestOpening.games}판, ${d.bestOpening.score}%)</span>` : "") +
        (d.worstOpening ? `<span class="ins-bad">📉 약한 오프닝: <b>${esc(d.worstOpening.opening)}</b>
           (${d.worstOpening.color === "white" ? "백" : "흑"}, ${d.worstOpening.games}판, ${d.worstOpening.score}%)</span>` : "");
    } else {
      $("insOpBest").innerHTML = '<span class="muted">오프닝 통계를 내려면 대국이 더 필요합니다.</span>';
    }

    ["white", "black"].forEach((color) => {
      const rows = d.openings.filter((o) => o.color === color).slice(0, 8).map((o) => ({
        label: `${o.opening} (${o.games}판)`,
        pct: o.score,
        value: `${o.score}%`,
        color: o.score >= 55 ? "var(--accent)" : (o.score < 45 ? "var(--danger)" : "var(--ink-soft)"),
      }));
      KiwiChart.bars($(color === "white" ? "insOpWhite" : "insOpBlack"), rows);
    });

    // ---- 정확도 ----
    KiwiChart.line($("insAcc"), d.accuracy.points.map((p) => ({
      y: p.accuracy,
      color: p.color === "white" ? "#e7efdc" : "#3a3f33",
      label: `${p.accuracy}% (예상 ${p.estElo})`,
    })), { height: 170 });
    $("insAccNote").textContent = d.accuracy.reviews
      ? `리뷰 ${d.accuracy.reviews}건 · 평균 정확도 ${d.accuracy.average}% · 예상 레이팅 ≈${d.accuracy.estElo}`
      : "분석 페이지에서 '전체 분석'을 하면 정확도가 기록됩니다.";

    // ---- 수 분류 분포 ----
    KiwiChart.donut($("insMoves"), d.moveDistribution.map((m) => ({
      label: CLASS_KO[m.kind] || m.kind,
      value: m.count,
      color: CLASS_COLORS[m.kind] || "#999",
    })));

    // ---- 게임 길이 ----
    const lenTotal = d.gameLength.reduce((a, x) => a + x.count, 0);
    KiwiChart.bars($("insLength"), d.gameLength.map((x) => ({
      label: x.bucket,
      pct: lenTotal ? (x.count / lenTotal) * 100 : 0,
      value: `${x.count}판`,
      color: "var(--info)",
    })));

    // ---- 연속 기록 ----
    $("insStreak").innerHTML =
      kpi(d.streaks.bestWin, "최다 연승") +
      kpi(d.streaks.worstLoss, "최다 연패") +
      kpi(d.streaks.loginCurrent, "🔥 현재 스트릭") +
      kpi(d.streaks.loginBest, "🔥 최고 스트릭");
    $("insStreak").className = "grid";
    $("insStreak").style.gridTemplateColumns = "repeat(auto-fit,minmax(90px,1fr))";
    $("insStreak").style.gap = "10px";

    // ---- 활동 패턴 ----
    KiwiChart.heatmap($("insHeat"), d.activity);

    // ---- 훈련 현황 ----
    const t = d.training;
    $("insTraining").innerHTML =
      kpi(t.puzzleRating, "퍼즐 레이팅") +
      kpi(t.puzzlesSolved, "푼 퍼즐") +
      kpi(t.rushBest, "⚡ 러시 최고") +
      kpi(`${t.battleWins}-${t.battleLosses}`, "⚔️ 전투") +
      kpi(t.visionCoords, "👁️ 좌표") +
      kpi(t.visionMoves, "👁️ 수순") +
      kpi(t.openingsMastered, "📖 마스터한 오프닝");
  }

  $("insRange").addEventListener("change", load);
  load();
})();
