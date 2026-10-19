const { randomUUID } = require("node:crypto");
class RewardGroups {
  constructor(store, twitch) {
    this.store = store;
    this.twitch = twitch;
  }
  list() {
    return this.store.meta("rewardGroups", []);
  }
  async save(input) {
    const groups = this.list();
    if (input.id && !groups.some((g) => g.id === input.id))
      throw Error("Группа не найдена");
    const name = String(input.name || "").trim();
    if (!name || name.length > 60)
      throw Error("Название группы: от 1 до 60 символов");
    if (!/^#[\da-f]{6}$/i.test(input.color))
      throw Error("Неверный цвет группы");
    if (!Array.isArray(input.members) || input.members.length > 1000)
      throw Error("Неверный список наград");
    const members = [...new Set(input.members)];
    if (members.some((id) => typeof id !== "string" || !this.store.reward(id)))
      throw Error("Награда больше не существует");
    const group = {
      id: input.id || randomUUID(),
      name,
      color: input.color,
      members,
      errors: [],
    };
    this.store.transaction(() => {
      const next = groups
        .filter((g) => g.id !== group.id)
        .map((g) => ({
          ...g,
          members: g.members.filter((id) => !members.includes(id)),
        }));
      this.store.setMeta("rewardGroups", [...next, group]);
      for (const id of members) {
        const r = this.store.reward(id);
        this.store.putReward({ ...r, background: group.color });
        const draft = this.store.meta("editor:" + id);
        if (draft)
          this.store.stashDraft({ ...draft.value, background: group.color });
      }
    });
    for (const id of members) {
      const r = this.store.reward(id);
      if (!r.remoteId) continue;
      try {
        this.twitch.assertOwner(r);
        await this.twitch.request(
          "PATCH",
          "channel_points/custom_rewards",
          { id: r.remoteId },
          { background_color: group.color },
        );
        this.twitch.assertOwner(r);
      } catch (e) {
        group.errors.push({ id, title: r.title, message: e.message });
      }
    }
    this.store.setMeta(
      "rewardGroups",
      this.list().map((g) => (g.id === group.id ? group : g)),
    );
    this.store.log(
      `Цвет группы «${group.name}»: ${members.length} наград; ошибок Twitch: ${group.errors.length}`,
    );
    return group;
  }
  remove(id) {
    this.store.setMeta(
      "rewardGroups",
      this.list().filter((g) => g.id !== id),
    );
  }
}
module.exports = { RewardGroups };
