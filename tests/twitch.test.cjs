const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { Store, importMedia } = require("../core/store.cjs"),
  { Engine } = require("../core/engine.cjs"),
  { Twitch } = require("../core/twitch.cjs"),
  { initialReward } = require("../core/model.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-twitch-")),
    store = new Store(dir),
    engine = new Engine(store),
    auth = new EventEmitter();
  auth.saved = { user: { id: "owner" }, clientId: "client" };
  auth.validate = async () => {};
  let refreshes = 0;
  auth.getProvider = async () => ({
    getAccessTokenForUser: async () => ({ accessToken: "fake" }),
    refreshAccessTokenForUser: async () => {
      refreshes++;
      return { accessToken: "new-fake" };
    },
  });
  const requests = [],
    remote = [],
    redemptions = [];
  let loseCreate = false,
    losePatch = false,
    denyReward = "";
  const twitch = new Twitch({
    auth,
    store,
    engine,
    fetchImpl: async (url, options) => {
      const u = new URL(url),
        b = options.body && JSON.parse(options.body);
      requests.push({ method: options.method, url: u, body: b });
      if (u.pathname.endsWith("/redemptions")) {
        if (denyReward === u.searchParams.get("reward_id"))
          return new Response("{}", { status: 404 });
        if (options.method === "PATCH") {
          redemptions.find((x) => x.id === u.searchParams.get("id")).status =
            b.status;
          if (losePatch) {
            losePatch = false;
            throw Error("lost response");
          }
        }
        const data = redemptions.filter(
          (x) =>
            (!u.searchParams.get("id") || x.id === u.searchParams.get("id")) &&
            (!u.searchParams.get("status") ||
              x.status === u.searchParams.get("status")),
        );
        return Response.json({ data, pagination: {} });
      }
      if (options.method === "POST") {
        const value = { ...b, id: "remote-" + (remote.length + 1) };
        remote.push(value);
        if (loseCreate) {
          loseCreate = false;
          throw Error("lost create response");
        }
        return Response.json({ data: [value] });
      }
      if (options.method === "PATCH") {
        Object.assign(
          remote.find((x) => x.id === u.searchParams.get("id")) || {},
          b,
        );
        return Response.json({ data: remote });
      }
      if (options.method === "DELETE") {
        remote.splice(
          remote.findIndex((x) => x.id === u.searchParams.get("id")),
          1,
        );
        return new Response(null, { status: 204 });
      }
      return Response.json({ data: remote });
    },
  });
  const file = path.join(dir, "sound.wav");
  fs.writeFileSync(file, Buffer.alloc(44));
  const m = importMedia(store, file, "audio");
  const r = store.saveReward({
    ...initialReward(),
    items: [{ id: m.id, volume: 100, weight: 1 }],
  });
  t.after(() => {
    twitch.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    engine,
    auth,
    twitch,
    r,
    requests,
    remote,
    redemptions,
    loseCreate: () => (loseCreate = true),
    losePatch: () => (losePatch = true),
    deny: (id) => (denyReward = id),
  };
}
test("create/update/delete affect only owned reward and carry Twitch options", async (t) => {
  const f = fixture(t);
  await f.twitch.publish(f.r.id);
  let r = f.store.reward(f.r.id);
  assert.equal(r.remoteId, "remote-1");
  assert.equal(r.account, "owner");
  f.store.putReward({ ...r, cost: 500, userLimit: 3 });
  await f.twitch.publish(r.id);
  assert.equal(f.remote[0].cost, 500);
  assert.equal(f.remote[0].max_per_user_per_stream, 3);
  await f.twitch.remove(r.id);
  assert.equal(f.store.reward(r.id), undefined);
  assert.equal(f.remote.length, 0);
});
test("lost creation response is recovered without duplicate POST", async (t) => {
  const f = fixture(t);
  f.loseCreate();
  await assert.rejects(f.twitch.publish(f.r.id));
  assert.equal(f.store.reward(f.r.id).sync, "creating");
  await f.twitch.publish(f.r.id);
  assert.equal(f.remote.length, 1);
  assert.equal(f.requests.filter((x) => x.method === "POST").length, 1);
  assert.equal(f.store.reward(f.r.id).remoteId, "remote-1");
});
test("new reward creation sends selected color, price and all configurable limits", async (t) => {
  const f = fixture(t);
  f.store.putReward({
    ...f.r,
    cost: 2345,
    background: "#dd8844",
    prompt: "Выберите видео",
    input: true,
    enabled: false,
    paused: true,
    streamLimit: 7,
    userLimit: 2,
    cooldown: 45,
    skipQueue: true,
  });
  await f.twitch.publish(f.r.id);
  const body = f.requests.find((r) => r.method === "POST").body;
  assert.equal(body.cost, 2345);
  assert.equal(body.background_color, "#dd8844");
  assert.equal(body.prompt, "Выберите видео");
  assert.equal(body.is_user_input_required, true);
  assert.equal(body.max_per_stream, 7);
  assert.equal(body.max_per_user_per_stream, 2);
  assert.equal(body.global_cooldown_seconds, 45);
  assert.equal(body.is_enabled, false);
  assert.equal(body.should_redemptions_skip_request_queue, true);
  assert.equal(f.remote[0].is_paused, true);
});
test("existing title is never silently claimed", async (t) => {
  const f = fixture(t);
  f.remote.push({ id: "not-ours", title: f.r.title });
  await assert.rejects(f.twitch.publish(f.r.id));
  assert.equal(f.requests.filter((x) => x.method === "POST").length, 0);
});
test("other account and unknown reward events are ignored", async (t) => {
  const f = fixture(t);
  await f.twitch.publish(f.r.id);
  f.twitch.receive({
    account: "another",
    rewardId: "remote-1",
    id: "1",
    status: "unfulfilled",
  });
  f.twitch.receive({
    account: "owner",
    rewardId: "other",
    id: "2",
    status: "unfulfilled",
  });
  assert.equal(f.store.jobs().length, 0);
  f.auth.saved.user.id = "another";
  await assert.rejects(f.twitch.remove(f.r.id));
});
test("pending purchase prevents reward deletion and auto-fulfillment", async (t) => {
  const f = fixture(t);
  await f.twitch.publish(f.r.id);
  f.redemptions.push({ id: "1", status: "UNFULFILLED" });
  await assert.rejects(f.twitch.remove(f.r.id));
  assert.equal(f.requests.filter((x) => x.method === "DELETE").length, 0);
  assert.equal(f.remote[0].is_paused, true);
});
test("poll and EventSub deduplicate and lost completion is reconciled", async (t) => {
  const f = fixture(t);
  await f.twitch.publish(f.r.id);
  f.redemptions.push({ id: "1", status: "UNFULFILLED", user_name: "viewer" });
  f.twitch.receive({
    account: "owner",
    rewardId: "remote-1",
    id: "1",
    status: "unfulfilled",
  });
  await f.twitch.tick();
  assert.equal(f.store.jobs().length, 1);
  const j = f.store.jobs()[0];
  f.engine.start(j, "c");
  f.engine.finish(j.id, true);
  f.losePatch();
  await f.twitch.tick();
  assert.equal(f.store.job(j.id).state, "settling");
  await f.twitch.tick();
  assert.equal(f.store.job(j.id).state, "done");
  assert.equal(
    f.requests.filter(
      (x) => x.method === "PATCH" && x.url.pathname.endsWith("/redemptions"),
    ).length,
    1,
  );
});
test("broken reward does not block settlement of another reward", async (t) => {
  const f = fixture(t);
  await f.twitch.publish(f.r.id);
  const good = f.store.reward(f.r.id);
  f.store.putReward({ ...good, id: "broken-local", remoteId: "broken" });
  f.deny("broken");
  f.redemptions.push({ id: "1", status: "UNFULFILLED" });
  const j = f.engine.enqueue(good, {
    account: "owner",
    id: "1",
    status: "unfulfilled",
  });
  f.engine.start(j, "c");
  f.engine.finish(j.id, false);
  await f.twitch.tick();
  assert.equal(f.store.job(j.id).state, "refunded");
});
