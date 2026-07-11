/* KiwiSettings — 전역 설정 저장/불러오기 + 자동 주입 설정 모달(⚙️) */
const KiwiSettings = (() => {
  const KEY = "kiwi_settings";
  const DEFAULTS = {
    soundOn: true,        // 효과음 켜기
    soundVolume: 60,      // 0~100
    evalMovetime: 400,    // 분석 보드 실시간 평가 시간(ms)
    reviewMovetime: 200,  // 게임 리뷰 수당 평가 시간(ms)
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
      <div class="modal" style="text-align:left;max-width:400px;">
        <h2 style="text-align:center;">⚙️ 설정</h2>
        <label style="display:flex;align-items:center;gap:8px;margin:10px 0;">
          <input type="checkbox" id="ksSound" style="width:auto;margin:0;" /> 효과음 켜기
        </label>
        <label>효과음 볼륨: <span id="ksVolVal"></span>%</label>
        <input type="range" id="ksVolume" min="0" max="100" step="10" style="width:100%;" />
        <label>리뷰 분석 속도 (수당 시간)</label>
        <select id="ksReviewMs" style="width:100%;">
          <option value="100">빠름 (100ms) — 정확도 낮음</option>
          <option value="200">보통 (200ms) — 권장</option>
          <option value="400">정밀 (400ms)</option>
          <option value="800">매우 정밀 (800ms) — 느림</option>
        </select>
        <label>리뷰 병렬 워커 수</label>
        <select id="ksWorkers" style="width:100%;">
          <option value="0">자동 (CPU에 맞춤)</option>
          <option value="1">1개</option>
          <option value="2">2개</option>
          <option value="3">3개</option>
          <option value="4">4개</option>
        </select>
        <label>분석 보드 실시간 평가 시간</label>
        <select id="ksEvalMs" style="width:100%;">
          <option value="200">빠름 (200ms)</option>
          <option value="400">보통 (400ms)</option>
          <option value="800">정밀 (800ms)</option>
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
      $("ksSound").checked = get("soundOn");
      $("ksVolume").value = get("soundVolume");
      $("ksVolVal").textContent = get("soundVolume");
      $("ksReviewMs").value = String(get("reviewMovetime"));
      $("ksWorkers").value = String(get("reviewWorkers"));
      $("ksEvalMs").value = String(get("evalMovetime"));
      $("ksFx").checked = get("celebrateFx");
    }
    btn.addEventListener("click", (e) => { e.preventDefault(); sync(); bg.classList.add("show"); });
    $("ksClose").addEventListener("click", () => bg.classList.remove("show"));
    bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.remove("show"); });
    $("ksSound").addEventListener("change", (e) => set("soundOn", e.target.checked));
    $("ksVolume").addEventListener("input", (e) => { $("ksVolVal").textContent = e.target.value; set("soundVolume", parseInt(e.target.value, 10)); });
    $("ksReviewMs").addEventListener("change", (e) => set("reviewMovetime", parseInt(e.target.value, 10)));
    $("ksWorkers").addEventListener("change", (e) => set("reviewWorkers", parseInt(e.target.value, 10)));
    $("ksEvalMs").addEventListener("change", (e) => set("evalMovetime", parseInt(e.target.value, 10)));
    $("ksFx").addEventListener("change", (e) => set("celebrateFx", e.target.checked));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { injectUI(); apply(); });
  else { injectUI(); apply(); }

  return { get, set };
})();
window.KiwiSettings = KiwiSettings;
