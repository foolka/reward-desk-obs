const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Control } = require("../core/control.cjs");
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reward-control-test-"));
  let time = 1, visible = false, saved;
  const control = new Control({ root, snapshot: () => ({ version: "0.8.0", rewards: [], jobs: [], logs: [], auth: {}, overlay: {}, preferences: {}, updates: {} }),
    now: () => time, desktopVisible: () => visible, stash: (v) => { saved = v; }, upload: (_, p) => ({ bytes: fs.statSync(p).size }),
    openEditor: async () => {}, execute: async (command) => ({ command }) });
  await control.start();
  t.after(() => { control.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const editor = "0123456789abcdef", key = control.editorKey;
  const request = (route, body, options = {}) => fetch(control.origin + route, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer " + key, "X-Reward-Editor": editor,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== "headers")) });
  return { control, request, root, editor, key, saved: () => saved, advance: () => { time += 91000; }, visible: (v) => { visible = v; } };
}
test("control requires capabilities and refuses other origins and host rebinding", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.control.origin + "/api/state")).status, 401);
  assert.equal((await f.request("/api/claim", {}, { headers: { Origin: "https://evil.example" } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = require("node:http").request(f.control.origin + "/api/state", { headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await f.request("/api/claim", {})).status, 200);
  assert.equal((await f.request("/api/state")).status, 200);
});
test("dock can control playback but cannot save, import, or read full profile", async (t) => {
  const f = await fixture(t), headers = { Authorization: "Bearer " + f.control.dockKey };
  assert.equal((await f.request("/dock/state", undefined, { headers })).status, 200);
  assert.equal((await f.request("/dock/command", { command: "pause", arg: true }, { headers })).status, 200);
  assert.equal((await f.request("/dock/command", { command: "save" }, { headers })).status, 403);
  assert.equal((await f.request("/api/state", undefined, { headers })).status, 401);
  assert.equal((await f.request("/dock/state")).status, 401);
});
test("only one browser editor can write, and the desktop cannot overwrite it", async (t) => {
  const f = await fixture(t);
  f.visible(true);
  assert.equal((await f.request("/api/claim", {})).status, 409);
  f.visible(false);
  assert.equal((await f.request("/api/claim", {})).status, 200);
  assert.throws(() => f.control.assertDesktop());
  assert.equal((await f.request("/api/claim", {}, { headers: { "X-Reward-Editor": "other-editor-012345" } })).status, 409);
  const draft = { id: "reward", title: "Safe draft" };
  assert.equal((await f.request("/api/draft", draft)).status, 200);
  assert.deepEqual(f.saved(), draft);
  assert.equal((await f.request("/api/leave", { token: f.key, editor: f.editor, draft })).status, 200);
  assert.doesNotThrow(() => f.control.assertDesktop());
  assert.equal((await f.request("/api/draft", draft)).status, 409);
});
test("expired editor must reopen; a stale tab cannot overwrite another session", async (t) => {
  const f = await fixture(t);
  await f.request("/api/claim", {}); f.advance();
  assert.equal((await f.request("/api/draft", { id: "x" })).status, 409);
  await f.request("/api/claim", {}, { headers: { "X-Reward-Editor": "new-editor-012345678" } });
  assert.equal((await f.request("/api/draft", { id: "x" })).status, 409);
});
test("browser cannot submit local file paths or native lifecycle commands", async (t) => {
  const f = await fixture(t); await f.request("/api/claim", {});
  for (const command of ["import", "quit", "preview"])
    assert.equal((await f.request("/api/command", { command, arg: { paths: ["C:\\secret"] } })).status, 403);
});
test("uploads restrict names, static routes never expose profile or source", async (t) => {
  const f = await fixture(t); await f.request("/api/claim", {});
  for (const name of ["../secret.mp3", "C:\\secret.mp3", "malware.exe"])
    assert.equal((await f.request("/api/upload?id=x&name=" + encodeURIComponent(name), "data")).status, 400);
  for (const route of ["/rewards.sqlite", "/core/profile.cjs", "/editor/../main.cjs", "/auth.bin"])
    assert.notEqual((await fetch(f.control.origin + route)).status, 200);
  const page = await fetch(f.control.origin + "/editor/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /browser.js/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});
test("endpoint rotates on restart and is removed only by its owner", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "obs-control-endpoint.json");
  assert.equal(JSON.parse(fs.readFileSync(file)).token, f.control.dockKey);
  fs.writeFileSync(file, JSON.stringify({ token: "newer-process" }));
  f.control.close(); assert.ok(fs.existsSync(file));
});
