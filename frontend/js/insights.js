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
      d = await API.insights(parseInt($("insRange").value, 10) || 0,
                             $("insIncludeBots").checked,
                             $("insTcFilter").value, $("insSrcFilter").value);
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

    renderDetailed(d.detailed || { hasData: false });
    renderTiming(d.timing || null);
    renderGeography(d.geography || null);
  }

  /** 승/무/패 + 정확도를 한 줄로 보여주는 공용 렌더러 */
  function rowsWithScore(el, rows, emptyMsg) {
    if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = `<p class="muted">${esc(emptyMsg)}</p>`; return; }
    el.innerHTML = rows.map((r) => `
      <div class="ins-row">
        <div class="ins-row-head">
          <b>${esc(r.ko || r.code || "")}</b>
          <span class="ins-score">${r.score}%
            <small>(${r.games}판${r.reviewed ? ` · 정확도 ${r.accuracy}%` : ""})</small>
          </span>
        </div>
        ${KiwiChart.wdl(r.win, r.draw, r.loss)}
      </div>`).join("");
  }

  function renderTiming(t) {
    if (!t) {
      rowsWithScore($("insWeekday"), [], "데이터가 없습니다.");
      rowsWithScore($("insHourBand"), [], "데이터가 없습니다.");
      return;
    }
    rowsWithScore($("insWeekday"), t.weekday, "요일별 기록이 없습니다.");
    rowsWithScore($("insHourBand"), t.hourBands, "시간대별 기록이 없습니다.");
  }

  function renderGeography(g) {
    const note = $("insGeoNote");
    if (!g || !g.countries || !g.countries.length) {
      note.textContent = "상대 국가 정보가 없습니다. Chess.com 게임을 가져오면 " +
        "상대의 국가별 성적을 볼 수 있습니다.";
      $("insGeo").innerHTML = '<p class="muted">데이터가 없습니다.</p>';
      return;
    }
    let msg = `${g.totalCountries}개국 · ${g.withCountry}판 기준.`;
    if (g.best) msg += ` 가장 좋은 상대 국가: ${g.best.ko} (${g.best.score}%).`;
    if (g.worst && g.worst.code !== (g.best && g.best.code)) {
      msg += ` 가장 까다로운 국가: ${g.worst.ko} (${g.worst.score}%).`;
    }
    note.textContent = msg;
    rowsWithScore($("insGeo"), g.countries, "데이터가 없습니다.");
  }

  // ==================== 세부 리뷰 지표 ====================
  function accColor(a) {
    return a >= 80 ? "var(--accent)" : (a >= 60 ? "var(--ink-soft)" : "var(--danger)");
  }

  function renderDetailed(d) {
    const note = $("insDetailedNote");
    if (!d || !d.hasData) {
      note.textContent = "아직 리뷰한 게임이 없습니다. 분석 페이지에서 '전체 분석'을 하면 " +
        "결과별·단계별·기물별 정확도, 수 번호별 정확도, 캐슬링, 전술·이론, 게임 양상 등 " +
        "세부 지표가 여기 쌓입니다.";
      ["insAccResult","insPhaseAcc","insMoveNumAcc","insPieceAcc","insPieceMoves",
       "insShapes","insEndedPhase","insResultPhase","insTacticsTheory","insCastling"]
        .forEach((id) => { const el = $(id); if (el) el.innerHTML = '<p class="muted">데이터가 없습니다.</p>'; });
      return;
    }
    note.textContent = `리뷰 ${d.reviews}건 · 분석한 수 ${d.movesAnalyzed.toLocaleString()}개 기준.`;

    // 결과별 평균 정확도
    const AR = d.accuracyByResult || {};
    KiwiChart.bars($("insAccResult"), ["win","draw","loss","overall"]
      .filter((k) => AR[k] && (AR[k].games || k === "overall"))
      .map((k) => ({
        label: `${AR[k].ko} (${AR[k].games}판)`,
        pct: AR[k].accuracy,
        value: `${AR[k].accuracy}%`,
        color: k === "overall" ? "var(--info)" : accColor(AR[k].accuracy),
      })));

    // 게임 단계별 정확도
    KiwiChart.bars($("insPhaseAcc"), (d.accuracyByPhase || []).map((p) => ({
      label: `${p.ko} (${p.moves}수)`, pct: p.accuracy, value: `${p.accuracy}%`, color: accColor(p.accuracy),
    })));

    // 수 번호별 정확도
    KiwiChart.bars($("insMoveNumAcc"), (d.accuracyByMoveNumber || []).map((b) => ({
      label: `${b.bucket} (${b.moves}수)`, pct: b.accuracy, value: `${b.accuracy}%`, color: accColor(b.accuracy),
    })));

    // 기물별 평균 정확도
    KiwiChart.bars($("insPieceAcc"), (d.accuracyByPiece || []).map((p) => ({
      label: `${p.ko} (${p.moves}수)`, pct: p.accuracy, value: `${p.accuracy}%`, color: accColor(p.accuracy),
    })));

    // 기물별 움직임
    KiwiChart.bars($("insPieceMoves"), (d.movesByPiece || []).map((p) => ({
      label: p.ko, pct: p.pct, value: `${p.count} (${p.pct}%)`, color: "var(--accent)",
    })));

    // 게임 양상 (분포 + 결과 + 정확도)
    const shapes = d.gameShapes || [];
    $("insShapes").innerHTML = shapes.length ? shapes.map((s) => `
      <div class="ins-row">
        <div class="ins-row-head">
          <b>${esc(s.ko)}</b>
          <span class="ins-score">${s.score}% <small>(${s.games}판 · 정확도 ${s.accuracy}%)</small></span>
        </div>
        ${KiwiChart.wdl(s.win, s.draw, s.loss)}
      </div>`).join("") : '<p class="muted">양상 데이터가 없습니다.</p>';

    // 어느 단계에서 끝났나
    const endTotal = (d.endedByPhase || []).reduce((a, x) => a + x.count, 0);
    KiwiChart.bars($("insEndedPhase"), (d.endedByPhase || []).map((p) => ({
      label: p.ko, pct: endTotal ? (p.count / endTotal) * 100 : 0, value: `${p.count}판`, color: "var(--k-rind)",
    })));
    $("insResultPhase").innerHTML = (d.resultByPhase || []).map((p) => `
      <div class="ins-row">
        <div class="ins-row-head"><b>${esc(p.ko)}에서 종료</b>
          <span class="ins-score">${p.score}% <small>(${p.games}판)</small></span></div>
        ${KiwiChart.wdl(p.win, p.draw, p.loss)}
      </div>`).join("");

    // 전술 & 이론
    const tc = d.tactics || {}, th = d.theory || {};
    $("insTacticsTheory").innerHTML =
      kpi(`${tc.found || 0}/${tc.total || 0}`, "전술 포착") +
      kpi(`${tc.foundPct || 0}%`, "포착률") +
      kpi(`${tc.missed || 0}`, "놓친 전술") +
      kpi(`${th.avgPerGame || 0}`, "게임당 이론 수");
    $("insTacticsTheory").className = "grid";
    $("insTacticsTheory").style.gridTemplateColumns = "repeat(auto-fit,minmax(90px,1fr))";
    $("insTacticsTheory").style.gap = "10px";

    // 캐슬링
    const c = d.castling || {};
    $("insCastling").innerHTML =
      kpi(c.king || 0, "킹사이드 O-O") +
      kpi(c.queen || 0, "퀸사이드 O-O-O") +
      kpi(`${c.castledPct || 0}%`, "캐슬링한 게임") +
      kpi(c.avgMove || 0, "평균 캐슬링 수");
    $("insCastling").className = "grid";
    $("insCastling").style.gridTemplateColumns = "repeat(auto-fit,minmax(90px,1fr))";
    $("insCastling").style.gap = "10px";
  }

  // ==================== Chess.com 가져오기 ====================
  async function loadImportStatus() {
    if (!API.getToken()) return;
    try {
      const s = await API.importStatus();
      if (s.chesscomUsername) {
        $("ccUser").value = s.chesscomUsername;
        $("insImportStatus").textContent =
          `연동됨: ${s.chesscomUsername} · 가져온 게임 ${s.importedGames}판`;
      }
    } catch (e) { /* noop */ }
  }

  async function doImport() {
    const username = $("ccUser").value.trim();
    if (!username) { $("ccResult").textContent = "사용자명을 입력하세요."; return; }
    const months = parseInt($("ccMonths").value, 10) || 3;
    const btn = $("ccImportBtn");
    btn.disabled = true;
    $("ccResult").textContent = "Chess.com에서 게임을 가져오는 중… (수십 초 걸릴 수 있어요)";
    try {
      const r = await API.importChesscom(username, months);
      if (!r.ok) {
        $("ccResult").textContent = "⚠️ " + (r.error || "가져오기에 실패했습니다.");
      } else {
        $("ccResult").textContent =
          `✅ ${r.imported}판 가져옴 (중복/제외 ${r.skipped}판). 통찰을 새로고침합니다…`;
        await load();
        await loadImportStatus();
      }
    } catch (e) {
      $("ccResult").textContent = "⚠️ " + (e.message || "가져오기 중 오류가 발생했습니다.");
    } finally {
      btn.disabled = false;
    }
  }

  $("ccImportBtn").addEventListener("click", doImport);
  $("ccUser").addEventListener("keydown", (e) => { if (e.key === "Enter") doImport(); });

  $("insRange").addEventListener("change", load);
  $("insIncludeBots").addEventListener("change", load);
  $("insTcFilter").addEventListener("change", load);
  $("insSrcFilter").addEventListener("change", load);
  load();
  loadImportStatus();
})();
