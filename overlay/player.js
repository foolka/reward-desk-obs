const stage = document.querySelector("#stage");
const loadedBuild = document.querySelector(
  'meta[name="reward-build"]',
)?.content;
let client = "",
  current = null,
  source,
  watchdog,
  reconnectTimer,
  lastSignal = Date.now(),
  retryDelay = 1000;
function resize() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(innerWidth - 1920 * s) / 2}px`;
  stage.style.top = `${(innerHeight - 1080 * s) / 2}px`;
}
addEventListener("resize", resize);
resize();
async function ack(type, id = "") {
  if (!client) return;
  try {
    const r = await fetch("ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, type, id, build: loadedBuild }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 409) connect();
  } catch {}
}
function stop() {
  clearTimeout(watchdog);
  if (current) {
    current.el.pause();
    current.el.removeAttribute("src");
    current.el.load();
    current.frame.remove();
    current = null;
  }
}
function connect() {
  clearTimeout(reconnectTimer);
  source?.close();
  stop();
  client = "";
  source = new EventSource("events");
  source.addEventListener("hello", (e) => {
    lastSignal = Date.now();
    retryDelay = 1000;
    const hello = JSON.parse(e.data);
    if (loadedBuild && hello.build && loadedBuild !== hello.build) {
      source.close();
      location.reload();
      return;
    }
    client = hello.id;
    void ack("ready");
  });
  source.addEventListener("ping", () => {
    lastSignal = Date.now();
    void ack("heartbeat");
  });
  source.addEventListener("stop", stop);
  source.addEventListener("play", (e) => play(JSON.parse(e.data)));
  source.onerror = () => {
    source.close();
    client = "";
    stop();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(15000, retryDelay * 2);
  };
}
setInterval(() => {
  if (client && Date.now() - lastSignal > 8000) connect();
}, 2000);
function play(job) {
  stop();
  const el = document.createElement(job.kind === "video" ? "video" : "audio");
  const frame = job.kind === "video" ? document.createElement("div") : el;
  if (frame !== el) {
    frame.className = "clip-frame";
    el.className = "clip";
    frame.append(el);
  }
  current = { id: job.id, el, frame };
  el.volume = job.volume / 100;
  el.preload = "auto";
  el.playsInline = true;
  let settled = false;
  const finish = (type) => {
    if (settled || current?.id !== job.id) return;
    settled = true;
    clearTimeout(watchdog);
    frame.classList.add("leaving");
    setTimeout(() => {
      if (current?.id === job.id) {
        stop();
        void ack(type, job.id);
      }
    }, 180);
  };
  el.onended = () => finish("ended");
  el.onerror = () => finish("error");
  el.onloadedmetadata = () => {
    if (current?.id !== job.id || settled) return;
    if (!Number.isFinite(el.duration) || el.duration > 600) {
      finish("error");
      return;
    }
    if (job.kind === "video") {
      const v = job.video,
        p = RewardGeometry.layout(v, el.videoWidth / el.videoHeight || 16 / 9);
      Object.assign(frame.style, {
        left: p.x + "px",
        top: p.y + "px",
        width: p.width + "px",
        height: p.height + "px",
        transform: `rotate(${p.angle}deg)`,
        border: `${p.border}px ${v.borderStyle} ${v.color}`,
        borderRadius: v.radius + "px",
      });
      RewardCaption.renderAll(frame, v, el.duration);
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () => finish("error"),
      Math.min(600000, el.duration * 1000 + 15000),
    );
    el.play().catch(() => finish("error"));
  };
  watchdog = setTimeout(() => finish("error"), 20000);
  el.src = job.url;
  stage.append(frame);
}
connect();
