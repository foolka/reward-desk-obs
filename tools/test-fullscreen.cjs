const { _electron: electron, chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, "..");
const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "reward-retired-ui-")));
const out = path.join(root, "test-results/fullscreen");
fs.mkdirSync(out, { recursive: true });
const videoFile = path.join(profile, "video.webm");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x19ba89:s=320x180:r=20", "-t", "2", "-c:v", "libvpx-vp9", videoFile], { windowsHide: true });
const seed = new Store(profile), media = importMedia(seed, videoFile, "video");
const regular = initialReward("video"); regular.title = "Regular video"; regular.items = [{ id: media.id, volume: 0, weight: 1 }];
const legacy = initialReward("video"); legacy.title = "Legacy fullscreen"; legacy.video.fullscreen = true; legacy.items = structuredClone(regular.items);
seed.putReward(regular); seed.putReward(legacy); seed.close();
let app, browser, page;
const errors = [];
const isPlugin = require("../core/product.cjs").obsPlugin;

// Exercise each independent product without Twitch or the user's profile.
(async () => {
	browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
	const env = { ...process.env, REWARD_DESK_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
	const executablePath = process.argv[2];
	app = await electron.launch({ ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}), args: [...(executablePath ? [] : [root]), "--test-mode", "--mute-audio"], env });
	page = await app.firstWindow();
	if (isPlugin) {
		let descriptor;
		for (let i = 0; i < 100; i++) {
			try { descriptor = JSON.parse(fs.readFileSync(path.join(profile, "obs-control-endpoint.json"))); break; } catch {}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.ok(descriptor);
		const response = await fetch(descriptor.origin + "/dock/command", { method: "POST", headers: { Authorization: "Bearer " + descriptor.token, "Content-Type": "application/json" }, body: JSON.stringify({ command: "open-editor" }) });
		page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		await page.goto((await response.json()).url);
	}
	page.on("pageerror", error => errors.push(error.message));
	await page.waitForFunction(() => typeof state !== "undefined" && !!state?.rewards);
	await page.locator('[data-kind-tab="video"]').click();
	await page.locator('[data-id="' + legacy.id + '"]').click();
	await page.locator("#editor h3").filter({ hasText: "Dudos Lite" }).waitFor();
	assert.equal(await page.locator("#test").count(), 0);
	assert.equal(await page.locator("#fullscreen-enabled").count(), 0);
	assert.equal(await page.locator("#editor li").count(), 1);
	const snapshot = await page.evaluate(() => desk.command("state"));
	assert.deepEqual(snapshot.rewards.find(r => r.id === legacy.id).items, legacy.items);
	assert.equal(snapshot.rewards.find(r => r.id === legacy.id).video.fullscreen, true);
	await page.screenshot({ path: path.join(out, "retired-record.png") });
	await page.locator('[data-id="' + regular.id + '"]').click();
	assert.equal(await page.locator("#fullscreen-enabled").count(), 0);
	await page.locator(".video-controls").waitFor();
	const context = await browser.newContext({ userAgent: "obs-browser/32.0", viewport: { width: 1920, height: 1080 } });
	const player = await context.newPage(); player.on("pageerror", error => errors.push(error.message));
	await player.goto(snapshot.overlay.url);
	await player.waitForTimeout(700);
	await page.evaluate(id => desk.command("test", { id }), regular.id);
	await player.locator(".clip-frame").waitFor({ state: "visible" });
	assert.equal(await player.locator(".fullscreen-frame").count(), 0);
	await player.waitForFunction(() => !document.querySelector(".clip-frame"));
	for (const width of [900, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.locator('[data-id="' + legacy.id + '"]').click();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	}
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ product: isPlugin ? "OBS" : "app", legacyRetained: true, fullscreenRetired: true, regularPlayback: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
	await browser?.close(); await app?.close();
});
