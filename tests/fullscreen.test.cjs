const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { initialReward, normalizeReward } = require("../core/model.cjs");
const { Store, importMedia } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");

// Legacy media remains exportable, but cannot be queued by chat, tests or redemptions.
test("retired fullscreen records retain their files and settle new redemptions", t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-retired-"));
	const store = new Store(root);
	t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
	const source = path.join(root, "legacy.png"); fs.writeFileSync(source, "fixture");
	const media = importMedia(store, source, "video");
	const r = initialReward("video"); r.video.fullscreen = true;
	r.items = [{ id: media.id, weight: 2, volume: 35, presentation: { imageSeconds: 7, enterFrom: "left" } }];
	store.putReward(r);
	assert.throws(() => normalizeReward(r), /Dudos Lite/);
	assert.equal(normalizeReward(r, r).video.fullscreen, true);
	const before = JSON.stringify(store.reward(r.id));
	const engine = new Engine(store);
	assert.equal(engine.enqueue(r).state, "failed");
	const job = engine.enqueue(r, { account: "1", id: "purchase", status: "unfulfilled", user: "Viewer" });
	assert.equal(job.state, "settling"); assert.equal(job.desired, "CANCELED");
	assert.equal(engine.next("1"), undefined);
	assert.equal(JSON.stringify(store.reward(r.id)), before);
	assert.equal(fs.readFileSync(store.mediaPath(media.id), "utf8"), "fixture");
});

test("upgrade cancels only pending legacy fullscreen jobs without deleting rewards", t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-upgrade-"));
	let store = new Store(root);
	t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
	const r = initialReward("video"); r.video.fullscreen = true; store.putReward(r);
	for (const state of ["queued", "playing", "attention", "done"])
		store.putJob({ id: state, rewardId: r.id, state, video: { fullscreen: true }, refundable: true, createdAt: Date.now() });
	store.putJob({ id: "regular", rewardId: r.id, state: "queued", video: {}, createdAt: Date.now() });
	store.close(); store = new Store(root);
	for (const id of ["queued", "playing", "attention"]) {
		assert.equal(store.job(id).state, "settling"); assert.equal(store.job(id).desired, "CANCELED");
	}
	assert.equal(store.job("done").state, "done");
	assert.equal(store.job("regular").state, "queued");
	assert.equal(store.reward(r.id).video.fullscreen, true);
});

test("new ordinary rewards remain nonfullscreen with their existing geometry", () => {
	const r = initialReward("video"); delete r.video.fullscreen;
	const saved = normalizeReward(r);
	assert.equal(saved.video.fullscreen, false);
	assert.equal(saved.video.width, r.video.width);
	assert.equal(saved.video.height, r.video.height);
});
