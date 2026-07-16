/* guide.html — 현재 버전 표시 */
(function () {
  const el = document.getElementById("curVer");
  if (!el) return;
  API.site()
    .then((s) => { el.textContent = s.version || "-"; })
    .catch(() => { el.textContent = "-"; });
})();
