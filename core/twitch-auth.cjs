const { EventEmitter } = require("node:events");
const SCOPES = ["channel:manage:redemptions"];
const LOGIN_SCOPES = [...SCOPES, "user:read:chat"];
let sdkPromise;
function loadSdk() {
  return (sdkPromise ||= Promise.all([
    import("@twurple/auth"),
    import("@twurple/api"),
    import("@twurple/eventsub-ws"),
  ]).then((parts) => Object.assign({}, ...parts)));
}
function clientId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9]{20,64}$/i.test(id))
    throw Error("Вставьте Client ID приложения Twitch. Не Client Secret.");
  return id;
}
function errorCode(error) {
  let body = error?.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
  } catch {}
  return body?.message || body?.error || error?.message || "";
}
function invalidAccess(error) {
  return error?.name === "InvalidTokenError" || error?.statusCode === 401;
}
function rejectedRefresh(error) {
  const code = errorCode(error),
    status = error?.statusCode;
  return (
    error?.name === "MissingScopeError" ||
    ([400, 401].includes(status) &&
      /invalid[ _]refresh[ _]token|invalid[ _]grant|refresh[ _]token.*(?:invalid|revoked|expired)/i.test(
        code,
      ))
  );
}
function safeError(error) {
  if (error?.publicMessage) return error.publicMessage;
  const code = errorCode(error);
  if (/denied|declined/i.test(code))
    return "Доступ не разрешён. Можно повторить вход.";
  if (/client|device code/i.test(code))
    return "Проверьте Client ID и тип Public в Twitch Developer Console.";
  if (rejectedRefresh(error))
    return "Нужно заново войти через Twitch и разрешить доступ.";
  return "Нет соединения с Twitch. Повторяем автоматически; вход сохранён.";
}
function publicError(message) {
  return Object.assign(Error(message), { publicMessage: message });
}
function verificationUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://www.twitch.tv" || url.pathname !== "/activate")
    throw publicError("Twitch вернул неизвестный адрес входа.");
  return url.href;
}
class TwitchAuth extends EventEmitter {
  constructor({
    saved = null,
    save,
    pending = null,
    savePending = () => {},
    sdk = loadSdk,
    now = Date.now,
  }) {
    super();
    this.saved = saved;
    this.save = save;
    this.savePending = savePending;
    this.sdk = sdk;
    this.now = now;
    this.serial = 0;
    this.authGeneration = 0;
    this.pending = null;
    this.message = "";
    this.invalid = false;
    this.health = saved ? "restoring" : "signed_out";
    if (!saved && pending) {
      try {
        if (
          typeof pending.deviceCode !== "string" ||
          !pending.deviceCode ||
          typeof pending.userCode !== "string" ||
          !Number.isSafeInteger(pending.expiresAt) ||
          pending.expiresAt <= now() ||
          pending.expiresAt > now() + 86400000
        )
          throw Error("Expired pending login");
        this.pending = {
          ...pending,
          clientId: clientId(pending.clientId),
          url: verificationUrl(pending.url),
          interval: Math.max(
            5000,
            Math.min(60000, Number(pending.interval) || 5000),
          ),
        };
        this.message = "Продолжаем сохранённый вход Twitch";
      } catch {
        try {
          savePending(null);
        } catch {}
        this.message = "Незавершённый вход истёк. Войдите через Twitch.";
      }
    }
  }
  view() {
    return {
      user: this.saved?.user || null,
      reauthRequired: this.invalid,
      status: this.pending ? "authorizing" : this.health,
      pending: this.pending
        ? {
            code: this.pending.userCode,
            url: this.pending.url,
            expiresAt: this.pending.expiresAt,
          }
        : null,
      message: this.message,
    };
  }
  persist(value) {
    try {
      this.save(value);
    } catch {
      throw publicError(
        "Не удалось сохранить вход в защищённом хранилище Windows. Проверьте доступ к папке данных; повторяем автоматически.",
      );
    }
  }
  invalidate(message) {
    if (this.invalid) return;
    this.invalid = true;
    this.health = "reauth_required";
    this.message = message;
    this.authGeneration++;
    this.provider = null;
    this.loading = null;
    this.emit("expired");
    this.emit("change");
  }
  temporaryFailure(error, generation) {
    if (generation !== this.authGeneration || this.invalid) return;
    this.authGeneration++;
    this.provider = null;
    this.loading = null;
    this.validatedAt = 0;
    this.health = "retrying";
    this.message = error?.publicMessage || safeError(error);
    this.emit("retry", this.message);
    this.emit("change");
  }
  handleFailure(error, generation) {
    if (generation !== this.authGeneration || this.invalid) return;
    if (rejectedRefresh(error))
      this.invalidate(
        "Twitch отклонил сохранённый вход. Войдите через Twitch снова.",
      );
    else this.temporaryFailure(error, generation);
  }
  cancel() {
    this.serial++;
    clearTimeout(this.timer);
    this.pending = null;
    try {
      this.savePending(null);
    } catch {}
    this.emit("change");
  }
  resume() {
    if (this.pending) {
      const generation = this.serial;
      this.timer = setTimeout(() => void this.poll(generation), 0);
      this.timer.unref?.();
    }
  }
  async start(id) {
    this.cancel();
    const generation = this.serial;
    id = clientId(id);
    this.message = "Получаем код Twitch";
    this.emit("change");
    const sdk = await this.sdk();
    const info = await sdk.startDeviceCodeFlow(id, LOGIN_SCOPES);
    if (generation !== this.serial) return;
    const pending = {
      ...info,
      clientId: id,
      url: verificationUrl(info.verificationUri),
      expiresAt: this.now() + info.expiresIn * 1000,
      interval: Math.max(5, info.interval || 5) * 1000,
      scopes: LOGIN_SCOPES,
    };
    try {
      this.savePending(pending);
    } catch {
      throw publicError(
        "Не удалось сохранить незавершённый вход. Проверьте защищённое хранилище Windows.",
      );
    }
    this.pending = pending;
    this.message = "Разрешите доступ в браузере";
    this.emit("change");
    this.schedule(generation);
    return this.view();
  }
  schedule(generation) {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.poll(generation),
      this.pending.interval,
    );
    this.timer.unref?.();
  }
  async poll(generation = this.serial) {
    if (generation !== this.serial || !this.pending) return;
    const pending = this.pending;
    if (this.now() >= pending.expiresAt) {
      this.cancel();
      this.message = "Код истёк. Нажмите «Войти через Twitch» ещё раз.";
      this.emit("change");
      return;
    }
    try {
      const sdk = await this.sdk();
      const token = await sdk.exchangeDeviceCode(
        pending.clientId,
        pending.deviceCode,
        pending.scopes || SCOPES,
      );
      if (generation !== this.serial) return;
      const info = await sdk.getTokenInfo(token.accessToken, pending.clientId);
      if (generation !== this.serial) return;
      if (
        info.clientId !== pending.clientId ||
        !info.userId ||
        (pending.scopes || SCOPES).some((scope) => !info.scopes.includes(scope))
      )
        throw publicError("Разрешены не все нужные права. Повторите вход.");
      const saved = {
        clientId: pending.clientId,
        user: { id: info.userId, login: info.userName },
        token: { ...token, scope: info.scopes },
      };
      this.persist(saved);
      this.authGeneration++;
      this.loading = null;
      this.invalid = false;
      this.saved = saved;
      this.provider = null;
      this.health = "ready";
      this.pending = null;
      clearTimeout(this.timer);
      this.message = "Вход выполнен";
      this.emit("change");
      this.emit("authorized");
      try {
        this.savePending(null);
      } catch {}
    } catch (error) {
      if (generation !== this.serial) return;
      const code = errorCode(error);
      if (/authorization_pending/i.test(code)) {
        this.schedule(generation);
        return;
      }
      if (/slow_down/i.test(code)) {
        pending.interval += 5000;
        this.schedule(generation);
        return;
      }
      if (!error.statusCode && !error.publicMessage) {
        this.message = "Нет ответа Twitch. Повторяем подключение";
        this.emit("change");
        this.schedule(generation);
        return;
      }
      this.pending = null;
      try {
        this.savePending(null);
      } catch {}
      this.message = safeError(error);
      this.emit("change");
    }
  }
  async getProvider() {
    if (this.invalid) throw publicError(this.message);
    if (!this.saved) throw publicError("Войдите через Twitch.");
    if (this.provider) return this.provider;
    if (this.loading) return this.loading;
    const generation = this.authGeneration,
      saved = this.saved;
    const loading = (async () => {
      // Persist the latest in-memory token before any further rotation.
      this.persist(saved);
      if (!saved.token?.refreshToken) {
        this.invalidate(
          "Сохранённый вход неполный. Войдите через Twitch снова.",
        );
        throw publicError(this.message);
      }
      const sdk = await this.sdk();
      const provider = new sdk.RefreshingAuthProvider({
        clientId: saved.clientId,
      });
      const refresh = provider.refreshAccessTokenForUser.bind(provider);
      let refreshing;
      provider.refreshAccessTokenForUser = (...args) => {
        if (!refreshing)
          refreshing = Promise.resolve()
            .then(() => refresh(...args))
            .finally(() => {
              refreshing = null;
            });
        return refreshing;
      };
      provider.onRefresh((id, token) => {
        if (generation !== this.authGeneration || this.saved?.user.id !== id)
          return;
        const next = { ...this.saved, token };
        this.saved = next;
        try {
          this.persist(next);
        } catch (error) {
          this.temporaryFailure(error, generation);
        }
      });
      provider.onRefreshFailure((_id, error) =>
        this.handleFailure(error, generation),
      );
      // addUserForToken validates after rotating, before emitting onRefresh.
      // With a known user ID, addUser lets us save the rotation first.
      provider.addUser(saved.user.id, saved.token, ["chat", "default"]);
      await this.checkToken(provider, generation, sdk);
      if (generation !== this.authGeneration)
        throw publicError("Настройка подключения изменена.");
      this.provider = provider;
      return provider;
    })()
      .catch((error) => {
        this.handleFailure(error, generation);
        throw publicError(this.message || safeError(error));
      })
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });
    this.loading = loading;
    return loading;
  }
  async checkToken(provider, generation, sdk) {
    const user = this.saved.user.id,
      client = this.saved.clientId;
    let token = await provider.getAccessTokenForUser(user, SCOPES),
      info;
    if (!token?.accessToken) {
      this.invalidate("Сохранённый вход неполный. Войдите через Twitch снова.");
      throw publicError(this.message);
    }
    try {
      info = await sdk.getTokenInfo(token.accessToken, client);
    } catch (error) {
      if (!invalidAccess(error)) throw error;
      token = await provider.refreshAccessTokenForUser(user);
      if (generation !== this.authGeneration) throw publicError(this.message);
      try {
        info = await sdk.getTokenInfo(token.accessToken, client);
      } catch (next) {
        if (invalidAccess(next))
          this.invalidate(
            "Twitch отклонил обновлённый вход. Войдите через Twitch снова.",
          );
        throw next;
      }
    }
    if (generation !== this.authGeneration)
      throw publicError("Подключение изменено.");
    if (
      info.userId !== user ||
      info.clientId !== client ||
      SCOPES.some((s) => !info.scopes.includes(s))
    ) {
      this.invalidate("Права Twitch изменились. Войдите снова.");
      throw publicError(this.message);
    }
    this.validatedAt = this.now();
    // Keep optional permissions current without invalidating legacy reward-only logins.
    if (
      JSON.stringify(this.saved.token.scope) !== JSON.stringify(info.scopes)
    ) {
      this.saved = {
        ...this.saved,
        token: { ...this.saved.token, scope: info.scopes },
      };
      this.persist(this.saved);
    }
    this.health = "ready";
    this.message = "";
    this.emit("change");
  }
  async validate() {
    const provider = await this.getProvider();
    if (this.now() - (this.validatedAt || 0) < 55 * 60000) return;
    if (this.validating?.generation === this.authGeneration)
      return this.validating.promise;
    const generation = this.authGeneration;
    const promise = this.sdk()
      .then((sdk) => this.checkToken(provider, generation, sdk))
      .catch((error) => {
        this.handleFailure(error, generation);
        throw publicError(this.message || safeError(error));
      });
    this.validating = { generation, promise };
    try {
      await promise;
    } finally {
      if (this.validating?.promise === promise) this.validating = null;
    }
  }
  logout() {
    this.cancel();
    this.authGeneration++;
    this.loading = null;
    this.provider = null;
    this.invalid = false;
    this.health = "signed_out";
    this.saved = null;
    this.persist(null);
    this.message = "Вы вышли из аккаунта";
    this.emit("change");
  }
  dispose() {
    this.serial++;
    clearTimeout(this.timer);
    this.authGeneration++;
    this.removeAllListeners();
  }
}
module.exports = {
  TwitchAuth,
  SCOPES,
  LOGIN_SCOPES,
  clientId,
  loadSdk,
  errorCode,
  safeError,
  publicError,
  verificationUrl,
  rejectedRefresh,
  invalidAccess,
};
