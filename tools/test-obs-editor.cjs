const { _electron: electron, chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { execFileSync, spawnSync, spawn } = require("node:child_process");
const { Store } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, ".."), out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, "obs-editor-"));
const appProfile = fs.mkdtempSync(path.join(out, "isolated-app-"));
const fixture = path.join(profile, "sample.wav");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-af", "volume=0.02", fixture], { windowsHide: true });
const desktopSeed = new Store(appProfile);
desktopSeed.saveReward({ ...initialReward(), title: "Do not touch standalone" }); desktopSeed.close();
const desktopBefore = fs.readFileSync(path.join(appProfile, "rewards.sqlite"));
let app, browser, descriptor, editorUrl, page, parent;
const errors = [];
const packaged = process.argv[2];
const env = { ...process.env, REWARD_DESK_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
async function start(parentId) {
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
    args: [...(packaged ? [] : [root]), "--test-mode", "--mute-audio", ...(parentId ? ["--obs-parent", String(parentId)] : [])], env });
  await app.firstWindow();
  for (let i = 0; i < 100; i++) {
    try { descriptor = JSON.parse(fs.readFileSync(path.join(profile, "obs-control-endpoint.json"))); break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(descriptor?.token);
}
async function dock(command, arg) {
  const res = await fetch(descriptor.origin + (command ? "/dock/command" : "/dock/state"), { method: command ? "POST" : "GET",
    headers: { Authorization: "Bearer " + descriptor.token, ...(command ? { "Content-Type": "application/json" } : {}) },
    body: command ? JSON.stringify({ command, arg }) : undefined });
  const value = await res.json(); assert.equal(res.status, 200, JSON.stringify(value)); return value;
}
async function open() {
  editorUrl = (await dock("open-editor")).url;
  page = await browser.newPage({ viewport: { width: 1240, height: 860 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(editorUrl);
  await page.waitForFunction(() => typeof state !== "undefined" && !!state?.rewards);
}
(async () => {
  await start();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await open();
  assert.equal(await page.locator(".window-titlebar").isVisible(), false);
  for (const width of [2536, 1600, 760]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('#tab-rewards > aside').evaluate((el) => Math.round(el.getBoundingClientRect().left)), 0,
      `sidebar is flush left at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, `obs-editor-width-${width}.png`) });
  }
  await page.screenshot({ path: path.join(out, "obs-editor-empty.png") });
  await page.setViewportSize({ width: 1240, height: 860 });
  await page.locator("#new-reward").click();
  await page.locator('[data-field="title"]').fill("Browser reward");
  const chooser = page.waitForEvent("filechooser"); await page.locator("#add-files").click();
  await (await chooser).setFiles(fixture);
  await page.locator(".media-name").filter({ hasText: "sample.wav" }).waitFor();
  await page.locator("#save").click();
  await page.waitForFunction(() => !dirty && state.rewards.some((r) => r.title === "Browser reward" && r.items.length === 1));
  await page.locator("#manage-groups").click();
  await page.locator("#group-name").fill("Browser group");
  await page.locator("#group-members input").first().check();
  await page.locator("#group-save").click();
  await page.waitForFunction(() => document.querySelector("#group-result").textContent.includes("Сохранено"));
  assert.equal(await page.locator("#group-name").inputValue(), "Browser group", "saved group is immediately available, without waiting for poll");
  await page.locator("#groups-dialog").evaluate((el) => el.close());
  assert.equal((await dock()).queued, 0);
  await dock("pause", true);
  await page.locator("#test-reward").click();
  for (let i = 0; i < 30 && (await dock()).queued !== 1; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await dock()).queued, 1);
  assert.equal((await dock()).paused, true);
  const overlayUrl = (await dock()).overlay.url;
  const player = await browser.newPage(); await player.goto(overlayUrl);
  await dock("pause", false);
  for (let i = 0; i < 100 && !(await dock()).playing; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok((await dock()).playing, "queued reward starts in the browser source");
  await dock("stop"); assert.equal((await dock()).playing, "");
  await player.close();
  const duplicate = await browser.newPage(); await duplicate.goto(editorUrl);
  await duplicate.locator("#browser-disconnected").waitFor();
  assert.match(await duplicate.locator("#browser-disconnected").textContent(), /другой вкладке/);
  await duplicate.close();
  await page.locator('[data-field="title"]').fill("Unsaved browser draft");
  await page.waitForFunction(() => document.querySelector("#draft-status").textContent.includes("сохранён"));
  await page.screenshot({ path: path.join(out, "obs-editor-light.png") });
  await page.locator("#theme-toggle").click(); await page.locator("#language").selectOption("en");
  await page.screenshot({ path: path.join(out, "obs-editor-dark-en.png") });
  assert.equal(await page.locator('[data-field="title"]').inputValue(), "Unsaved browser draft");
  await page.setViewportSize({ width: 760, height: 700 });
  await page.screenshot({ path: path.join(out, "obs-editor-compact.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.QT_SDK) {
    const preview = path.join(root, "obs-plugin/build/Release/reward-desk-obs-preview.exe");
    const qt = process.env.QT_SDK;
    const profilePathFile = path.join(profile, "native-profile-path.txt");
    const pathCheck = spawnSync(preview, ["--profile-path-check"], { windowsHide: true, timeout: 15000,
      env: { ...process.env, Path: path.join(qt, "bin") + ";" + process.env.Path,
        QT_PLUGIN_PATH: path.join(qt, "plugins"), REWARD_DESK_OBS_PATH_OUTPUT: profilePathFile } });
    assert.equal(pathCheck.status, 0, String(pathCheck.stderr));
    const roaming = await app.evaluate(({ app }) => app.getPath("appData"));
    assert.equal(path.resolve(fs.readFileSync(profilePathFile, "utf8")).toLowerCase(),
      path.join(roaming, "RewardDeskOBS").toLowerCase(), "native dock and runtime resolve the same roaming profile");
    const result = spawnSync(preview, [], { windowsHide: true, timeout: 15000,
      env: { ...process.env, Path: path.join(qt, "bin") + ";" + process.env.Path,
        QT_PLUGIN_PATH: path.join(qt, "plugins"), REWARD_DESK_OBS_TEST_PROFILE: profile,
        REWARD_DESK_OBS_REQUIRE_CONNECTED: "1",
        REWARD_DESK_OBS_SCREENSHOT: path.join(out, "obs-dock.png") } });
    assert.equal(result.status, 0, String(result.stderr));
  }
  await page.close();
  for (let i = 0; i < 30 && (await dock()).editorOpen; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await dock()).editorOpen, false, "closed tab releases its editor lease");
  await open();
  await page.locator(".reward-item").first().click();
  assert.equal(await page.locator('[data-field="title"]').inputValue(), "Unsaved browser draft");
  await page.locator("#save").click();
  await page.waitForFunction(() => !dirty);
  await page.reload();
  await page.waitForFunction(() => typeof state !== "undefined" && !!state?.rewards);
  assert.equal(await page.locator("#browser-disconnected").count(), 0, "normal browser reload works");
  await page.close();
  const originalToken = descriptor.token;
  await app.close(); app = null;
  descriptor = null; await start();
  assert.notEqual(descriptor.token, originalToken);
  assert.equal((await dock()).overlay.url.split("/o/")[1], overlayUrl.split("/o/")[1], "OBS source token remains stable");
  await open();
  assert.equal(await page.evaluate(() => state.rewards[0].title), "Unsaved browser draft");
  assert.equal(await page.evaluate(() => state.media.length), 1);
  await page.close(); await app.close(); app = null;
  parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { windowsHide: true, stdio: "ignore" });
  descriptor = null; await start(parent.pid);
  const stopped = app.waitForEvent("close", { timeout: 15000 });
  parent.kill(); await stopped; app = null;
  assert.equal(fs.existsSync(path.join(profile, "obs-control-endpoint.json")), false, "OBS parent exit stops the service gracefully");
  assert.deepEqual(fs.readFileSync(path.join(appProfile, "rewards.sqlite")), desktopBefore, "standalone profile is untouched");
  assert.deepEqual(errors, []);
  console.log("PASS: independent profile, hidden runtime, browser CRUD/upload/drafts, dock pause/stop, playback, themes/languages, exclusive editor, reload/restart and stable source token");
})().catch(async (e) => { console.error(e); console.error("page errors:", errors); if (page && !page.isClosed()) { console.error(await page.locator("#toast").textContent().catch(() => "")); await page.screenshot({ path: path.join(out, "obs-editor-failure.png") }).catch(() => {}); } process.exitCode = 1; }).finally(async () => {
  await browser?.close().catch(() => {});
  await app?.close().catch(() => {});
});
