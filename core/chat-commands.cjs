const { normalizeReward } = require("./model.cjs");
const CHAT_SCOPE = "user:read:chat";
class ChatCommands {
  constructor({ auth, store, engine, now = Date.now }) {
    Object.assign(this, { auth, store, engine, now });
    this.status = "Чат не подключён";
    this.ready = false;
    this.deniedAt = new Map();
  }
  hasScope() {
    return !!this.auth.saved?.token?.scope?.includes(CHAT_SCOPE);
  }
  view() {
    return {
      status:
        this.auth.saved && !this.hasScope()
          ? "Для команд войдите через Twitch ещё раз и разрешите чтение чата"
          : this.status,
      ready: this.ready,
      reauthRequired: !!this.auth.saved && !this.hasScope(),
    };
  }
  saveReward(input) {
    const prior = this.store.reward(input.id);
    const r = normalizeReward(input, prior);
    if (r.chat.enabled) {
      const account = this.auth.saved?.user.id,
        client = this.auth.saved?.clientId;
      if (!account || this.auth.invalid)
        throw Error("Сначала войдите через Twitch");
      if (
        (r.remoteId && (r.account !== account || r.clientId !== client)) ||
        (r.chatAccount &&
          (r.chatAccount !== account || r.chatClientId !== client))
      )
        throw Error(
          "Команда привязана к другому аккаунту Twitch или Client ID",
        );
      if (
        this.store
          .rewards()
          .some(
            (other) =>
              other.id !== r.id &&
              other.chat?.enabled &&
              other.chatAccount === account &&
              other.chatClientId === client &&
              other.chat.command === r.chat.command,
          )
      )
        throw Error("Эта команда уже используется другой наградой");
      r.chatAccount = account;
      r.chatClientId = client;
    }
    return this.store.transaction(() => {
      const saved = this.store.saveReward({ ...input, chat: r.chat });
      return this.store.putReward({
        ...saved,
        chatAccount: r.chatAccount || "",
        chatClientId: r.chatClientId || "",
      });
    });
  }
  receive(event) {
    const account = this.auth.saved?.user.id,
      client = this.auth.saved?.clientId;
    if (
      !this.ready ||
      !this.hasScope() ||
      this.auth.invalid ||
      !account ||
      event.account !== account ||
      (event.sourceAccount && event.sourceAccount !== account) ||
      event.isRedemption ||
      !event.id ||
      !event.userId ||
      typeof event.text !== "string" ||
      typeof event.login !== "string"
    )
      return;
    const command = event.text.trim().toLowerCase(),
      login = event.login.toLowerCase();
    if (command.length > 33 || !command.startsWith("!")) return;
    const matches = this.store
      .rewards()
      .filter(
        (r) =>
          r.chat?.enabled &&
          r.chat.command === command &&
          r.chatAccount === account &&
          r.chatClientId === client &&
          (!r.remoteId || (r.account === account && r.clientId === client)),
      );
    if (matches.length !== 1) return;
    const r = matches[0];
    const id = `chat:${account}:${event.id}`;
    if (this.store.job(id)) return this.store.job(id);
    const seenKey = `chat-ignored:${JSON.stringify([account, client])}`;
    const ignored = this.store.meta(seenKey, []);
    if (ignored.includes(event.id)) return;
    const ignore = () =>
      this.store.setMeta(seenKey, [...ignored, event.id].slice(-2000));
    if (!r.chat.users.includes(login)) {
      ignore();
      const key = r.id;
      if (this.now() - (this.deniedAt.get(key) ?? -Infinity) >= 10000) {
        this.store.log(
          `Команда ${command}: ${login} не входит в список разрешённых`,
        );
        this.deniedAt.set(key, this.now());
      }
      return;
    }
    const lastKey = `chat-last:${JSON.stringify([account, client, r.id])}`;
    const last = this.store.meta(lastKey);
    if (last !== null && this.now() - last < r.chat.cooldown * 1000) {
      ignore();
      return;
    }
    // Chat and paid redemptions share the draw cycle, but never settlement IDs.
    const job = this.engine.enqueue(r, {
      source: "chat",
      account,
      id: event.id,
      user: event.user || event.login,
      userId: event.userId,
      command,
    });
    if (job.state === "queued") {
      this.store.setMeta(lastKey, this.now());
      this.store.log(`Команда ${command}: ${login} → ${r.title}`);
    }
    return job;
  }
}
module.exports = { ChatCommands, CHAT_SCOPE };
