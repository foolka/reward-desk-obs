const { normalizeSettings, fromTwitch, twitchFields } = require("./model.cjs");
const endpoint = "channel_points/custom_rewards";
class ChannelRewards {
  constructor(twitch) {
    this.twitch = twitch;
  }
  identity() {
    const saved = this.twitch.auth.saved;
    return { account: saved?.user.id || "", clientId: saved?.clientId || "" };
  }
  assertIdentity(expected) {
    const actual = this.identity();
    if (
      !actual.account ||
      actual.account !== expected.account ||
      actual.clientId !== expected.clientId
    )
      throw Error("Аккаунт Twitch изменился. Обновите список наград.");
  }
  async list() {
    const identity = this.identity();
    this.assertIdentity(identity);
    const all = await this.twitch.request("GET", endpoint, {
      only_manageable_rewards: "false",
    });
    const allowed = await this.twitch.list();
    this.assertIdentity(identity);
    const ids = new Set(allowed.map((r) => r.id));
    const catalog = {
      ...identity,
      updatedAt: Date.now(),
      items: all.data.map((r) => ({
        id: r.id,
        settings: fromTwitch(r),
        manageable: ids.has(r.id),
        inStock: r.is_in_stock,
        redeemed: r.redemptions_redeemed_current_stream,
      })),
    };
    let changed = false;
    for (const local of this.twitch.store.rewards()) {
      if (
        local.account !== identity.account ||
        local.clientId !== identity.clientId ||
        local.sync !== "synced"
      )
        continue;
      const remote = catalog.items.find(
        (r) => r.id === local.remoteId && r.manageable,
      );
      if (
        remote &&
        JSON.stringify(normalizeSettings(local)) !==
          JSON.stringify(remote.settings)
      ) {
        this.twitch.store.putReward({ ...local, ...remote.settings });
        changed = true;
      }
    }
    if (changed) this.twitch.changed();
    return catalog;
  }
  async save(input) {
    this.assertIdentity(input);
    const desired = normalizeSettings(input.settings);
    const baseline = normalizeSettings(input.baseline);
    const catalog = await this.list();
    this.assertIdentity(input);
    const remote = catalog.items.find((r) => r.id === input.id);
    if (!remote) throw Error("Награды больше нет в Twitch. Обновите список.");
    if (!remote.manageable)
      throw Error(
        "Twitch разрешает редактирование только приложению, создавшему награду. Откройте панель Twitch.",
      );
    if (JSON.stringify(remote.settings) !== JSON.stringify(baseline))
      throw Error(
        "Настройки уже изменены в Twitch. Обновите список и проверьте их перед сохранением.",
      );
    const linked = this.twitch.store
      .rewards()
      .filter(
        (r) =>
          r.remoteId === input.id &&
          r.account === input.account &&
          r.clientId === input.clientId,
      );
    if (linked.some((r) => r.sync !== "synced"))
      throw Error(
        "У этой награды есть неотправленные изменения. Сначала синхронизируйте её во вкладке «Награды».",
      );
    // Only changed fields are sent; dynamic Twitch status and media stay untouched.
    const before = twitchFields(baseline),
      after = twitchFields(desired);
    const patch = Object.fromEntries(
      Object.entries(after).filter(([k, v]) => before[k] !== v),
    );
    if (!Object.keys(patch).length) return catalog;
    const response = await this.twitch.request(
      "PATCH",
      endpoint,
      { id: input.id },
      patch,
    );
    this.assertIdentity(input);
    const updated = response.data?.find((r) => r.id === input.id);
    if (!updated)
      throw Error("Ответ Twitch неполный. Обновите список перед повтором.");
    const settings = fromTwitch(updated);
    for (const local of linked) {
      const current = this.twitch.store.reward(local.id);
      this.twitch.store.putReward({ ...current, ...settings });
    }
    this.twitch.store.log(
      "Обновлены настройки награды канала: " + settings.title,
    );
    this.twitch.changed();
    catalog.items = catalog.items.map((r) =>
      r.id === input.id ? { ...r, settings } : r,
    );
    catalog.updatedAt = Date.now();
    return catalog;
  }
}
module.exports = { ChannelRewards };
