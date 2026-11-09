const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createHash } = require("node:crypto");
const {
  Updates,
  newer,
  releaseInfo,
  checksumText,
  allowedUrl,
} = require("../core/updates.cjs");
const payload = Buffer.from("synthetic installer; never executed");
const hash = createHash("sha256").update(payload).digest("hex");
const product = require("../core/product.cjs");
const name = `${product.id}-0.6.0-windows-x64-setup.exe`;
const release = {
  tag_name: "v0.6.0",
  draft: false,
  prerelease: false,
  body: "Release notes",
  assets: [name, name + ".sha256"].map((name) => ({
    name,
    state: "uploaded",
    size: payload.length,
    browser_download_url:
      `https://github.com/${product.repository}/releases/download/v0.6.0/` + name,
  })),
};

test("default updater requests release JSON with GitHub JSON Accept header", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requested = { url, options };
    return new Response("", { status: 404 });
  });
  const u = new Updates({ current: "0.5.2" });
  assert.equal((await u.check()).status, "unavailable");
  assert.equal(requested.options.headers.Accept, "application/vnd.github+json");
  assert.equal(requested.url, `https://api.github.com/repos/${product.repository}/releases?per_page=100`);
});
test("strict semantic version checks reject downgrade and malformed versions", () => {
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("0.5.0", "0.5.0"), false);
  assert.equal(newer("0.4.9", "0.5.0"), false);
  assert.throws(() => newer("0.6.0-beta", "0.5.0"));
  assert.equal(releaseInfo(release, "1.0.0"), null);
  assert.throws(() => releaseInfo({ ...release, prerelease: true }, "0.5.0"));
});

test("updates accept only this product repository and assets, never the legacy mixed channel", async () => {
  const other = product.obsPlugin ? "reward-desk" : "reward-desk-obs";
  const wrongRepo = structuredClone(release);
  wrongRepo.assets.forEach(asset => { asset.browser_download_url = asset.browser_download_url.replace(product.repository, "foolka/" + other); });
  assert.throws(() => releaseInfo(wrongRepo, "0.1.0"));
  const wrongAsset = structuredClone(release);
  wrongAsset.assets.forEach(asset => { asset.name = asset.name.replace(product.id + "-", other + "-"); });
  assert.throws(() => releaseInfo(wrongAsset, "0.1.0"));
  const legacy = { ...release, tag_name: "obs-v0.9.0" };
  assert.throws(() => releaseInfo(legacy, "0.1.0"));
  const u = new Updates({ current: "0.5.0", get: async () => new Response(JSON.stringify([legacy, release, { ...release, tag_name: "v9.0.0", prerelease: true }])) });
  assert.equal((await u.check()).release.name, name);
  u.get = async () => new Response(JSON.stringify([legacy]));
  assert.equal((await u.check()).status, "unavailable");
});
test("only exact repository assets and trusted HTTPS redirects accepted", () => {
  assert.ok(releaseInfo(release, "0.5.0"));
  const bad = structuredClone(release);
  bad.assets[0].browser_download_url = "https://github.com/other/repo/test.exe";
  assert.throws(() => releaseInfo(bad, "0.5.0"));
  for (const url of [
    "http://github.com/x",
    "https://github.com.evil.test/x",
    "https://user:pass@github.com/x",
    "https://github.com:8080/x",
  ])
    assert.equal(allowedUrl(url), false);
  assert.equal(
    allowedUrl("https://release-assets.githubusercontent.com/x"),
    true,
  );
  assert.throws(() => checksumText(hash + "  other.exe", name));
});
test("private/missing releases and network failure never claim up to date", async () => {
  const u = new Updates({
    current: "0.5.0",
    get: async () => new Response("", { status: 404 }),
  });
  assert.equal((await u.check()).status, "unavailable");
  u.get = async () => {
    throw Error("offline");
  };
  assert.equal((await u.check()).status, "error");
});

test("local builds are distinguished from the latest published version", async () => {
  const updater = new Updates({ current: "0.12.0", get: async () => new Response(JSON.stringify([release])) });
  const state = await updater.check();
  assert.equal(state.status, "local");
  assert.equal(state.publishedVersion, "0.6.0");
  assert.equal(state.release, undefined);
});

test("automatic checks retry temporary failures and stop when disabled", async () => {
  let timer, cleared = 0;
  const updater = new Updates({ current: "0.5.0", get: async () => { throw Error("offline"); },
    setTimer: (fn, ms) => (timer = { fn, ms }), clearTimer: () => { cleared++; } });
  updater.setAuto(true); assert.equal(timer.ms, 3500);
  await timer.fn(); assert.equal(timer.ms, 300000);
  updater.get = async () => new Response(JSON.stringify([release]));
  await timer.fn(); assert.equal(updater.state.status, "available"); assert.equal(timer.ms, 21600000);
  updater.setAuto(false); assert.equal(updater.auto, false);
  updater.dispose(); assert.ok(cleared >= 3);
});
test("toggling automatic checks during a request cannot create duplicate timers", async () => {
  let finish;
  const timers = [];
  const updater = new Updates({ current: "0.5.0", get: () => new Promise(resolve => { finish = resolve; }),
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimer: () => {} });
  updater.setAuto(true);
  const pending = timers[0].fn();
  updater.setAuto(false); updater.setAuto(true);
  finish(new Response(JSON.stringify([release])));
  await pending;
  assert.equal(timers.length, 2);
  updater.dispose();
});

test("verified download is complete and exact; mismatched hash cannot become installer", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let corrupt = false;
  const u = new Updates({
    current: "0.5.0",
    get: async (url) =>
      new Response(
        url.endsWith("?per_page=100")
          ? JSON.stringify([release])
          : url.endsWith(".sha256")
            ? `${corrupt ? "0".repeat(64) : hash}  ${name}\n`
            : payload,
      ),
  });
  assert.equal((await u.check()).status, "available");
  const result = await u.download(root);
  assert.deepEqual(fs.readFileSync(result.file), payload);
  assert.equal(result.hash, hash);
  u.state.status = "available";
  corrupt = true;
  await assert.rejects(u.download(root), /сумма/);
  assert.equal(u.state.status, "available");
  assert.equal(
    fs
      .readdirSync(root)
      .filter((dir) => fs.existsSync(path.join(root, dir, name))).length,
    1,
  );
});
