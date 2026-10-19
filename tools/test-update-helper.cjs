const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { Store, importMedia } = require("../core/store.cjs");
const { initialReward } = require("../core/model.cjs");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-results");
fs.mkdirSync(out, { recursive: true });
const folder = fs.mkdtempSync(path.join(out, "update-helper-"));
const target = path.join(folder, "Mock Installation");
const profile = path.join(folder, "Mock Profile");
fs.mkdirSync(target);
const powershell = path.join(
  process.env.SystemRoot,
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const payload = path.join(folder, "payload.exe");
execFileSync(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -Path $env:RD_FIXTURE_SOURCE -OutputAssembly $env:RD_FIXTURE_OUTPUT -OutputType WindowsApplication",
  ],
  {
    windowsHide: true,
    env: {
      ...process.env,
      RD_FIXTURE_SOURCE: path.join(__dirname, "update-fixture.cs"),
      RD_FIXTURE_OUTPUT: payload,
    },
  },
);
const installer = path.join(folder, "setup.exe");
fs.copyFileSync(payload, installer);
const mediaPath = path.join(folder, "fixture.mp4");
fs.writeFileSync(mediaPath, "synthetic media");
const store = new Store(profile);
const media = importMedia(store, mediaPath, "video");
const reward = store.saveReward({
  ...initialReward("video"),
  title: "Unpublished test",
  items: [{ id: media.id, volume: 80, weight: 1 }],
});
store.stashDraft({ ...reward, prompt: "Unapplied local draft" });
const token = store.meta("overlayToken");
store.close();
const download = {
  folder,
  file: installer,
  hash: createHash("sha256").update(fs.readFileSync(installer)).digest("hex"),
  version: "0.6.0",
};
(async () => {
  const context = {
    profile,
    executable: path.join(target, "RewardDesk.exe"),
    backupRoot: path.join(folder, "Backups"),
  };
  const spec = path.join(folder, "test-spec.json");
  fs.writeFileSync(spec, JSON.stringify({ download, context }));
  execFileSync(
    process.execPath,
    [path.join(__dirname, "update-parent-fixture.cjs"), spec],
    { windowsHide: true, timeout: 25000 },
  );
  let result;
  for (let i = 0; i < 300; i++) {
    if (fs.existsSync(path.join(folder, "result.json"))) {
      result = JSON.parse(
        fs
          .readFileSync(path.join(folder, "result.json"), "utf8")
          .replace(/^\uFEFF/, ""),
      );
      if (!result.success || fs.existsSync(path.join(target, "restarted.txt")))
        break;
    }
    await delay(100);
  }
  assert.equal(result?.success, true, JSON.stringify(result));
  assert.ok(fs.existsSync(path.join(target, "restarted.txt")));
  const verify = new Store(profile);
  assert.equal(verify.reward(reward.id).title, reward.title);
  assert.equal(
    verify.drafts()[reward.id].value.prompt,
    "Unapplied local draft",
  );
  assert.equal(verify.meta("overlayToken"), token);
  verify.close();
  assert.equal(
    fs.readFileSync(
      path.join(result.backup, "RewardDesk/media", media.id + media.ext),
      "utf8",
    ),
    "synthetic media",
  );
  assert.ok(fs.existsSync(path.join(result.backup, "checksums.json")));
  assert.match(
    fs.readFileSync(path.join(target, "installer-args.txt"), "utf8"),
    /\/NORESTART/,
  );
  console.log(
    JSON.stringify({
      isolatedHelper: true,
      verifiedProfileBackup: true,
      localDraftPreserved: true,
      mockInstallerCompleted: true,
      mockApplicationRelaunched: true,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
