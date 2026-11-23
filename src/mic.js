// Helper window for the party bar's talking light. Owlbear doesn't let extension frames use the mic,
// so this small top-level window listens and tells the party bar (its opener) when you talk.
const st = document.getElementById("st");
const meter = document.getElementById("m");
const go = document.getElementById("go");
const slider = document.getElementById("thr");
const mark = document.getElementById("mark");
// Levels on a decibel scale, like Discord's input sensitivity: 0% = -60 dB (silence), 100% = 0 dB (loudest).
const THR_KEY = "nimble-mic-threshold";
const pct = (rms) => Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 60) * 100));
let thrPct = 40;
try { const v = Number(localStorage.getItem(THR_KEY)); if (v > 0 && v <= 100) thrPct = v; } catch (_) {}
slider.value = String(thrPct);
mark.style.left = thrPct + "%";
slider.addEventListener("input", () => {
  thrPct = Number(slider.value);
  mark.style.left = thrPct + "%";
  try { localStorage.setItem(THR_KEY, String(thrPct)); } catch (_) {}
});
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
  const src = ctx.createMediaStreamSource(stream);
  status();
  // Detection runs on the audio thread, not on a timer: browsers slow timers down in windows you
  // aren't looking at, which made the light stick on or miss you while this window was hidden.
  // Each block reports its loudness and how much audio it covered, so the timings hold either way.
  let aboveMs = 0, belowMs = 0, lastUi = 0;
  const onLevel = (rms, ms) => {
    const level = pct(rms);
    if (level > thrPct) { aboveMs += ms; belowMs = 0; } else { belowMs += ms; aboveMs = 0; }
    const now = Date.now();
    if (!on && aboveMs >= 150) post(true);
    else if (on && belowMs >= 700) post(false);
    else if (on && now - sentAt > 1500) post(true);
    if (now - lastUi > 60) { lastUi = now; meter.firstElementChild.style.width = level + "%"; meter.classList.toggle("talk", on); }
  };
  const worklet = `class L extends AudioWorkletProcessor{constructor(){super();this.s=0;this.n=0}
    process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++)this.s+=c[k]*c[k];this.n+=c.length;
    if(this.n>=2048){this.port.postMessage([Math.sqrt(this.s/this.n),this.n/sampleRate*1000]);this.s=0;this.n=0}}return true}}
    registerProcessor("nimble-level",L);`;
  try {
    if (!ctx.audioWorklet) throw new Error("no worklet");
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: "application/javascript" })));
    const node = new AudioWorkletNode(ctx, "nimble-level");
    node.port.onmessage = (e) => onLevel(e.data[0], e.data[1]);
    const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
  } catch (_) {
    // older browsers: the audio-thread callback of a ScriptProcessor isn't timer-throttled either
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = (e) => {
      const c = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let k = 0; k < c.length; k++) sum += c[k] * c[k];
      onLevel(Math.sqrt(sum / c.length), (c.length / ctx.sampleRate) * 1000);
    };
    const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(sp).connect(mute).connect(ctx.destination);
  }
  // keep the audio running if the browser suspends it
  setInterval(() => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); }, 1000);
  document.addEventListener("visibilitychange", () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); });
  setInterval(status, 2000);
}
go.addEventListener("click", start);
window.addEventListener("beforeunload", () => post(false));
start();
