const stage = document.querySelector("#stage");
const loadedBuild = document.querySelector(
  'meta[name="reward-build"]',
)?.content;
let client = "",
  current = null,
  source,
  reconnectTimer,
  lastSignal = Date.now(),
  retryDelay = 1000;
function resize() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(innerWidth - 1920 * s) / 2}px`;
  stage.style.top = `${(innerHeight - 1080 * s) / 2}px`;
  if (current?.frame.classList.contains("fullscreen-frame")) current.layout();
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
  current?.stop();
  current = null;
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
  current = RewardPlayback.mount(job.video?.fullscreen && job.kind === "video" ? document.body : stage, job, (type) => {
    if (current?.id !== job.id) return;
    current = null;
    void ack(type, job.id);
  });
}
connect();
