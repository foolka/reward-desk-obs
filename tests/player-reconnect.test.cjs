const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function player() {
  let now = 1000,
    sequence = 0,
    reloaded = 0;
  const sources = [],
    timers = new Map(),
    intervals = [],
    requests = [];
  class EventSource {
    constructor() {
      this.events = {};
      sources.push(this);
    }
    addEventListener(type, fn) {
      this.events[type] = fn;
    }
    close() {
      this.closed = true;
    }
    emit(type, value) {
      this.events[type]({ data: JSON.stringify(value) });
    }
  }
  const context = vm.createContext({
    document: {
      querySelector: (s) =>
        s === "#stage" ? { style: {} } : { content: "current" },
    },
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {},
    location: { reload: () => reloaded++ },
    EventSource,
    AbortSignal,
    Date: { now: () => now },
    setTimeout: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => intervals.push(fn),
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { status: 204 };
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../overlay/player.js"), "utf8"),
    context,
  );
  return {
    sources,
    timers,
    requests,
    intervals,
    advance: (ms) => (now += ms),
    reloads: () => reloaded,
    retry() {
      const [id, t] = [...timers][0];
      timers.delete(id);
      t.fn();
      return t.ms;
    },
  };
}

test("source reconnects after errors with bounded backoff and resets on hello", () => {
  const p = player();
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
    const source = p.sources.at(-1);
    source.onerror();
    assert.equal(source.closed, true);
    assert.equal(p.timers.size, 1);
    assert.equal(p.retry(), delay);
  }
  p.sources.at(-1).emit("hello", { id: "test-client", build: "current" });
  assert.equal(p.requests.at(-1).type, "ready");
  assert.equal(p.requests.at(-1).build, "current");
  p.sources.at(-1).onerror();
  assert.equal(p.retry(), 1000);
});

test("silent connection reconnects without replay and a new build reloads page", () => {
  const p = player(),
    initial = p.sources[0];
  initial.emit("hello", { id: "client", build: "current" });
  p.advance(7000);
  p.intervals[0]();
  assert.equal(p.sources.length, 1);
  initial.emit("ping", {});
  p.advance(7000);
  p.intervals[0]();
  assert.equal(p.sources.length, 1);
  p.advance(1001);
  p.intervals[0]();
  assert.equal(initial.closed, true);
  assert.equal(p.sources.length, 2);
  assert.deepEqual(
    p.requests.map((r) => r.type),
    ["ready", "heartbeat"],
  );
  p.sources[1].emit("hello", { id: "new-client", build: "updated" });
  assert.equal(p.reloads(), 1);
  assert.equal(p.sources[1].closed, true);
});
