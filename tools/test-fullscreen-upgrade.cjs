const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const { Engine } = require("../core/engine.cjs");
const { Overlay } = require("../core/overlay.cjs");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reward-upgrade-"));
const store = new Store(profile), engine = new Engine(store);
let overlay, browser;

// A live source stays open across server replacement; jobs wait for the new build.
async function until(check) {
	const deadline = Date.now() + 15000;
	while (!await check()) {
		assert.ok(Date.now() < deadline, "source did not recover in time");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

(async () => {
	const file = path.join(profile, "image.png");
	execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x198b67:s=200x200", "-frames:v", "1", file], { windowsHide: true });
	const media = importMedia(store, file, "video");
	const reward = initialReward("video"); reward.video.fullscreen = true;
	reward.items = [{ id: media.id, volume: 0, weight: 1, presentation: { imageSeconds: 0.3, enterMs: 0, exitMs: 0 } }];
	const saved = store.saveReward(reward);
	overlay = new Overlay({ store, engine, account: () => "" });
	overlay.build = "previous-installed-build";
	await overlay.start(0);
	const port = overlay.port, url = overlay.url();
	browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
	const page = await browser.newPage({ userAgent: "obs-browser/32.0" });
	let navigations = 0, plays = 0;
	page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
	page.on("request", (request) => { if (request.url().includes("/media/")) plays++; });
	await page.goto(url);
	await until(() => overlay.view().obsClients === 1);
	store.setMeta("paused", true);
	const job = engine.enqueue(saved);
	const old = overlay;
	await new Promise((resolve) => { old.server.once("close", resolve); old.close(); });
	overlay = new Overlay({ store, engine, account: () => "" });
	await overlay.start(port);
	store.setMeta("paused", false);
	await until(() => store.job(job.id).state === "done");
	assert.equal(navigations, 2, "already open page reloads exactly once");
	assert.equal(plays, 1, "queued fullscreen image plays exactly once");
	assert.equal(await page.locator(".clip-frame").count(), 0);
	assert.equal(overlay.url(), url);
	assert.equal(store.jobs().length, 1);
	console.log(JSON.stringify({ oldPageReloaded: true, queuePreserved: true, noReplay: true, sameUrl: true }));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
	await browser?.close(); overlay?.close(); store.close();
	fs.rmSync(profile, { recursive: true, force: true });
});
