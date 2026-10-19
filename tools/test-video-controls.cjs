const { _electron: electron, chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, "video-controls-"));
const file = path.join(profile, "sample.webm");
execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x22cc77:s=640x360:r=20",
    "-t",
    "3",
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "100k",
    file,
  ],
  { windowsHide: true },
);
const store = new Store(profile),
  initial = initialReward("video");
initial.video = {
  ...initial.video,
  x: 0,
  y: 0,
  angle: 12,
  borderStyle: "dashed",
  duration: {
    ...initial.video.duration,
    enabled: true,
    anchor: "middle-left",
    x: 0,
    y: 0,
  },
};
initial.items = [
  {
    id: importMedia(store, file, "video").id,
    volume: 80,
    weight: 1,
    captionText: "Тест",
  },
];
const reward = store.saveReward(initial);
store.close();
let app, browser;
(async () => {
  const env = { ...process.env, REWARD_DESK_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.argv[2]
      ? { executablePath: path.resolve(process.argv[2]) }
      : {}),
    args: [...(process.argv[2] ? [] : [root]), "--test-mode", "--mute-audio"],
    env,
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator("#placement video").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  );
  await page.evaluate(() => {
    window.confirm = () => {
      throw Error("Blocking browser confirm is forbidden");
    };
  });
  for (const answer of ["cancel", "accept"]) {
    await page.locator("#stop").click();
    await page.locator(`#confirm-dialog [value="${answer}"]`).click();
    await page.locator("#confirm-dialog").waitFor({ state: "hidden" });
  }
  for (const [key, value] of Object.entries({
    width: 850,
    height: 480,
    x: 230,
    y: 170,
    border: 8,
    radius: 25,
  })) {
    const input = page.locator(`[data-video="${key}"]`);
    await input.click();
    await input.press("Control+a");
    await input.press("Backspace");
    await input.pressSequentially(String(value), { delay: 120 });
    await input.press("Tab");
    assert.equal(await input.inputValue(), String(value), "Typed " + key);
    await page.waitForTimeout(350);
    assert.equal(
      await input.inputValue(),
      String(value),
      "Draft autosave " + key,
    );
  }
  await page.locator("#save").click();
  const saved = (await page.evaluate(() => desk.command("state"))).rewards[0];
  for (const [key, value] of Object.entries({
    width: 850,
    height: 480,
    x: 230,
    y: 170,
    border: 8,
    radius: 25,
  }))
    assert.equal(saved.video[key], value, "Saved " + key);
  for (const kind of ["caption", "duration"]) {
    const points = [];
    for (const anchor of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]) {
      await page
        .locator(`[data-text-kind="${kind}"][data-text-anchor="${anchor}"]`)
        .click();
      const point = await page
        .locator(`#placement [data-kind="${kind}"]`)
        .evaluate((el) => ({ x: el.offsetLeft, y: el.offsetTop }));
      points.push(point);
      await page.locator("#placement").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(out, `controls-${kind}-${anchor}.png`),
      });
      await page
        .locator("#placement")
        .screenshot({
          path: path.join(out, `controls-frame-${kind}-${anchor}.png`),
        });
    }
    assert.ok(points[1].x > points[0].x + 10, kind + " moves right");
    assert.ok(points[2].y > points[0].y + 10, kind + " moves down");
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const player = await browser.newPage();
  const snapshot = await page.evaluate(() => desk.command("state"));
  let loads = 0;
  await player.route(snapshot.overlay.url, async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (++loads === 1)
      body = body.replace(
        /name="reward-build" content="[^"]+"/,
        'name="reward-build" content="older-build"',
      );
    await route.fulfill({ response, body });
  });
  await player.goto(snapshot.overlay.url);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && loads < 2) await page.waitForTimeout(100);
  assert.equal(
    loads,
    2,
    "Outdated OBS page reloads exactly once before becoming ready",
  );
  await page.waitForTimeout(1500);
  assert.equal(loads, 2, "Matching build never loops reloads");
  const obsPoints = [];
  for (const anchor of ["top-left", "bottom-right"]) {
    for (const kind of ["caption", "duration"])
      await page
        .locator(`[data-text-kind="${kind}"][data-text-anchor="${anchor}"]`)
        .click();
    await page.locator("#save").click();
    await page.evaluate((id) => desk.command("test", { id }), reward.id);
    await player.locator('[data-kind="duration"]').waitFor();
    obsPoints.push(
      await player
        .locator(".video-caption")
        .evaluateAll((els) =>
          els.map((el) => ({
            kind: el.dataset.kind,
            x: el.offsetLeft,
            y: el.offsetTop,
          })),
        ),
    );
    await player.screenshot({
      path: path.join(out, `controls-obs-${anchor}.png`),
    });
    await player.locator("video.clip").waitFor({ state: "detached" });
  }
  for (const kind of ["caption", "duration"]) {
    const from = obsPoints[0].find((p) => p.kind === kind);
    const to = obsPoints[1].find((p) => p.kind === kind);
    assert.ok(to.x > from.x + 10 && to.y > from.y + 10, kind + " moves in OBS");
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ordinaryTypingAndSave: true,
      anchorsVisiblyMove: true,
      typingAfterStopConfirmation: true,
      overlayBuildRefresh: true,
      obsAnchorsMove: true,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await app?.close();
  });
