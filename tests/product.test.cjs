const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const product = require("../core/product.cjs");
const pkg = require("../package.json");

test("product identity, build and updater are fixed to this repository", () => {
  assert(Object.isFrozen(product));
  assert.equal(product.id, pkg.name);
  assert.equal(product.name, pkg.productName);
  assert.equal(product.repository, "foolka/" + pkg.name);
  assert.equal(product.obsPlugin, pkg.name === "reward-desk-obs");
  assert.equal(product.profileName, product.obsPlugin ? "RewardDeskOBS" : "RewardDesk");
  assert.equal(product.port, product.obsPlugin ? 18875 : 18874);
  assert.equal(fs.existsSync(path.join(__dirname, "../obs-plugin/CMakeLists.txt")), product.obsPlugin);
  assert.equal(fs.existsSync(path.join(__dirname, "../tools/installer.iss")), !product.obsPlugin);
  assert(!("package:obs" in pkg.scripts));
  const build = fs.readFileSync(path.join(__dirname, "../tools/build.cjs"), "utf8");
  assert(!build.includes('process.argv.includes("--obs-plugin")'));
  assert(build.includes('require("../core/product.cjs").obsPlugin'));
});
