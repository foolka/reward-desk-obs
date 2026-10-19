const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TwitchAuth, SCOPES } = require("../core/twitch-auth.cjs");
const CLIENT = "a".repeat(30),
  USER = "100";
const token = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  scope: SCOPES,
};
const fresh = {
  ...token,
  accessToken: "fresh-access",
  refreshToken: "fresh-refresh",
};
const info = { userId: USER, clientId: CLIENT, scopes: SCOPES };
const invalid = () =>
  Object.assign(Error("Invalid token"), { name: "InvalidTokenError" });
const rejection = () => ({
  statusCode: 400,
  body: { message: "Invalid refresh token" },
});

function fixture(t) {
  const f = {
    providers: [],
    writes: [],
    refreshes: 0,
    validations: 0,
    expired: 0,
    retries: 0,
    now: 1800000000000,
    refreshError: null,
    validateError: null,
  };
  class Provider {
    constructor() {
      f.providers.push(this);
    }
    onRefresh(cb) {
      this.onRotated = cb;
    }
    onRefreshFailure(cb) {
      this.onFailed = cb;
    }
    addUser(user, value) {
      assert.equal(user, USER);
      this.token = value;
    }
    async getAccessTokenForUser() {
      if (this.poisoned) throw Error("cached refresh failure");
      return this.token;
    }
    async refreshAccessTokenForUser() {
      f.refreshes++;
      await f.refreshWait;
      if (f.refreshError) {
        this.poisoned = true;
        this.onFailed(USER, f.refreshError);
        throw f.refreshError;
      }
      this.token = fresh;
      this.onRotated(USER, fresh);
      return fresh;
    }
  }
  f.sdk = {
    RefreshingAuthProvider: Provider,
    getTokenInfo: async (value) => {
      f.validations++;
      if (f.validate) return f.validate(value);
      if (f.validateError) throw f.validateError;
      return info;
    },
  };
  f.auth = new TwitchAuth({
    saved: { clientId: CLIENT, user: { id: USER, login: "owner" }, token },
    save: (value) => {
      if (f.writeError) throw f.writeError;
      f.writes.push(structuredClone(value));
    },
    sdk: async () => f.sdk,
    now: () => f.now,
  });
  f.auth.on("expired", () => f.expired++);
  f.auth.on("retry", () => f.retries++);
  t.after(() => f.auth.dispose());
  return f;
}

test("saved identity is restoring, not proof of valid authorization", async (t) => {
  const f = fixture(t);
  assert.equal(f.auth.view().status, "restoring");
  assert.equal(f.auth.view().reauthRequired, false);
  await f.auth.getProvider();
  assert.equal(f.auth.view().status, "ready");
  assert.equal(f.refreshes, 0);
});
test("network, 429 and 5xx validation failures keep credentials and recover without refresh or login", async (t) => {
  for (const error of [
    Error("offline"),
    { statusCode: 429 },
    { statusCode: 500 },
    { statusCode: 503 },
  ]) {
    const f = fixture(t);
    f.validateError = error;
    await assert.rejects(f.auth.getProvider());
    assert.equal(f.expired, 0);
    assert.equal(f.auth.view().status, "retrying");
    assert.equal(f.refreshes, 0);
    f.validateError = null;
    await f.auth.getProvider();
    assert.equal(f.auth.view().status, "ready");
    assert.equal(f.auth.saved.token.refreshToken, "old-refresh");
  }
});
test("invalid access token refreshes once and saves the new token before validating it", async (t) => {
  const f = fixture(t);
  f.validate = (value) => {
    if (value === "old-access") throw invalid();
    assert.equal(f.writes.at(-1).token.refreshToken, "fresh-refresh");
    return info;
  };
  await f.auth.getProvider();
  assert.equal(f.refreshes, 1);
  assert.equal(f.auth.view().status, "ready");
  assert.equal(f.expired, 0);
});
test("network loss after rotation does not lose the single-use refresh token", async (t) => {
  const f = fixture(t);
  let fail = true;
  f.validate = (value) => {
    if (value === "old-access") throw invalid();
    if (fail) throw Error("network lost after rotation");
    return info;
  };
  await assert.rejects(f.auth.getProvider());
  assert.equal(f.writes.at(-1).token.refreshToken, "fresh-refresh");
  assert.equal(f.expired, 0);
  fail = false;
  await f.auth.getProvider();
  assert.equal(f.refreshes, 1);
  assert.equal(f.auth.view().status, "ready");
});
test("temporary refresh failure replaces SDK cached failure and retries from saved credentials", async (t) => {
  const f = fixture(t);
  f.validate = (value) => {
    if (value === "old-access") throw invalid();
    return info;
  };
  f.refreshError = { statusCode: 503 };
  await assert.rejects(f.auth.getProvider());
  const poisoned = f.providers[0];
  assert.equal(f.expired, 0);
  assert.equal(f.retries, 1);
  f.refreshError = null;
  await f.auth.getProvider();
  assert.notEqual(f.auth.provider, poisoned);
  assert.equal(f.auth.view().status, "ready");
  assert.equal(f.refreshes, 2);
  poisoned.onFailed(USER, rejection());
  assert.equal(f.expired, 0);
});
test("only an explicit rejected refresh token asks for reauthorization, once", async (t) => {
  const f = fixture(t);
  f.validate = () => {
    throw invalid();
  };
  f.refreshError = rejection();
  await assert.rejects(f.auth.getProvider());
  assert.equal(f.expired, 1);
  assert.equal(f.auth.view().reauthRequired, true);
  assert.equal(f.auth.view().user.login, "owner");
  await assert.rejects(f.auth.getProvider());
  assert.equal(f.refreshes, 1);
  f.auth.invalidate("same");
  assert.equal(f.expired, 1);
});
test("a refreshed access token still rejected by Twitch requires login", async (t) => {
  const f = fixture(t);
  f.validate = () => {
    throw invalid();
  };
  await assert.rejects(f.auth.getProvider());
  assert.equal(f.expired, 1);
  assert.equal(f.refreshes, 1);
});
test("confirmed account or scope changes require login", async (t) => {
  for (const changed of [
    { ...info, scopes: [] },
    { ...info, userId: "other" },
    { ...info, clientId: "other" },
  ]) {
    const f = fixture(t);
    f.validate = () => changed;
    await assert.rejects(f.auth.getProvider());
    assert.equal(f.expired, 1);
  }
});
test("simultaneous startup and manual refresh requests do not consume a token twice", async (t) => {
  const f = fixture(t);
  const [a, b] = await Promise.all([
    f.auth.getProvider(),
    f.auth.getProvider(),
  ]);
  assert.equal(a, b);
  assert.equal(f.providers.length, 1);
  let finish;
  f.refreshWait = new Promise((resolve) => (finish = resolve));
  const one = a.refreshAccessTokenForUser(USER),
    two = a.refreshAccessTokenForUser(USER);
  await new Promise(setImmediate);
  assert.equal(f.refreshes, 1);
  finish();
  assert.deepEqual(await Promise.all([one, two]), [fresh, fresh]);
});
test("temporary hourly validation failure never rotates a still-valid token", async (t) => {
  const f = fixture(t);
  await f.auth.getProvider();
  f.now += 56 * 60000;
  f.validateError = Error("offline");
  await assert.rejects(f.auth.validate());
  assert.equal(f.expired, 0);
  assert.equal(f.refreshes, 0);
  f.validateError = null;
  await f.auth.validate();
  assert.equal(f.auth.view().status, "ready");
});
test("disk error preserves newly rotated token in memory and does not request login", async (t) => {
  const f = fixture(t);
  const provider = await f.auth.getProvider();
  f.writeError = Error("disk full");
  await provider.refreshAccessTokenForUser(USER);
  assert.equal(f.auth.saved.token.refreshToken, "fresh-refresh");
  assert.equal(f.expired, 0);
  await assert.rejects(f.auth.getProvider());
  assert.equal(f.refreshes, 1);
  f.writeError = null;
  await f.auth.getProvider();
  assert.equal(f.writes.at(-1).token.refreshToken, "fresh-refresh");
  assert.equal(f.auth.view().status, "ready");
});
