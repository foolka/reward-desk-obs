const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { Store } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");
const {
  initialReward,
  normalizeChat,
  twitchFields,
} = require("../core/model.cjs");
const { ChatCommands } = require("../core/chat-commands.cjs");
const { Twitch } = require("../core/twitch.cjs");
const { TwitchAuth, SCOPES, LOGIN_SCOPES } = require("../core/twitch-auth.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reward-chat-"));
  let store = new Store(dir),
    engine = new Engine(
      store,
      () => {},
      () => 0,
    ),
    now = 100000;
  const auth = new EventEmitter();
  auth.saved = {
    user: { id: "owner", login: "my_channel" },
    clientId: "client",
    token: { scope: LOGIN_SCOPES },
  };
  auth.getProvider = async () => ({});
  auth.validate = async () => {};
  let chat = new ChatCommands({ auth, store, engine, now: () => now });
  chat.ready = true;
  const initial = initialReward("video");
  for (let i = 0; i < 3; i++) {
    store.putMedia({
      id: "media" + i,
      kind: "video",
      ext: ".webm",
      name: "video" + i,
    });
    initial.items.push({ id: "media" + i, weight: 1, volume: 80 });
  }
  store.putReward(initial);
  let reward = chat.saveReward({
    ...initial,
    chat: {
      enabled: true,
      command: "!VIDEO",
      users: "@Alice, BOB\nalice",
      cooldown: 5,
    },
  });
  const event = (id = "message", extra = {}) => ({
    id,
    account: "owner",
    userId: "alice-id",
    login: "alice",
    user: "Alice",
    text: "!video",
    ...extra,
  });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    auth,
    event,
    get store() {
      return store;
    },
    get engine() {
      return engine;
    },
    get chat() {
      return chat;
    },
    get reward() {
      return store.reward(reward.id);
    },
    advance: (seconds) => (now += seconds * 1000),
    restart() {
      store.close();
      store = new Store(dir);
      engine = new Engine(
        store,
        () => {},
        () => 0,
      );
      chat = new ChatCommands({ auth, store, engine, now: () => now });
      chat.ready = true;
    },
  };
}
test("commands normalize logins, require explicit allowlist and remain local", () => {
  const chat = normalizeChat({
    enabled: true,
    command: " !ЗВУК ",
    users: "@Alice BOB,alice;test_user",
    cooldown: 0,
  });
  assert.equal(chat.command, "!звук");
  assert.deepEqual(chat.users, ["alice", "bob", "test_user"]);
  for (const patch of [
    { command: "video" },
    { command: "!video test" },
    { users: "" },
    { users: "https://twitch.tv/alice" },
    { users: "all,*" },
    { cooldown: -1 },
  ])
    assert.throws(() => normalizeChat({ ...chat, ...patch }));
  assert.equal("chat" in twitchFields({ ...initialReward(), chat }), false);
});
test("authorized exact commands enqueue free jobs using the same weighted cycle as redemptions", (t) => {
  const f = fixture(t);
  f.store.putReward({
    ...f.reward,
    remoteId: "remote",
    account: "owner",
    clientId: "client",
    enabled: false,
    paused: true,
  });
  const first = f.chat.receive(f.event("one", { text: "  !VIDEO  " }));
  assert.equal(first.source, "chat");
  assert.equal(first.refundable, false);
  assert.equal(first.redemptionId, "");
  assert.equal(first.user, "Alice");
  assert.equal(first.command, "!video");
  const paid = f.engine.enqueue(f.reward, {
    id: "paid",
    account: "owner",
    status: "unfulfilled",
  });
  f.advance(5);
  const next = f.chat.receive(f.event("two", { login: "BOB" }));
  assert.equal(new Set([first.item.id, paid.item.id, next.item.id]).size, 3);
  f.engine.start(first, "obs");
  f.engine.finish(first.id, true);
  assert.equal(f.store.job(first.id).state, "done");
  assert.equal(f.store.jobs().filter((j) => j.state === "settling").length, 0);
});
test("foreign users, display-name spoofing, shared chat, reward messages and partial commands are rejected", (t) => {
  const f = fixture(t);
  const cases = [
    { login: "stranger", user: "Alice" },
    { account: "other" },
    { sourceAccount: "other" },
    { isRedemption: true },
    { text: "!video extra" },
    { text: "hello !video" },
    { userId: "" },
  ];
  cases.forEach((extra, i) =>
    assert.equal(f.chat.receive(f.event("bad" + i, extra)), undefined),
  );
  assert.equal(f.store.jobs().length, 0);
  f.auth.saved.token.scope = SCOPES;
  assert.equal(f.chat.receive(f.event("scope")), undefined);
  f.auth.saved.token.scope = LOGIN_SCOPES;
  f.chat.ready = false;
  assert.equal(f.chat.receive(f.event("offline")), undefined);
});
test("cooldown is shared and persistent; duplicate messages never consume another draw", (t) => {
  const f = fixture(t),
    first = f.chat.receive(f.event("one"));
  assert.deepEqual(f.chat.receive(f.event("one")), first);
  assert.equal(f.chat.receive(f.event("during", { login: "bob" })), undefined);
  f.restart();
  f.advance(6);
  assert.equal(
    f.chat.receive(f.event("during")),
    undefined,
    "late redelivery of rejected message stays rejected",
  );
  assert.equal(f.chat.receive(f.event("one")).id, first.id);
  const next = f.chat.receive(f.event("two"));
  assert.notEqual(first.item.id, next.item.id);
  assert.equal(f.store.jobs().length, 2);
});
test("commands bind to account and client; duplicate commands and invalid saves do not overwrite data", (t) => {
  const f = fixture(t),
    old = f.reward;
  assert.throws(() =>
    f.chat.saveReward({ ...old, chat: { ...old.chat, users: [] } }),
  );
  assert.deepEqual(f.reward, old);
  const other = initialReward();
  f.store.putReward(other);
  assert.throws(
    () => f.chat.saveReward({ ...other, chat: old.chat }),
    /уже используется/,
  );
  f.auth.saved.user.id = "other";
  assert.equal(
    f.chat.receive(f.event("foreign", { account: "other" })),
    undefined,
  );
  assert.throws(() => f.chat.saveReward(old), /другому аккаунту/);
  f.auth.saved.user.id = "owner";
  f.auth.saved.clientId = "other-client";
  assert.throws(() => f.chat.saveReward(old), /Client ID/);
  assert.deepEqual(f.reward, old);
});
test("disabling a command keeps its settings; disabled and empty-list commands fail closed", (t) => {
  const f = fixture(t);
  f.chat.saveReward({
    ...f.reward,
    chat: { ...f.reward.chat, enabled: false },
  });
  assert.equal(f.chat.receive(f.event()), undefined);
  assert.deepEqual(f.reward.chat.users, ["alice", "bob"]);
  f.store.putReward({
    ...f.reward,
    chat: { ...f.reward.chat, enabled: true, users: [] },
  });
  assert.equal(f.chat.receive(f.event("empty")), undefined);
});
test("legacy auth remains valid; new device login requests chat read permission, never chat write", async () => {
  let requested;
  const auth = new TwitchAuth({
    save() {},
    sdk: async () => ({
      startDeviceCodeFlow: async (_id, scopes) => {
        requested = scopes;
        return {
          deviceCode: "device",
          userCode: "code",
          verificationUri: "https://www.twitch.tv/activate",
          expiresIn: 300,
          interval: 5,
        };
      },
    }),
  });
  try {
    await auth.start("a".repeat(30));
    assert.deepEqual(requested, LOGIN_SCOPES);
    assert.deepEqual(SCOPES, ["channel:manage:redemptions"]);
    assert.equal(requested.includes("user:write:chat"), false);
  } finally {
    auth.dispose();
  }
});
test("EventSub receives chat using the existing listener; chat failures do not stop paid rewards", async (t) => {
  const f = fixture(t);
  let listener;
  class Listener {
    constructor() {
      listener = this;
      this.events = {};
      this.subs = [];
    }
    onChannelChatMessage(account, user, cb) {
      assert.equal(account, "owner");
      assert.equal(user, "owner");
      this.chat = cb;
      return this.add();
    }
    onChannelRedemptionAdd(_account, cb) {
      this.paid = cb;
      return this.add();
    }
    onChannelRedemptionUpdate() {
      return this.add();
    }
    add() {
      const sub = { verified: true, start() {} };
      this.subs.push(sub);
      return sub;
    }
    onSubscriptionCreateSuccess(cb) {
      this.events.success = cb;
    }
    onSubscriptionCreateFailure(cb) {
      this.events.failure = cb;
    }
    onUserSocketDisconnect(cb) {
      this.events.disconnect = cb;
    }
    onUserSocketConnect(cb) {
      this.events.connect = cb;
    }
    onRevoke(cb) {
      this.events.revoke = cb;
    }
    start() {
      this.subs.forEach((sub) => this.events.success(sub));
    }
    stop() {
      this.stopped = true;
    }
  }
  const twitch = new Twitch({
    auth: f.auth,
    store: f.store,
    engine: f.engine,
    sdk: async () => ({ EventSubWsListener: Listener, ApiClient: class {} }),
  });
  twitch.tick = async () => {};
  try {
    await twitch.connect();
    assert.equal(twitch.chat.ready, true);
    const { EventSubChannelChatMessageEvent } = await import(
      "@twurple/eventsub-base"
    );
    const event = new EventSubChannelChatMessageEvent({
      broadcaster_user_id: "owner",
      chatter_user_id: "alice-id",
      chatter_user_login: "alice",
      chatter_user_name: "Alice",
      message_id: "msg",
      message: { text: "!video", fragments: [] },
      channel_points_custom_reward_id: null,
      source_broadcaster_user_id: null,
    });
    listener.chat(event);
    assert.equal(f.store.jobs().at(-1).source, "chat");
    listener.events.failure(twitch.chatSub, { statusCode: 403 });
    assert.equal(twitch.chat.ready, false);
    assert.ok(!listener.stopped);
    assert.match(twitch.chat.status, /Войдите/);
    const stale = listener.chat;
    twitch.stop();
    stale(event);
    assert.equal(f.store.jobs().length, 1);
    f.auth.saved.token.scope = SCOPES;
    await twitch.connect();
    assert.equal(listener.chat, undefined);
    assert.equal(twitch.chat.view().reauthRequired, true);
    assert.equal(
      listener.subs.length,
      2,
      "reward-only login still subscribes to redemptions",
    );
  } finally {
    twitch.close();
  }
});
