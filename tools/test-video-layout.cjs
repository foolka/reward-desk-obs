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
const profile = fs.mkdtempSync(path.join(out, "video-fit-"));
const seed = new Store(profile),
  rewards = [];
for (const [name, width, height] of [
  ["wide", 960, 400],
  ["portrait", 360, 640],
  ["square", 400, 400],
]) {
  const file = path.join(profile, name + ".webm");
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x22cc77:s=${width}x${height}:r=20`,
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
  const media = importMedia(seed, file, "video"),
    reward = initialReward("video");
  rewards.push(
    seed.saveReward({
      ...reward,
      title: name,
      items: [{ id: media.id, weight: 1, volume: 50 }],
      video: {
        ...reward.video,
        border: 16,
        color: "#e23399",
        radius: 0,
        width: 600,
        height: 340,
        angle: 0,
      },
    }),
  );
}
seed.close();
let app, browser;
async function waitDone(page, id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => desk.command("state"));
    const job = state.jobs.find((job) => job.id === id);
    if (job?.state === "done") return;
    assert.ok(
      !["failed", "attention"].includes(job?.state),
      JSON.stringify(job),
    );
    await page.waitForTimeout(100);
  }
  throw Error("Playback did not finish: " + id);
}
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
  });
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".reward-item").first().waitFor();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const player = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  player.on("pageerror", (error) => errors.push(error.message));
  const snapshot = await page.evaluate(() => desk.command("state"));
  await player.goto(snapshot.overlay.url);
  await page.waitForFunction(
    async () => (await desk.command("state")).overlay.clients === 1,
  );
  for (const reward of rewards) {
    await page.locator(`[data-id="${reward.id}"]`).click();
    await page.waitForFunction(
      () => document.querySelector("#placement video")?.readyState >= 2,
    );
    for (const [width, height] of [
      [1440, 1000],
      [1040, 900],
      [760, 850],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setContentSize(...size),
        [width, height],
      );
      await page.waitForTimeout(100);
      await page.locator("#placement").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const v = document.querySelector("#placement video");
        return v?.readyState >= 2 && !v.seeking;
      });
      const fit = await page.locator("#placement").evaluate((frame) => {
        const video = frame.querySelector("video"),
          style = getComputedStyle(frame);
        const contentWidth =
          frame.getBoundingClientRect().width -
          parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth);
        const contentHeight =
          frame.getBoundingClientRect().height -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth);
        return {
          gap: Math.abs(
            contentWidth / (video.videoWidth / video.videoHeight) -
              contentHeight,
          ),
          outerWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
        };
      });
      assert.ok(
        fit.gap < 3,
        `${reward.title} preview letterbox at ${width}: ${fit.gap}`,
      );
      assert.ok(
        fit.outerWidth <= fit.viewport,
        `Preview page overflow at ${width}`,
      );
      const scroll = await page.evaluate(() => {
        const main = document.querySelector("main");
        const header = document
          .querySelector(".app-header")
          .getBoundingClientRect();
        const title = document
          .querySelector(".window-titlebar")
          .getBoundingClientRect();
        const nav = document.querySelector("#source-health").getBoundingClientRect();
        return {
          y: scrollY,
          scroll: main.scrollTop,
          top: main.getBoundingClientRect().top,
          navBottom: nav.bottom,
          headerTop: header.top,
          titleBottom: title.bottom,
          titleWidth: title.width,
          viewport: innerWidth,
        };
      });
      assert.equal(
        scroll.y,
        0,
        "Document must not scroll over window controls",
      );
      assert.ok(scroll.scroll > 0, "Only the main content scrolls");
      assert.equal(scroll.top, scroll.navBottom);
      assert.equal(scroll.headerTop, scroll.titleBottom);
      assert.equal(
        scroll.titleWidth,
        scroll.viewport,
        "Scrollbar does not consume titlebar width",
      );
      assert.ok(
        await page
          .locator(".media-row")
          .evaluate((row) => row.getBoundingClientRect().height <= 52),
        "Compact media row",
      );
      await page.screenshot({
        path: path.join(out, `fit-${reward.title}-${width}.png`),
        fullPage: true,
      });
    }
    const job = await page.evaluate(
      (id) => desk.command("test", { id }),
      reward.id,
    );
    assert.equal(job.jobs[0].rewardId, reward.id);
    await player.locator("video.clip").waitFor();
    await player.waitForFunction(
      () => document.querySelector("video")?.currentTime > 0.3,
    );
    const gap = await player.locator("video").evaluate((video) => {
      const style = getComputedStyle(video);
      const width =
        parseFloat(style.width) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth);
      const height =
        parseFloat(style.height) -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth);
      return Math.abs(width / (video.videoWidth / video.videoHeight) - height);
    });
    assert.ok(gap < 1, `${reward.title} OBS letterbox: ${gap}`);
    const picture = await player.locator("video").screenshot({
      path: path.join(out, `obs-fit-${reward.title}.png`),
      omitBackground: true,
    });
    const pixels = await app.evaluate(
      ({ nativeImage }, data) => {
        const image = nativeImage.createFromDataURL(data),
          { width, height } = image.getSize(),
          bytes = image.getBitmap();
        return [
          [width / 2, 19],
          [width / 2, height - 20],
          [19, height / 2],
          [width - 20, height / 2],
        ].map(([x, y]) => {
          const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
          return [...bytes.subarray(offset, offset + 4)];
        });
      },
      "data:image/png;base64," + picture.toString("base64"),
    );
    assert.ok(
      pixels.every(([b, g, r, a]) => g > 150 && r < 90 && b < 170 && a === 255),
      `${reward.title}: colored video pixels reach all four inner edges`,
    );
    await waitDone(page, job.jobs[0].id);
    await player.locator("video.clip").waitFor({ state: "detached" });
    await page
      .locator("#caption-text")
      .fill("Спасибо за поддержку!\nНовый ролик");
    await page.locator("#caption-font").selectOption("Arial");
    await page.locator("#caption-size").fill("48");
    await page.locator("#caption-color").fill("#ffee33");
    await page.locator("#duration-enabled").check();
    await page.locator("#duration-font").selectOption("Verdana");
    await page.locator("#duration-color").fill("#ffffff");
    await page.locator("#save").click();
    const captionState = await page.evaluate(() => desk.command("state"));
    const saved = captionState.rewards.find((r) => r.id === reward.id);
    assert.equal(
      saved.items[0].captionText,
      "Спасибо за поддержку!\nНовый ролик",
    );
    assert.equal(saved.video.duration.enabled, true);
    for (const width of [1440, 1040, 760]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setContentSize(w, 1000),
        width,
      );
      await page.locator("#placement").scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const geometry = await page.locator("#placement").evaluate((frame) => {
        const c = frame.querySelector('[data-kind="caption"]'),
          d = frame.querySelector('[data-kind="duration"]');
        return {
          inside: [c, d].every(
            (el) =>
              el.offsetLeft >= 0 &&
              el.offsetTop >= 0 &&
              el.offsetLeft + el.offsetWidth <= frame.clientWidth + 1 &&
              el.offsetTop + el.offsetHeight <= frame.clientHeight + 1,
          ),
          separate: d.offsetTop + d.offsetHeight <= c.offsetTop + 1,
          duration: d.textContent,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(
        geometry.inside,
        true,
        `${reward.title} caption bounds ${width}`,
      );
      assert.equal(
        geometry.separate,
        true,
        `${reward.title} caption separation ${width}`,
      );
      assert.equal(geometry.duration, "0:03");
      assert.equal(geometry.overflow, false);
      await page.screenshot({
        path: path.join(out, `caption-${reward.title}-${width}.png`),
      });
    }
    const played = await page.evaluate(
      (id) => desk.command("test", { id }),
      reward.id,
    );
    const playId = played.jobs[0].id;
    await player.locator('.video-caption[data-kind="caption"]').waitFor();
    await player.waitForFunction(
      () => document.querySelector("video.clip")?.currentTime > 0.4,
    );
    assert.equal(
      await player.locator('[data-kind="duration"]').textContent(),
      "0:03",
    );
    assert.equal(
      await player
        .locator('[data-kind="caption"]')
        .evaluate((el) => getComputedStyle(el).fontWeight),
      "800",
    );
    const rendered = await player
      .locator(".clip-frame")
      .screenshot({ path: path.join(out, `obs-caption-${reward.title}.png`) });
    const coloredText = await app.evaluate(
      ({ nativeImage }, data) => {
        const bytes = nativeImage.createFromDataURL(data).getBitmap();
        let count = 0;
        for (let i = 0; i < bytes.length; i += 4)
          if (bytes[i + 2] > 200 && bytes[i + 1] > 180 && bytes[i] < 110)
            count++;
        return count;
      },
      "data:image/png;base64," + rendered.toString("base64"),
    );
    assert.ok(coloredText > 50, "Caption pixels rendered over video");
    await waitDone(page, playId);
    await player.locator("video.clip").waitFor({ state: "detached" });
    // Independent offsets, styles and disabling survive the next save.
    await page.locator("#caption-text").fill("<b>Текст</b>");
    await page.locator("#caption-x").fill("-25");
    await page.locator("#caption-y").fill("-30");
    await page.locator("#duration-x").fill("25");
    await page.locator("#duration-y").fill("-150");
    await page.locator("#save").click();
    assert.equal(
      await page.locator('#placement [data-kind="caption"]').textContent(),
      "<b>Текст</b>",
    );
    assert.equal(await page.locator("#placement b").count(), 0);
    for (const kind of ["caption", "duration"]) {
      for (const [
        index,
        anchor,
      ] of require("../overlay/caption.js").anchors.entries()) {
        await page
          .locator(`[data-text-kind="${kind}"][data-text-anchor="${anchor}"]`)
          .click();
        assert.equal(await page.locator(`#${kind}-x`).inputValue(), "0");
        assert.equal(await page.locator(`#${kind}-y`).inputValue(), "0");
        const position = await page
          .locator("#placement")
          .evaluate((frame, kind) => {
            const text = frame.querySelector(`[data-kind="${kind}"]`);
            const scale =
              document.querySelector("#stage").getBoundingClientRect().width /
              1920;
            const inset = Math.min(
              12 * scale,
              frame.clientWidth / 4,
              frame.clientHeight / 4,
            );
            return {
              x: text.offsetLeft,
              y: text.offsetTop,
              inset,
              roomX: frame.clientWidth - 2 * inset - text.offsetWidth,
              roomY: frame.clientHeight - 2 * inset - text.offsetHeight,
            };
          }, kind);
        assert.ok(
          Math.abs(
            position.x - position.inset - (position.roomX * (index % 3)) / 2,
          ) < 2,
          `${kind} ${anchor} X`,
        );
        assert.ok(
          Math.abs(
            position.y -
              position.inset -
              (position.roomY * Math.floor(index / 3)) / 2,
          ) < 2,
          `${kind} ${anchor} Y`,
        );
      }
    }
    await page
      .locator('[data-text-kind="caption"][data-text-anchor="top-left"]')
      .click();
    await page.locator("#caption-x").fill("12");
    await page.locator("#caption-y").fill("8");
    await page.locator("#save").click();
    const positions = (
      await page.evaluate(() => desk.command("state"))
    ).rewards.find((r) => r.id === reward.id).video;
    assert.equal(positions.caption.anchor, "top-left");
    assert.equal(positions.caption.x, 12);
    assert.equal(positions.duration.anchor, "bottom-right");
    await page.locator("#caption-item").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(out, `text-controls-${reward.title}.png`),
    });
    await page.locator("#caption-text").fill("");
    await page.locator("#duration-enabled").uncheck();
    await page.locator("#save").click();
    assert.equal(await page.locator("#placement .video-caption").count(), 0);
  }
  const checkbox = page.locator("#allow-repeats"),
    help = page.locator('.option-help[data-help="repeats"]');
  await checkbox.scrollIntoViewIfNeeded();
  assert.equal(await checkbox.isChecked(), false);
  await help.hover();
  await page.locator("#option-tooltip").waitFor();
  assert.match(
    await page.locator("#option-tooltip").textContent(),
    /сохраняется после перезапуска/,
  );
  await help.click();
  assert.equal(
    await checkbox.isChecked(),
    false,
    "Help must not toggle the option",
  );
  const tip = await page.locator("#option-tooltip").boundingBox();
  assert.ok(
    tip.x >= 0 &&
      tip.x + tip.width <=
        (await page.evaluate(() => document.documentElement.clientWidth)) &&
      tip.y >= 0 &&
      tip.y + tip.height <= 1000,
  );
  await page.screenshot({ path: path.join(out, "option-help-760.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#option-tooltip").isVisible(), false);
  await checkbox.focus();
  await help.focus();
  assert.equal(await page.locator("#option-tooltip").isVisible(), true);
  assert.ok((await page.locator("#editor .option-help").count()) >= 25);
  await page.keyboard.press("Escape");
  const roulette = structuredClone(rewards[0]);
  roulette.items = [
    { ...rewards[0].items[0], captionText: "Первый ролик" },
    { ...rewards[1].items[0], captionText: "Второй ролик" },
  ];
  await page.evaluate((value) => desk.command("save", value), roulette);
  await page.locator(`[data-id="${roulette.id}"]`).click();
  assert.equal(
    await page.locator("#caption-text").inputValue(),
    "Первый ролик",
  );
  await page.locator("#caption-item").selectOption(roulette.items[1].id);
  assert.equal(
    await page.locator("#caption-text").inputValue(),
    "Второй ролик",
  );
  await page.waitForFunction(
    (id) =>
      document.querySelector("#placement").dataset.media === id &&
      document.querySelector("#placement video").videoHeight === 640,
    roulette.items[1].id,
  );
  await page.locator("#caption-text").fill("Правка только второго");
  await page.locator("#save").click();
  await page
    .locator(`[data-item="${roulette.items[0].id}"] [data-caption-edit]`)
    .click();
  assert.equal(
    await page.locator("#caption-text").inputValue(),
    "Первый ролик",
  );
  await page.locator("#caption-text").fill("");
  await page.locator("#save").click();
  const beforeRestart = await page.evaluate(() => desk.command("state"));
  assert.deepEqual(
    beforeRestart.rewards
      .find((r) => r.id === roulette.id)
      .items.map((i) => i.captionText),
    ["", "Правка только второго"],
  );
  await page.evaluate(
    ({ id, itemId }) => desk.command("test", { id, itemId }),
    { id: roulette.id, itemId: roulette.items[1].id },
  );
  await player.locator('[data-kind="caption"]').waitFor();
  assert.equal(
    await player.locator('[data-kind="caption"]').textContent(),
    "Правка только второго",
  );
  await player.locator('[data-kind="caption"]').waitFor({ state: "detached" });
  await app.close();
  app = await electron.launch({
    ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
    args: [...(packaged ? [] : [root]), "--test-mode", "--mute-audio"],
    env,
  });
  const reopened = await app.firstWindow();
  await reopened.locator(`[data-id="${roulette.id}"]`).click();
  await reopened.locator("#caption-item").selectOption(roulette.items[1].id);
  assert.equal(
    await reopened.locator("#caption-text").inputValue(),
    "Правка только второго",
  );
  await reopened.locator(`[data-id="${rewards[2].id}"]`).click();
  assert.equal(
    await reopened
      .locator('[data-text-kind="caption"][data-text-anchor="top-left"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await reopened.locator("#caption-x").inputValue(), "12");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      formats: ["wide", "portrait", "square"],
      previewWidths: [1440, 1040, 760],
      obsInnerEdgePixels: true,
      compactRows: true,
      tooltipsMouseAndKeyboard: true,
      captionsAndDuration: true,
      perItemCaptionsAfterRestart: true,
      nineAnchors: true,
      fixedHeaderAndWindowControls: true,
    }),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await app?.close();
  });
