const { randomUUID, createHash } = require("node:crypto");
const sha = (value) => createHash("sha256").update(value).digest("base64");
class ObsSocket {
  constructor(config, WebSocketImpl = WebSocket) {
    this.config = config;
    this.WebSocket = WebSocketImpl;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new this.WebSocket(
        `ws://127.0.0.1:${this.config.port}`,
      ));
      const timer = setTimeout(() => {
        reject(Error("OBS не ответил"));
        this.close();
      }, 5000);
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const { op, d } = msg;
        if (!d || typeof d !== "object") return;
        if (op === 0) {
          const identity = { rpcVersion: 1, eventSubscriptions: 0 };
          if (d.authentication)
            identity.authentication = sha(
              sha(this.config.password + d.authentication.salt) +
                d.authentication.challenge,
            );
          ws.send(JSON.stringify({ op: 1, d: identity }));
        }
        if (op === 2) {
          clearTimeout(timer);
          this.ready = true;
          resolve();
        }
        if (op === 7) {
          const request = this.pending.get(d.requestId);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(d.requestId);
          d.requestStatus.result
            ? request.resolve(d.responseData || {})
            : request.reject(
                Error(`OBS: ${d.requestType} (${d.requestStatus.code})`),
              );
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(Error("Нет соединения с OBS WebSocket"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        this.ready = false;
        reject(Error("OBS отключён или пароль не принят"));
        this.rejectPending();
      };
    });
  }
  request(type, data = {}) {
    if (!this.ready) return Promise.reject(Error("OBS не подключён"));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("OBS не ответил: " + type));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(
        JSON.stringify({
          op: 6,
          d: { requestType: type, requestId: id, requestData: data },
        }),
      ); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  rejectPending() {
    for (const r of this.pending.values()) {
      clearTimeout(r.timer);
      r.reject(Error("OBS отключён"));
    }
    this.pending.clear();
  }
  close() {
    this.ready = false;
    this.ws?.close();
    this.rejectPending();
  }
}
class ObsRecovery {
  constructor({
    overlay,
    engine,
    store,
    changed = () => {},
    config = null,
    connect = (config) => new ObsSocket(config),
    now = Date.now,
  }) {
    Object.assign(this, {
      overlay,
      engine,
      store,
      changed,
      config,
      connect,
      now,
    });
    this.status = "Не подключено";
    this.missingSince = null;
    this.attempts = [];
    this.lastRecovery = 0;
  }
  view() {
    return {
      configured: !!this.config,
      enabled: this.store.meta("obsAutoRecover", false),
      connected: !!this.socket?.ready,
      status: this.store.meta("obsAutoRecover", false) ? this.status : "Защита выключена",
      lastRecovery: this.lastRecovery,
    };
  }
  start() {
    this.closed = false;
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
    void this.tick();
  }
  async configure(config) {
    if (this.busy)
      throw Error(
        "Проверяется соединение с OBS. Повторите через несколько секунд.",
      );
    if (
      !Number.isInteger(config.port) ||
      config.port < 1024 ||
      config.port > 65535 ||
      typeof config.password !== "string" ||
      config.password.length > 1024
    )
      throw Error("Неверные настройки OBS WebSocket");
    this.configuring = true;
    const probe = this.connect(config);
    try {
      await probe.connect();
      const version = await probe.request("GetVersion");
      for (const name of [
        "GetInputList",
        "GetInputSettings",
        "GetSourceActive",
        "PressInputPropertiesButton",
      ])
        if (!version.availableRequests?.includes(name))
          throw Error("Обновите OBS: отсутствует " + name);
    } catch (e) {
      probe.close();
      this.configuring = false;
      throw e;
    }
    this.socket?.close();
    this.config = config;
    this.socket = probe;
    this.status = "OBS подключён";
    this.missingSince = null;
    this.attempts = [];
    this.configuring = false;
    this.changed();
  }
  usePrepared(config) {
    this.socket?.close();
    this.config = config;
    this.socket = null;
    this.status = "Защита настроена. Запустите OBS";
    this.missingSince = null;
    this.attempts = [];
  }
  async tick() {
    if (this.busy || this.closed || this.configuring) return;
    if (!this.config || !this.store.meta("obsAutoRecover", false)) {
      this.socket?.close();this.socket=null;this.missingSince=null;
      return;
    }
    this.busy = true;
    try {
      if (!this.socket?.ready) {
        this.socket?.close();
        this.socket = this.connect(this.config);
        await this.socket.connect();
      }
      if (this.closed) return;
      const health = this.overlay.view();
      if (health.error) {this.status=health.error;this.missingSince=null;return;}
      if (health.obsClients > 0) {
        this.missingSince = null;
        this.status = "Источник OBS отвечает";
        return;
      }
      this.missingSince ??= this.now();
      this.status = "Ожидание источника OBS";
      if (this.now() - this.missingSince < 20000 || this.engine.playing())
        return;
      this.attempts = this.attempts.filter((t) => this.now() - t < 300000);
      if (this.attempts.length >= 3) {
        this.status = "Источник не восстановлен: проверьте OBS";
        return;
      }
      if (this.attempts.length && this.now() - this.attempts.at(-1) < 60000)
        return;
      const { inputs } = await this.socket.request("GetInputList", {
        inputKind: "browser_source",
      });
      let matched = 0,
        active = 0;
      for (const input of inputs) {
        const { inputSettings } = await this.socket.request(
          "GetInputSettings",
          { inputName: input.inputName },
        );
        if (inputSettings.url !== this.overlay.url()) continue;
        matched++;
        const state = await this.socket.request("GetSourceActive", {
          sourceName: input.inputName,
        });
        if (!state.videoActive) continue;
        active++;
        // Recheck ownership after the async activity query before refreshing anything.
        const current = await this.socket.request("GetInputSettings", {inputName:input.inputName});
        if (current.inputSettings.url !== this.overlay.url()) continue;
        if (
          this.closed ||
          this.engine.playing() ||
          this.overlay.view().obsClients > 0 ||
          !this.store.meta("obsAutoRecover", false)
        )
          return;
        this.attempts.push(this.now());
        await this.socket.request("PressInputPropertiesButton", {
          inputName: input.inputName,
          propertyName: "refreshnocache",
        });
        this.lastRecovery = this.now();
        this.missingSince = this.now();
        this.status = "Источник обновлён; ожидание подключения";
        this.store.log("Автовосстановление OBS: " + input.inputName);
        break;
      }
      if (!matched) this.status = "Источник с текущим URL не найден в OBS";
      else if (!active) this.status = "Источник неактивен в текущей сцене";
    } catch (e) {
      this.status = e.message;
      this.socket?.close();
    } finally {
      this.busy = false;
      if (!this.closed) this.changed();
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.socket?.close();
  }
}
module.exports = { ObsSocket, ObsRecovery };
