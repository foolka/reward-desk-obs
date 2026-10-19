const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const product = require("./product.cjs");
const REPO = product.repository;
function version(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    value || "",
  );
  if (!match) throw Error("Некорректная версия обновления");
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error("Некорректная версия");
  return parts;
}
function newer(a, b) {
  const aa = version(a),
    bb = version(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
function assetUrl(value, tag, name) {
  const expected = `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  if (value !== expected) throw Error("Недопустимый адрес обновления");
  return value;
}
function releaseInfo(release, current) {
  if (release.draft || release.prerelease)
    throw Error("Нет стабильного выпуска");
  if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw Error("Выпуск предназначен для другого варианта Reward Desk");
  const next = version(release.tag_name).join(".");
  if (!newer(next, current)) return null;
  const name = `${product.id}-${next}-windows-x64-setup.exe`;
  const installer = release.assets?.find(
    (a) => a.name === name && a.state === "uploaded",
  );
  const checksum = release.assets?.find(
    (a) => a.name === name + ".sha256" && a.state === "uploaded",
  );
  if (
    !installer ||
    !checksum ||
    !Number.isSafeInteger(installer.size) ||
    installer.size <= 0 ||
    installer.size > 512 * 1024 * 1024
  )
    throw Error("В выпуске нет установщика с контрольной суммой");
  return {
    version: next,
    name,
    size: installer.size,
    url: assetUrl(installer.browser_download_url, release.tag_name, name),
    checksum: assetUrl(
      checksum.browser_download_url,
      release.tag_name,
      name + ".sha256",
    ),
    notes: String(release.body || "").slice(0, 12000),
  };
}
function allowedUrl(value) {
  const u = new URL(value);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === "443") &&
    [
      "api.github.com",
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(u.hostname)
  );
}
async function request(url, timeout = 20000) {
  const signal = AbortSignal.timeout(timeout);
  for (let i = 0; i < 6; i++) {
    if (!allowedUrl(url)) throw Error("Небезопасный адрес обновления");
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "RewardDesk-Updater",
        Accept:
          new URL(url).hostname === "api.github.com"
            ? "application/vnd.github+json"
            : "application/octet-stream",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("Некорректное перенаправление GitHub");
      url = new URL(location, url).href;
      continue;
    }
    return response;
  }
  throw Error("Слишком много перенаправлений");
}
async function body(response, max, receive) {
  if (!response.ok) throw Error(`GitHub: HTTP ${response.status}`);
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > max) throw Error("Размер обновления превышает допустимый");
      await receive(chunk, size);
    }
  } finally {
    if (!response.body.locked) await response.body.cancel().catch(() => {});
  }
  return size;
}
async function smallResponse(response, max) {
  const chunks = [];
  await body(response, max, (chunk) => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}
function checksumText(text, name) {
  const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)\s*$/i.exec(text.trim());
  if (!match || match[2] !== name)
    throw Error("Некорректная контрольная сумма установщика");
  return match[1].toLowerCase();
}
class Updates {
  constructor({ current, changed = () => {}, get = request }) {
    this.current = current;
    this.changed = changed;
    this.get = get;
    this.state = { status: "idle", message: "Проверка ещё не выполнена" };
  }
  set(value) {
    this.state = value;
    this.changed();
  }
  async check() {
    if (["checking", "downloading", "installing"].includes(this.state.status))
      return this.state;
    this.set({ status: "checking", message: "Проверяем GitHub…" });
    try {
      const response = await this.get(
        `https://api.github.com/repos/${REPO}/releases?per_page=100`,
      );
      if (response.status === 404) {
        await response.body?.cancel();
        this.set({
          status: "unavailable",
          message:
            "Нет доступного публичного выпуска. Приватные выпуски требуют отдельного доступа.",
        });
      } else {
        const releases = JSON.parse(await smallResponse(response, 2 * 1024 * 1024));
        if (!Array.isArray(releases)) throw Error("Некорректный список выпусков GitHub");
        const tagPattern = /^v\d+\.\d+\.\d+$/;
        const number = (r) => r.tag_name;
        const release = releases.filter((r) => !r.draft && !r.prerelease && tagPattern.test(r.tag_name))
          .sort((a, b) => newer(number(a), number(b)) ? -1 : newer(number(b), number(a)) ? 1 : 0)[0];
        if (!release) { this.set({ status: "unavailable", message: "Нет доступного публичного выпуска. Приватные выпуски требуют отдельного доступа." }); return this.state; }
        const info = releaseInfo(release, this.current);
        this.set(
          info
            ? {
                status: "available",
                message: `Доступна версия ${info.version}`,
                release: info,
              }
            : { status: "current", message: "Установлена актуальная версия" },
        );
      }
    } catch (error) {
      this.set({
        status: "error",
        message: `Проверка не выполнена: ${error.message}`,
      });
    }
    return this.state;
  }
  async download(directory) {
    const release = this.state.release;
    if (!release || this.state.status !== "available")
      throw Error("Сначала проверьте обновления");
    this.set({
      status: "downloading",
      release,
      progress: 0,
      message: "Загрузка установщика…",
    });
    const folder = path.join(directory, randomUUID());
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, release.name);
    try {
      const hash = checksumText(
        await smallResponse(await this.get(release.checksum), 1024),
        release.name,
      );
      const fd = await fs.promises.open(file + ".part", "wx");
      const digest = createHash("sha256");
      let size,
        last = -1;
      try {
        size = await body(
          await this.get(release.url, 600000),
          release.size,
          async (chunk, received) => {
            digest.update(chunk);
            let offset = 0;
            while (offset < chunk.length)
              offset += (await fd.write(chunk, offset, chunk.length - offset))
                .bytesWritten;
            const progress = Math.floor((received / release.size) * 100);
            if (progress !== last) {
              last = progress;
              this.set({ ...this.state, progress });
            }
          },
        );
        await fd.sync();
      } finally {
        await fd.close();
      }
      if (size !== release.size || digest.digest("hex") !== hash)
        throw Error(
          "Контрольная сумма установщика не совпала. Установка отменена.",
        );
      fs.renameSync(file + ".part", file);
      this.set({
        status: "installing",
        release,
        message: "Подготовка резервной копии и установки…",
      });
      return { file, hash, folder, version: release.version };
    } catch (error) {
      this.set({ status: "available", release, message: error.message });
      throw error;
    }
  }
}
async function launchInstaller(
  download,
  { profile, executable, pid, backupRoot },
) {
  const script = path.join(download.folder, "install.ps1");
  const launcher = path.join(download.folder, "start.ps1");
  const requestPath = path.join(download.folder, "request.json");
  const ready = path.join(download.folder, "ready");
  fs.copyFileSync(path.join(__dirname, "update-install.ps1"), script);
  fs.copyFileSync(path.join(__dirname, "update-start.ps1"), launcher);
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      ...download,
      profile,
      executable,
      pid,
      backupRoot,
      ready,
    }),
    { flag: "wx" },
  );
  const log = fs.openSync(path.join(download.folder, "helper.log"), "a");
  const env = { ...process.env };
  // PowerShell 7 module paths break Windows PowerShell's built-in cmdlets.
  for (const key of Object.keys(env))
    if (key.toLowerCase() === "psmodulepath") delete env[key];
  let child;
  try {
    child = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
        "-RequestPath",
        requestPath,
      ],
      { windowsHide: true, stdio: ["ignore", log, log], env },
    );
  } finally {
    fs.closeSync(log);
  }
  let failed;
  child.on("error", (error) => {
    failed = error;
  });
  child.on("exit", (code) => {
    if (code !== 0 && !fs.existsSync(ready))
      failed = Error(
        `Помощник установки завершился (${code}). Подробности в helper.log: ${download.folder}`,
      );
  });
  child.unref();
  for (let i = 0; i < 150; i++) {
    if (failed) throw failed;
    if (fs.existsSync(ready)) return;
    if (fs.existsSync(path.join(download.folder, "result.json")))
      throw Error(
        "Помощник установки сообщил об ошибке. См. result.json: " +
          download.folder,
      );
    await delay(100);
  }
  // Without the commit file, the helper never installs, even if it starts late.
  throw Error(
    "Помощник установки не запустился. Приложение остаётся открытым.",
  );
}
module.exports = {
  Updates,
  launchInstaller,
  newer,
  releaseInfo,
  checksumText,
  allowedUrl,
};
