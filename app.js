const $ = (id) => document.getElementById(id);
let apiBase = "";
let apiToken = "";
let pollTimer = null;
let paused = false;

function setMessage(text, type = "") {
  const el = $("actionMessage");
  el.textContent = text;
  el.className = `message ${type}`;
}
function authHeaders(json = false) {
  const h = { Authorization: `Bearer ${apiToken}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}
async function api(path, options = {}) {
  if (!apiBase || !apiToken) throw new Error("Primero conecta la API.");
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) }
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}
function setConnectionStatus(online, text) {
  $("statusDot").classList.toggle("online", online);
  $("statusText").textContent = text;
}
function renderQueue(data) {
  const tracks = data.queue || [];
  $("queueCount").textContent = `${tracks.length} ${tracks.length === 1 ? "canción" : "canciones"}`;
  $("queueSummary").textContent = `${tracks.length} ${tracks.length === 1 ? "canción en espera" : "canciones en espera"}`;
  if (!tracks.length) {
    $("queueList").innerHTML = '<div class="empty-queue"><span>♫</span><b>Tu cola está vacía</b><small>Busca una canción o añade una playlist compatible.</small></div>';
    return;
  }
  $("queueList").replaceChildren();
  tracks.slice(0, 50).forEach((track, i) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    const number = document.createElement("span"); number.className = "queue-number"; number.textContent = String(i + 1).padStart(2, "0");
    const info = document.createElement("div");
    const title = document.createElement("div"); title.className = "queue-title"; title.textContent = track.title || "Canción";
    const url = document.createElement("div"); url.className = "queue-url"; url.textContent = track.duration || "—";
    info.append(title, url);
    const source = document.createElement("span"); source.className = "queue-source"; source.textContent = track.source || "YouTube";
    row.append(number, info, source); $("queueList").append(row);
  });
}
async function refreshState(showErrors = false) {
  try {
    const [status, queue] = await Promise.all([api("/api/status"), api("/api/music/queue")]);
    setConnectionStatus(Boolean(status.online), status.online ? "API conectada" : "Bot sin conexión");
    $("voiceStatus").textContent = status.voice === "ready" ? "Conectado" : status.voice;
    $("currentTitle").textContent = queue.current?.title || "Nada reproduciéndose";
    $("currentSource").textContent = queue.current ? `${queue.current.source || "YouTube"} · ${queue.current.duration || "—"}` : "Cuando reproduzcas algo, aparecerá aquí";
    paused = Boolean(status.paused);
    $("pauseBtn").textContent = paused ? "▶" : "Ⅱ";
    renderQueue(queue);
    if (showErrors && status.lastError) setMessage(status.lastError, "error");
  } catch (err) {
    setConnectionStatus(false, "API sin conectar");
    if (showErrors) setMessage(err.message, "error");
  }
}
$("connectBtn").addEventListener("click", async () => {
  apiBase = $("apiUrl").value.trim().replace(/\/+$/, "");
  apiToken = $("apiToken").value.trim();
  if (!/^https?:\/\//i.test(apiBase) || !apiToken) {
    $("connectMessage").textContent = "Completa URL y token";
    return;
  }
  $("connectBtn").disabled = true;
  $("connectMessage").textContent = "Conectando…";
  try {
    await refreshState(true);
    await api("/health", { headers: {} }).catch(() => null);
    $("connectMessage").textContent = "Token activo en esta pestaña";
    setMessage("Conexión realizada. Ya puedes controlar la música.", "success");
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => refreshState(false), 8000);
  } catch (err) {
    $("connectMessage").textContent = "No se pudo conectar";
    setMessage(err.message, "error");
  } finally {
    $("connectBtn").disabled = false;
  }
});
$("playForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("query").value.trim();
  if (!query) return;
  setMessage("Buscando y añadiendo a la cola…");
  try {
    const result = await api("/api/music/play", { method: "POST", body: JSON.stringify({ query }) });
    $("query").value = "";
    setMessage(`Listo: añadí ${result.added} canción(es) a la cola.`, "success");
    await refreshState();
  } catch (err) { setMessage(err.message, "error"); }
});
$("pauseBtn").addEventListener("click", async () => {
  try {
    await api(paused ? "/api/music/resume" : "/api/music/pause", { method: "POST", body: "{}" });
    setMessage(paused ? "Música reanudada." : "Música pausada.", "success");
    await refreshState();
  } catch (err) { setMessage(err.message, "error"); }
});
$("skipBtn").addEventListener("click", async () => {
  try { await api("/api/music/skip", { method: "POST", body: "{}" }); setMessage("Canción saltada.", "success"); await refreshState(); }
  catch (err) { setMessage(err.message, "error"); }
});
$("stopBtn").addEventListener("click", async () => {
  try { await api("/api/music/stop", { method: "POST", body: "{}" }); setMessage("Música detenida y cola vaciada.", "success"); await refreshState(); }
  catch (err) { setMessage(err.message, "error"); }
});
$("refreshBtn").addEventListener("click", () => refreshState(true));
