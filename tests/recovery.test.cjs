const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-recovery-"));
  let store = new Store(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(root);
    },
  };
}
test("unpublished roulette, seven files, drafts and OBS key survive restart", (t) => {
  const f = fixture(t);
  const source = path.join(f.root, "video.mp4");
  fs.writeFileSync(source, "fixture");
  const items = Array.from({ length: 7 }, () => ({
    id: importMedia(f.store, source, "video").id,
    volume: 80,
    weight: 1,
  }));
  const r = f.store.saveReward({
    ...initialReward("video"),
    title: "MPause - рулетка",
    items,
  });
  const token = f.store.meta("overlayToken");
  f.store.stashDraft({ ...r, prompt: "Ещё не нажал сохранить", cost: 0 });
  f.reopen();
  assert.equal(f.store.reward(r.id).items.length, 7);
  assert.equal(f.store.reward(r.id).remoteId, "");
  assert.equal(f.store.drafts()[r.id].value.prompt, "Ещё не нажал сохранить");
  assert.equal(
    f.store.drafts()[r.id].value.cost,
    0,
    "incomplete fields are recoverable",
  );
  assert.equal(f.store.meta("overlayToken"), token);
  for (const item of items)
    assert.equal(
      fs.readFileSync(f.store.mediaPath(item.id), "utf8"),
      "fixture",
    );
});
test("saved versions restore to draft, retain current Twitch identity and displaced draft", (t) => {
  const { store } = fixture(t);
  const r = store.saveReward(initialReward());
  const next = store.putReward({
    ...r,
    title: "Current",
    remoteId: "remote",
    account: "owner",
    sync: "ready",
  });
  const version = store.versions(r.id)[0];
  store.stashDraft({ ...next, prompt: "New unsaved text" });
  store.restoreDraft(r.id, version.id);
  assert.equal(store.reward(r.id).title, "Current");
  assert.equal(store.drafts()[r.id].value.title, r.title);
  assert.equal(store.drafts()[r.id].value.remoteId, "remote");
  assert.equal(store.versions(r.id)[0].value.prompt, "New unsaved text");
});
test("history is bounded and preserved on explicit deletion", (t) => {
  const { store } = fixture(t);
  const r = store.saveReward(initialReward());
  for (let i = 0; i < 70; i++) store.putReward({ ...r, title: "Version " + i });
  assert.equal(store.versions(r.id).length, 50);
  store.deleteReward(r.id);
  assert.equal(store.versions(r.id)[0].reason, "deleted");
  assert.equal(store.versions(r.id)[0].value.title, "Version 69");
});
test("invalid draft and failed transaction never overwrite a reward", (t) => {
  const { store } = fixture(t);
  const r = store.saveReward(initialReward());
  assert.throws(() => store.stashDraft({ id: "missing" }));
  assert.throws(() => store.stashDraft({ ...r, prompt: "x".repeat(300000) }));
  assert.throws(() =>
    store.transaction(() => {
      store.putReward({ ...r, title: "discard" });
      throw Error("rollback");
    }),
  );
  assert.equal(store.reward(r.id).title, r.title);
  assert.deepEqual(store.versions(r.id), []);
});
