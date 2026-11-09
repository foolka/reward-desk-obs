const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initialReward, normalizeReward, normalizePresentation } = require("../core/model.cjs");
const { Store, importMedia, importKind } = require("../core/store.cjs");
const { Engine } = require("../core/engine.cjs");
const { Overlay } = require("../core/overlay.cjs");
const { readRecovery, restoreMissing } = require("../core/profile-recovery.cjs");
const { defaults, animations, directions, frames } = require("../overlay/presentation.js");

// All fixtures live in temporary profiles and never connect to Twitch or OBS.
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-fullscreen-"));
	const store = new Store(root);
	const cleanups = [];
	t.after(() => { for (const close of cleanups) close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
	const add = (name, kind) => {
		const file = path.join(root, name);
		fs.writeFileSync(file, Buffer.from("test media"));
		return importMedia(store, file, kind);
	};
	return { root, store, add, cleanups };
}

test("old rewards keep geometry and receive default-off fullscreen settings", () => {
	const old = initialReward("video");
	delete old.video.fullscreen;
	old.items = [{ id: "video", volume: 47, weight: 3, captionText: "Keep caption" }];
	const normalized = normalizeReward(old, old);
	assert.equal(normalized.video.fullscreen, false);
	assert.equal(normalized.video.width, old.video.width);
	assert.equal(normalized.video.border, old.video.border);
	assert.equal(normalized.items[0].volume, 47);
	assert.equal(normalized.items[0].captionText, "Keep caption");
	assert.deepEqual(normalized.items[0].presentation, defaults);
	assert.equal(defaults.imageSeconds, 5);
	assert.equal(defaults.soundId, "");
});

test("missing new fields preserve prior item settings and fullscreen opt-in", () => {
	const prior = initialReward("video");
	prior.video.fullscreen = true;
	prior.items = [{ id: "image", volume: 61, weight: 1, presentation: { ...defaults, enterFrom: "left", imageSeconds: 13, soundId: "audio" } }];
	const input = structuredClone(prior);
	delete input.video.fullscreen;
	delete input.items[0].presentation;
	const saved = normalizeReward(input, prior);
	assert.equal(saved.video.fullscreen, true);
	assert.deepEqual(saved.items[0].presentation, prior.items[0].presentation);
});

test("fullscreen values are bounded and enum fields are not executable strings", () => {
	for (const invalid of [null, [], { imageSeconds: 0 }, { imageSeconds: 601 }, { enterMs: -1 },
		{ exitMs: 5001 }, { enterMs: 0.5 }, { soundVolume: 101 }, { soundId: {} },
		{ enter: "url(javascript:evil)" }, { exitTo: "anywhere" }, { fit: "fill" }])
		assert.throws(() => normalizePresentation(invalid));
	assert.equal(normalizePresentation({ enterMs: 0, exitMs: 0, soundVolume: 0 }).soundVolume, 0);
	const reward = initialReward("video"); reward.video.fullscreen = "yes";
	assert.throws(() => normalizeReward(reward));
});

test("video roulette accepts raster images; replacement sound must be audio", (t) => {
	const { store, add } = fixture(t);
	for (const ext of ["png", "jpg", "jpeg", "gif", "webp"]) assert.equal(add("image." + ext, "video").kind, "image");
	const image = add("frame.png", "video"), audio = add("sound.wav", "audio");
	const r = initialReward("video"); r.video.fullscreen = true;
	r.items = [{ id: image.id, volume: 70, weight: 1, presentation: { ...defaults, soundId: audio.id } }];
	const saved = store.saveReward(r);
	assert.equal(saved.items[0].presentation.soundId, audio.id);
	const invalid = structuredClone(saved); invalid.items[0].presentation.soundId = image.id;
	assert.throws(() => store.saveReward(invalid));
	assert.equal(store.reward(saved.id).items[0].presentation.soundId, audio.id);
	assert.throws(() => add("unsafe.svg", "video"));
	assert.throws(() => add("image.png", "audio"));
	assert.equal(importKind(r, "sound"), "audio");
	assert.throws(() => importKind(initialReward(), "sound"));
	assert.throws(() => importKind(r, "arbitrary"));
});

test("reordered queue and forced stop retain each item's independent presentation", (t) => {
	const { store, add } = fixture(t);
	const media = [add("one.png", "video"), add("two.webm", "video"), add("three.jpg", "video")];
	const audio = add("sound.wav", "audio");
	let reward = initialReward("video"); reward.video.fullscreen = true;
	reward.items = media.map((m, i) => ({ id: m.id, weight: 1, volume: 40 + i,
		presentation: { ...defaults, imageSeconds: 5 + i, enterFrom: directions[i], soundId: i === 1 ? audio.id : "" } }));
	reward = store.saveReward(reward);
	const engine = new Engine(store, () => {}, () => 0);
	const one = engine.enqueue(reward), two = engine.enqueue(reward), three = engine.enqueue(reward);
	engine.cancel(one.id);
	const second = engine.start(store.job(two.id), "client");
	assert.deepEqual(second.item.presentation, reward.items.find((i) => i.id === second.item.id).presentation);
	engine.finish(second.id, false, "Stopped");
	const third = engine.start(store.job(three.id), "client");
	assert.notEqual(third.item.id, second.item.id);
	assert.deepEqual(third.item.presentation, reward.items.find((i) => i.id === third.item.id).presentation);
	assert.equal(third.video.fullscreen, true);
});

test("overlay publishes selected item and replacement audio only in fullscreen", async (t) => {
	const { store, add, cleanups } = fixture(t);
	const image = add("frame.png", "video"), sound = add("sound.mp3", "audio");
	const engine = new Engine(store);
	const overlay = new Overlay({ store, engine, account: () => "" });
	await overlay.start(0); cleanups.push(() => overlay.close());
	const packets = [];
	const c = { id: "client", ready: true, build: overlay.build, seen: Date.now(), res: { write: (packet) => packets.push(packet), end() {} } };
	overlay.clients.set(c.id, c);
	const r = initialReward("video"); r.video.fullscreen = true;
	r.items = [{ id: image.id, volume: 13, weight: 1, presentation: { ...defaults, soundId: sound.id, soundVolume: 27 } }];
	const saved = store.saveReward(r), j = engine.enqueue(saved);
	overlay.tick();
	let packet = packets.find((p) => p.startsWith("event: play"));
	const payload = JSON.parse(packet.split("data: ")[1]);
	assert.equal(payload.mediaKind, "image");
	assert.equal(payload.presentation.soundVolume, 27);
	assert.equal(payload.soundUrl, overlay.base + "/media/" + sound.id);
	engine.finish(j.id, true);
	r.video.fullscreen = false;
	engine.enqueue(store.saveReward(r)); packets.length = 0; overlay.tick();
	packet = packets.find((p) => p.startsWith("event: play"));
	assert.equal(JSON.parse(packet.split("data: ")[1]).soundUrl, "");
	for (const file of ["presentation.js", "playback.js", "playback.css"])
		assert.equal((await fetch(overlay.url() + file)).status, 200);
});

test("entrance and exit keyframes cover all supported directions", () => {
	for (const name of animations) for (const direction of directions) {
		const enter = frames(name, direction), exit = frames(name, direction, true);
		assert.deepEqual(enter.at(-1), exit[0]);
		assert.deepEqual(enter[0], exit.at(-1));
		assert.equal(enter.at(-1).opacity, 1);
		assert.ok(enter.every((frame) => typeof frame.transform === "string"));
	}
});

test("recovery copies image and independent audio from saved items and drafts", async (t) => {
	const source = fixture(t), target = fixture(t);
	const picture = source.add("picture.png", "video"), sound = source.add("sound.mp3", "audio");
	const draftSound = source.add("draft.wav", "audio");
	const r = initialReward("video"); r.video.fullscreen = true;
	r.items = [{ id: picture.id, volume: 20, weight: 1, presentation: { ...defaults, soundId: sound.id } }];
	const saved = source.store.saveReward(r);
	const draft = structuredClone(saved); draft.items[0].presentation.soundId = draftSound.id;
	source.store.stashDraft(draft);
	const result = await restoreMissing(target.store, readRecovery(source.root));
	assert.deepEqual(result, { added: 1, files: 3 });
	assert.equal(target.store.reward(saved.id).items[0].presentation.soundId, sound.id);
	assert.equal(target.store.meta("editor:" + saved.id).value.items[0].presentation.soundId, draftSound.id);
	for (const media of [picture, sound, draftSound])
		assert.deepEqual(fs.readFileSync(target.store.mediaPath(media.id)), fs.readFileSync(source.store.mediaPath(media.id)));
});
