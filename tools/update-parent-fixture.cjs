const fs = require("node:fs"),
  path = require("node:path");
const { launchInstaller } = require("../core/updates.cjs");
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
(async () => {
  await launchInstaller(spec.download, { ...spec.context, pid: process.pid });
  fs.writeFileSync(path.join(spec.download.folder, "commit"), "install");
  // Exit naturally while the unreferenced Windows helper continues independently.
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
