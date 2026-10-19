const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
class Overlay {
  constructor({ store, engine, account, changed = () => {} }) {
    Object.assign(this, { store, engine, account, changed });
    this.clients = new Map();
    this.error = "";
    this.token = store.meta("overlayToken");
    this.base = "/o/" + this.token;
    this.build = createHash("sha256");
    for (const file of [
      "index.html",
      "player.js",
      "player.css",
      "geometry.js",
      "caption.js",
      "caption.css",
    ])
      this.build.update(
        fs.readFileSync(path.join(__dirname, "../overlay", file)),
      );
    this.build = this.build.digest("hex");
  }
  url() {
    return `http://127.0.0.1:${this.port}${this.base}/`;
  }
  view() {
    return {
      url: this.url(),
      port: this.port,
      clients: [...this.clients.values()].filter(
        (c) => c.ready && Date.now() - c.seen < 12000,
      ).length,
      obsClients: [...this.clients.values()].filter(
        (c) => c.obs && c.ready && Date.now() - c.seen < 12000,
      ).length,
      outdated: [...this.clients.values()].some(
        (c) => c.obs && c.build !== this.build,
      ),
      error: this.error,
    };
  }
  async start(port = 18874) {
    const server = http.createServer(
      (req, res) =>
        void this.handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        }),
    );
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    this.server = server;
    this.port = server.address().port;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    return this.url();
  }
  async handle(req, res) {
    const host = "127.0.0.1:" + this.port;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (
      req.headers.host !== host ||
      (req.headers.origin &&
        req.headers.origin !== "http://" + host &&
        !(req.method === "GET" && req.headers.origin === "null"))
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, "http://" + host),
      route = url.pathname;
    if (!route.startsWith(this.base + "/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const leaf = route.slice(this.base.length);
    if (
      req.method === "GET" &&
      [
        "/",
        "/player.js",
        "/player.css",
        "/geometry.js",
        "/caption.js",
        "/caption.css",
      ].includes(leaf)
    ) {
      const file = leaf === "/" ? "index.html" : leaf.slice(1);
      res.setHeader(
        "Content-Type",
        leaf.endsWith(".js")
          ? "text/javascript"
          : leaf.endsWith(".css")
            ? "text/css"
            : "text/html; charset=utf-8",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'",
      );
      const data = fs.readFileSync(path.join(__dirname, "../overlay", file));
      res.end(
        file === "index.html"
          ? data.toString("utf8").replace("REWARD_BUILD", this.build)
          : data,
      );
      return;
    }
    if (req.method === "GET" && leaf === "/events") {
      if (this.clients.size >= 8) {
        res.writeHead(429);
        res.end();
        return;
      }
      const id = randomUUID(),
        c = {
          id,
          res,
          seen: Date.now(),
          ready: false,
          obs: /obs-browser|OBS(?:Studio)?\//i.test(req.headers["user-agent"] || ""),
          build: "",
        };
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      this.clients.set(id, c);
      this.send(c, "hello", { id, build: this.build });
      this.changed();
      res.on("close", () => {
        this.clients.delete(id);
        if (this.closed) return;
        const playing = this.engine.playing();
        if (playing?.client === id)
          this.engine.interrupt(
            playing.id,
            "OBS отключился во время воспроизведения",
          );
        this.changed();
      });
      return;
    }
    if (req.method === "POST" && leaf === "/ack") {
      if (req.headers["content-type"] !== "application/json") {
        res.writeHead(415);
        res.end();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const c = this.clients.get(value.client);
      if (!c) {
        res.writeHead(409);
        res.end();
        return;
      }
      c.seen = Date.now();
      const wasReady = c.ready;
      c.build = value.build || "";
      c.ready = !c.obs || c.build === this.build;
      if (c.ready !== wasReady) {
        if (c.obs && c.ready)
          this.store.log("Источник OBS подключён, версия страницы проверена");
        this.changed();
      }
      const j = this.engine.playing();
      if (value.id && j?.id === value.id && j.client === c.id) {
        if (value.type === "ended") this.engine.finish(j.id, true);
        if (value.type === "error")
          this.engine.finish(
            j.id,
            false,
            "Медиа не воспроизвелось: проверьте формат и OBS",
          );
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (["GET", "HEAD"].includes(req.method) && leaf.startsWith("/media/")) {
      const id = leaf.slice(7),
        m = this.store.media(id);
      if (!m) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = this.store.mediaPath(id);
      let size;
      try {
        size = fs.statSync(file).size;
      } catch {
        res.writeHead(404);
        res.end();
        return;
      }
      let start = 0,
        end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          res.end();
          return;
        }
        if (!match[1]) start = Math.max(0, size - Number(match[2]));
        else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(end, Number(match[2]));
        }
        if (start > end || start >= size) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          res.end();
          return;
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader("Content-Type", m.mime);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", end - start + 1);
      if (req.method === "HEAD") res.end();
      else {
        const stream = fs.createReadStream(file, { start, end });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      }
      return;
    }
    res.writeHead(404);
    res.end();
  }
  send(c, type, data) {
    if (!c.res.destroyed)
      c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  tick() {
    if (this.activeId && this.engine.playing()?.id !== this.activeId) {
      this.stopPlayback();
      this.activeId = "";
    }
    for (const c of this.clients.values()) {
      if (Date.now() - c.seen > 12000) {
        c.ready = false;
        const job = this.engine.playing();
        if (job?.client === c.id) {
          this.engine.interrupt(
            job.id,
            "Источник OBS не отвечает. Проверьте показ перед повтором.",
          );
          this.store.log(
            "Источник OBS потерял связь во время показа. Автоповтор отключён.",
          );
        }
        c.res.end();
        continue;
      }
      this.send(c, "ping", {});
    }
    const playing = this.engine.playing();
    if (playing) {
      if (Date.now() - playing.startedAt > 10 * 60000) {
        this.stopPlayback();
        this.engine.interrupt(playing.id, "Превышено 10 минут воспроизведения");
      }
      return;
    }
    if (this.store.meta("paused", false)) return;
    const c = [...this.clients.values()].find(
      (c) => c.ready && Date.now() - c.seen < 12000,
    );
    if (!c) return;
    const next = this.engine.next(this.account());
    if (!next) return;
    const job = this.engine.start(next, c.id);
    if (!job) return;
    this.activeId = job.id;
    this.send(c, "play", {
      id: job.id,
      kind: job.kind,
      volume: job.item.volume,
      url: this.base + "/media/" + job.item.id,
      video: job.video,
    });
  }
  stopPlayback() {
    for (const c of this.clients.values()) this.send(c, "stop", {});
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    const j = this.engine.playing();
    if (j) this.engine.interrupt(j.id, "Источник остановлен");
    for (const c of this.clients.values()) c.res.end();
    this.clients.clear();
    this.server?.close();
  }
}
module.exports = { Overlay };
