// Helper window for the party bar's talking light. Owlbear doesn't let extension frames use the mic,
// so this small top-level window listens and tells the party bar (its opener) when you talk.
const st = document.getElementById("st");
const meter = document.getElementById("m");
const go = document.getElementById("go");
let target = window.opener;
let on = false, sentAt = 0;

window.addEventListener("message", (e) => {
  if (e.origin === location.origin && e.data && e.data.type === "nimble-hello") { target = e.source; status(); }
});

function post(v) {
  on = v; sentAt = Date.now();
  try { target && target.postMessage({ type: "nimble-talk", on: v }, location.origin); } catch (_) {}
}
function status(msg) {
  if (msg) { st.textContent = msg; return; }
  const ok = target && !target.closed;
  st.textContent = ok ? "Connected to your party bar. Talk and your card lights up." : "Lost the party bar (Owlbear reloaded it). Click 🎙 on your card again to reconnect.";
  st.className = ok ? "s" : "s bad";
}

async function start() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    status(err && err.name === "NotAllowedError" ? "Microphone permission was denied. Click the icon next to the address bar to allow it, then press the button." : "No microphone found.");
    st.className = "s bad"; go.hidden = false; return;
  }
  go.hidden = true;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  let floor = 0.01, above = 0, below = 0;
  status();
  setInterval(() => {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!on) floor = floor * 0.98 + rms * 0.02;
    const thr = Math.max(0.012, floor * 2.6);
    if (rms > thr) { above++; below = 0; } else { below++; above = 0; }
    const now = Date.now();
    if (!on && above >= 3) post(true);
    else if (on && below >= 14) post(false);
    else if (on && now - sentAt > 1500) post(true);
    meter.firstElementChild.style.width = Math.min(100, (rms / 0.15) * 100) + "%";
    meter.classList.toggle("talk", on);
  }, 50);
  setInterval(status, 2000);
}
go.addEventListener("click", start);
window.addEventListener("beforeunload", () => post(false));
start();
