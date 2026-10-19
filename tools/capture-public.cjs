const { _electron: electron, chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store, importMedia } = require('../core/store.cjs');
const { initialReward } = require('../core/model.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results/public');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(out, 'profile-'));
const seed = new Store(profile);
function media(name, video, frequency = 440) {
  const file = path.join(profile, name);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', video ? 'testsrc2=size=640x360:rate=24' : `sine=frequency=${frequency}:duration=2`, '-t', '2', ...(video ? ['-c:v', 'libvpx-vp9', '-b:v', '300k'] : []), file], { windowsHide: true });
  return importMedia(seed, file, video ? 'video' : 'audio');
}
const sounds = [media('Chime.wav', false), media('Welcome.wav', false, 660), media('Bonus.wav', false, 880)];
const videos = [media('Stream break.webm', true), media('Highlights.webm', true)];
const audio = seed.saveReward({ ...initialReward(), title: 'Sound roulette', prompt: 'A random sound for the stream', cost: 300, cooldown: 30, items: sounds.map((m, i) => ({ id: m.id, weight: i + 1, volume: 65 })) });
const video = seed.saveReward({ ...initialReward('video'), title: 'Video break', cost: 1000, background: '#dc8858', items: videos.map(m => ({ id: m.id, weight: 1, volume: 70, captionText: 'STREAM BREAK' })) });
seed.close();
let app, browser;
(async () => {
  for (const mode of [require('../core/product.cjs').obsPlugin ? 'obs' : 'app']) {
    const env = { ...process.env, REWARD_DESK_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [root, '--test-mode', '--mute-audio', ...(mode === 'obs' ? ['--obs-plugin'] : [])], env });
    let page = await app.firstWindow();
    if (mode === 'obs') {
      const endpoint = path.join(profile, 'obs-control-endpoint.json');
      for (let i = 0; i < 100 && !fs.existsSync(endpoint); i++) await new Promise(r => setTimeout(r, 100));
      const d = JSON.parse(fs.readFileSync(endpoint));
      const response = await fetch(d.origin + '/dock/command', { method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'open-editor' }) });
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      page = await browser.newPage(); await page.goto((await response.json()).url);
    }
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.locator('.reward-item').first().waitFor();
    for (const language of ['ru', 'uk', 'en']) {
      const folder = path.join(out, mode, language); fs.mkdirSync(folder, { recursive: true });
      await page.locator('#language').selectOption(language);
      await page.locator('[data-tab=rewards]').click(); await page.locator('#kind-audio').click();
      await page.locator(`[data-id="${audio.id}"]`).click();
      await page.locator('[data-field=title]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(folder, 'audio.png') });
      await page.locator('#kind-video').click(); await page.locator(`[data-id="${video.id}"]`).click();
      await page.locator('#placement').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(folder, 'video.png') });
      await page.locator('#caption-text').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(folder, 'text.png') });
      await page.locator('[data-tab=settings]').click();
      await page.screenshot({ path: path.join(folder, 'connection.png') });
      console.log(`Captured ${mode}/${language}`);
    }
    if (browser) { await browser.close(); browser = null; }
    await app.close(); app = null;
  }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); await app?.close(); });
