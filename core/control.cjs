const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const EDITOR_COMMANDS = new Set([
  "preferences", "check-updates", "auto-updates", "install-update",
  "channel-list", "channel-save", "channel-dashboard", "group-save", "group-remove",
  "obs-connect", "obs-auto", "new", "save", "versions", "restore-draft", "publish",
  "remove", "test", "pause", "stop", "retry", "cancel", "port", "login",
  "cancel-login", "logout", "reconnect",
  "recover-profile", "folder",
]);
const DOCK_COMMANDS = new Set(["pause", "stop", "check-updates", "reconnect"]);
const token = () => randomBytes(32).toString("hex");
const same = (a, b) => typeof a === "string" && a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (message, status = 400) => Object.assign(Error(message), { status });
async function json(req) {
  if (req.headers["content-type"] !== "application/json") throw error("JSON required", 415);
  let bytes = 0, chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1048576) throw error("Request too large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); }
  catch { throw error("Invalid JSON"); }
}

// One process owns the database. The dock has a separate, deliberately narrow capability.
class Control {
  constructor({ root, snapshot, execute, stash, upload, openEditor, desktopVisible, now = Date.now }) {
    Object.assign(this, { root, snapshot, execute, stash, upload, openEditor, desktopVisible, now });
    this.dockKey = token();
    this.editorKey = token();
    this.lease = null;
    this.uploads = 0;
  }
  editorActive() { return this.lease && this.now() - this.lease.seen < 90000; }
  assertDesktop() {
    if (this.editorActive()) throw error("Редактор открыт в браузере. Закройте его вкладку перед редактированием в приложении.", 409);
  }
  claim(id) {
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id || "")) throw error("Editor identity required", 403);
    if (this.desktopVisible()) throw error("Редактор открыт в приложении. Откройте браузер через панель Reward Desk в OBS.", 409);
    if (this.editorActive() && this.lease.id !== id)
      throw error("Редактор уже открыт в другой вкладке. Закройте её и повторите подключение.", 409);
    if (this.lease && this.lease.id !== id && !this.editorActive()) this.lease = null;
    this.lease = { id, seen: this.now() };
  }
  authorizeEditor(id) {
    if (!this.editorActive() || this.lease.id !== id || this.desktopVisible())
      throw error("Сеанс редактора завершён. Откройте редактор заново из OBS. Изменения не перезаписаны.", 409);
    this.lease.seen = this.now();
  }
  editorUrl() { return `${this.origin}/editor/#${this.editorKey}`; }
  async start() {
    this.server = http.createServer((req, res) => void this.handle(req, res).catch((e) => {
      if (!res.headersSent) this.reply(res, e.status || 400, { error: e.message });
      else res.destroy();
    }));
    this.server.requestTimeout = 300000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
    this.descriptor = path.join(this.root, "obs-control-endpoint.json");
    fs.writeFileSync(this.descriptor + ".tmp", JSON.stringify({ protocol: 1, pid: process.pid,
      origin: this.origin, token: this.dockKey, version: this.snapshot().version }));
    fs.renameSync(this.descriptor + ".tmp", this.descriptor);
  }
  reply(res, status, value) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value ?? null));
  }
  status() {
    const s = this.snapshot();
    const playing = s.jobs.find((j) => j.state === "playing");
    return { protocol: 1, version: s.version, preferences: s.preferences, paused: s.paused,
      twitch: s.twitch, account: s.auth.user?.login || "", connected: s.auth.status === "ready",
      overlay: s.overlay, queued: s.jobs.filter((j) => j.state === "queued").length,
      attention: s.jobs.filter((j) => j.state === "attention").length,
      playing: playing ? s.rewards.find((r) => r.id === playing.rewardId)?.title || playing.title || "Награда" : "",
      updates: s.updates, logs: s.logs.slice(0, 5), editorOpen: !!this.editorActive() };
  }
  async handle(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.headers.host !== new URL(this.origin).host ||
      (req.headers.origin && req.headers.origin !== this.origin)) throw error("Forbidden origin", 403);
    const url = new URL(req.url, this.origin);
    if (req.method === "GET" && this.static(req, res, url.pathname)) return;
    const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (url.pathname.startsWith("/dock/")) {
      if (!same(bearer, this.dockKey)) throw error("Unauthorized", 401);
      if (req.method === "GET" && url.pathname === "/dock/state") return this.reply(res, 200, this.status());
      if (req.method === "POST" && url.pathname === "/dock/command") {
        const { command, arg } = await json(req);
        if (command === "open-editor") {
          await this.openEditor(this.editorUrl());
          return this.reply(res, 200, { ok: true, url: this.editorUrl() });
        }
        if (!DOCK_COMMANDS.has(command)) throw error("Command not permitted", 403);
        await this.execute(command, arg, { dock: true });
        return this.reply(res, 200, this.status());
      }
    }
    // sendBeacon cannot set Authorization. Its body contains the editor capability,
    // and still requires a same-origin JSON POST. It can only persist a draft and leave.
    if (req.method === "POST" && url.pathname === "/api/leave") {
      const body = await json(req);
      if (!same(body.token, this.editorKey)) throw error("Unauthorized", 401);
      this.authorizeEditor(body.editor);
      if (body.draft) this.stash(body.draft);
      this.lease = null;
      return this.reply(res, 200, { ok: true });
    }
    if (!same(bearer, this.editorKey)) throw error("Unauthorized", 401);
    const id = req.headers["x-reward-editor"];
    if (req.method === "POST" && url.pathname === "/api/claim") {
      await json(req); this.claim(id);
      return this.reply(res, 200, this.snapshot());
    }
    this.authorizeEditor(id);
    if (req.method === "GET" && url.pathname === "/api/state") return this.reply(res, 200, this.snapshot());
    if (req.method === "POST" && url.pathname === "/api/draft") {
      this.stash(await json(req));
      return this.reply(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/command") {
      const { command, arg, confirmed } = await json(req);
      if (!EDITOR_COMMANDS.has(command)) throw error("Command not permitted", 403);
      return this.reply(res, 200, await this.execute(command, arg, { browser: true, confirmed: confirmed === true }));
    }
    if (req.method === "POST" && url.pathname === "/api/upload") {
      if (this.uploads) throw error("Загрузка уже выполняется", 409);
      const name = url.searchParams.get("name") || "";
      if (name !== path.basename(name) || /[\\/:\0]/.test(name) || name.length > 200 ||
        !/\.(mp4|webm|mp3|wav|ogg|m4a|flac)$/i.test(name)) throw error("Недопустимый файл");
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reward-upload-"));
      const file = path.join(directory, name);
      this.uploads++;
      try {
        let size = 0;
        await pipeline(req, new Transform({ transform(chunk, _, cb) {
          size += chunk.length;
          cb(size > 512 * 1024 * 1024 ? error("Файл больше 512 МБ", 413) : null, chunk);
        } }), fs.createWriteStream(file, { flags: "wx" }));
        this.authorizeEditor(id);
        return this.reply(res, 200, await this.upload(url.searchParams.get("id"), file));
      } finally {
        this.uploads--;
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(directory);
      }
    }
    throw error("Not found", 404);
  }
  static(req, res, route) {
    const base = path.resolve(__dirname, "..");
    let file;
    if (route === "/editor/") file = "ui/index.html";
    else if (/^\/editor\/[a-z0-9-]+\.(js|css)$/.test(route)) file = "ui/" + route.slice(8);
    else if (["/overlay/caption.css", "/overlay/caption.js", "/overlay/geometry.js",
      "/node_modules/lucide/dist/umd/lucide.js"].includes(route)) file = route.slice(1);
    if (!file || !fs.existsSync(path.join(base, file))) return false;
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http://127.0.0.1:*; media-src 'self' http://127.0.0.1:*; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
    let content = fs.readFileSync(path.join(base, file), "utf8");
    if (file === "ui/index.html") content = content.replace("connect-src 'none'", "connect-src 'self'")
      .replace('<script src="i18n.js">', '<script src="browser.js"></script><link rel="stylesheet" href="browser.css" /><script src="i18n.js">');
    res.end(content);
    return true;
  }
  close() {
    this.server?.closeAllConnections();
    this.server?.close();
    if (this.descriptor && fs.existsSync(this.descriptor)) {
      try {
        if (JSON.parse(fs.readFileSync(this.descriptor)).token === this.dockKey) fs.unlinkSync(this.descriptor);
      } catch { /* A later process may already own the descriptor. */ }
    }
  }
}
module.exports = { Control };
