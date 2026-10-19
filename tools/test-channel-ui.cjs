const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path"),
  fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { initialReward, normalizeSettings } = require("../core/model.cjs");
const root = path.resolve(__dirname, "..");
const local = {
  ...initialReward(),
  id: "local",
  remoteId: "ours",
  account: "owner",
  clientId: "client",
  sync: "synced",
  title: "Видео-сюрприз",
  cost: 750,
  background: "#f59c35",
};
const catalog = {
  account: "owner",
  clientId: "client",
  updatedAt: Date.now(),
  items: [
    {
      id: "ours",
      manageable: true,
      settings: normalizeSettings(local),
      inStock: true,
    },
    {
      id: "old",
      manageable: false,
      settings: normalizeSettings({
        ...initialReward(),
        title: "Награда из панели Twitch",
        cost: 2500,
        background: "#ac477b",
        userLimit: 2,
        cooldown: 90,
      }),
      inStock: true,
    },
    {
      id: "extra",
      manageable: true,
      settings: normalizeSettings({
        ...initialReward(),
        title: "Рулетка звуков",
        cost: 300,
        background: "#259b88",
        paused: true,
      }),
      inStock: false,
    },
  ],
};
const snapshot = {
  version: require("../package.json").version,
  rewards: [local],
  media: [],
  jobs: [],
  logs: [],
  auth: { user: { id: "owner", login: "test_channel" }, status: "ready" },
  authClientId: "client",
  clientId: "client",
  twitch: "Twitch подключён",
  overlay: {
    url: "http://127.0.0.1:18874/o/test/",
    clients: 0,
    port: 18874,
    error: "",
  },
  paused: false,
};
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1080 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ snapshot, catalog }) => {
        const clone = (x) => structuredClone(x);
        window.mock = {
          snapshot,
          catalog,
          saves: [],
          fail: false,
          dashboard: 0,
        };
        window.desk = {
          uiPreferences: { theme: "light", language: "ru" },
          stashDraft: () => ({ ok: true }),
          filePath: () => "",
          onState: (fn) => (window.emitState = fn),
          command: async (name, arg) => {
            if (name === "preferences") return clone(arg);
            if (name === "state") return clone(mock.snapshot);
            if (name === "channel-list") return clone(mock.catalog);
            if (name === "channel-dashboard") {
              mock.dashboard++;
              return;
            }
            if (name === "channel-save") {
              mock.saves.push(clone(arg));
              if (mock.fail)
                throw Error(
                  "Настройки уже изменены в Twitch. Обновите список.",
                );
              const r = mock.catalog.items.find((r) => r.id === arg.id);
              if (!r.manageable) throw Error("Readonly");
              r.settings = clone(arg.settings);
              const local = mock.snapshot.rewards.find(
                (r) => r.remoteId === arg.id,
              );
              if (local) Object.assign(local, clone(arg.settings));
              return clone(mock.catalog);
            }
            if (name === "save") {
              mock.snapshot.rewards[
                mock.snapshot.rewards.findIndex((r) => r.id === arg.id)
              ] = clone(arg);
              return clone(mock.snapshot);
            }
            throw Error("Unexpected test command: " + name);
          },
        };
      },
      { snapshot, catalog },
    );
    await page.goto(pathToFileURL(path.join(root, "ui/index.html")).href);
    await page.locator("#editor [data-field=title]").waitFor();
    // A periodic state update must not detach the editor's draft from its inputs.
    await page.evaluate(() => emitState(structuredClone(mock.snapshot)));
    await page.locator("#editor [data-field=cost]").fill("1200");
    await page.locator("#editor [data-field=background]").fill("#bb6611");
    await page.locator("#editor [data-limit=userLimit]").check();
    await page.locator("#editor [data-field=userLimit]").fill("4");
    await page.locator("#save").click();
    assert.equal(
      await page.evaluate(() => mock.snapshot.rewards[0].cost),
      1200,
    );
    assert.equal(
      await page.evaluate(() => mock.snapshot.rewards[0].background),
      "#bb6611",
    );
    assert.equal(
      await page.evaluate(() => mock.snapshot.rewards[0].userLimit),
      4,
    );
    await page.locator("#editor [data-field=cost]").fill("1250");
    await page.locator("#save").click();
    assert.equal(
      await page.evaluate(() => mock.snapshot.rewards[0].cost),
      1250,
    );
    await page.locator("[data-tab=channel]").click();
    await page.locator("[data-channel-id=old]").waitFor();
    assert.equal(await page.locator("#channel-list tr").count(), 3);
    assert.equal(
      await page
        .locator("#channel-list .reward-swatch")
        .nth(1)
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(172, 71, 123)",
    );
    const rowIds = () =>
      page
        .locator("#channel-list [data-channel-id]")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.channelId),
        );
    for (const [key, ascending] of [
      ["cost", ["extra", "ours", "old"]],
      ["title", ["ours", "old", "extra"]],
      ["color", ["extra", "old", "ours"]],
    ]) {
      await page.locator(`[data-channel-sort=${key}]`).click();
      assert.deepEqual(await rowIds(), ascending);
      assert.equal(
        await page.locator(`[data-column=${key}]`).getAttribute("aria-sort"),
        "ascending",
      );
      await page.locator(`[data-channel-sort=${key}]`).click();
      assert.deepEqual(await rowIds(), [...ascending].reverse());
      await page.locator(`[data-channel-sort=${key}]`).click();
      assert.deepEqual(await rowIds(), ["ours", "old", "extra"]);
    }
    await page.locator("[data-channel-menu=color]").click();
    await page.locator('[data-filter-color="#f59c35"]').click();
    assert.deepEqual(await rowIds(), ["ours"]);
    await page.locator('[data-filter-color="#259b88"]').click();
    assert.deepEqual(await rowIds(), ["ours", "extra"]);
    await page.keyboard.press("Escape");
    await page.locator("[data-channel-menu=cost]").click();
    await page.locator("#channel-cost-min").fill("750");
    await page.locator("#channel-cost-max").fill("750");
    assert.deepEqual(
      await rowIds(),
      ["ours"],
      "Inclusive bounds combine with color filters",
    );
    await page.locator("#channel-cost-min").fill("751");
    assert.deepEqual(await rowIds(), []);
    assert.equal(await page.locator("#channel-range-error").isVisible(), true);
    await page.locator("#channel-cost-min").fill("0");
    assert.equal(
      await page.locator("#channel-cost-min").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("[data-clear-column=cost]").click();
    assert.deepEqual(await rowIds(), ["ours", "extra"]);
    await page.keyboard.press("Escape");
    await page.locator("[data-channel-menu=title]").click();
    await page.locator("#channel-status").selectOption("paused");
    assert.deepEqual(await rowIds(), ["extra"]);
    await page.locator("#channel-name").fill("  РУЛЕТКА  ");
    assert.deepEqual(await rowIds(), ["extra"]);
    assert.equal(
      await page.locator("#channel-search").inputValue(),
      "  РУЛЕТКА  ",
    );
    await page.keyboard.press("Escape");
    await page.locator("#channel-clear-filters").click();
    assert.deepEqual(await rowIds(), ["ours", "old", "extra"]);
    assert.equal(
      await page.locator("#channel-filter-summary").isVisible(),
      false,
    );
    assert.equal(await page.locator("#channel-name").inputValue(), "");
    // Filters and sorting are local UI state, never reward mutations.
    assert.equal(await page.evaluate(() => mock.saves.length), 0);
    for (const status of ["active", "paused", "disabled", "unavailable"]) {
      await page.locator("[data-channel-menu=title]").click();
      await page.locator("#channel-status").selectOption(status);
      assert.deepEqual(
        await rowIds(),
        status === "active"
          ? ["ours", "old"]
          : status === "paused"
            ? ["extra"]
            : [],
      );
      await page.keyboard.press("Escape");
    }
    await page.locator("#channel-clear-filters").click();
    await page.locator("[data-channel-id=old]").click();
    assert.equal(
      await page.locator("#channel-form [data-field=cost]").inputValue(),
      "2500",
    );
    assert.equal(
      await page.locator("#channel-form [data-field=cost]").isDisabled(),
      true,
    );
    await page.locator("#channel-open-twitch").click();
    const readonlyHelp = page.locator(
      '#channel-form .option-help[data-help="cost"]',
    );
    assert.equal(await readonlyHelp.isEnabled(), true);
    await readonlyHelp.focus();
    assert.match(
      await page.locator("#option-tooltip").textContent(),
      /баллов канала/,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => mock.dashboard), 1);
    await page.locator("#channel-filter").selectOption("editable");
    assert.equal(await page.locator("#channel-list tr").count(), 2);
    await page.locator("#channel-search").fill("рулетка");
    assert.equal(await page.locator("#channel-list tr").count(), 1);
    await page.locator("#channel-search").fill("");
    await page.locator("#channel-filter").selectOption("all");
    await page.locator("[data-channel-id=ours]").click();
    await page.locator("#channel-form [data-field=cost]").fill("950");
    await page.locator("#channel-form [data-field=background]").fill("#ee8844");
    await page.locator("#channel-form [data-field=input]").check();
    await page.locator("#channel-form [data-limit=cooldown]").check();
    await page.locator("#channel-form [data-field=cooldown]").fill("45");
    const costInput = await page.locator("#channel-form [data-field=cost]").evaluateHandle((el) => el);
    await page.locator("#channel-form [data-field=cost]").fill("");
    await page.locator("#channel-form [data-field=cost]").pressSequentially("12e");
    await page.locator("#language").selectOption("en");
    assert.equal(await costInput.evaluate((el) => el.isConnected && el.validity.badInput), true);
    await page.locator("#channel-form [data-field=cost]").fill("950");
    await page.locator("#channel-form [data-limit=cooldown]").uncheck();
    assert.equal(await page.locator("#channel-form [data-field=cooldown]").isDisabled(), true);
    await page.locator("#channel-form [data-limit=cooldown]").check();
    await page.locator("#channel-form [data-field=cooldown]").fill("45");
    assert.equal(await page.evaluate(() => channelDraft.cooldown), 45);
    await page.locator("#language").selectOption("ru");
    await page.evaluate(() => emitState(structuredClone(mock.snapshot)));
    assert.equal(
      await page.locator("#channel-form [data-field=cost]").inputValue(),
      "950",
    );
    await page.locator("#channel-save").click();
    await page.waitForFunction(() => mock.saves.length === 1);
    const saved = await page.evaluate(() => mock.saves[0]);
    assert.equal(saved.settings.cost, 950);
    assert.equal(saved.settings.background, "#ee8844");
    assert.equal(saved.settings.cooldown, 45);
    assert.equal(saved.settings.input, true);
    await page.locator("#channel-form [data-field=cost]").fill("999");
    await page.locator("[data-channel-sort=cost]").click();
    await page.locator("#channel-search").fill("рулетка");
    await page.evaluate(() => emitState(structuredClone(mock.snapshot)));
    assert.equal(
      await page.locator("#channel-form [data-field=cost]").inputValue(),
      "999",
    );
    await page.locator("#channel-clear-filters").click();
    await page.evaluate(() => (mock.fail = true));
    await page.locator("#channel-save").click();
    await page.locator("#toast").filter({ hasText: "уже изменены" }).waitFor();
    assert.equal(
      await page.locator("#channel-form [data-field=cost]").inputValue(),
      "999",
    );
    assert.equal(
      await page
        .locator("#channel-save")
        .textContent()
        .then((t) => t.includes("*")),
      true,
    );
    await page.locator("[data-tab=rewards]").click();
    await page.locator('#confirm-dialog [value="cancel"]').click();
    assert.equal(await page.locator("#tab-channel").isVisible(), true);
    await page.locator("#channel-refresh").click();
    await page.locator('#confirm-dialog [value="accept"]').click();
    await page.waitForFunction(() => !channelDirty && !channelBusy);
    await page.locator("#toast").waitFor({ state: "hidden" });
    for (const width of [1440, 1240, 1120, 1040, 760]) {
      await page.setViewportSize({ width, height: 1080 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `Overflow at ${width}`,
      );
      const layout = await page.evaluate(() => {
        const buttons = [
          ...document.querySelectorAll(".column-heading button"),
        ];
        return buttons.every((button) => {
          const rect = button.getBoundingClientRect(),
            cell = button.closest("th").getBoundingClientRect();
          return rect.left >= cell.left && rect.right <= cell.right + 1;
        });
      });
      assert.ok(layout, `Column header overflow at ${width}`);
      await page.screenshot({
        path: path.join(root, "test-results", `channel-${width}.png`),
        fullPage: true,
      });
      for (const column of ["color", "title", "cost"]) {
        await page.locator(`[data-channel-menu=${column}]`).click();
        const popup = page.locator(`#channel-${column}-popover`);
        await page.waitForFunction(
          (id) =>
            document.getElementById(id).matches(":popover-open") &&
            document.getElementById(id).style.left !== "",
          `channel-${column}-popover`,
        );
        const rect = await popup.boundingBox();
        assert.ok(
          rect.x >= 0 &&
            rect.x + rect.width <= width &&
            rect.y >= 0 &&
            rect.y + rect.height <= 1080,
          `Popover overflow: ${column} at ${width}`,
        );
        if (width === 1240 || width === 760)
          await page.screenshot({
            path: path.join(
              root,
              "test-results",
              `filter-${column}-${width}.png`,
            ),
          });
        await page.keyboard.press("Escape");
        assert.equal(await popup.isVisible(), false);
      }
      assert.equal(
        await page.locator("#channel-filter").evaluate((select) => {
          const wrapper = select.parentElement,
            arrow = wrapper.querySelector("svg"),
            bounds = select.getBoundingClientRect(),
            icon = arrow.getBoundingClientRect();
          return (
            wrapper.className === "select-control" &&
            getComputedStyle(select).appearance === "none" &&
            bounds.right - icon.right >= 10 &&
            getComputedStyle(arrow).pointerEvents === "none"
          );
        }),
        true,
      );
    }
    await page.setViewportSize({ width: 760, height: 560 });
    await page.locator("[data-channel-menu=cost]").click();
    await page.locator("#channel-cost-min").fill("900");
    await page.locator("#channel-cost-max").fill("800");
    const shortPopup = await page
      .locator("#channel-cost-popover")
      .boundingBox();
    assert.ok(
      shortPopup.y >= 0 && shortPopup.y + shortPopup.height <= 560,
      "Validation error fits in a short window",
    );
    await page.locator("[data-clear-column=cost]").click();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.screenshot({
      path: path.join(root, "docs/screenshots/channel-rewards.png"),
      fullPage: true,
    });
    await page.locator("[data-tab=rewards]").click();
    assert.equal(
      await page.locator("#editor [data-field=cost]").inputValue(),
      "950",
    );
    await page.locator("[data-tab=channel]").click();
    await page.evaluate(() => {
      mock.snapshot.auth = { user: null, status: "signed-out" };
      mock.snapshot.authClientId = "";
      emitState(structuredClone(mock.snapshot));
    });
    assert.equal(await page.locator("#channel-list tr").count(), 0);
    assert.equal(await page.locator("#channel-form").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        allRewards: true,
        foreignReadOnly: true,
        colors: true,
        settingsSaved: true,
        dirtyStatePreserved: true,
        accountCleared: true,
        columnFilters: true,
        columnSorting: true,
        selectChevronSpacing: true,
        responsiveWidths: [1440, 1240, 1120, 1040, 760],
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
