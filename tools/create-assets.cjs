const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");
function xml(node) {
  const [name, attrs, children = []] = node;
  return `<${name} ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ")}>${children.map(xml).join("")}</${name}>`;
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: 256, height: 256 },
    });
    const svg = xml(require("lucide").icons.Clapperboard);
    await page.setContent(
      `<style>body{margin:0;background:transparent}div{width:256px;height:256px;border-radius:48px;background:#197b6a;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 -12px 0 #126453}svg{width:176px;height:176px;color:#fff;stroke-width:1.7}</style><div>${svg}</div>`,
    );
    const root = path.resolve(__dirname, "../assets");
    fs.mkdirSync(root, { recursive: true });
    const png = await page.screenshot({
      path: path.join(root, "icon.png"),
      omitBackground: true,
    });
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(root, "icon.ico"), Buffer.concat([header, png]));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
