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
const profile = fs.mkdtempSync(path.join(out, "ui-"));
const wav = path.join(profile, "studio.wav"),
  video = path.join(profile, "scene.webm");
execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-af",
    "volume=0.03",
    wav,
  ],
  { windowsHide: true },
);
execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-t",
    "3",
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "400k",
    video,
  ],
  { windowsHide: true },
);
const seed = new Store(profile),
  a = importMedia(seed, wav, "audio"),
  v = importMedia(seed, video, "video");
const audio = seed.saveReward({
  ...initialReward(),
  title: "Рулетка звуков",
  prompt: "Звук для стрима",
  cost: 300,
  items: [{ id: a.id, volume: 80, weight: 1 }],
});
const movie = seed.saveReward({
  ...initialReward("video"),
  title: "Видео-сюрприз",
  cost: 750,
  userLimit: 2,
  cooldown: 30,
  items: [{ id: v.id, volume: 70, weight: 3 }],
});
seed.close();
let app, browser;
const errors = [];
(async () => {
  const env = { ...process.env, REWARD_DESK_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv[2];
  app = await electron.launch({
    ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
    args: packaged
      ? ["--test-mode", "--mute-audio"]
      : [root, "--test-mode", "--mute-audio"],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".reward-item").first().waitFor();
  assert.equal(await page.locator(".reward-item").count(), 1);
  await page.locator("[data-tab=channel]").click();
  assert.equal(await page.locator("#channel-refresh").isDisabled(), true);
  assert.match(
    await page.locator("#channel-empty").textContent(),
    /Войдите через Twitch/,
  );
  await page.locator("[data-tab=rewards]").click();
  await page.locator('#kind-video').click();
  await page.locator(`[data-id="${movie.id}"]`).click();
  await page.locator("#placement").waitFor();
  assert.ok(
    await page.locator("#position-mode").evaluate((select) => {
      const style = getComputedStyle(select),
        context = document.createElement("canvas").getContext("2d");
      context.font = style.font;
      return (
        context.measureText(select.selectedOptions[0].textContent).width <=
        select.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
      );
    }),
    "Selected placement label fits beside its chevron",
  );
  await page.locator("[data-field=title]").fill("Видео-сюрприз: новый");
  await page.locator("#save").click();
  await page.waitForFunction(
    () => !document.querySelector("#save").textContent.includes("*"),
  );
  await page.locator("#placement").scrollIntoViewIfNeeded();
  const rect = await page.locator("#placement").boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 35,
    rect.y + rect.height / 2 + 15,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.locator("#tilt").check();
  await page.locator("#border-style").selectOption("dashed");
  await page.locator("#save").click();
  await page.waitForFunction(
    async () =>
      (await desk.command("state")).rewards.find((r) => r.kind === "video")
        .video.angle === 12,
  );
  let s = await page.evaluate(() => desk.command("state"));
  const saved = s.rewards.find((r) => r.kind === "video");
  assert.ok(saved.video.x > 660);
  assert.equal(saved.video.angle, 12);
  assert.equal(saved.video.borderStyle, "dashed");
  const screenshots = path.join(root, "docs/screenshots");
  fs.mkdirSync(screenshots, { recursive: true });
  for (const [w, h] of [
    [1440, 1000],
    [1040, 900],
    [760, 850],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [w, h],
    );
    await page.waitForTimeout(180);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${w}`,
    );
    assert.ok(
      await page.locator("#editor select").evaluateAll(
        (selects) =>
          selects.length === 5 &&
          selects.every((select) => {
            const wrapper = select.parentElement,
              arrow = wrapper.querySelector("svg"),
              bounds = select.getBoundingClientRect(),
              icon = arrow?.getBoundingClientRect();
            return (
              wrapper.className === "select-control" &&
              !wrapper.parentElement.classList.contains("select-control") &&
              getComputedStyle(select).appearance === "none" &&
              icon &&
              bounds.right - icon.right >= 10
            );
          }),
      ),
      `All dynamic select chevrons inset at ${w}`,
    );
    await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, `editor-${w}.png`),
      fullPage: true,
    });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1240, 1100),
  );
  await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, "video-editor.png"),
    fullPage: true,
  });
  await page.locator('#kind-audio').click();
  await page.locator(`[data-id="${audio.id}"]`).click();
  await page.evaluate((file) => addFiles([file]), wav);
  assert.equal(await page.locator(".media-row").count(), 2);
  assert.equal(await page.locator("#media-mode").textContent(), "Рулетка");
  await page.locator("[data-weight]").nth(1).fill("3");
  assert.deepEqual(await page.locator(".chance").allTextContents(), [
    "25.0%",
    "75.0%",
  ]);
  await page.locator("#save").click();
  assert.equal(await page.locator("#allow-repeats").isChecked(), false);
  await page.locator("#allow-repeats").check();
  await page.locator("#save").click();
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await desk.command("state")).rewards.find((r) => r.id === id)
          .allowRepeats,
      audio.id,
    ),
    true,
  );
  await page.locator("[data-weight]").nth(1).fill("5");
  await page
    .locator("[data-volume]")
    .nth(1)
    .evaluate((input) => {
      input.value = "65";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.locator("#save").click();
  const changedMedia = await page.evaluate(
    async (id) =>
      (await desk.command("state")).rewards.find((r) => r.id === id).items[1],
    audio.id,
  );
  assert.equal(changedMedia.weight, 5);
  assert.equal(changedMedia.volume, 65);
  await page.locator("#allow-repeats").uncheck();
  await page.locator("#save").click();
  await page.waitForFunction(
    async (id) =>
      (await desk.command("state")).rewards.find((r) => r.id === id).items
        .length === 2,
    audio.id,
  );
  const recoverySeed = new Store(profile);
  recoverySeed.putReward({
    ...recoverySeed.reward(audio.id),
    sync: "creating",
  });
  recoverySeed.close();
  await page.evaluate(() => command("state"));
  await page.locator("#publish").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#toast")
      .textContent.includes("Twitch отключён в тестовом режиме"),
  );
  const restoreSeed = new Store(profile);
  restoreSeed.putReward({ ...restoreSeed.reward(audio.id), sync: "draft" });
  restoreSeed.close();
  await page.evaluate(() => command("state"));
  await page.locator("#toast").waitFor({ state: "hidden" });
  await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, "audio-editor.png"),
    fullPage: true,
  });
  browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const player = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  player.on("pageerror", (e) => errors.push(e.message));
  await player.goto(s.overlay.url);
  await page.waitForFunction(
    async () => (await desk.command("state")).overlay.clients === 1,
  );
  await page.evaluate((id) => desk.command("test", { id }), movie.id);
  await player.locator("video").waitFor();
  await player.waitForFunction(
    () => document.querySelector("video")?.currentTime > 0.2,
  );
  const pixel = await player.evaluate(() => {
    const v = document.querySelector("video"),
      c = document.createElement("canvas");
    c.width = 100;
    c.height = 60;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, 100, 60);
    return [...ctx.getImageData(0, 0, 100, 60).data].filter(
      (x, i) => i % 4 !== 3 && x > 50,
    ).length;
  });
  assert.ok(pixel > 1000, "Nonblank video");
  await player.screenshot({
    path: path.join(screenshots, "obs-preview.png"),
    omitBackground: true,
  });
  await page.waitForFunction(
    async (id) =>
      (await desk.command("state")).jobs.some(
        (j) => j.rewardId === id && j.state === "done",
      ),
    movie.id,
    { timeout: 15000 },
  );
  await page.evaluate((id) => desk.command("test", { id }), audio.id);
  await player.locator("audio").waitFor({ state: "attached" });
  await page.waitForFunction(
    async (id) =>
      (await desk.command("state")).jobs.some(
        (j) => j.rewardId === id && j.state === "done",
      ),
    audio.id,
    { timeout: 15000 },
  );
  // Two overlay instances must never receive the same play command.
  const second = await browser.newPage();
  await second.goto(s.overlay.url);
  await page.waitForFunction(
    async () => (await desk.command("state")).overlay.clients === 2,
  );
  await page.evaluate((id) => desk.command("test", { id }), movie.id);
  await player.locator("video").waitFor();
  assert.equal(await second.locator("video").count(), 0);
  await player.close();
  await page.waitForFunction(async () =>
    (await desk.command("state")).jobs.some((j) => j.state === "attention"),
  );
  assert.equal(await second.locator("video").count(), 0);
  await page.locator("[data-tab=queue]").click();
  await page.screenshot({
    path: path.join(screenshots, "queue.png"),
    fullPage: true,
  });
  const key = s.overlay.url.split("/o/")[1].split("/")[0];
  await browser.close();
  browser = null;
  await app.close();
  app = null;
  const db = new Store(profile);
  assert.equal(db.meta("overlayToken"), key);
  assert.ok(db.jobs().some((j) => j.state === "attention"));
  assert.equal(db.reward(movie.id).video.angle, 12);
  db.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      responsiveWidths: [1440, 1040, 760],
      audioPlayed: true,
      videoPlayed: true,
      videoPixels: pixel,
      singlePlayback: true,
      interruptionPreserved: true,
      screenshots,
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
