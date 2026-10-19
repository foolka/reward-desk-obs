const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../obs-plugin");
const env = Object.fromEntries(Object.entries(process.env).map(([k,v]) => [k.toUpperCase() === "PATH" ? "Path" : k.toUpperCase(), v]));
env.MSBUILDDISABLENODEREUSE = "1";
function run(file, args, pipe = false) {
  const r = spawnSync(file, args, { cwd: root, env, windowsHide: true, encoding: "utf8", stdio: pipe ? "pipe" : "inherit" });
  if (r.error || r.status !== 0) throw Error(r.error?.message || r.stderr || `Failed: ${file}`);
  return r.stdout;
}
const vswhere = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio/Installer/vswhere.exe");
const vs = JSON.parse(run(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-format", "json"], true))[0];
if (!vs || !process.env.QT_SDK) throw Error("Visual Studio C++ and QT_SDK (OBS Qt 6.8 x64 SDK) are required");
const cmake = process.env.CMAKE_EXE || path.join(vs.installationPath, "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe");
if (!fs.existsSync(cmake)) throw Error("CMake not found");
const generator = Number(vs.installationVersion.split(".")[0]) >= 17 ? "Visual Studio 17 2022" : "Visual Studio 16 2019";
run(cmake, ["-S", root, "-B", path.join(root,"build"), "-G", generator, "-A", "x64", `-DCMAKE_PREFIX_PATH=${process.env.QT_SDK}`]);
run(cmake, ["--build", path.join(root,"build"), "--config", "Release", "--parallel", "1", "--", "/nodeReuse:false"]);
