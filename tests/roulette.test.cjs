const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  initialReward,
  normalizeReward,
  chooseCycle,
  twitchFields,
} = require("../core/model.cjs");
const { Store } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");
const { playedKey } = require("../core/roulette.cjs");
function fixture(t, kind = "audio") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-cycle-"));
  const f = { root, store: new Store(root) };
  f.engine = new Engine(
    f.store,
    () => {},
    () => 0,
  );
  f.reward = f.store.saveReward({
    ...initialReward(kind),
    account: "",
    items: [],
  });
  f.reward.account = "owner";
  f.reward.clientId = "client";
  for (let n = 0; n < 5; n++) {
    const id = randomUUID();
    f.store.putMedia({
      id,
      kind,
      name: "Item " + n,
      ext: kind === "audio" ? ".wav" : ".mp4",
    });
    f.reward.items.push({ id, volume: 80, weight: n + 1 });
  }
  f.store.putReward(f.reward);
  f.key = "roulette:" + JSON.stringify(["owner", "client", f.reward.id]);
  f.draw = (id = randomUUID()) =>
    f.engine.enqueue(f.reward, {
      id,
      account: "owner",
      user: "viewer-" + id,
      status: "unfulfilled",
    });
  t.after(() => {
    f.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return f;
}
test("new and legacy rewards default to cycles; explicit random remains opt-in", () => {
  const legacy = initialReward();
  delete legacy.allowRepeats;
  assert.equal(normalizeReward(legacy).allowRepeats, false);
  assert.equal(
    normalizeReward({ ...legacy, allowRepeats: true }).allowRepeats,
    true,
  );
  assert.equal(
    normalizeReward(legacy, { ...legacy, allowRepeats: true }).allowRepeats,
    true,
  );
  assert.throws(() => normalizeReward({ ...legacy, allowRepeats: "true" }));
  assert.equal(
    Object.hasOwn(
      twitchFields({ ...legacy, allowRepeats: true }),
      "allowRepeats",
    ),
    false,
  );
});
for (const kind of ["audio", "video"])
  test(`${kind}: each cycle selects every positive-weight item once for all viewers`, (t) => {
    const f = fixture(t, kind);
    f.reward.items[4].weight = 0;
    let last;
    for (let cycle = 0; cycle < 10; cycle++) {
      const ids = Array.from({ length: 4 }, () => f.draw().item.id);
      assert.equal(new Set(ids).size, 4);
      assert.ok(!ids.includes(f.reward.items[4].id));
      assert.notEqual(ids[0], last);
      last = ids.at(-1);
    }
  });
test("weights apply among remaining items and do not mutate the previous cycle", () => {
  const items = [
    { id: "a", weight: 1 },
    { id: "b", weight: 3 },
    { id: "off", weight: 0 },
  ];
  const previous = { used: [], last: "" };
  assert.equal(chooseCycle(items, previous, () => 0).selected.id, "a");
  assert.equal(chooseCycle(items, previous, () => 1).selected.id, "b");
  assert.deepEqual(previous, { used: [], last: "" });
  assert.equal(
    chooseCycle(items, { used: ["b"], last: "b" }, (total) => {
      assert.equal(total, 1);
      return 0;
    }).selected.id,
    "a",
  );
});
test("a cycle survives an application restart and has no time expiry", (t) => {
  const f = fixture(t);
  const first = f.draw().item.id;
  f.store.close();
  f.store = new Store(f.root);
  f.engine = new Engine(
    f.store,
    () => {},
    () => 0,
  );
  const rest = Array.from({ length: 4 }, () => f.draw().item.id);
  assert.equal(new Set([first, ...rest]).size, 5);
  assert.equal(f.store.meta(f.key).used.length, 5);
});
test("duplicate redemptions, retries and direct file tests do not consume new draws", (t) => {
  const f = fixture(t);
  const first = f.draw("one");
  const before = f.store.meta(f.key);
  assert.equal(f.draw("one").item.id, first.item.id);
  f.engine.enqueue(f.reward, null, f.reward.items[3].id);
  f.engine.start(first, "browser");
  f.engine.interrupt(first.id, "offline");
  f.engine.retry(first.id);
  assert.deepEqual(f.store.meta(f.key), before);
  assert.equal(f.store.job(first.id).item.id, first.item.id);
  assert.notEqual(f.draw().item.id, first.item.id);
});
test("whole-reward tests share the cycle with real redemptions", (t) => {
  const f = fixture(t);
  const first = f.engine.enqueue(f.reward).item.id;
  assert.notEqual(f.draw().item.id, first);
});
test("rewards and accounts have independent cycles", (t) => {
  const f = fixture(t);
  const first = f.draw().item.id;
  assert.equal(f.engine.enqueue({ ...f.reward, id: "another" }).item.id, first);
  assert.equal(
    f.engine.enqueue({ ...f.reward, account: "another" }).item.id,
    first,
  );
  assert.equal(
    f.engine.enqueue({ ...f.reward, clientId: "another" }).item.id,
    first,
  );
  assert.notEqual(f.draw().item.id, first);
});
test("full random permits consecutive repeats and switching back starts a fresh cycle", (t) => {
  const f = fixture(t);
  f.reward.allowRepeats = true;
  const ids = Array.from({ length: 3 }, () => f.draw().item.id);
  assert.equal(new Set(ids).size, 1);
  f.reward.allowRepeats = false;
  const cycle = Array.from({ length: 5 }, () => f.draw().item.id);
  assert.notEqual(cycle[0], ids[0]);
  assert.equal(new Set(cycle).size, 5);
});
test("edits to weights and files retain already selected items until the cycle ends", (t) => {
  const f = fixture(t);
  const first = f.draw().item.id;
  f.reward.items.reverse();
  f.reward.items[0].weight = 10000;
  f.reward.items = f.reward.items.filter((item) => item.id !== first);
  f.reward.items.push({ id: first, volume: 80, weight: 2 });
  const remaining = Array.from({ length: 4 }, () => f.draw().item.id);
  assert.equal(new Set([first, ...remaining]).size, 5);
});
test("single item cycles repeat; all-zero pools fail without advancing", (t) => {
  const f = fixture(t);
  f.reward.items = f.reward.items.slice(0, 1);
  assert.equal(f.draw().item.id, f.draw().item.id);
  const before = f.store.meta(f.key);
  f.reward.items[0].weight = 0;
  assert.equal(f.draw().desired, "CANCELED");
  assert.deepEqual(f.store.meta(f.key), before);
});
test("queue capacity and missing media do not consume the cycle", (t) => {
  const f = fixture(t);
  f.draw();
  const before = f.store.meta(f.key);
  const original = f.reward.items;
  f.reward.items = [{ id: "missing", volume: 100, weight: 1 }];
  assert.equal(f.draw().desired, "CANCELED");
  assert.deepEqual(f.store.meta(f.key), before);
  f.reward.items = original;
  for (let n = 0; n < 500; n++)
    f.store.putJob({
      id: "queued:" + n,
      rewardId: f.reward.id,
      createdAt: n,
      state: "queued",
    });
  assert.equal(f.draw().detail, "Очередь заполнена");
  assert.deepEqual(f.store.meta(f.key), before);
});
test("cycle reservation and job insertion roll back together on a storage error", (t) => {
  const f = fixture(t);
  const write = f.store.setMeta;
  f.store.setMeta = () => {
    throw Error("Disk unavailable");
  };
  assert.throws(() => f.draw("broken"), /Disk unavailable/);
  assert.equal(f.store.job("owner:broken"), undefined);
  assert.equal(f.store.meta(f.key), null);
  f.store.setMeta = write;
  assert.equal(f.draw("broken").item.id, f.reward.items[0].id);
});
for (const kind of ["audio", "video"])
  test(`${kind}: stopping then canceling a multi-cycle queue keeps shown progress and returns unseen files`, (t) => {
    const f = fixture(t, kind);
    const queued = Array.from({ length: 13 }, () => f.engine.enqueue(f.reward));
    const first = f.engine.start(queued[0], "obs");
    f.engine.finish(first.id, false, "Остановлено вручную");
    for (const job of queued.slice(1).reverse()) f.engine.cancel(job.id);
    assert.deepEqual(f.store.meta(playedKey(f.key)).used, [first.item.id]);
    assert.deepEqual(f.store.meta(f.key).used, [first.item.id]);
    f.store.close();
    f.store = new Store(f.root);
    f.engine = new Engine(
      f.store,
      () => {},
      () => 0,
    );
    const shown = [first.item.id];
    for (let n = 0; n < 4; n++) {
      const job = f.engine.start(f.engine.enqueue(f.reward), "obs");
      shown.push(job.item.id);
      f.engine.finish(job.id, true);
    }
    assert.equal(new Set(shown).size, 5);
    assert.notEqual(f.engine.enqueue(f.reward).item.id, shown.at(-1));
  });
test("canceled pending items are replaced before later cycles play, without changing queued caption snapshots", (t) => {
  const f = fixture(t, "video");
  f.reward.items.forEach((item, n) => (item.captionText = "Original " + n));
  f.store.putReward(f.reward);
  const queue = Array.from({ length: 11 }, () => f.engine.enqueue(f.reward));
  const first = f.engine.start(queue[0], "obs");
  f.engine.finish(first.id, true);
  f.engine.cancel(queue[1].id);
  f.reward.items.forEach((item) => (item.captionText = "Changed later"));
  f.store.putReward(f.reward);
  const shown = [first.item.id];
  for (let n = 0; n < 9; n++) {
    const job = f.engine.start(f.engine.next("owner"), "obs");
    assert.match(job.video.caption.text, /^Original /);
    shown.push(job.item.id);
    f.engine.finish(job.id, true);
  }
  assert.equal(new Set(shown.slice(0, 5)).size, 5);
  assert.equal(new Set(shown.slice(5, 10)).size, 5);
});
test("legacy progress excludes never-started canceled reservations without deleting history", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 5; n++)
    f.store.putJob({
      id: "old" + n,
      rewardId: f.reward.id,
      account: "owner",
      clientId: "client",
      item: f.reward.items[n],
      createdAt: n + 1,
      startedAt: n < 2 ? n + 1 : undefined,
      state: n < 2 ? "done" : "failed",
    });
  f.store.setMeta(f.key, {
    used: f.reward.items.map((item) => item.id),
    last: f.reward.items[4].id,
  });
  const history = f.store.jobs();
  const next = Array.from(
    { length: 3 },
    () => f.engine.enqueue(f.reward).item.id,
  );
  assert.equal(
    new Set([...f.reward.items.slice(0, 2).map((item) => item.id), ...next])
      .size,
    5,
  );
  assert.deepEqual(
    f.store.jobs().filter((job) => job.id.startsWith("old")),
    history,
  );
});
test("a direct-file test before the first roulette activation does not consume its first draw", (t) => {
  const f = fixture(t);
  const fixed = f.engine.enqueue(f.reward, null, f.reward.items[0].id);
  f.engine.start(fixed, "obs");
  f.engine.finish(fixed.id, true);
  assert.equal(f.engine.enqueue(f.reward).item.id, f.reward.items[0].id);
});
