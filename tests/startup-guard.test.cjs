const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const main = path.resolve(__dirname, "../main.cjs");
const realRequire = createRequire(main);
const source = fs.readFileSync(main, "utf8");
const product = require("../core/product.cjs");

for (const mode of ["app", "obs-argument", "obs-marker"]) {
  for (const failure of ["redirect", "access"]) {
    test(`startup stops before database access: ${mode}, ${failure}`, async () => {
      const events = [];
      const root = path.resolve("virtual-test-profile");
      let profile = root, probe, notice, resolveExit;
      const exited = new Promise((resolve) => { resolveExit = resolve; });
      const io = {
        mkdirSync() {},
        existsSync(file) {
          return file === probe || (mode === "obs-marker" && file.endsWith("reward-desk-obs.json"));
        },
        writeFileSync(file) {
          if (failure === "access") throw Object.assign(Error("Access denied"), { code: "EACCES" });
          probe = file;
        },
        unlinkSync(file) { assert.equal(file, probe); probe = undefined; },
        realpathSync: { native(file) { return path.join(root, "redirected", path.basename(file)); } },
      };
      const electron = {
        app: {
          getPath(name) { return name === "appData" ? root : profile; },
          setPath(name, value) { profile = value; },
          setAppUserModelId(value) { assert.equal(value, product.appUserModelId); },
          requestSingleInstanceLock() { return true; },
          getLocale() { return "en-US"; },
          whenReady() { return Promise.resolve(); },
          on() {},
          exit(code) { events.push("exit"); resolveExit(code); },
        },
        dialog: {
          showMessageBoxSync(options) { events.push("notice"); notice = options; return 0; },
          showErrorBox() { assert.fail("Startup must use the typed product notice"); },
        },
      };
      const profileModule = realRequire("./core/profile.cjs");
      vm.runInNewContext(source, {
        __dirname: path.dirname(main),
        process: { argv: mode === "obs-argument" ? ["test.exe", "--obs-plugin"] : ["test.exe"],
          env: {}, resourcesPath: root },
        require(id) {
          if (id === "electron") return electron;
          if (id === "node:fs") return io;
          if (id === "./core/profile.cjs") return {
            ...profileModule,
            assertProfileLocation(directory) { profileModule.assertProfileLocation(directory, io); },
            assertProfileDatabase() { events.push("database-check"); },
          };
          if (id === "./core/store.cjs") return {
            Store: class { constructor() { events.push("database-open"); } },
          };
          return realRequire(id);
        },
      }, { filename: main });
      assert.equal(await exited, 1);
      assert.deepEqual(events, ["notice", "exit"]);
      assert.equal(probe, undefined);
      assert.equal(notice.type, failure === "redirect" ? "info" : "error");
      assert.equal(notice.title, product.name);
      assert.equal(profile, path.join(root, product.profileName), "arguments and legacy markers cannot select the other product profile");
      assert.equal(notice.message, failure === "redirect" ? "Open from your usual shortcut" : "Could not start the app");
    });
  }
}
