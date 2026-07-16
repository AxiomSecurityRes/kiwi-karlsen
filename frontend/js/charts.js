/* charts.js — 외부 라이브러리 없이 순수 SVG 로 그리는 작은 차트 모음.
   CSP(script-src 'self')에서 안전하고, 번들 크기도 늘지 않는다. */
const KiwiChart = (() => {
  const esc = (s) => window.kiwiEscapeHtml(s);

  function css(name, dflt) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || dflt;
    } catch (e) { return dflt; }
  }

  /** 꺾은선 그래프 (레이팅/정확도 추이) */
  function line(el, points, opts) {
    opts = opts || {};
    if (!el) return;
    if (!points || points.length < 2) {
      el.innerHTML = '<p class="muted">데이터가 부족합니다. 대국을 더 해보세요.</p>';
      return;
    }
    const W = 640, H = opts.height || 180, P = 26;
    const vals = points.map((p) => p.y);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;

    const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
    const y = (v) => H - P - ((v - min) / (max - min)) * (H - P * 2);

    let path = `M ${x(0)} ${y(vals[0])}`;
    for (let i = 1; i < points.length; i++) path += ` L ${x(i)} ${y(vals[i])}`;
    const area = path + ` L ${x(points.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`;

    const accent = css("--accent", "#7fb02f");
    const soft = css("--ink-soft", "#888");

    // 점 (승/패/무 색)
    const dots = points.map((p, i) => {
      const c = p.color || accent;
      return `<circle cx="${x(i)}" cy="${y(p.y)}" r="2.6" fill="${c}">
        <title>${esc(p.label || "")}</title></circle>`;
    }).join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="kchart" preserveAspectRatio="none">
        <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="${soft}" stroke-width="1" opacity="0.3"/>
        <path d="${area}" fill="${accent}" opacity="0.13"/>
        <path d="${path}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linejoin="round"/>
        ${dots}
        <text x="${P}" y="14" class="kc-lab">${esc(String(Math.round(max)))}</text>
        <text x="${P}" y="${H - 6}" class="kc-lab">${esc(String(Math.round(min)))}</text>
      </svg>`;
  }

  /** 가로 막대 (오프닝 성과, 시간제어별 등) */
  function bars(el, rows, opts) {
    opts = opts || {};
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = '<p class="muted">데이터가 없습니다.</p>';
      return;
    }
    el.innerHTML = rows.map((r) => {
      const w = Math.max(0, Math.min(100, r.pct));
      return `
      <div class="kbar-row">
        <span class="kbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="kbar-track">
          <span class="kbar-fill" style="width:${w}%;background:${r.color || "var(--accent)"}"></span>
        </span>
        <span class="kbar-val">${esc(r.value)}</span>
      </div>`;
    }).join("");
  }

  /** 승/무/패 3색 막대 */
  function wdl(win, draw, loss) {
    const t = win + draw + loss;
    if (!t) return '<span class="muted">기록 없음</span>';
    const w = (win / t) * 100, d = (draw / t) * 100, l = (loss / t) * 100;
    return `
      <span class="wdl">
        <span class="wdl-w" style="width:${w}%"></span>
        <span class="wdl-d" style="width:${d}%"></span>
        <span class="wdl-b" style="width:${l}%"></span>
      </span>
      <span class="wdl-legend">
        <span>${win}승</span><span>${draw}무</span><span>${loss}패</span>
      </span>`;
  }

  /** 도넛 (수 분류 분포) */
  function donut(el, slices) {
    if (!el) return;
    const total = slices.reduce((a, s) => a + s.value, 0);
    if (!total) { el.innerHTML = '<p class="muted">리뷰한 게임이 없습니다.</p>'; return; }

    const R = 60, C = 2 * Math.PI * R;
    let offset = 0;
    const rings = slices.map((s) => {
      const frac = s.value / total;
      const len = frac * C;
      const seg = `<circle cx="80" cy="80" r="${R}" fill="none"
        stroke="${s.color}" stroke-width="26"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 80 80)"><title>${esc(s.label)} ${s.value}</title></circle>`;
      offset += len;
      return seg;
    }).join("");

    const legend = slices.filter((s) => s.value > 0).map((s) => `
      <span class="kd-item">
        <span class="kd-dot" style="background:${s.color}"></span>
        ${esc(s.label)} <b>${s.value}</b>
        <small>${Math.round((s.value / total) * 100)}%</small>
      </span>`).join("");

    el.innerHTML = `
      <div class="kdonut">
        <svg viewBox="0 0 160 160" width="150" height="150">${rings}
          <text x="80" y="84" text-anchor="middle" class="kd-center">${total}</text>
          <text x="80" y="100" text-anchor="middle" class="kd-sub">수</text>
        </svg>
        <div class="kd-legend">${legend}</div>
      </div>`;
  }

  /** 히트맵 (요일 × 시간대 활동) */
  function heatmap(el, matrix) {
    if (!el) return;
    const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
    let max = 0;
    matrix.forEach((row) => row.forEach((v) => { if (v > max) max = v; }));
    if (!max) { el.innerHTML = '<p class="muted">활동 기록이 없습니다.</p>'; return; }

    const cells = matrix.map((row, d) => `
      <div class="hm-row">
        <span class="hm-day">${DAYS[d]}</span>
        ${row.map((v, h) => {
          const a = v ? 0.15 + (v / max) * 0.85 : 0;
          return `<span class="hm-cell" style="opacity:${a || 1};background:${v ? "var(--accent)" : "var(--line)"}"
                   title="${DAYS[d]} ${h}시 — ${v}판"></span>`;
        }).join("")}
      </div>`).join("");

    el.innerHTML = `
      <div class="heatmap">
        ${cells}
        <div class="hm-row hm-hours">
          <span class="hm-day"></span>
          ${Array.from({ length: 24 }, (_, h) =>
            `<span class="hm-hour">${h % 6 === 0 ? h : ""}</span>`).join("")}
        </div>
      </div>`;
  }

  return { line, bars, wdl, donut, heatmap };
})();
window.KiwiChart = KiwiChart;
