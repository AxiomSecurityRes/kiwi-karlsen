/* version-check.js — 캐시된 옛 페이지 자동 갱신.

문제: 브라우저는 각 HTML 을 개별적으로 캐시한다. 로비만 새로고침해도
play.html, puzzles.html 등은 여전히 옛 버전이 뜰 수 있다.

해결: 각 HTML 에 박아둔 버전(<meta name="kiwi-version">)과 서버의 실제 버전을
비교해, 다르면 캐시를 우회해 한 번만 자동으로 다시 불러온다. */
(function () {
  const RELOAD_FLAG = "kiwi_reloaded_for";   // 무한 새로고침 방지

  // "v17" 과 "17" 을 같은 것으로 본다
  function norm(v) {
    return String(v == null ? "" : v).trim().replace(/^v/i, "");
  }

  function pageVersion() {
    const m = document.querySelector('meta[name="kiwi-version"]');
    return m ? norm(m.getAttribute("content")) : null;
  }

  async function check() {
    const mine = pageVersion();
    if (!mine) return;
    let server;
    try {
      // no-store 로 요청해 캐시된 응답을 쓰지 않는다
      const res = await fetch("/api/site", { cache: "no-store" });
      if (!res.ok) return;
      server = norm((await res.json()).version);
    } catch (e) {
      return;   // 오프라인 등: 조용히 넘어간다
    }
    if (!server || server === mine) {
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch (e) {}
      return;
    }

    // 이미 이 버전 때문에 새로고침한 적이 있으면 반복하지 않는다
    let already = null;
    try { already = sessionStorage.getItem(RELOAD_FLAG); } catch (e) {}
    if (already === server) {
      console.warn(`[Kiwi] 페이지 버전(${mine})이 서버(${server})와 다릅니다. ` +
                   "Ctrl+F5 로 강력 새로고침 해주세요.");
      return;
    }
    try { sessionStorage.setItem(RELOAD_FLAG, server); } catch (e) {}

    // 캐시를 우회해 다시 불러온다
    const url = new URL(location.href);
    url.searchParams.set("_v", server);
    location.replace(url.toString());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
  else check();
})();
