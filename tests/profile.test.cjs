const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const {
  selectProfile,
  assertProfileLocation,
  assertProfileDatabase,
  rememberProfile,
  recordStartup,
} = require("../core/profile.cjs");
const {
  readRecovery,
  restoreMissing,
} = require("../core/profile-recovery.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-profile-"));
  const source = new Store(path.join(root, "source"));
  const target = new Store(path.join(root, "target"));
  t.after(() => {
    source.close();
    target.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, "video.mp4");
  fs.writeFileSync(file, "video fixture");
  const media = importMedia(source, file, "video");
  const reward = source.saveReward({
    ...initialReward("video"),
    title: "MPause",
    items: [{ id: media.id, volume: 65, weight: 3 }],
  });
  return { root, source, target, media, reward };
}

test("profile guard accepts physical folder and diagnostics omit secret OBS token", (t) => {
  const { source } = fixture(t);
  assertProfileLocation(source.root);
  recordStartup(source.root, {
    version: "test",
    executable: "test.exe",
    store: source,
  });
  const text = fs.readFileSync(
    path.join(source.root, "startup-diagnostics.jsonl"),
    "utf8",
  );
  assert.equal(JSON.parse(text).rewards, 1);
  assert.ok(!text.includes(source.meta("overlayToken")));
  assert.ok(
    !fs.readdirSync(source.root).some((f) => f.startsWith(".profile-probe")),
  );
});
for (const redirected of ["probe", "database", "root", "wal", "identity"]) {
  test("profile guard rejects per-file redirection: " + redirected, () => {
    const root = path.resolve("test-profile");
    let cleaned = false;
    const io = {
      writeFileSync() {},
      existsSync() {
        return true;
      },
      unlinkSync() {
        cleaned = true;
      },
      realpathSync: {
        native(file) {
          if (
            (redirected === "root" && file === root) ||
            (redirected === "wal" && file.endsWith("rewards.sqlite-wal")) ||
            (redirected === "identity" &&
              file.endsWith("profile-identity.json")) ||
            (redirected === "database" && file.endsWith("rewards.sqlite")) ||
            (redirected === "probe" &&
              path.basename(file).startsWith(".profile-probe"))
          )
            return path.resolve("LocalCache", path.basename(file));
          return file;
        },
      },
    };
    assert.throws(() => assertProfileLocation(root, io), {
      code: "PROFILE_REDIRECTED",
      message: /перенаправляет/,
    });
    assert.equal(cleaned, true);
  });
}
test("test mode requires an isolated folder and cannot use production or its child", () => {
  const production = path.resolve("production-profile");
  assert.equal(selectProfile(production, false, "ignored"), production);
  assert.throws(() => selectProfile(production, true), /отдельной/);
  assert.throws(
    () => selectProfile(production, true, production),
    /рабочий профиль/,
  );
  assert.throws(
    () => selectProfile(production, true, path.join(production, "nested")),
    /рабочий профиль/,
  );
  assert.equal(
    selectProfile(production, true, "test-profile"),
    path.resolve("test-profile"),
  );
});

test("profile identity survives restart, never stores OBS secret and detects a different database", (t) => {
  const { source, target } = fixture(t);
  assertProfileDatabase(source.root);
  rememberProfile(source.root, source);
  const marker = path.join(source.root, "profile-identity.json");
  const before = fs.readFileSync(marker, "utf8");
  assert.ok(!before.includes(source.meta("overlayToken")));
  assertProfileDatabase(source.root);
  rememberProfile(source.root, source);
  assert.equal(fs.readFileSync(marker, "utf8"), before);
  fs.copyFileSync(marker, path.join(target.root, "profile-identity.json"));
  assert.throws(() => assertProfileDatabase(target.root), /не соответствует/);
  assert.equal(target.rewards().length, 0);
});

test("missing or damaged database is never silently initialized over profile remnants", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assertProfileDatabase(root);
  for (const name of [
    "profile-identity.json",
    "auth.bin",
    "startup-diagnostics.jsonl",
    "rewards.sqlite-wal",
    "media/file.mp4",
    "backups/prior.sqlite",
  ]) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "test");
    assert.throws(() => assertProfileDatabase(root), /пустая база не создана/);
    assert.equal(fs.existsSync(path.join(root, "rewards.sqlite")), false);
    fs.unlinkSync(file);
  }
  fs.writeFileSync(path.join(root, "rewards.sqlite"), "corrupted database");
  assert.throws(() => assertProfileDatabase(root), /пустая база не создана/);
  assert.equal(
    fs.readFileSync(path.join(root, "rewards.sqlite"), "utf8"),
    "corrupted database",
  );
});

test("invalid identity marker is not replaced", (t) => {
  const { source } = fixture(t);
  const marker = path.join(source.root, "profile-identity.json");
  fs.writeFileSync(marker, "invalid json");
  assert.throws(() => assertProfileDatabase(source.root), /не соответствует/);
  assert.equal(fs.readFileSync(marker, "utf8"), "invalid json");
});
test("recovery adds missing draft/files/history without changing current rewards, key or replaying jobs", async (t) => {
  const { source, target, reward, media } = fixture(t);
  const existing = target.saveReward(initialReward("video"));
  const token = target.meta("overlayToken");
  target.setMeta("clientId", "current-client");
  source.stashDraft({ ...reward, prompt: "unsaved", cost: 0 });
  source.putJob({
    id: "done",
    rewardId: reward.id,
    state: "done",
    createdAt: 1,
  });
  source.putJob({
    id: "pending",
    rewardId: reward.id,
    state: "queued",
    createdAt: 2,
  });
  const cycle = "roulette:" + JSON.stringify(["", "", reward.id]);
  source.setMeta(cycle, { used: [media.id], last: media.id });
  const result = await restoreMissing(target, readRecovery(source.root));
  assert.deepEqual(result, { added: 1, files: 1 });
  assert.deepEqual(target.reward(existing.id), existing);
  assert.deepEqual(target.reward(reward.id), reward);
  assert.equal(target.drafts()[reward.id].value.prompt, "unsaved");
  assert.equal(target.drafts()[reward.id].value.cost, 0);
  assert.equal(target.meta("overlayToken"), token);
  assert.equal(target.meta("clientId"), "current-client");
  assert.equal(
    fs.readFileSync(target.mediaPath(media.id), "utf8"),
    "video fixture",
  );
  assert.equal(target.jobs().length, 1);
  assert.equal(target.jobs()[0].id, "done");
  assert.deepEqual(target.meta(cycle), source.meta(cycle));
  assert.deepEqual(await restoreMissing(target, readRecovery(source.root)), {
    added: 0,
    files: 0,
  });
  assert.equal(target.rewards().length, 2);
  assert.ok(
    fs
      .readdirSync(path.join(target.root, "backups"))
      .some((n) => n.startsWith("before-recovery")),
  );
});
test("recovery never overwrites an existing reward with same id", async (t) => {
  const { source, target, reward } = fixture(t);
  const changed = { ...reward, title: "New current title", items: [] };
  target.putReward(changed);
  await restoreMissing(target, readRecovery(source.root));
  assert.deepEqual(target.reward(reward.id), changed);
});
test("missing media aborts without adding reward or replacing current data", async (t) => {
  const { source, target, media } = fixture(t);
  fs.unlinkSync(source.mediaPath(media.id));
  await assert.rejects(() => restoreMissing(target, readRecovery(source.root)));
  assert.equal(target.rewards().length, 0);
  assert.equal(target.all("media").length, 0);
});
test("conflicting media contents abort rather than overwrite", async (t) => {
  const { source, target, media } = fixture(t);
  const dest = path.join(target.root, "media", media.id + media.ext);
  fs.writeFileSync(dest, "current file");
  await assert.rejects(
    () => restoreMissing(target, readRecovery(source.root)),
    /Конфликт/,
  );
  assert.equal(fs.readFileSync(dest, "utf8"), "current file");
  assert.equal(target.rewards().length, 0);
});
test("backup cannot inject a media path outside its folder", (t) => {
  const { source, media } = fixture(t);
  source.putMedia({ ...media, id: "../../outside" });
  assert.throws(() => readRecovery(source.root), /Некорректный путь/);
});
