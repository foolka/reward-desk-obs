const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { initialReward, normalizeReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const reward = initialReward();
let snapshot = {
  version: require("../package.json").version,
  rewards: [reward],
  media: [],
  jobs: [],
  logs: [],
  auth: { user: { id: "owner", login: "test_channel" }, status: "ready" },
  authClientId: "client",
  clientId: "client",
  twitch: "Twitch подключён",
  chat: {
    status: "Команды чата подключены",
    ready: true,
    reauthRequired: false,
  },
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
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.exposeFunction("rpc", (name, arg) => {
      if (name === "save")
        snapshot.rewards[0] = normalizeReward(arg, snapshot.rewards[0]);
      else if (name !== "state") throw Error("Unexpected command: " + name);
      return structuredClone(snapshot);
    });
    await page.addInitScript(() => {
      window.desk = {
        stashDraft: () => ({ ok: true }),
        command: (name, arg) => window.rpc(name, arg),
        onState: (fn) => (window.emitState = fn),
        filePath() {},
      };
    });
    await page.goto(pathToFileURL(path.join(root, "ui/index.html")).href);
    await page.locator("#chat-enabled").waitFor();
    assert.equal(await page.locator(".chat-fields").isVisible(), false);
    await page.locator("#chat-enabled").check();
    await page.locator("#chat-command").fill("!SOUND");
    await page.locator("#chat-users").fill("@Alice, BOB\nalice");
    await page.locator("#chat-cooldown").fill("7");
    await page.locator("#save").click();
    await page.waitForFunction(
      () => !document.querySelector("#save").textContent.includes("*"),
    );
    assert.deepEqual(snapshot.rewards[0].chat, {
      enabled: true,
      command: "!sound",
      users: ["alice", "bob"],
      cooldown: 7,
    });
    await page.locator("#chat-users").fill("charlie");
    await page.locator("#chat-cooldown").fill("0");
    await page.locator("#save").click();
    await page.waitForFunction(
      () => !document.querySelector("#save").textContent.includes("*"),
    );
    assert.deepEqual(snapshot.rewards[0].chat.users, ["charlie"]);
    for (const width of [1440, 1040, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(".chat-section").scrollIntoViewIfNeeded();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator('[data-help="chatUsers"]').hover();
      assert.match(
        await page.locator("#option-tooltip").textContent(),
        /владельца и модераторов/,
      );
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: path.join(out, `chat-command-${width}.png`),
      });
    }
    snapshot.chat = {
      ready: false,
      reauthRequired: true,
      status: "Нужен повторный вход",
    };
    await page.evaluate((s) => emitState(s), snapshot);
    assert.equal(await page.locator("#chat-access").isVisible(), true);
    await page.locator("#chat-enabled").uncheck();
    await page.locator("#save").click();
    await page.waitForFunction(
      () => !document.querySelector("#save").textContent.includes("*"),
    );
    assert.equal(snapshot.rewards[0].chat.enabled, false);
    assert.deepEqual(snapshot.rewards[0].chat.users, ["charlie"]);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        chatSettings: true,
        responsiveWidths: [1440, 1040, 760],
        reauthorizationNotice: true,
        preservedAfterSave: true,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
