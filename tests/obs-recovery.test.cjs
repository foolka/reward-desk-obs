const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { ObsRecovery } = require("../core/obs-control.cjs");
const { prepareObs } = require("../core/obs-setup.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function fixture() {
  let now = 100000,
    healthy = 0,
    playing = false,
    enabled = true,
    active = true, changedUrl = false, afterActivity = false, localError = '';
  const requests = [],
    logs = [];
  const socket = {
    ready: true,
    connect: async () => {},
    close() {
      this.ready = false;
    },
    request: async (type, data) => {
      requests.push({ type, data });
      if (type === "GetInputList")
        return { inputs: [{ inputName: "other" }, { inputName: "ours" }] };
      if (type === "GetInputSettings")
        return {
          inputSettings: {
            url:
              data.inputName === "ours" && !(changedUrl && afterActivity)
                ? "http://127.0.0.1:18874/o/secret/"
                : "https://other.test",
          },
        };
      if (type === "GetSourceActive") {
        afterActivity = true;
        assert.equal(data.sourceName, "ours");
        return { videoActive: active };
      }
      if (type === "PressInputPropertiesButton") return {};
      throw Error("Unexpected OBS request: " + type);
    },
  };
  const recovery = new ObsRecovery({
    config: { port: 4455, password: "secret" },
    overlay: {
      view: () => ({ obsClients: healthy, error: localError }),
      url: () => "http://127.0.0.1:18874/o/secret/",
    },
    engine: { playing: () => playing },
    store: { meta: () => enabled, log: (m) => logs.push(m) },
    connect: () => socket,
    now: () => now,
  });
  return {
    recovery,
    requests,
    logs,
    advance: (ms) => (now += ms),
    setHealthy: (n) => (healthy = n),
    setPlaying: (n) => (playing = n),
    setEnabled: (n) => (enabled = n),
    setActive: (n) => (active = n),
    changeUrl: () => (changedUrl = true),
    setError: (text) => (localError = text),
  };
}
test("missing active OBS source is refreshed only after grace, exact URL, with bounded retries", async () => {
  const f = fixture();
  await f.recovery.tick();
  assert.equal(f.requests.length, 0);
  f.advance(21000);
  await f.recovery.tick();
  const refresh = () =>
    f.requests.filter((r) => r.type === "PressInputPropertiesButton");
  assert.deepEqual(refresh()[0].data, {
    inputName: "ours",
    propertyName: "refreshnocache",
  });
  assert.equal(refresh().length, 1);
  await f.recovery.tick();
  assert.equal(refresh().length, 1);
  f.advance(61000);
  await f.recovery.tick();
  f.advance(61000);
  await f.recovery.tick();
  f.advance(61000);
  await f.recovery.tick();
  assert.equal(refresh().length, 3);
  assert.match(f.recovery.status, /не восстановлен/);
  assert.equal(JSON.stringify(f.recovery.view()).includes("secret"), false);
});
test("healthy, playing, disabled and inactive sources are not refreshed", async () => {
  for (const mode of ["healthy", "playing", "disabled", "inactive"]) {
    const f = fixture();
    await f.recovery.tick();
    f.advance(30000);
    if (mode === "healthy") f.setHealthy(1);
    if (mode === "playing") f.setPlaying(true);
    if (mode === "disabled") f.setEnabled(false);
    if (mode === "inactive") f.setActive(false);
    await f.recovery.tick();
    assert.equal(
      f.requests.some((r) => r.type === "PressInputPropertiesButton"),
      false,
      mode,
    );
  }
});
test("one-button setup preserves existing OBS fields, backs up, and refuses changes while OBS runs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obs-setup-")),
    file = path.join(root, "config.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = {
    server_enabled: false,
    server_port: 4455,
    auth_required: false,
    custom: "preserve",
  };
  fs.writeFileSync(file, JSON.stringify(original));
  let backup;
  assert.throws(
    () => prepareObs(file, { running: () => true, backup: () => {} }),
    /закройте OBS/,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), original);
  const result = prepareObs(file, {
    running: () => false,
    backup: (raw) => (backup = raw),
  });
  assert.deepEqual(JSON.parse(backup), original);
  assert.equal(result.prepared, true);
  assert.ok(result.config.password.length > 20);
  const changed = JSON.parse(fs.readFileSync(file));
  assert.equal(changed.custom, "preserve");
  assert.equal(changed.auth_required, true);
  assert.equal(changed.server_enabled, true);
  assert.equal(
    prepareObs(file, { running: () => true, backup: () => assert.fail() })
      .prepared,
    false,
  );
  assert.equal(prepareObs(file,{running:()=>false,backup:()=>assert.fail()}).prepared,true);
});

test('refresh rechecks URL and never touches a reassigned or locally unavailable source',async()=>{
  for(const mode of ['changed','local-error']){
    const f=fixture();await f.recovery.tick();f.advance(21000);
    if(mode==='changed')f.changeUrl();else f.setError('Port unavailable');
    await f.recovery.tick();
    assert.equal(f.requests.some(r=>r.type==='PressInputPropertiesButton'),false);
  }
});
test('brief recovery cannot bypass refresh rate limits; disabling closes the connection',async()=>{
  const f=fixture();await f.recovery.tick();f.advance(21000);await f.recovery.tick();
  assert.equal(f.recovery.attempts.length,1);
  f.setHealthy(1);await f.recovery.tick();assert.equal(f.recovery.attempts.length,1);
  f.setHealthy(0);await f.recovery.tick();f.advance(21000);await f.recovery.tick();
  assert.equal(f.requests.filter(r=>r.type==='PressInputPropertiesButton').length,1);
  f.advance(39000);await f.recovery.tick();
  assert.equal(f.requests.filter(r=>r.type==='PressInputPropertiesButton').length,2);
  for(let i=0;i<3;i++){
    f.setHealthy(1);await f.recovery.tick();f.setHealthy(0);await f.recovery.tick();
    f.advance(60000);await f.recovery.tick();
  }
  assert.equal(f.requests.filter(r=>r.type==='PressInputPropertiesButton').length,3);
  f.advance(60000);await f.recovery.tick();
  assert.equal(f.requests.filter(r=>r.type==='PressInputPropertiesButton').length,4);
  f.setEnabled(false);await f.recovery.tick();assert.equal(f.recovery.socket,null);
  assert.equal(f.recovery.view().status,'Защита выключена');
});
