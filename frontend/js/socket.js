/* WebSocket 클라이언트 래퍼 (이벤트 콜백 + 자동 재연결) */
const Socket = (() => {
  let ws = null;
  let token = "";
  const handlers = {};   // type -> [cb, ...]
  let shouldReconnect = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;

  function on(type, cb) {
    (handlers[type] = handlers[type] || []).push(cb);
  }

  function emit(type, payload) {
    (handlers[type] || []).forEach((cb) => cb(payload));
  }

  function connect(t) {
    token = t;
    shouldReconnect = true;
    open();
  }

  function startHeartbeat() {
    stopHeartbeat();
    // 25초마다 핑 → 프록시의 유휴 연결 종료 방지 (온라인 목록 유지의 핵심)
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }
  function stopHeartbeat() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; }

  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

    ws.onopen = () => { startHeartbeat(); emit("_open", {}); };
    ws.onmessage = (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg && msg.type) emit(msg.type, msg);
    };
    ws.onclose = () => {
      stopHeartbeat();
      emit("_close", {});
      if (shouldReconnect) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, 1500);
      }
    };
    ws.onerror = () => { /* onclose 가 이어서 처리 */ };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function close() {
    shouldReconnect = false;
    stopHeartbeat();
    clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  return { connect, on, send, close };
})();
