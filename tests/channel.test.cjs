const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Twitch } = require("../core/twitch.cjs");
const { ChannelRewards } = require("../core/channel-rewards.cjs");
const {
  initialReward,
  fromTwitch,
  twitchFields,
} = require("../core/model.cjs");
function responseReward(id, settings = initialReward()) {
  return {
    id,
    ...twitchFields(settings),
    max_per_stream_setting: {
      is_enabled: !!settings.streamLimit,
      max_per_stream: settings.streamLimit,
    },
    max_per_user_per_stream_setting: {
      is_enabled: !!settings.userLimit,
      max_per_user_per_stream: settings.userLimit,
    },
    global_cooldown_setting: {
      is_enabled: !!settings.cooldown,
      global_cooldown_seconds: settings.cooldown,
    },
    is_in_stock: true,
    redemptions_redeemed_current_stream: 2,
  };
}
function fixture(t) {
  const auth = new EventEmitter();
  auth.saved = { user: { id: "owner" }, clientId: "client" };
  auth.getProvider = async () => ({
    getAccessTokenForUser: async () => ({ accessToken: "test" }),
  });
  const local = {
    ...initialReward(),
    id: "local",
    remoteId: "ours",
    account: "owner",
    clientId: "client",
    sync: "synced",
    allowRepeats: true,
    items: [{ id: "audio", volume: 37, weight: 9 }],
  };
  const records = [local];
  const remotes = [
    responseReward("ours", local),
    responseReward("foreign", {
      ...initialReward(),
      title: "Старая награда",
      background: "#ab1234",
      cost: 456,
    }),
  ];
  const requests = [],
    logs = [];
  const store = {
    rewards: () => records,
    reward: (id) => records.find((r) => r.id === id),
    putReward: (r) =>
      records.splice(
        records.findIndex((x) => x.id === r.id),
        1,
        r,
      ),
    log: (l) => logs.push(l),
  };
  let failPatch = false,
    losePatch = false,
    hook = () => {};
  const twitch = new Twitch({
    auth,
    store,
    engine: {},
    fetchImpl: async (url, options) => {
      const u = new URL(url),
        body = options.body && JSON.parse(options.body);
      requests.push({ method: options.method, url: u, body });
      hook(options.method);
      if (options.method === "PATCH") {
        if (failPatch) return new Response("{}", { status: 403 });
        const i = remotes.findIndex((r) => r.id === u.searchParams.get("id"));
        const flat = { ...twitchFields(fromTwitch(remotes[i])), ...body };
        remotes[i] = responseReward(remotes[i].id, {
          ...fromTwitch(remotes[i]),
          title: flat.title,
          prompt: flat.prompt,
          cost: flat.cost,
          background: flat.background_color,
          enabled: flat.is_enabled,
          paused: flat.is_paused,
          input: flat.is_user_input_required,
          skipQueue: flat.should_redemptions_skip_request_queue,
          streamLimit: flat.is_max_per_stream_enabled ? flat.max_per_stream : 0,
          userLimit: flat.is_max_per_user_per_stream_enabled
            ? flat.max_per_user_per_stream
            : 0,
          cooldown: flat.is_global_cooldown_enabled
            ? flat.global_cooldown_seconds
            : 0,
        });
        if (losePatch) throw Error("Lost PATCH response");
        return Response.json({ data: [remotes[i]] });
      }
      return Response.json({
        data:
          u.searchParams.get("only_manageable_rewards") === "true"
            ? remotes.filter((r) => r.id === "ours")
            : remotes,
      });
    },
  });
  t.after(() => twitch.close());
  const channel = new ChannelRewards(twitch);
  return {
    auth,
    records,
    remotes,
    requests,
    logs,
    channel,
    fail: () => (failPatch = true),
    lose: () => (losePatch = true),
    hook: (fn) => (hook = fn),
  };
}
const edit = (catalog, id, patch) => ({
  account: catalog.account,
  clientId: catalog.clientId,
  id,
  baseline: catalog.items.find((r) => r.id === id).settings,
  settings: { ...catalog.items.find((r) => r.id === id).settings, ...patch },
});
test("channel list includes foreign rewards but only API-approved IDs are editable", async (t) => {
  const f = fixture(t),
    c = await f.channel.list();
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].manageable, true);
  assert.equal(c.items[1].manageable, false);
  assert.equal(c.items[1].settings.background, "#ab1234");
  assert.equal(c.items[1].settings.cost, 456);
  assert.equal(f.records[0].allowRepeats, true);
  assert.equal(
    f.requests[0].url.searchParams.get("only_manageable_rewards"),
    "false",
  );
});
test("channel edits preserve media, IDs and other rewards and sync local settings", async (t) => {
  const f = fixture(t),
    c = await f.channel.list(),
    before = structuredClone(f.records[0]),
    foreign = structuredClone(f.remotes[1]);
  const result = await f.channel.save(
    edit(c, "ours", {
      cost: 450,
      background: "#ff6600",
      title: "Новое",
      prompt: "Текст",
      streamLimit: 5,
      userLimit: 2,
      cooldown: 60,
      enabled: false,
      paused: true,
      input: true,
      skipQueue: true,
    }),
  );
  const r = f.records[0];
  assert.equal(r.allowRepeats, true);
  assert.equal(r.cost, 450);
  assert.equal(r.background, "#ff6600");
  assert.deepEqual(r.items, before.items);
  assert.deepEqual(r.video, before.video);
  assert.equal(r.id, before.id);
  assert.equal(r.remoteId, before.remoteId);
  assert.deepEqual(f.remotes[1], foreign);
  assert.equal(result.items[0].settings.userLimit, 2);
  const body = f.requests.find((r) => r.method === "PATCH").body;
  assert.equal(body.is_paused, true);
  assert.equal(body.is_max_per_user_per_stream_enabled, true);
  assert.equal(body.should_redemptions_skip_request_queue, true);
  assert.equal(f.logs.length, 1);
});
test("price-only edit sends only price, including for manageable reward without local media", async (t) => {
  const f = fixture(t);
  f.records.length = 0;
  const c = await f.channel.list();
  await f.channel.save(edit(c, "ours", { cost: 600 }));
  assert.deepEqual(f.requests.find((r) => r.method === "PATCH").body, {
    cost: 600,
  });
  assert.equal(f.records.length, 0);
});
test("foreign edit is rejected even when renderer claims it is manageable", async (t) => {
  const f = fixture(t),
    c = await f.channel.list();
  await assert.rejects(
    f.channel.save({ ...edit(c, "foreign", { cost: 1 }), manageable: true }),
    /создавшему/,
  );
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 0);
});
test("external change or deletion is never overwritten by stale editor", async (t) => {
  const f = fixture(t),
    c = await f.channel.list();
  f.remotes[0].cost = 700;
  await assert.rejects(
    f.channel.save(edit(c, "ours", { cost: 500 })),
    /уже изменены/,
  );
  f.remotes.shift();
  await assert.rejects(
    f.channel.save(edit(c, "ours", { cost: 500 })),
    /больше нет/,
  );
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 0);
});
test("account and client changes reject stale writes and lists", async (t) => {
  const f = fixture(t),
    c = await f.channel.list();
  f.auth.saved.clientId = "new";
  await assert.rejects(
    f.channel.save(edit(c, "ours", { cost: 500 })),
    /Аккаунт/,
  );
  f.hook(() => (f.auth.saved.user.id = "another"));
  await assert.rejects(f.channel.list(), /Аккаунт/);
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 0);
});
test("failed update and pending local edit preserve the local record", async (t) => {
  const f = fixture(t),
    c = await f.channel.list(),
    before = structuredClone(f.records[0]);
  f.fail();
  await assert.rejects(
    f.channel.save(edit(c, "ours", { cost: 500 })),
    /отказал/,
  );
  assert.deepEqual(f.records[0], before);
  f.records[0].sync = "pending";
  await assert.rejects(
    f.channel.save(edit(c, "ours", { cost: 500 })),
    /неотправленные/,
  );
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 1);
});
test("invalid settings never reach Twitch, unchanged settings do not PATCH", async (t) => {
  const f = fixture(t),
    c = await f.channel.list();
  for (const patch of [
    { cost: 0 },
    { cost: 1.5 },
    { background: "red" },
    { userLimit: -1 },
    { cooldown: 604801 },
    { enabled: "true" },
  ])
    await assert.rejects(f.channel.save(edit(c, "ours", patch)));
  await f.channel.save(edit(c, "ours", {}));
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 0);
});
test("disabling limits sends flags without placeholder values", async (t) => {
  const f = fixture(t);
  f.remotes[0] = responseReward("ours", {
    ...initialReward(),
    streamLimit: 5,
    userLimit: 3,
    cooldown: 60,
  });
  const c = await f.channel.list();
  await f.channel.save(
    edit(c, "ours", { streamLimit: 0, userLimit: 0, cooldown: 0 }),
  );
  const body = f.requests.find((r) => r.method === "PATCH").body;
  assert.equal(body.is_max_per_stream_enabled, false);
  assert.equal(body.max_per_stream, undefined);
  assert.equal(body.max_per_user_per_stream, undefined);
  assert.equal(body.is_global_cooldown_enabled, false);
  assert.equal(body.global_cooldown_seconds, undefined);
});
test("refresh recovers a lost PATCH response without resending or losing media", async (t) => {
  const f = fixture(t),
    c = await f.channel.list(),
    items = structuredClone(f.records[0].items);
  f.lose();
  await assert.rejects(f.channel.save(edit(c, "ours", { cost: 876 })), /Lost/);
  assert.equal(f.records[0].cost, 100);
  await f.channel.list();
  assert.equal(f.records[0].cost, 876);
  assert.deepEqual(f.records[0].items, items);
  assert.equal(f.requests.filter((r) => r.method === "PATCH").length, 1);
});
test("refresh does not overwrite pending local edits or another account", async (t) => {
  const f = fixture(t);
  f.remotes[0].cost = 900;
  f.records[0].sync = "pending";
  await f.channel.list();
  assert.equal(f.records[0].cost, 100);
  f.records[0].sync = "synced";
  f.records[0].account = "another";
  await f.channel.list();
  assert.equal(f.records[0].cost, 100);
});
