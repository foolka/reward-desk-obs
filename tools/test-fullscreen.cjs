const { _electron: electron, chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const { defaults } = require("../overlay/presentation.js");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "test-results/fullscreen");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, "profile-"));
const isPlugin = require("../core/product.cjs").obsPlugin;
const videoFile = path.join(profile, "video.webm"), imageFile = path.join(profile, "image.png"), soundFile = path.join(profile, "sound.wav");
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { windowsHide: true });
ffmpeg(["-f", "lavfi", "-i", "color=c=0x19ba89:s=320x180:r=20", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", "-t", "2", "-c:v", "libvpx-vp9", "-c:a", "libopus", videoFile]);
ffmpeg(["-f", "lavfi", "-i", "color=c=0xd13d57:s=180x320", "-frames:v", "1", imageFile]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=300:duration=8", soundFile]);
const seed = new Store(profile);
const video = importMedia(seed, videoFile, "video"), picture = importMedia(seed, imageFile, "video");
const reward = initialReward("video"); reward.title = "Fullscreen fixture";
reward.items = [{ id: video.id, volume: 39, weight: 1 }, { id: picture.id, volume: 65, weight: 1 }];
seed.putReward(reward); seed.close();
let app, browser, page, player, descriptor;
const errors = [];

// Test both independently packaged products through their real editor path.
async function open() {
	const env = { ...process.env, REWARD_DESK_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
	const packaged = process.argv[2];
	app = await electron.launch({
		...(packaged ? { executablePath: path.resolve(packaged) } : {}),
		args: [...(packaged ? [] : [root]), "--test-mode", "--mute-audio"], env,
	});
	const win = await app.firstWindow();
	if (isPlugin) {
		for (let i = 0; i < 100; i++) {
			try { descriptor = JSON.parse(fs.readFileSync(path.join(profile, "obs-control-endpoint.json"))); break; } catch {}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const res = await fetch(descriptor.origin + "/dock/command", { method: "POST", headers: { Authorization: "Bearer " + descriptor.token, "Content-Type": "application/json" }, body: JSON.stringify({ command: "open-editor" }) });
		const opened = await res.json(); assert.ok(opened.url);
		page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		await page.goto(opened.url);
	} else page = win;
	page.on("pageerror", (error) => errors.push(error.message));
	await page.waitForFunction(() => typeof state !== "undefined" && !!state?.rewards);
	await page.locator('[data-kind-tab="video"]').click();
	await page.locator(`[data-id="${reward.id}"]`).click();
}
const snapshot = () => page.evaluate(() => desk.command("state"));
const command = (name, arg) => page.evaluate(([name, arg]) => desk.command(name, arg), [name, arg]);

// No tests send Twitch messages or activate the user's actual browser source.
async function play(itemId) {
	await command("test", { id: reward.id, itemId });
	await player.waitForSelector(".clip-frame", { state: "visible" });
	await player.waitForFunction(() => current?.el && (current.el.tagName === "IMG" || current.el.currentTime > 0.1));
	return (await snapshot()).jobs.findLast((j) => j.state === "playing");
}
async function done(id) {
	const deadline = Date.now() + 12000;
	while ((await snapshot()).jobs.find((j) => j.id === id)?.state !== "done") {
		assert.ok(Date.now() < deadline, "playback must finish before its deadline");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.equal(await player.locator(".clip-frame").count(), 0);
}

(async () => {
	browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
	await open();
	assert.equal(await page.locator("#fullscreen-enabled").isChecked(), false);
	assert.equal(await page.locator("#fullscreen-options").isVisible(), false);
	await page.locator("#fullscreen-enabled").check();
	assert.equal(await page.locator(".video-controls").isVisible(), false);
	assert.equal(await page.locator("#full-soundId").inputValue(), "");
	await page.locator("#full-enter").selectOption("slide");
	await page.locator("#full-enterFrom").selectOption("left");
	await page.locator("#full-enterMs").fill("180");
	await page.locator("#full-exit").selectOption("zoom");
	await page.locator("#full-exitTo").selectOption("bottom");
	await page.locator("#full-exitMs").fill("150");
	if (isPlugin) {
		const chooser = page.waitForEvent("filechooser"); await page.locator("#full-add-sound").click();
		await (await chooser).setFiles(soundFile);
	} else {
		await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, soundFile);
		await page.locator("#full-add-sound").click();
	}
	await page.waitForFunction(() => document.querySelector("#full-soundId").value !== "");
	await page.locator("#full-soundVolume").evaluate((el) => { el.value = "27"; el.dispatchEvent(new Event("input", { bubbles: true })); });
	await page.locator("#fullscreen-item").selectOption(picture.id);
	assert.equal(await page.locator("#full-imageSeconds").inputValue(), "5");
	assert.equal(await page.locator("#full-soundId").inputValue(), "");
	await page.locator("#full-imageSeconds").fill("0.6");
	await page.locator("#full-enter").selectOption("pop");
	await page.locator("#full-enterMs").fill("100");
	await page.locator("#full-exitMs").fill("100");
	const jobsBefore = (await snapshot()).jobs.length;
	await page.locator("#full-preview-play").click();
	await page.waitForFunction(() => document.querySelector("#fullscreen-preview img")?.naturalWidth > 0);
	await page.screenshot({ path: path.join(out, "image-preview.png") });
	await page.waitForFunction(() => document.querySelector("#fullscreen-preview").hidden);
	assert.equal((await snapshot()).jobs.length, jobsBefore, "local preview never enters OBS queue");
	for (const [language, theme, width] of [["ru", "light", 1440], ["en", "dark", 760], ["uk", "light", 1800]]) {
		await page.locator("#language").selectOption(language);
		if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
		await page.setViewportSize({ width, height: 1000 });
		await page.locator("#fullscreen-item").selectOption(picture.id);
		assert.equal(await page.locator("#full-imageSeconds").inputValue(), "0.6");
		await page.locator("#fullscreen-options").scrollIntoViewIfNeeded();
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		assert.ok(await page.locator("#fullscreen-options").evaluate((el) => [...el.querySelectorAll("input,select,button")].every((control) => { const r = control.getBoundingClientRect(); return r.width === 0 || r.right <= innerWidth + 1; })));
		await page.screenshot({ path: path.join(out, `editor-${language}-${width}.png`) });
	}
	await page.locator("#save").click();
	await page.waitForFunction(() => !dirty);
	const saved = (await snapshot()).rewards.find((r) => r.id === reward.id);
	assert.equal(saved.video.fullscreen, true);
	assert.equal(saved.items[0].presentation.enterFrom, "left");
	assert.equal(saved.items[0].presentation.soundVolume, 27);
	assert.equal(saved.items[1].presentation.imageSeconds, 0.6);
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: "obs-browser/32.0", reducedMotion: "no-preference" });
	player = await context.newPage(); player.on("pageerror", (error) => errors.push(error.message));
	await player.goto((await snapshot()).overlay.url);
	let job = await play(video.id);
	const sound = await player.evaluate(() => ({ muted: current.el.muted, volume: current.sound.volume, time: current.sound.currentTime, fit: current.el.style.objectFit }));
	assert.equal(sound.muted, true); assert.equal(sound.volume, 0.27); assert.ok(sound.time > 0); assert.equal(sound.fit, "cover");
	await player.waitForTimeout(220);
	let bounds = await player.locator(".fullscreen-frame").boundingBox();
	assert.equal(Math.round(bounds.width), 1280); assert.equal(Math.round(bounds.height), 720);
	await player.screenshot({ path: path.join(out, "obs-video.png") });
	await done(job.id);
	await player.setViewportSize({ width: 600, height: 900 });
	job = await play(picture.id);
	await player.waitForTimeout(130);
	bounds = await player.locator(".fullscreen-frame").boundingBox();
	assert.equal(Math.round(bounds.width), 600); assert.equal(Math.round(bounds.height), 900);
	assert.equal(await player.locator("audio").count(), 0);
	await player.screenshot({ path: path.join(out, "obs-image-portrait.png") });
	await done(job.id);
	await page.locator("#fullscreen-item").selectOption(video.id);
	await page.locator("#full-remove-sound").click();
	await page.locator("#save").click(); await page.waitForFunction(() => !dirty);
	job = await play(video.id);
	assert.equal(await player.evaluate(() => current.el.muted), false);
	assert.equal(await player.locator("audio").count(), 0);
	await command("stop");
	await player.waitForFunction(() => !current && !document.querySelector(".clip-frame"));
	assert.notEqual((await snapshot()).jobs.find((j) => j.id === job.id).state, "done");
	await player.waitForTimeout(2400);
	assert.equal((await snapshot()).jobs.find((j) => j.id === job.id).state, "failed", "stale timers never complete a stopped job");
	await page.locator("#fullscreen-enabled").uncheck();
	assert.equal(await page.locator(".video-controls").isVisible(), true);
	await page.locator("#save").click(); await page.waitForFunction(() => !dirty);
	job = await play(video.id);
	assert.equal(await player.locator(".fullscreen-frame").count(), 0);
	assert.equal((await snapshot()).rewards.find((r) => r.id === reward.id).video.width, 600);
	await done(job.id);
	assert.deepEqual(errors, []);
	await page.setViewportSize({ width: 1440, height: 1100 });
	await page.locator("#language").selectOption("ru");
	if (await page.locator("html").getAttribute("data-theme") !== "light") await page.locator("#theme-toggle").click();
	await page.locator("#fullscreen-enabled").check();
	await page.locator("#fullscreen-item").selectOption(picture.id);
	await page.locator("#full-imageSeconds").fill("5");
	await page.locator(".b-fullscreen").evaluate((el) => el.scrollIntoView({ block: "start" }));
	await page.locator("#full-imageSeconds").blur();
	await page.locator(".b-fullscreen").screenshot({ path: path.join(out, "fullscreen-editor.png") });
	console.log(JSON.stringify({ ok: true, product: isPlugin ? "OBS" : "app", independentItems: true, images: true, originalAndReplacementAudio: true, localPreview: true, forceStop: true, fullscreenViewports: 2, locales: 3, themes: 2 }));
})().catch(async (error) => {
	console.error(error); console.error(errors);
	if (page && !page.isClosed()) {
		console.error(await page.locator("#toast").textContent().catch(() => ""));
		await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
	}
	process.exitCode = 1;
}).finally(async () => {
	await browser?.close().catch(() => {}); await app?.close().catch(() => {});
});
