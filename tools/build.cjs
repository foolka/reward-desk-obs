const { packager } = require("@electron/packager");
const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const obs = require("../core/product.cjs").obsPlugin;
  const root = path.resolve(__dirname, ".."),
    out = path.join(root, "release");
  const [built] = await packager({
    dir: root,
    name: obs ? "RewardDeskOBS" : "RewardDesk",
    executableName: obs ? "RewardDeskOBS" : "RewardDesk",
    platform: "win32",
    arch: "x64",
    out,
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, "assets/icon.ico"),
    ignore: (file) => {
      const first = file.replace(/\\/g, "/").replace(/^\//, "").split("/")[0];
      return (
        !!first &&
        ![
          "assets",
          "core",
          "ui",
          "overlay",
          "node_modules",
          "main.cjs",
          "preload.cjs",
          "package.json",
          "package-lock.json",
          "twitch-client.json",
        ].includes(first)
      );
    },
    appVersion: require("../package.json").version,
    win32metadata: {
      CompanyName: "FermionaPlay",
      FileDescription: obs ? "Reward Desk OBS runtime" : "Reward Desk",
      ProductName: obs ? "Reward Desk OBS" : "Reward Desk",
    },
  });
  for (const name of [
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "CHANGELOG.md",
  ])
    fs.copyFileSync(path.join(root, name), path.join(built, name));
  fs.copyFileSync(
    path.join(root, "assets/icon.ico"),
    path.join(built, "resources/app.ico"),
  );
  fs.cpSync(path.join(root, "docs"), path.join(built, "docs"), {
    recursive: true,
  });
  console.log(built);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
