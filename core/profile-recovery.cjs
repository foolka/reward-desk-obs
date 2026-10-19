const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { createHash, randomUUID } = require("node:crypto");
const { TYPES } = require("./store.cjs");
const { normalizeReward } = require("./model.cjs");

async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

function readRecovery(root) {
  const db = new DatabaseSync(path.join(root, "rewards.sqlite"), {
    readOnly: true,
  });
  try {
    if (
      db.prepare("PRAGMA user_version").get().user_version > 1 ||
      db.prepare("PRAGMA quick_check").get().quick_check !== "ok"
    )
      throw Error("Копия базы повреждена или создана более новой версией");
    const all = (table) =>
      db
        .prepare(`SELECT body FROM ${table}`)
        .all()
        .map((r) => JSON.parse(r.body));
    const rewards = all("rewards").filter((r) => !r.remoteId);
    for (const reward of rewards) {
      if (!/^[a-z0-9-]{1,100}$/i.test(reward.id))
        throw Error("Некорректный ID награды");
      normalizeReward(reward, reward);
    }
    const media = all("media");
    for (const m of media) {
      if (
        !/^[a-z0-9-]{1,100}$/i.test(m.id) ||
        !["audio", "video"].includes(m.kind) ||
        TYPES[m.ext]?.[0] !== m.kind
      )
        throw Error("Некорректный путь медиа в копии");
    }
    const meta = Object.fromEntries(
      db
        .prepare("SELECT key,value FROM meta")
        .all()
        .map((r) => [r.key, JSON.parse(r.value)]),
    );
    const hasVersions = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reward_versions'",
      )
      .get();
    const versions = hasVersions
      ? db
          .prepare(
            "SELECT reward_id,stamp,reason,body FROM reward_versions ORDER BY id",
          )
          .all()
      : [];
    return { root, rewards, media, meta, versions, jobs: all("jobs") };
  } finally {
    db.close();
  }
}

async function restoreMissing(store, source) {
  const rewards = source.rewards.filter((r) => !store.reward(r.id));
  if (!rewards.length) return { added: 0, files: 0 };
  const ids = new Set(
    rewards.flatMap((r) => [
      ...r.items.map((i) => i.id),
      ...(source.meta["editor:" + r.id]?.value?.items || []).map((i) => i.id),
    ]),
  );
  const media = [];
  for (const id of ids) {
    const m = source.media.find((m) => m.id === id);
    if (!m) throw Error("В копии отсутствует запись файла " + id);
    const file = path.join(source.root, "media", m.id + m.ext);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== m.size)
      throw Error("Файл в копии отсутствует или изменён: " + m.name);
    const existing = store.media(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(m))
      throw Error(
        "Конфликт файла: " + m.name + ". Текущие данные не заменены.",
      );
    const dest = path.join(store.root, "media", m.id + m.ext);
    const digest = await hash(file);
    if (fs.existsSync(dest) && (await hash(dest)) !== digest)
      throw Error("Конфликт содержимого файла: " + m.name);
    media.push({ m, file, dest, digest });
  }
  const folder = path.join(store.root, "backups");
  fs.mkdirSync(folder, { recursive: true });
  await backup(
    store.db,
    path.join(folder, `before-recovery-${Date.now()}-${randomUUID()}.sqlite`),
  );
  for (const { file, dest, digest } of media) {
    if (fs.existsSync(dest)) continue;
    const temp = dest + "." + randomUUID() + ".tmp";
    try {
      await fs.promises.copyFile(file, temp, fs.constants.COPYFILE_EXCL);
      if ((await hash(temp)) !== digest)
        throw Error("Ошибка проверки скопированного файла");
      await fs.promises.copyFile(temp, dest, fs.constants.COPYFILE_EXCL);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  store.transaction(() => {
    for (const { m } of media) if (!store.media(m.id)) store.putMedia(m);
    for (const r of rewards) {
      if (store.reward(r.id))
        throw Error("Награда уже появилась в текущей базе");
      store.putReward(r);
      const draft = source.meta["editor:" + r.id];
      if (draft?.value?.id === r.id) store.stashDraft(draft.value);
      for (const v of source.versions.filter((v) => v.reward_id === r.id))
        store.db
          .prepare(
            "INSERT INTO reward_versions(reward_id,stamp,reason,body) VALUES(?,?,?,?)",
          )
          .run(v.reward_id, v.stamp, v.reason, v.body);
      for (const [key, value] of Object.entries(source.meta)) {
        if (!key.startsWith("roulette:")) continue;
        const cycle = JSON.parse(key.slice(9));
        if (
          Array.isArray(cycle) &&
          cycle[2] === r.id &&
          store.meta(key) === null
        )
          store.setMeta(key, value);
      }
      for (const job of source.jobs.filter(
        (j) =>
          j.rewardId === r.id &&
          ["done", "failed", "refunded", "external"].includes(j.state),
      ))
        store.insertJob(job);
    }
    store.log(
      `Восстановлено локальных наград: ${rewards.length}; файлов: ${media.length}. Текущие награды, вход и ссылка OBS сохранены.`,
    );
  });
  return { added: rewards.length, files: media.length };
}

module.exports = { readRecovery, restoreMissing };
