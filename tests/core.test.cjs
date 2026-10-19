const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  initialReward,
  normalizeReward,
  choose,
  twitchFields,
} = require("../core/model.cjs");
const { Store, importMedia } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");
const { layout } = require("../overlay/geometry.js");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-desk-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const source = path.join(dir, "a.wav");
  fs.writeFileSync(source, Buffer.alloc(44));
  const media = importMedia(store, source, "audio");
  const r = store.saveReward({
    ...initialReward(),
    items: [{ id: media.id, volume: 80, weight: 1 }],
  });
  return { store, r, media, dir, engine: new Engine(store) };
}
test("reward limits and all Twitch fields", () => {
  const r = normalizeReward({
    ...initialReward(),
    streamLimit: 5,
    userLimit: 2,
    cooldown: 30,
    paused: true,
  });
  const b = twitchFields(r);
  assert.equal(b.max_per_stream, 5);
  assert.equal(b.max_per_user_per_stream, 2);
  assert.equal(b.global_cooldown_seconds, 30);
  assert.equal(b.is_paused, true);
  assert.equal(Object.hasOwn(twitchFields(r, true), "is_paused"), false);
  assert.equal(
    twitchFields(initialReward()).should_redemptions_skip_request_queue,
    false,
  );
});
test("invalid input is rejected and limits cannot be negative", () => {
  for (const p of [
    { cost: 0 },
    { cost: 1.5 },
    { title: "x".repeat(46) },
    { prompt: "x".repeat(201) },
    { userLimit: -1 },
    { cooldown: 604801 },
    { background: "red" },
    { items: [{ id: "x", weight: 0.2, volume: 100 }] },
  ])
    assert.throws(() => normalizeReward({ ...initialReward(), ...p }));
});
test("weighted boundaries exclude zero weights", () => {
  const items = [
    { id: "off", weight: 0 },
    { id: "a", weight: 1 },
    { id: "b", weight: 3 },
  ];
  assert.equal(choose(items, () => 0).id, "a");
  for (const n of [1, 2, 3]) assert.equal(choose(items, () => n).id, "b");
  assert.throws(() => choose([{ weight: 0 }]));
});
test("secure weighted random distribution", () => {
  const items = [
    { id: "a", weight: 1 },
    { id: "b", weight: 3 },
  ];
  let a = 0;
  for (let n = 0; n < 100000; n++) if (choose(items).id === "a") a++;
  assert.ok(Math.abs(a - 25000) < 800);
});
test("media copies survive original deletion", (t) => {
  const { store, media, dir } = fixture(t);
  fs.unlinkSync(path.join(dir, "a.wav"));
  assert.ok(fs.existsSync(store.mediaPath(media.id)));
  assert.throws(() => importMedia(store, __filename, "video"));
});
test("duplicate delivery and deterministic retry retain selected file", (t) => {
  const { engine, r, store } = fixture(t),
    event = {
      account: "1",
      id: "redemption",
      user: "viewer",
      status: "unfulfilled",
    };
  const a = engine.enqueue(r, event);
  engine.enqueue(r, event);
  assert.equal(store.jobs().length, 1);
  engine.start(a, "client");
  engine.interrupt(a.id, "disconnect");
  engine.retry(a.id);
  assert.equal(store.job(a.id).item.id, a.item.id);
  assert.equal(store.job(a.id).state, "queued");
});
test("no fulfillment until browser ended; errors refund", (t) => {
  const { engine, r, store } = fixture(t);
  const j = engine.enqueue(r, { account: "1", id: "1", status: "unfulfilled" });
  engine.start(j, "c");
  assert.equal(store.job(j.id).state, "playing");
  engine.finish(j.id, true);
  assert.equal(store.job(j.id).state, "settling");
  assert.equal(store.job(j.id).desired, "FULFILLED");
  engine.external("1", "1", "fulfilled");
  assert.equal(store.job(j.id).state, "done");
  const k = engine.enqueue(r, { account: "1", id: "2", status: "unfulfilled" });
  engine.start(k, "c");
  engine.finish(k.id, false);
  assert.equal(store.job(k.id).desired, "CANCELED");
  engine.external("1", "2", "canceled");
  assert.equal(store.job(k.id).state, "refunded");
});
test("queue snapshots the selected video caption, retaining it for duplicate delivery and retry", (t) => {
  const { store, engine, dir } = fixture(t);
  const items = ["first", "second", "blank"].map((name) => {
    const file = path.join(dir, name + ".webm");
    fs.writeFileSync(file, name);
    const media = importMedia(store, file, "video");
    return {
      id: media.id,
      volume: 80,
      weight: 1,
      captionText: name === "blank" ? "" : name,
    };
  });
  const reward = store.saveReward({ ...initialReward("video"), items });
  const event = { account: "1", id: "per-file", status: "unfulfilled" };
  const job = engine.enqueue(reward, event, items[1].id);
  assert.equal(job.video.caption.text, "second");
  reward.items[1].captionText = "edited later";
  reward.video.caption.color = "#000000";
  store.saveReward(reward);
  assert.equal(job.video.caption.color, "#ffffff");
  assert.equal(engine.enqueue(reward, event).video.caption.text, "second");
  engine.start(job, "client");
  engine.interrupt(job.id, "disconnect");
  engine.retry(job.id);
  assert.equal(store.job(job.id).video.caption.text, "second");
  assert.equal(
    engine.enqueue(reward, null, items[0].id).video.caption.text,
    "first",
  );
  assert.equal(
    engine.enqueue(reward, null, items[2].id).video.caption.text,
    "",
  );
  delete reward.items[0].captionText;
  reward.video.caption.text = "legacy";
  assert.equal(
    engine.enqueue(reward, null, items[0].id).video.caption.text,
    "legacy",
  );
});
test("tests never become Twitch settlements", (t) => {
  const { engine, r, store } = fixture(t);
  const j = engine.enqueue(r);
  engine.start(j, "c");
  engine.finish(j.id, true);
  assert.equal(store.job(j.id).state, "done");
  assert.equal(store.job(j.id).refundable, false);
});
test("externally canceled redemptions never play", (t) => {
  const { engine, r, store } = fixture(t);
  const j = engine.enqueue(r, { account: "1", id: "1", status: "unfulfilled" });
  engine.external("1", "1", "canceled");
  assert.equal(engine.next("1"), undefined);
  assert.equal(store.job(j.id).state, "external");
});
test("queue isolates channels", (t) => {
  const { engine, r } = fixture(t);
  engine.enqueue(r, { account: "1", id: "1", status: "unfulfilled" });
  assert.equal(engine.next("2"), undefined);
  assert.ok(engine.next("1"));
});
test("missing media goes to refund without playing", (t) => {
  const { engine, r, store } = fixture(t);
  const j = engine.enqueue(
    { ...r, items: [] },
    { account: "1", id: "1", status: "unfulfilled" },
  );
  assert.equal(store.job(j.id).desired, "CANCELED");
  assert.equal(engine.next("1"), undefined);
});
test("overlay key remains stable across restarts and active jobs need attention", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-restart-"));
  let s = new Store(dir);
  const token = s.meta("overlayToken");
  s.putJob({ id: "1", rewardId: "r", state: "playing", createdAt: 1 });
  s.close();
  s = new Store(dir);
  assert.equal(s.meta("overlayToken"), token);
  assert.equal(s.job("1").state, "attention");
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("rotated video always stays inside canvas", () => {
  for (let i = 0; i < 10000; i++) {
    const v = {
      ...initialReward("video").video,
      width: 40 + Math.random() * 1880,
      height: 40 + Math.random() * 1040,
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      angle: 45,
      mode: i % 2 ? "random" : "fixed",
    };
    const p = layout(v, 0.2 + Math.random() * 5);
    assert.ok(p.cx - p.bw / 2 >= -1e-8 && p.cx + p.bw / 2 <= 1920 + 1e-8);
    assert.ok(p.cy - p.bh / 2 >= -1e-8 && p.cy + p.bh / 2 <= 1080 + 1e-8);
    assert.ok(p.width <= v.width + 0.001 && p.height <= v.height + 0.001);
  }
});
test("video frame hugs landscape, portrait and square pixels including thick borders", () => {
  for (const ratio of [0.25, 9 / 16, 1, 16 / 9, 2.4, 4])
    for (const border of [0, 2, 16, 40])
      for (const borderStyle of ["solid", "dashed", "none"])
        for (const width of [40, 600, 1920]) {
          const v = {
            ...initialReward("video").video,
            width,
            height: 340,
            border,
            borderStyle,
            angle: 45,
          };
          const p = layout(v, ratio, () => 1);
          assert.ok(
            Math.abs(
              (p.width - 2 * p.border) / (p.height - 2 * p.border) - ratio,
            ) < 1e-8,
          );
          assert.ok(p.width <= v.width + 1e-8 && p.height <= v.height + 1e-8);
          assert.ok(p.width > p.border * 2 && p.height > p.border * 2);
          if (borderStyle === "none") assert.equal(p.border, 0);
        }
});
module.exports = { fixture };
