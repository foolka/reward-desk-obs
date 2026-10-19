const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const REDIRECTED =
  "Windows перенаправляет профиль Reward Desk в отдельную копию. Запуск остановлен, награды не изменены. Откройте программу обычным ярлыком из меню «Пуск» или панели задач, не из изолированной среды.";
const DATABASE_CHANGED =
  "Сохранённая база Reward Desk отсутствует или не соответствует профилю. Запуск остановлен: пустая база не создана, файлы не заменены. Сохраните папку профиля и обратитесь в поддержку.";

function selectProfile(production, test, override) {
  if (!test) return production;
  if (!override)
    throw Error(
      "Тестовый запуск требует отдельной папки REWARD_DESK_TEST_DATA.",
    );
  const target = path.resolve(override);
  const physical = (p) =>
    fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p);
  const relative = path.relative(physical(production), physical(target));
  if (
    samePath(target, production) ||
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw Error(
      "Тестовый запуск не может использовать рабочий профиль Reward Desk.",
    );
  return target;
}

function samePath(a, b) {
  const normalize = (p) =>
    path
      .resolve(p)
      .replace(/^\\\\\?\\/, "")
      .toLowerCase();
  return normalize(a) === normalize(b);
}

function assertProfileLocation(root, io = fs) {
  // MSIX can redirect individual files while the parent directory still looks normal.
  const probe = path.join(root, `.profile-probe-${randomUUID()}`);
  try {
    io.writeFileSync(probe, "profile check", { flag: "wx" });
    const canonical = io.realpathSync.native(root);
    if (!samePath(canonical, root))
      throw Object.assign(Error(REDIRECTED), { code: "PROFILE_REDIRECTED" });
    const files = [
      probe,
      ...[
        "rewards.sqlite",
        "rewards.sqlite-wal",
        "rewards.sqlite-shm",
        "profile-identity.json",
        "auth.bin",
        "obs-control.bin",
      ].map((name) => path.join(root, name)),
    ];
    for (const file of files) {
      if (!io.existsSync(file)) continue;
      if (
        !samePath(
          io.realpathSync.native(file),
          path.join(canonical, path.basename(file)),
        )
      )
        throw Object.assign(Error(REDIRECTED), { code: "PROFILE_REDIRECTED" });
    }
  } finally {
    if (io.existsSync(probe)) io.unlinkSync(probe);
  }
}

function profileId(token) {
  if (typeof token !== "string" || !token) throw Error(DATABASE_CHANGED);
  return createHash("sha256").update(token).digest("hex");
}

function assertProfileDatabase(root) {
  const file = path.join(root, "rewards.sqlite");
  const marker = path.join(root, "profile-identity.json");
  if (!fs.existsSync(file)) {
    const traces = [
      "profile-identity.json",
      "auth.bin",
      "startup-diagnostics.jsonl",
      "rewards.sqlite-wal",
    ].some((name) => fs.existsSync(path.join(root, name)));
    const content = ["media", "backups"].some((name) => {
      const dir = path.join(root, name);
      return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    });
    if (traces || content) throw Error(DATABASE_CHANGED);
    return;
  }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const check = db.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || Object.values(check[0])[0] !== "ok")
      throw Error(DATABASE_CHANGED);
    const token = JSON.parse(
      db.prepare("SELECT value FROM meta WHERE key='overlayToken'").get()
        ?.value || "null",
    );
    const id = profileId(token);
    if (fs.existsSync(marker)) {
      const saved = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (saved.version !== 1 || saved.id !== id) throw Error(DATABASE_CHANGED);
    }
  } catch (error) {
    throw Error(DATABASE_CHANGED, { cause: error });
  } finally {
    db?.close();
  }
}

function rememberProfile(root, store) {
  const marker = path.join(root, "profile-identity.json");
  const id = profileId(store.meta("overlayToken"));
  if (fs.existsSync(marker)) {
    const saved = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (saved.version !== 1 || saved.id !== id) throw Error(DATABASE_CHANGED);
    return;
  }
  fs.writeFileSync(marker, JSON.stringify({ version: 1, id }) + "\n", {
    flag: "wx",
    flush: true,
  });
}

function recordStartup(root, { version, executable, store }) {
  const file = path.join(root, "startup-diagnostics.jsonl");
  if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024)
    fs.renameSync(file, file + ".previous");
  fs.appendFileSync(
    file,
    JSON.stringify({
      at: new Date().toISOString(),
      version,
      executable,
      requestedProfile: root,
      database: fs.realpathSync.native(path.join(root, "rewards.sqlite")),
      profileId: createHash("sha256")
        .update(store.meta("overlayToken"))
        .digest("hex")
        .slice(0, 16),
      rewards: store.rewards().length,
      media: store.all("media").length,
    }) + "\n",
  );
}

module.exports = {
  selectProfile,
  assertProfileLocation,
  assertProfileDatabase,
  rememberProfile,
  recordStartup,
};
