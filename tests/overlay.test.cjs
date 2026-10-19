const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store, importMedia } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");
const { Overlay } = require("../core/overlay.cjs");
const { initialReward } = require("../core/model.cjs");
test("overlay is loopback-only, authenticated, read-only and supports media ranges", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-http-")),
    store = new Store(dir),
    engine = new Engine(store),
    overlay = new Overlay({ store, engine, account: () => "" });
  await overlay.start(0);
  t.after(() => {
    overlay.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = overlay.url();
  assert.equal((await fetch(url)).status, 200);
  assert.ok(
    (await (await fetch(url)).text()).includes(`content="${overlay.build}"`),
  );
  assert.equal((await fetch(url.replace(overlay.token, "wrong"))).status, 404);
  assert.equal(
    (await fetch(url, { headers: { Origin: "https://evil.example" } })).status,
    403,
  );
  assert.equal((await fetch(url + "admin", { method: "POST" })).status, 404);
  const file = path.join(dir, "test.wav");
  fs.writeFileSync(file, Buffer.from("0123456789"));
  const m = importMedia(store, file, "audio");
  const r = await fetch(url + "media/" + m.id, {
    headers: { Range: "bytes=2-4" },
  });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), "234");
  assert.equal(r.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(
    (await fetch(url + "media/" + m.id, { headers: { Range: "bytes=50-" } }))
      .status,
    416,
  );
  assert.equal(
    (
      await fetch(url + "ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: "invalid" }),
      })
    ).status,
    409,
  );
});

test("OBS needs current build; heartbeat loss interrupts rather than repeats or refunds a started job", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-heartbeat-")),
    store = new Store(dir),
    engine = new Engine(store),
    overlay = new Overlay({ store, engine, account: () => "" });
  await overlay.start(0);
  const response = await fetch(overlay.url() + "events", {
    headers: { "User-Agent": "obs-browser/2.25" },
  });
  const reader = response.body.getReader();
  await reader.read();
  t.after(async () => {
    await reader.cancel();
    overlay.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const c = [...overlay.clients.values()][0];
  const ack = (build) =>
    fetch(overlay.url() + "ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: c.id, type: "ready", build }),
    });
  await ack("old");
  assert.equal(overlay.view().obsClients, 0);
  assert.equal(overlay.view().outdated, true);
  await ack(overlay.build);
  assert.equal(overlay.view().obsClients, 1);
  const file = path.join(dir, "test.wav");
  fs.writeFileSync(file, "test");
  const media = importMedia(store, file, "audio");
  const reward = store.saveReward({
    ...initialReward(),
    items: [{ id: media.id, weight: 1, volume: 80 }],
  });
  const one = engine.enqueue(reward),
    two = engine.enqueue(reward);
  engine.start(one, c.id);
  c.seen = Date.now() - 13000;
  overlay.tick();
  assert.equal(store.job(one.id).state, "attention");
  assert.equal(store.job(two.id).state, "queued");
  assert.equal(engine.playing(), undefined);
  overlay.tick();
  assert.equal(store.job(one.id).state, "attention");
  assert.equal(store.job(two.id).state, "queued");
});
