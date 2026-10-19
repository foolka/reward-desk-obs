const { _electron: electron, chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, "appearance-"));
const file = path.join(profile, "Видео.webm");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
  "testsrc2=size=320x180:rate=20", "-t", "30", "-c:v", "libvpx-vp9", "-b:v", "80k", file], { windowsHide: true });
const seed = new Store(profile);
const media = importMedia(seed, file, "video");
const reward = seed.saveReward({ ...initialReward("video"), title: "Видео", prompt: "Без группы",
  items: [{ id: media.id, volume: 0, weight: 1, captionText: "Сохранить" }] });
seed.close();
let app, browser;
const errors = [];
async function launch() {
  const env = { ...process.env, REWARD_DESK_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv[2];
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve(packaged) } : {}),
    args: [...(packaged ? [] : [root]), "--test-mode", "--mute-audio"], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".reward-item").waitFor();
  return page;
}
(async () => {
  let page = await launch();
  const before = await page.evaluate(() => desk.command("state"));
  const url = before.overlay.url;
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.locator("[data-field=prompt]").fill("Не переводить: Сохранить & <video>\nМій текст");
  await page.locator("[data-video=width]").fill("");
  await page.locator("[data-video=x]").fill("");
  await page.locator("#caption-text").fill("Текст: Награды / Rewards");
  const draftBefore = await page.evaluate(() => structuredClone(draft));
  const mediaColor = await page.locator("#border-color").inputValue();
  const editorNode = await page.locator("[data-field=prompt]").evaluateHandle((el) => el);
  await page.locator("#theme-toggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await editorNode.evaluate((el) => el.isConnected), true, "Theme does not rebuild editor");
  await page.locator("#language").selectOption("en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.match(await page.locator("[data-tab=rewards]").textContent(), /Rewards/);
  assert.equal(await page.locator("[data-field=title]").inputValue(), "Видео");
  assert.equal(await page.locator(".editor-head h2").textContent(), "Видео");
  assert.equal(await page.locator("[data-video=width]").inputValue(), "");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("[data-video=x]").inputValue(), "");
  assert.equal(await page.locator("[data-field=prompt]").inputValue(), draftBefore.prompt);
  assert.equal(await page.locator("#caption-text").inputValue(), draftBefore.items[0].captionText);
  assert.equal(await page.locator("#border-color").inputValue(), mediaColor);
  assert.deepEqual(await page.evaluate(() => structuredClone(draft)), draftBefore);
  assert.equal(await page.evaluate(() => dirty), true);
  await page.locator("[data-video=width]").pressSequentially("12e");
  assert.equal(await page.locator("[data-video=width]").evaluate((el) => el.validity.badInput), true);
  const numericNode = await page.locator("[data-video=width]").evaluateHandle((el) => el);
  await page.locator("#language").selectOption("ru");
  assert.equal(await numericNode.evaluate((el) => el.isConnected && el.validity.badInput), true);
  await page.locator("#language").selectOption("en");
  assert.equal(await numericNode.evaluate((el) => el.isConnected && el.validity.badInput), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).colorScheme), "dark");
  await page.locator('[data-video=width]').fill("600");
  await page.locator("#save").click();
  await page.waitForFunction(() => !dirty && !saving);
  await page.locator("#language").selectOption("uk");
  assert.match(await page.locator("[data-tab=rewards]").textContent(), /Нагороди/);
  await page.locator('[data-help=cost]').hover();
  await page.locator("#option-tooltip:not([hidden])").waitFor();
  assert.doesNotMatch(await page.locator("#option-tooltip").textContent(), /Сколько баллов/);

  // The OBS player keeps its job, URL and frame while the app changes language/theme.
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const overlay = await browser.newPage();
  await overlay.goto(url);
  await page.waitForFunction(async () => (await desk.command("state")).overlay.clients > 0);
  await page.locator("#test-reward").click();
  let playing;
  for (let attempt = 0; attempt < 100 && !playing; attempt++) {
    playing = (await page.evaluate(() => desk.command("state"))).jobs.find((j) => j.state === "playing");
    if (!playing) await page.waitForTimeout(100);
  }
  assert.ok(playing, "Test OBS player starts the queued video");
  await page.locator("#language").selectOption("en");
  await page.locator("#theme-toggle").click();
  const active = await page.evaluate(() => desk.command("state"));
  assert.equal(active.overlay.url, url);
  assert.equal(active.jobs.find((j) => j.id === playing.id).state, "playing");
  assert.deepEqual(active.media, before.media);
  await page.evaluate(() => desk.command("stop"));
  await browser.close(); browser = null;

  for (const language of ["ru", "en", "uk"]) {
    await page.locator("#language").selectOption(language);
    for (const size of [[1240, 900], [760, 650]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), size);
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
        await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const overlap = await page.evaluate(() => {
          const controls = document.querySelector(".appearance-controls").getBoundingClientRect();
          const brand = document.querySelector(".brand").getBoundingClientRect();
          return controls.left < brand.right && controls.top < brand.bottom && controls.bottom > brand.top;
        });
        assert.equal(overlap, false, `Header overlap ${language}/${theme}/${size[0]}`);
        await page.screenshot({ path: path.join(out, `appearance-${language}-${theme}-${size[0]}.png`) });
      }
    }
  }
  await page.evaluate(() => {
    const select = document.querySelector("#language");
    for (const language of ["en", "ru", "en", "uk"]) {
      select.value = language;
      select.dispatchEvent(new Event("change"));
    }
    for (let i = 0; i < 4; i++) document.querySelector("#theme-toggle").click();
  });
  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.locator("html").getAttribute("lang"), "uk");
  assert.equal(await page.locator("[data-field=title]").inputValue(), "Видео");
  assert.match(await page.locator("[data-field=prompt]").inputValue(), /Не переводить/);
  const after = await page.evaluate(() => desk.command("state"));
  assert.equal(after.rewards.length, 1);
  assert.equal(after.rewards[0].id, reward.id);
  assert.deepEqual(after.media, before.media);
  assert.deepEqual(errors, []);
  console.log("PASS: live RU/UK/EN + light/dark, drafts/raw input/media preserved, active OBS job unchanged, 12 responsive screenshots, restart persistence");
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); if (app) await app.close(); });
