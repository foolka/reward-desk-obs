const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), version = require("../package.json").version;
const payload = path.join(root, "release/reward-desk-obs-payload");
const moduleRoot = path.join(payload, "reward-desk-obs");
fs.mkdirSync(path.join(moduleRoot, "bin/64bit"), { recursive: true });
fs.mkdirSync(path.join(moduleRoot, "data"), { recursive: true });
fs.copyFileSync(path.join(root, "obs-plugin/build/Release/reward-desk-obs.dll"), path.join(moduleRoot, "bin/64bit/reward-desk-obs.dll"));
fs.cpSync(path.join(root, "release/RewardDeskOBS-win32-x64"), path.join(moduleRoot, "data/runtime"), { recursive: true });
for (const name of ["README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"])
  fs.copyFileSync(path.join(root, name), path.join(moduleRoot, "data", name));
const r = spawnSync(process.env.ISCC_EXE || path.join(root, ".deps/inno/ISCC.exe"), ["/Qp", `/DAppVersion=${version}`, `/DPackageDir=${moduleRoot}`, `/DOutputDir=${path.join(root, "release")}`, path.join(root, "obs-plugin/installer.iss")], { stdio: "inherit", windowsHide: true });
if (r.error || r.status !== 0) throw Error(r.error?.message || "Installer compilation failed");
const file = path.join(root, `release/reward-desk-obs-${version}-windows-x64-setup.exe`);
fs.writeFileSync(file + ".sha256", crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") + "  " + path.basename(file) + "\n");
console.log(file);
