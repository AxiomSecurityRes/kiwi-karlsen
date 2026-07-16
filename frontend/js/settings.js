/* KiwiSettings — 전역 설정 저장/불러오기 + 자동 주입 설정 모달(⚙️) */
const KiwiSettings = (() => {
  const KEY = "kiwi_settings";
  const DEFAULTS = {
    soundOn: true,        // 효과음 켜기
    soundVolume: 60,      // 0~100
    evalDepth: 14,        // 분석 보드 평가 깊이 (고정 깊이여야 국면 간 평가가 일관됨)
    reviewDepth: 12,      // 게임 리뷰 평가 깊이
    reviewWorkers: 0,     // 0=자동, 1~4
    celebrateFx: true,    // 훌륭/탁월 애니메이션
  };
  let cache = null;

  function load() {
    if (cache) return cache;
    try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; }
    catch (e) { cache = { ...DEFAULTS }; }
    return cache;
  }
  function get(k, dflt) {
    const s = load();
    return (k in s && s[k] !== undefined && s[k] !== null) ? s[k] : (dflt !== undefined ? dflt : DEFAULTS[k]);
  }
  function set(k, v) {
    const s = load();
    s[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    apply();
  }
  function apply() {
    const s = load();
    try {
      if (typeof Sounds !== "undefined") {
        Sounds.setEnabled(!!s.soundOn);
        if (Sounds.setVolume) Sounds.setVolume((s.soundVolume || 60) / 100);
      }
    } catch (e) {}
  }

  /* ---------- 설정 모달 자동 주입 ---------- */
  function injectUI() {
    if (document.getElementById("kiwiSettingsBtn")) return;
    const nav = document.querySelector(".topbar nav");
    if (!nav) return;
    const btn = document.createElement("a");
    btn.href = "#"; btn.id = "kiwiSettingsBtn"; btn.textContent = "⚙️";
    btn.title = "설정";
    nav.appendChild(btn);

    const bg = document.createElement("div");
    bg.className = "modal-bg"; bg.id = "kiwiSettingsModal";
    bg.innerHTML = `
      <div class="modal" style="text-align:left;max-width:420px;">
        <h2 style="text-align:center;">⚙️ 설정</h2>

        <h3 style="margin-top:4px;">화면</h3>
        <label>테마</label>
        <select id="ksTheme" style="width:100%;">
          <option value="auto">자동 (시스템 설정 따름)</option>
          <option value="light">낮 — 과육</option>
          <option value="dark">야행 — 키위새의 시간 🥝🌙</option>
        </select>
        <label>체스판 테마</label>
        <select id="ksBoard" style="width:100%;"></select>

        <h3 style="margin-top:12px;">소리</h3>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;margin:10px 0;">
          <input type="checkbox" id="ksSound" style="width:auto;margin:0;" /> 효과음 켜기
        </label>
        <label>효과음 볼륨: <span id="ksVolVal"></span>%</label>
        <input type="range" id="ksVolume" min="0" max="100" step="10" style="width:100%;" />
        <h3 style="margin-top:12px;">분석 · 리뷰</h3>
        <label>게임 리뷰 정확도 (탐색 깊이)</label>
        <select id="ksReviewMs" style="width:100%;">
          <option value="10">빠름 (depth 10)</option>
          <option value="12">보통 (depth 12) — 권장</option>
          <option value="14">정밀 (depth 14)</option>
          <option value="16">매우 정밀 (depth 16) — 느림</option>
        </select>
        <label>리뷰 병렬 워커 수</label>
        <select id="ksWorkers" style="width:100%;">
          <option value="0">자동 (CPU에 맞춤)</option>
          <option value="1">1개</option>
          <option value="2">2개</option>
          <option value="3">3개</option>
          <option value="4">4개</option>
        </select>
        <label>분석 보드 평가 깊이</label>
        <select id="ksEvalMs" style="width:100%;">
          <option value="12">빠름 (depth 12)</option>
          <option value="14">보통 (depth 14)</option>
          <option value="16">정밀 (depth 16)</option>
          <option value="18">매우 정밀 (depth 18)</option>
        </select>
        <label style="display:flex;align-items:center;gap:8px;margin:10px 0;">
          <input type="checkbox" id="ksFx" style="width:auto;margin:0;" /> 훌륭/탁월 애니메이션 효과
        </label>
        <div class="center" style="margin-top:12px;">
          <button class="btn" id="ksClose">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const $ = (id) => document.getElementById(id);
    function sync() {
      // 보드 테마 선택지 채우기
      const bsel = $("ksBoard");
      if (bsel && !bsel.options.length && window.KiwiTheme) {
        KiwiTheme.BOARDS.forEach((b) => {
          const o = document.createElement("option");
          o.value = b.id; o.textContent = b.label;
          bsel.appendChild(o);
        });
      }
      if (window.KiwiTheme) {
        $("ksTheme").value = KiwiTheme.getMode();
        $("ksBoard").value = KiwiTheme.getBoard();
      }
      $("ksSound").checked = get("soundOn");
      $("ksVolume").value = get("soundVolume");
      $("ksVolVal").textContent = get("soundVolume");
      $("ksReviewMs").value = String(get("reviewDepth"));
      $("ksWorkers").value = String(get("reviewWorkers"));
      $("ksEvalMs").value = String(get("evalDepth"));
      $("ksFx").checked = get("celebrateFx");
    }
    btn.addEventListener("click", (e) => { e.preventDefault(); sync(); bg.classList.add("show"); });
    $("ksClose").addEventListener("click", () => bg.classList.remove("show"));
    bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.remove("show"); });
    $("ksTheme").addEventListener("change", (e) => {
      if (window.KiwiTheme) KiwiTheme.setMode(e.target.value);
    });
    $("ksBoard").addEventListener("change", (e) => {
      if (window.KiwiTheme) KiwiTheme.setBoard(e.target.value);
    });
    $("ksSound").addEventListener("change", (e) => set("soundOn", e.target.checked));
    $("ksVolume").addEventListener("input", (e) => { $("ksVolVal").textContent = e.target.value; set("soundVolume", parseInt(e.target.value, 10)); });
    $("ksReviewMs").addEventListener("change", (e) => set("reviewDepth", parseInt(e.target.value, 10)));
    $("ksWorkers").addEventListener("change", (e) => set("reviewWorkers", parseInt(e.target.value, 10)));
    $("ksEvalMs").addEventListener("change", (e) => set("evalDepth", parseInt(e.target.value, 10)));
    $("ksFx").addEventListener("change", (e) => set("celebrateFx", e.target.checked));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { injectUI(); apply(); revealAdmin(); });
  else { injectUI(); apply(); revealAdmin(); }

  // 관리자면 상단 '관리자' 링크 표시 (모든 페이지 공통)
  // 깜빡임 방지: 마지막으로 확인된 관리자 여부를 저장해 두고 즉시 반영한 뒤,
  // 서버 응답으로 최종 확정한다.
  const ADMIN_CACHE_KEY = "kiwi_is_admin";

  function setAdminLink(show) {
    const link = document.getElementById("adminNavLink");
    if (!link) return;
    link.classList.toggle("hidden", !show);
  }

  function revealAdmin() {
    const link = document.getElementById("adminNavLink");
    if (!link) return;
    if (typeof API === "undefined" || !API.getToken()) {
      setAdminLink(false);
      try { localStorage.removeItem(ADMIN_CACHE_KEY); } catch (e) {}
      return;
    }

    // 1) 즉시 반영 (저장된 세션 정보 또는 캐시)
    let optimistic = false;
    try {
      const u = API.getUser && API.getUser();
      if (u && u.isAdmin) optimistic = true;
      else if (localStorage.getItem(ADMIN_CACHE_KEY) === "1") optimistic = true;
    } catch (e) {}
    setAdminLink(optimistic);

    // 2) 서버로 최종 확인 (권한이 바뀌었을 수도 있으므로)
    API.profileMe().then((r) => {
      const isAdmin = !!(r && r.profile && r.profile.isAdmin);
      setAdminLink(isAdmin);
      try { localStorage.setItem(ADMIN_CACHE_KEY, isAdmin ? "1" : "0"); } catch (e) {}
      // 세션에 저장된 사용자 정보도 최신화
      try {
        const u = API.getUser();
        if (u && u.isAdmin !== isAdmin) {
          u.isAdmin = isAdmin;
          API.setSession(API.getToken(), u);
        }
      } catch (e) {}
    }).catch(() => { /* 네트워크 오류 시 낙관적 표시 유지 */ });
  }

  // 로그인/로그아웃 직후에도 다시 판정할 수 있게 노출
  window.kiwiRevealAdmin = revealAdmin;

  return { get, set };
})();
window.KiwiSettings = KiwiSettings;
