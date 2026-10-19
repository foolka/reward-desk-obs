const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { Store } = require("../core/store.cjs"),
  { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, "library-")),
  store = new Store(profile);
const a = store.putReward({ ...initialReward(), title: "Звук - Чипи Чапа" }),
  b = store.putReward({ ...initialReward(), title: "Звук - Скетман" }),
  v = store.putReward({ ...initialReward("video"), title: "MPause - рулетка" });
store.close();
let app;
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
  await page.locator("#kind-audio[aria-selected=true]").waitFor();
  await page.locator(".reward-item").first().waitFor();
  assert.equal(await page.locator(".reward-item").count(), 2);
  for (const key of ["streamLimit", "userLimit", "cooldown"]) {
    const field = page.locator(`[data-field=${key}]`);
    assert.equal(await field.inputValue(), "0");
    assert.equal(await field.isDisabled(), true);
  }
  await page.locator("[data-limit=cooldown]").check();
  await page.locator("[data-field=cooldown]").fill("120");
  await page.locator("#save").click();
  assert.equal(
    (await page.evaluate(() => desk.command("state"))).rewards.find(
      (r) => r.id === a.id,
    ).cooldown,
    120,
  );
  await page.locator("[data-limit=cooldown]").uncheck();
  assert.equal(await page.locator("[data-field=cooldown]").inputValue(), "0");
  await page.locator("#save").click();
  await page.locator("[data-field=prompt]").fill("Сохранить мой черновик");
  await page.locator("#kind-video").click();
  assert.equal(await page.locator(".reward-item").count(), 1);
  assert.equal(
    await page.locator("#kind-video").getAttribute("aria-selected"),
    "true",
  );
  await page.locator("#kind-audio").click();
  assert.equal(
    await page.locator("[data-field=prompt]").inputValue(),
    "Сохранить мой черновик",
  );
  await page.locator("#manage-groups").click();
  await page.locator("#group-name").fill("Музыка");
  await page.locator("#group-color").fill("#cc4477");
  await page.locator(`#group-members input[value="${a.id}"]`).check();
  await page.locator(`#group-members input[value="${v.id}"]`).check();
  await page.locator("#group-save").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#group-result")
      .textContent.includes("Цвет применён"),
  );
  let snapshot = await page.evaluate(() => desk.command("state"));
  assert.equal(snapshot.groups.length, 1);
  assert.equal(
    snapshot.rewards.find((r) => r.id === a.id).background,
    "#cc4477",
  );
  assert.equal(snapshot.drafts[a.id].value.prompt, "Сохранить мой черновик");
  await page.locator("#groups-dialog [aria-label=Закрыть]").click();
  assert.equal(
    await page.locator("[data-field=prompt]").inputValue(),
    "Сохранить мой черновик",
  );
  assert.match(await page.locator("#reward-list").textContent(), /Музыка/);
  for (const width of [1440, 1040, 760]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
      width,
    );
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const fits = await page
      .locator("aside")
      .evaluate((aside) =>
        [...aside.querySelectorAll("button,input")].every(
          (el) =>
            el.getBoundingClientRect().right <=
            aside.getBoundingClientRect().right + 1,
        ),
      );
    assert.ok(fits, "Sidebar overflow " + width);
    const stripes = await page.locator(".reward-item").evaluateAll((items) =>
      items.map((item) => {
        const row = item.getBoundingClientRect();
        const stripe = item
          .querySelector(".reward-swatch")
          .getBoundingClientRect();
        return (
          Math.abs(stripe.top - row.top) < 1 &&
          Math.abs(stripe.bottom - row.bottom) < 1 &&
          Math.abs(stripe.left - row.left) < 1 &&
          stripe.width === 6
        );
      }),
    );
    assert.ok(
      stripes.length && stripes.every(Boolean),
      "Full-height reward colors " + width,
    );
    await page.screenshot({ path: path.join(out, `library-${width}.png`) });
  }
  await page.locator("#kind-video").click();
  const before = snapshot.rewards.length;
  await page.locator("#new-reward").click();
  await page.waitForFunction(
    async (n) => (await desk.command("state")).rewards.length === n + 1,
    before,
  );
  snapshot = await page.evaluate(() => desk.command("state"));
  assert.equal(snapshot.rewards.at(-1).kind, "video");
  await page.locator("[data-tab=settings]").click();
  assert.equal(await page.locator("#obs-local").isVisible(), true);
  assert.equal(await page.locator("#obs-ws-password").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      kindTabs: true,
      createSelectedKind: true,
      disabledLimitsZero: true,
      groupsPreserveDrafts: true,
      groupColors: true,
      fullHeightColors: true,
      responsive: true,
      oneButtonObsSetup: true,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await app?.close();
  });
