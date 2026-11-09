const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "test-results/transparency");
fs.mkdirSync(out, { recursive: true });
const files = new Map();
for (const name of ["player.css", "playback.css", "caption.css", "geometry.js", "caption.js", "presentation.js", "playback.js"]) {
	files.set("/" + name, path.join(root, "overlay", name));
}
files.set("/fullscreen.css", path.join(root, "ui/fullscreen.css"));
const frame = Buffer.alloc(64 * 64 * 4);
for (let y = 0; y < 64; y++) {
	for (let x = 0; x < 64; x++) {
		const i = (y * 64 + x) * 4;
		frame[i] = 204; frame[i + 1] = 51; frame[i + 2] = 85;
		frame[i + 3] = x >= 24 && x < 40 && y >= 24 && y < 40 ? 255
			: x >= 20 && x < 44 && y >= 20 && y < 44 ? 128 : 0;
	}
}
// Known transparent, half-transparent and opaque pixels detect a painted backdrop.
for (const extension of ["png", "webm"]) {
	const filename = path.join(out, "alpha." + extension);
	const video = extension === "webm";
	execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "64x64", "-framerate", "12", "-i", "pipe:0",
		...(video ? ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-lossless", "1"] : ["-frames:v", "1"]), filename],
		{ windowsHide: true, input: video ? Buffer.concat(Array(60).fill(frame)) : frame });
	files.set("/alpha." + extension, filename);
}
const markup = `<!doctype html>
<html>
	<head>
		<link rel="stylesheet" href="/player.css">
		<link rel="stylesheet" href="/playback.css">
		<link rel="stylesheet" href="/caption.css">
		<link rel="stylesheet" href="/fullscreen.css">
	</head>
	<body>
		<script src="/geometry.js"></script>
		<script src="/caption.js"></script>
		<script src="/presentation.js"></script>
		<script src="/playback.js"></script>
	</body>
</html>`;
const server = http.createServer((req, res) => {
	if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end(markup); return; }
	const file = files.get(req.url);
	if (!file) { res.writeHead(404); res.end(); return; }
	const types = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webm": "video/webm" };
	res.setHeader("Content-Type", types[path.extname(file)]);
	res.end(fs.readFileSync(file));
});
let browser;

// Inspect the composed screenshot, not just the media's own alpha channel.
async function pixels(page, name, points) {
	const png = await page.screenshot({ path: path.join(out, name + ".png"), omitBackground: true });
	return page.evaluate(async ({ data, points }) => {
		const img = new Image(); img.src = data; await img.decode();
		const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
		const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
		return points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]);
	}, { data: "data:image/png;base64," + png.toString("base64"), points });
}

(async () => {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
	const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
	const errors = []; page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	for (const extension of ["png", "webm"]) {
		for (const fit of ["cover", "contain"]) {
			await page.evaluate(({ extension, fit }) => {
				window.playback?.stop(); document.body.style.background = "transparent";
				window.playback = RewardPlayback.mount(document.body, {
					id: "alpha", kind: "video", mediaKind: extension === "png" ? "image" : "video",
					url: "/alpha." + extension, volume: 0, video: { fullscreen: true },
					presentation: { fit, imageSeconds: 30, enter: "none", exit: "none" },
				}, () => {});
			}, { extension, fit });
			await page.waitForFunction(() => playback.frame.style.visibility === "visible");
			if (extension === "webm") await page.waitForFunction(() => playback.el.currentTime > 0.1);
			const scale = fit === "cover" ? 10 : 360 / 64, left = (640 - 64 * scale) / 2;
			const points = [[5, 5], [left + 10 * scale, 180], [left + 22 * scale, 180], [320, 180]];
			const alpha = await pixels(page, `${extension}-${fit}-alpha`, points);
			assert.equal(alpha[0][3], 0, "empty margins stay transparent");
			assert.equal(alpha[1][3], 0, "transparent media reveals the scene");
			assert.ok(alpha[2][3] >= 120 && alpha[2][3] <= 136, "soft edges retain partial alpha");
			assert.equal(alpha[3][3], 255, "opaque subject remains opaque");
			await page.evaluate(() => { document.body.style.background = "rgb(36, 110, 185)"; });
			const composed = await pixels(page, `${extension}-${fit}-scene`, points);
			assert.deepEqual(composed[0], [36, 110, 185, 255]);
			assert.deepEqual(composed[1], [36, 110, 185, 255]);
			assert.notDeepEqual(composed[3], composed[1]);
		}
	}
	await page.evaluate(() => {
		playback.stop(); document.body.style.background = "transparent";
		const area = document.createElement("div"); area.className = "b-fullscreen__preview"; document.body.append(area);
		window.playback = RewardPlayback.mount(area, { id: "preview", kind: "video", mediaKind: "image", url: "/alpha.png", volume: 0, video: { fullscreen: true }, presentation: { imageSeconds: 30, enter: "none", exit: "none" } }, () => {});
	});
	await page.waitForFunction(() => playback.frame.style.visibility === "visible");
	const checker = await pixels(page, "editor-checker", [[5, 5], [17, 5], [320, 180]]);
	assert.notDeepEqual(checker[0], checker[1], "preview checker is visible through alpha");
	assert.equal(checker[0][3], 255);
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ ok: true, formats: 2, fitModes: 2, pixelAlpha: true, sceneVisible: true, previewChecker: true }));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
	await browser?.close(); await new Promise((resolve) => server.close(resolve));
});
