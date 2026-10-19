const { loadSdk } = require("./twitch-auth.cjs");
const { ChatCommands } = require("./chat-commands.cjs");
class Twitch {
  constructor({
    auth,
    store,
    engine,
    changed = () => {},
    fetchImpl = fetch,
    sdk = loadSdk,
  }) {
    Object.assign(this, { auth, store, engine, changed, fetchImpl, sdk });
    this.chat = new ChatCommands({ auth, store, engine });
    this.status = "Войдите через Twitch";
    this.epoch = 0;
    this.onRetry = () => this.reconnect();
    auth.on("retry", this.onRetry);
  }
  account() {
    return this.auth.saved?.user.id || "";
  }
  assertOwner(r) {
    if (
      !this.account() ||
      r.account !== this.account() ||
      r.clientId !== this.auth.saved.clientId
    )
      throw Error("Войдите в аккаунт Twitch, создавший эту награду");
  }
  async request(method, endpoint, params = {}, body) {
    if (this.closed) throw Error("Приложение закрывается");
    const account = this.account(),
      client = this.auth.saved?.clientId;
    const provider = await this.auth.getProvider();
    let token = await provider.getAccessTokenForUser(account, [
      "channel:manage:redemptions",
    ]);
    const send = (access) => {
      if (account !== this.account() || client !== this.auth.saved?.clientId)
        throw Error("Аккаунт изменился");
      return this.fetchImpl(
        "https://api.twitch.tv/helix/" +
          endpoint +
          "?" +
          new URLSearchParams({ broadcaster_id: account, ...params }),
        {
          method,
          headers: {
            "Client-Id": client,
            Authorization: "Bearer " + access,
            "Content-Type": "application/json",
          },
          body: body && JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
    };
    let response = await send(token.accessToken);
    if (response.status === 401) {
      token = await provider.refreshAccessTokenForUser(account);
      response = await send(token.accessToken);
    }
    if (!response.ok) {
      const message =
        response.status === 403
          ? "Twitch отказал в доступе. Проверьте права и доступность баллов канала."
          : response.status === 429
            ? "Лимит запросов Twitch. Подождите минуту."
            : "Twitch отклонил запрос: HTTP " + response.status;
      throw Object.assign(Error(message), { status: response.status });
    }
    if (this.closed) throw Error("Приложение закрывается");
    return response.status === 204 ? {} : response.json();
  }
  async list() {
    return (
      await this.request("GET", "channel_points/custom_rewards", {
        only_manageable_rewards: "true",
      })
    ).data;
  }
  async publish(id) {
    const { twitchFields } = require("./model.cjs");
    let r = this.store.reward(id);
    if (!r) throw Error("Награда не найдена");
    if (!r.items.some((i) => i.weight > 0))
      throw Error("Сначала добавьте файл с ненулевым весом");
    if (r.remoteId) {
      this.assertOwner(r);
      await this.request(
        "PATCH",
        "channel_points/custom_rewards",
        { id: r.remoteId },
        twitchFields(r),
      );
      this.store.putReward({ ...this.store.reward(id), sync: "synced" });
      this.changed();
      return;
    }
    if (!this.account()) throw Error("Сначала войдите через Twitch");
    const list = await this.list();
    if (r.sync === "creating") {
      this.assertOwner(r);
      const recovered = list.find(
        (x) => x.title === r.createTitle && !r.knownRemoteIds?.includes(x.id),
      );
      if (recovered) {
        r = { ...r, remoteId: recovered.id, sync: "synced" };
        this.store.putReward(r);
        return this.publish(id);
      }
    } else {
      if (list.some((x) => x.title.toLowerCase() === r.title.toLowerCase()))
        throw Error("В Twitch уже есть награда с таким названием");
      r = {
        ...r,
        account: this.account(),
        clientId: this.auth.saved.clientId,
        sync: "creating",
        createTitle: r.title,
        knownRemoteIds: list.map((x) => x.id),
      };
      this.store.putReward(r);
      this.changed();
    }
    try {
      const result = await this.request(
        "POST",
        "channel_points/custom_rewards",
        {},
        twitchFields(r, true),
      );
      const linked = {
        ...this.store.reward(id),
        remoteId: result.data[0].id,
        sync: "synced",
      };
      this.store.putReward(linked);
      if (linked.paused)
        await this.request(
          "PATCH",
          "channel_points/custom_rewards",
          { id: linked.remoteId },
          { is_paused: true },
        );
      this.store.log("Создана награда: " + linked.title);
      this.changed();
    } catch (e) {
      if (e.status && e.status < 500)
        this.store.putReward({ ...this.store.reward(id), sync: "draft" });
      throw e;
    }
  }
  async remove(id) {
    const r = this.store.reward(id);
    if (!r) return;
    if (
      this.store
        .jobs()
        .some(
          (j) =>
            j.rewardId === id &&
            ["queued", "playing", "attention", "settling"].includes(j.state),
        )
    )
      throw Error("Сначала завершите или отмените очередь этой награды");
    if (r.sync === "creating")
      throw Error("Сначала восстановите связь кнопкой «Создать в Twitch»");
    if (r.remoteId) {
      this.assertOwner(r);
      await this.request(
        "PATCH",
        "channel_points/custom_rewards",
        { id: r.remoteId },
        { is_paused: true },
      );
      this.store.putReward({ ...r, paused: true });
      this.changed();
      const pending = await this.request(
        "GET",
        "channel_points/custom_rewards/redemptions",
        { reward_id: r.remoteId, status: "UNFULFILLED", first: "1" },
      );
      if (pending.data.length)
        throw Error(
          "В Twitch есть незавершённые покупки. Награда на паузе; дождитесь обработки очереди.",
        );
      await this.request("DELETE", "channel_points/custom_rewards", {
        id: r.remoteId,
      });
    }
    this.store.deleteReward(id);
    this.store.log("Удалена награда: " + r.title);
    this.changed();
  }
  receive(event) {
    if (event.account !== this.account()) return;
    const r = this.store
      .rewards()
      .find(
        (r) =>
          r.remoteId === event.rewardId &&
          r.account === event.account &&
          r.clientId === this.auth.saved?.clientId,
      );
    if (r) this.engine.enqueue(r, event);
  }
  async connect() {
    this.stop();
    const epoch = this.epoch;
    if (!this.account()) return;
    this.status = "Подключение";
    this.changed();
    try {
      const sdk = await this.sdk(),
        authProvider = await this.auth.getProvider();
      if (epoch !== this.epoch) return;
      const listener = (this.listener = new sdk.EventSubWsListener({
        apiClient: new sdk.ApiClient({ authProvider }),
        logger: { minLevel: "error" },
      }));
      const account = this.account();
      if (this.chat.hasScope()) {
        this.chat.status = "Подключение к чату";
        this.chatSub = listener.onChannelChatMessage(
          account,
          account,
          (event) => {
            if (epoch !== this.epoch) return;
            try {
              this.chat.receive({
                account: event.broadcasterId,
                sourceAccount: event.sourceBroadcasterId,
                id: event.messageId,
                login: event.chatterName,
                user: event.chatterDisplayName,
                userId: event.chatterId,
                text: event.messageText,
                isRedemption: event.isRedemption,
              });
            } catch {
              this.store.log(
                "Не удалось обработать команду чата; проверьте очередь и доступ к папке данных",
              );
            }
          },
        );
      }
      listener.onChannelRedemptionAdd(account, (event) => {
        if (epoch === this.epoch)
          this.receive({
            account: event.broadcasterId,
            id: event.id,
            rewardId: event.rewardId,
            user: event.userDisplayName,
            status: event.status,
          });
      });
      listener.onChannelRedemptionUpdate(account, (event) => {
        if (epoch === this.epoch)
          this.engine.external(account, event.id, event.status);
      });
      listener.onSubscriptionCreateSuccess((sub) => {
        if (epoch === this.epoch) {
          if (sub === this.chatSub) {
            this.chat.ready = true;
            this.chat.status = "Команды чата подключены";
            clearTimeout(this.chatRetry);
          } else this.status = "Twitch подключён";
          this.changed();
        }
      });
      listener.onSubscriptionCreateFailure((sub, error) => {
        if (epoch !== this.epoch) return;
        if (sub !== this.chatSub)
          return this.reconnect("Не удалось подписаться на Twitch");
        this.chat.ready = false;
        const denied =
          [401, 403].includes(error?.statusCode) ||
          error?.name === "MissingScopeError";
        this.chat.status = denied
          ? "Нет доступа к чату. Войдите через Twitch ещё раз"
          : "Чат недоступен; повторяем подключение";
        clearTimeout(this.chatRetry);
        if (!denied) {
          this.chatRetry = setTimeout(() => {
            if (epoch === this.epoch) sub.start();
          }, 30000);
          this.chatRetry.unref();
        }
        this.changed();
      });
      listener.onUserSocketConnect(() => {
        if (epoch === this.epoch && this.chatSub?.verified) {
          this.chat.ready = true;
          this.chat.status = "Команды чата подключены";
          this.changed();
        }
      });
      listener.onUserSocketDisconnect(() => {
        if (epoch === this.epoch) {
          this.status = "Переподключение Twitch";
          this.chat.ready = false;
          this.chat.status = "Переподключение чата";
          this.changed();
        }
      });
      listener.onRevoke((sub, reason) => {
        if (epoch === this.epoch) {
          if (sub === this.chatSub) {
            this.chat.ready = false;
            this.chat.status =
              "Доступ к чату отозван. Войдите через Twitch ещё раз";
            this.changed();
            return;
          }
          this.auth.invalidate("Twitch отозвал доступ: " + reason);
          this.stop();
        }
      });
      listener.start();
      this.timer = setInterval(() => void this.tick(), 15000);
      this.timer.unref();
      await this.tick();
    } catch {
      if (epoch === this.epoch)
        this.reconnect("Twitch недоступен; повторяем подключение");
    }
  }
  reconnect(message = "Повторное подключение") {
    this.stop();
    this.status = message;
    this.changed();
    if (!this.auth.invalid) {
      this.retry = setTimeout(() => void this.connect(), 15000);
      this.retry.unref();
    }
  }
  async tick() {
    if (this.busy || !this.account()) return;
    this.busy = true;
    try {
      await this.auth.validate();
      for (const r of this.store
        .rewards()
        .filter(
          (r) =>
            r.remoteId &&
            r.account === this.account() &&
            r.clientId === this.auth.saved?.clientId,
        )) {
        try {
          let after = "";
          // Bounded backfill; deduplication is persistent across EventSub, polling and restarts.
          for (let page = 0; page < 10; page++) {
            const result = await this.request(
              "GET",
              "channel_points/custom_rewards/redemptions",
              {
                reward_id: r.remoteId,
                status: "UNFULFILLED",
                first: "50",
                sort: "OLDEST",
                ...(after ? { after } : {}),
              },
            );
            for (const e of result.data)
              this.receive({
                account: r.account,
                id: e.id,
                rewardId: r.remoteId,
                user: e.user_name,
                status: e.status.toLowerCase(),
              });
            after = result.pagination?.cursor;
            if (!after) break;
          }
        } catch (e) {
          if (this.closed) return;
          this.status = e.message;
          this.changed();
        }
      }
      if (this.closed) return;
      for (const job of this.store
        .jobs()
        .filter(
          (j) =>
            j.state === "settling" &&
            j.account === this.account() &&
            j.clientId === this.auth.saved?.clientId,
        )
        .slice(0, 20)) {
        try {
          const existing = await this.request(
            "GET",
            "channel_points/custom_rewards/redemptions",
            { reward_id: job.remoteId, id: job.redemptionId },
          );
          const status = existing.data[0]?.status?.toLowerCase();
          if (status && status !== "unfulfilled") {
            this.engine.external(job.account, job.redemptionId, status);
            continue;
          }
          if (!status) throw Error("Покупка не найдена в Twitch");
          await this.request(
            "PATCH",
            "channel_points/custom_rewards/redemptions",
            { reward_id: job.remoteId, id: job.redemptionId },
            { status: job.desired },
          );
          this.engine.external(
            job.account,
            job.redemptionId,
            job.desired.toLowerCase(),
          );
        } catch {
          this.status = "Ожидаем подтверждение Twitch";
          this.changed();
        }
      }
    } catch (e) {
      this.status = e.publicMessage || e.message || "Ошибка связи с Twitch";
      this.changed();
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.epoch++;
    clearTimeout(this.retry);
    clearInterval(this.timer);
    clearTimeout(this.chatRetry);
    this.chat.ready = false;
    this.chat.status = "Чат не подключён";
    this.listener?.stop();
    this.listener = null;
    this.chatSub = null;
  }
  close() {
    this.closed = true;
    this.stop();
    this.auth.off("retry", this.onRetry);
  }
}
module.exports = { Twitch };
